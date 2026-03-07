/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Contract Reason Service
 *
 * AI-powered contract reasoning engine that validates code against compliance
 * contracts (framework rules) without touching framework definitions.
 * Frameworks stay pure pattern-based (regex, AST, dataflow, import-graph).
 * This service operates alongside them as the reasoning layer.
 *
 * ## How It Works
 *
 * **Phase 1 — Contract Comprehension (on import)**
 *
 * When a framework is loaded, this service sends ALL its rules to the LLM
 * with a comprehension prompt. The LLM builds an understanding of:
 * - What each rule is trying to enforce
 * - Edge cases that patterns might miss
 * - Relationships between rules
 * - Common violation patterns
 *
 * This understanding is cached per framework ID + version.
 *
 * **Phase 2 — Contract Reasoning (on file save)**
 *
 * After pattern checks run, this service receives the code + pattern results
 * and uses the contract understanding to:
 * - Find violations that patterns missed
 * - Flag likely false positives
 * - Add contextual explanations
 *
 * **Rate Limiting — Periodic Batch Processing**
 *
 * During workspace scans, files are processed in controlled batches to avoid
 * overwhelming the AI provider with bulk requests. The service uses:
 * - Configurable concurrency limit (max parallel LLM calls)
 * - Inter-batch cooldown delay to respect rate limits
 * - Exponential backoff on rate limit errors
 *
 * ## Void LLM API Reference
 *
 * This service calls Void's LLM module without modifying Void core:
 *
 * ```typescript
 * import { ILLMMessageService } from '../../void/common/sendLLMMessageService.js';
 * import { IVoidSettingsService } from '../../void/common/voidSettingsService.js';
 *
 * // Get user's configured model (Checks-specific with Chat fallback):
 * const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['Checks']
 *     ?? this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
 *
 * // Call LLM:
 * this.llmMessageService.sendLLMMessage({
 *     messagesType: 'chatMessages',
 *     messages: [...],
 *     modelSelection,
 *     onFinalMessage: ({ fullText }) => { ... },
 *     ...
 * });
 * ```
 *
 * ModelSelection = { providerName: ProviderName, modelName: string }
 */

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ICheckResult, IGRCRule, toDisplaySeverity } from '../types/grcTypes.js';
import { IFrameworkRegistry, ILoadedFramework } from '../framework/frameworkRegistry.js';
import { ILLMMessageService } from '../../../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../../../../void/common/voidSettingsService.js';
import { LLMChatMessage } from '../../../../void/common/sendLLMMessageTypes.js';
import { INanoAgentContext, IProjectAnalyzerService } from '../../nanoAgents/projectAnalyzerService.js';
import { IAccessibilitySignalService, AccessibilitySignal } from '../../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';



// ─── Service Interface ───────────────────────────────────────────────────────

export const IContractReasonService = createDecorator<IContractReasonService>('contractReasonService');

/**
 * Contract reasoning results from AI analysis.
 */
export interface ContractReasonResult {
	/** Violations the AI found that patterns missed */
	additionalViolations: ICheckResult[];
	/** Pattern results the AI thinks are false positives */
	falsePositiveFlags: { ruleId: string; line: number; reason: string }[];
	/**
	 * AI enrichments for EXISTING pattern violations.
	 * Maps ruleId:line to AI-generated explanation, fix, and confidence.
	 * These get applied to the existing ICheckResult objects.
	 */
	enrichments: Map<string, {
		aiExplanation: string;
		aiConfidence: 'high' | 'medium' | 'low';
	}>;
	/** File that was analyzed */
	fileUri: URI;
}

/**
 * Cached framework comprehension (contract understanding).
 */
interface ContractContext {
	frameworkId: string;
	version: string;
	/** LLM's structured understanding of the framework */
	understanding: string;
	/** When the comprehension was created */
	timestamp: number;
}


export interface IContractReasonService {
	readonly _serviceBrand: undefined;

	/** Whether contract reasoning is available (model configured + contract comprehended + enabled) */
	readonly isAvailable: boolean;

	/** Whether the contract reasoning system is enabled (defaults to OFF) */
	readonly isEnabled: boolean;

	/** Enable or disable the contract reasoning system */
	setEnabled(enabled: boolean): void;

	/** Event fired when enabled state changes */
	readonly onDidEnabledChange: Event<boolean>;

	/** Comprehend a framework's contracts — called on import/load */
	comprehendFramework(framework: ILoadedFramework): Promise<void>;

	/** Get contract-reasoning-enhanced results for a file */
	analyzeFile(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		context?: INanoAgentContext,
		contextFiles?: Map<string, string>
	): Promise<ContractReasonResult | undefined>;

	/** Event fired when contract reasoning results are ready */
	readonly onDidContractReasonResultsReady: Event<ContractReasonResult>;

	/** Send a one-shot query to the LLM (rate-limited). Returns raw response text. */
	sendOneShotQuery(prompt: string): Promise<string | undefined>;
}


// ─── Rate Limiter ────────────────────────────────────────────────────────────

/**
 * Controls the rate at which AI analysis requests are dispatched.
 * Prevents bulk workspace scans from overwhelming the LLM provider.
 */
class AnalysisRateLimiter {
	/** Pending analysis tasks waiting to be processed */
	private readonly _queue: Array<{ execute: () => Promise<void>; resolve: () => void }> = [];

	/** Number of currently in-flight LLM calls */
	private _activeCount = 0;

	/** Whether the drain loop is running */
	private _draining = false;

	/** Current backoff delay (increases on rate limit errors) */
	private _backoffMs = 0;

	/** Max concurrent file-level analyses */
	private static readonly MAX_CONCURRENCY = 2;

	/** Delay between batches (ms) — gives the API breathing room */
	private static readonly BATCH_COOLDOWN_MS = 3_000;

	/** Base backoff on rate limit error */
	private static readonly BACKOFF_BASE_MS = 5_000;

	/** Max backoff ceiling */
	private static readonly BACKOFF_MAX_MS = 60_000;

	/**
	 * Enqueue an analysis task. Returns a promise that resolves when the
	 * task has been dispatched (not when the LLM responds).
	 */
	enqueue(execute: () => Promise<void>): Promise<void> {
		return new Promise<void>((resolve) => {
			this._queue.push({ execute, resolve });
			this._drain();
		});
	}

	/** Signal that a rate limit error occurred — increase backoff */
	reportRateLimitError(): void {
		this._backoffMs = this._backoffMs === 0
			? AnalysisRateLimiter.BACKOFF_BASE_MS
			: Math.min(this._backoffMs * 2, AnalysisRateLimiter.BACKOFF_MAX_MS);
		console.warn(`[ContractReason] Rate limit hit — backoff increased to ${this._backoffMs}ms`);
	}

	/** Signal a successful call — gradually reduce backoff */
	reportSuccess(): void {
		if (this._backoffMs > 0) {
			this._backoffMs = Math.max(0, this._backoffMs - AnalysisRateLimiter.BACKOFF_BASE_MS);
		}
	}

	/** Number of items waiting + in-flight */
	get pending(): number {
		return this._queue.length + this._activeCount;
	}

	private async _drain(): Promise<void> {
		if (this._draining) return;
		this._draining = true;

		try {
			while (this._queue.length > 0) {
				// Wait for a slot to open
				if (this._activeCount >= AnalysisRateLimiter.MAX_CONCURRENCY) {
					await new Promise<void>(r => setTimeout(r, 200));
					continue;
				}

				// Apply backoff if we've been rate-limited
				if (this._backoffMs > 0) {
					console.log(`[ContractReason] Rate limit backoff: waiting ${this._backoffMs}ms before next batch`);
					await new Promise<void>(r => setTimeout(r, this._backoffMs));
				}

				// Dispatch up to MAX_CONCURRENCY tasks
				const batch: typeof this._queue[number][] = [];
				while (batch.length < AnalysisRateLimiter.MAX_CONCURRENCY && this._queue.length > 0) {
					batch.push(this._queue.shift()!);
				}

				this._activeCount += batch.length;

				// Fire all tasks in this batch concurrently
				await Promise.all(batch.map(async (task) => {
					try {
						await task.execute();
					} finally {
						this._activeCount--;
						task.resolve();
					}
				}));

				// Cooldown between batches to avoid bursts
				if (this._queue.length > 0) {
					await new Promise<void>(r => setTimeout(r, AnalysisRateLimiter.BATCH_COOLDOWN_MS));
				}
			}
		} finally {
			this._draining = false;
		}
	}
}


// ─── Implementation ──────────────────────────────────────────────────────────

export class ContractReasonService extends Disposable implements IContractReasonService {
	declare readonly _serviceBrand: undefined;

	/** Storage key for persisting framework comprehension contexts across restarts */
	private static readonly COMPREHENSION_STORAGE_KEY = 'grc.contractReasonComprehensions';

	/** Storage key for persisting per-file content hashes — skip LLM when content unchanged */
	private static readonly FILE_HASH_STORAGE_KEY = 'grc.fileContentHashes';

	/** Persisted content hashes from previous sessions: fileUri → hash */
	private _persistedHashes = new Map<string, string>();

	/** Cached framework comprehension contexts */
	private readonly _contractContexts = new Map<string, ContractContext>();

	/** Currently running analysis requests (prevent duplicates) */
	private readonly _runningAnalyses = new Set<string>();

	/** Cached analysis results per file hash (LRU) */
	private readonly _resultCache = new Map<string, { result: ContractReasonResult; hash: string }>();

	/** Maximum cached analysis entries */
	private static readonly MAX_CACHE = 50;

	/** Rate limiter for AI analysis requests */
	private readonly _rateLimiter = new AnalysisRateLimiter();

	private readonly _onDidContractReasonResultsReady = this._register(new Emitter<ContractReasonResult>());
	public readonly onDidContractReasonResultsReady = this._onDidContractReasonResultsReady.event;

	/** Contract reasoning enabled state — auto-enables when model is configured */
	private _enabled = false;
	private readonly _onDidEnabledChange = this._register(new Emitter<boolean>());
	public readonly onDidEnabledChange = this._onDidEnabledChange.event;

	constructor(
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IFrameworkRegistry private readonly frameworkRegistry: IFrameworkRegistry,
		@IProjectAnalyzerService private readonly projectAnalyzerService: IProjectAnalyzerService,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Restore framework comprehensions and file hashes from previous session.
		// Prevents re-running LLM calls on every IDE restart.
		this._loadPersistedComprehensions();
		this._loadPersistedHashes();

		// Auto-comprehend when frameworks change (only if enabled)
		this._register(this.frameworkRegistry.onDidFrameworksChange(() => {
			if (this._enabled) {
				this._comprehendAllFrameworks();
			}
		}));

		// Auto-enable/disable when model settings change
		this._register(this.voidSettingsService.onDidChangeState(() => {
			this._autoToggleBasedOnModel();
		}));

		// Check if we should auto-enable on startup
		this.voidSettingsService.waitForInitState.then(() => {
			this._autoToggleBasedOnModel();
		});

		console.log('[ContractReason] Service initialized (auto-enables when Checks or Chat model is configured)');
	}

	/**
	 * Load framework comprehension contexts from workspace storage.
	 * Populated by previous sessions — skips LLM calls for already-comprehended frameworks.
	 */
	private _loadPersistedComprehensions(): void {
		try {
			const stored = this.storageService.get(
				ContractReasonService.COMPREHENSION_STORAGE_KEY,
				StorageScope.WORKSPACE
			);
			if (!stored) return;

			const contexts: ContractContext[] = JSON.parse(stored);
			for (const ctx of contexts) {
				const key = `${ctx.frameworkId}:${ctx.version}`;
				this._contractContexts.set(key, ctx);
			}
			console.log(`[ContractReason] Restored ${contexts.length} contract comprehension(s) from storage`);
		} catch (e) {
			console.error('[ContractReason] Failed to load persisted comprehensions:', e);
		}
	}

	private _loadPersistedHashes(): void {
		try {
			const stored = this.storageService.get(ContractReasonService.FILE_HASH_STORAGE_KEY, StorageScope.WORKSPACE);
			if (!stored) return;
			const entries: [string, string][] = JSON.parse(stored);
			this._persistedHashes = new Map(entries);
			console.log(`[ContractReason] Restored content hashes for ${this._persistedHashes.size} file(s)`);
		} catch (e) {
			console.error('[ContractReason] Failed to load persisted file hashes:', e);
		}
	}

	private _savePersistedHashes(): void {
		try {
			const entries = Array.from(this._persistedHashes.entries());
			this.storageService.store(
				ContractReasonService.FILE_HASH_STORAGE_KEY,
				JSON.stringify(entries),
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE
			);
		} catch (e) {
			console.error('[ContractReason] Failed to persist file hashes:', e);
		}
	}

	/**
	 * Persist all framework comprehension contexts to workspace storage.
	 * Called after each successful comprehension to ensure next restart is free.
	 */
	private _saveComprehensions(): void {
		try {
			const contexts = Array.from(this._contractContexts.values());
			this.storageService.store(
				ContractReasonService.COMPREHENSION_STORAGE_KEY,
				JSON.stringify(contexts),
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE
			);
		} catch (e) {
			console.error('[ContractReason] Failed to persist comprehensions:', e);
		}
	}

	/**
	 * Automatically enable/disable contract reasoning based on whether
	 * a Checks or Chat model is configured.
	 */
	private _autoToggleBasedOnModel(): void {
		const modelSelection = this._getModelSelection();
		const shouldBeEnabled = !!modelSelection;

		if (shouldBeEnabled && !this._enabled) {
			this.setEnabled(true);
		} else if (!shouldBeEnabled && this._enabled) {
			this.setEnabled(false);
		}
	}


	// ─── Availability & Toggle ──────────────────────────────────────

	public get isEnabled(): boolean {
		return this._enabled;
	}

	public setEnabled(enabled: boolean): void {
		if (this._enabled === enabled) return;
		this._enabled = enabled;
		this._onDidEnabledChange.fire(enabled);

		if (enabled) {
			console.log('[ContractReason] Contract Reasoning ENABLED');
			// Comprehend frameworks now that we're enabled
			this._comprehendAllFrameworks();
		} else {
			console.log('[ContractReason] Contract Reasoning DISABLED');
		}
	}

	public get isAvailable(): boolean {
		if (!this._enabled) return false;
		const modelSelection = this._getModelSelection();
		return !!modelSelection;
	}

	/**
	 * Get the model selection for Checks — uses dedicated 'Checks' model if configured,
	 * otherwise falls back to 'Chat' model. Keeps Checks costs separate and controllable.
	 */
	private _getModelSelection() {
		return this.voidSettingsService.state.modelSelectionOfFeature['Checks']
			?? this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
	}


	// ─── Phase 1: Contract Comprehension ─────────────────────────────

	/**
	 * Comprehend all active frameworks.
	 */
	private async _comprehendAllFrameworks(): Promise<void> {
		const frameworks = this.frameworkRegistry.getActiveFrameworks();
		for (const fw of frameworks) {
			await this.comprehendFramework(fw);
		}
	}

	/**
	 * Send a framework's rules to the LLM for comprehension.
	 * The LLM builds an understanding of the framework's intent.
	 *
	 * Cached per framework ID + version — only re-comprehends on change.
	 */
	public async comprehendFramework(framework: ILoadedFramework): Promise<void> {
		const fwId = framework.definition.framework.id;
		const fwVersion = framework.definition.framework.version;
		const cacheKey = `${fwId}:${fwVersion}`;

		// Already comprehended this version
		if (this._contractContexts.has(cacheKey)) {
			return;
		}

		const modelSelection = this._getModelSelection();
		if (!modelSelection) {
			console.log('[ContractReason] No model configured for Checks or Chat — skipping comprehension');
			return;
		}

		// Build the comprehension prompt
		const rulesDescription = framework.rules.map(r =>
			`- [${r.id}] "${r.message}" (severity: ${r.severity}, type: ${r.type})\n  Check: ${JSON.stringify(r.check).substring(0, 200)}`
		).join('\n');

		const systemPrompt = `You are a compliance framework analyst for critical and regulated software. Study the following framework rules and build a deep understanding of what this framework enforces.

Framework: ${framework.definition.framework.name} v${fwVersion}
Description: ${framework.definition.framework.description || 'N/A'}

Rules:
${rulesDescription}

For each rule, identify:
1. The core intent (what security/reliability issue it prevents)
2. Edge cases that pattern matching might miss
3. How this rule relates to other rules in the framework
4. Common code patterns that violate this rule but are hard to catch with regex/AST

Return your understanding as a structured analysis. Be concise but thorough. Focus on what patterns might MISS, not what they already catch.`;

		return new Promise<void>((resolve) => {
			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: systemPrompt }] as LLMChatMessage[],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					this._contractContexts.set(cacheKey, {
						frameworkId: fwId,
						version: fwVersion,
						understanding: params.fullText,
						timestamp: Date.now()
					});
					// Persist so next restart doesn't re-call the LLM
					this._saveComprehensions();
					console.log(`[ContractReason] Comprehended framework: ${fwId} v${fwVersion} (${params.fullText.length} chars)`);
					resolve();
				},
				onError: (err: { message: string }) => {
					console.error(`[ContractReason] Comprehension failed for ${fwId}:`, err.message);
					resolve(); // Don't block on failure
				},
				onAbort: () => { resolve(); },
				logging: { loggingName: 'GRC-ContractReason-Comprehend' },
			});
		});
	}


	// ─── Phase 2: Contract Reasoning (File Analysis) ─────────────────

	/**
	 * Analyze a file using the contract understanding + pattern results.
	 *
	 * Called after pattern checks complete (on file save, not keystroke).
	 * Returns additional violations, false positive flags, and explanations.
	 *
	 * All calls are routed through the rate limiter to prevent overwhelming
	 * the AI provider during bulk workspace scans.
	 */
	public async analyzeFile(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		context?: INanoAgentContext,
		contextFiles?: Map<string, string>
	): Promise<ContractReasonResult | undefined> {
		if (!this.isAvailable) {
			return undefined;
		}

		// Prevent duplicate analysis for the same file
		const fileKey = fileUri.toString();
		if (this._runningAnalyses.has(fileKey)) {
			return undefined;
		}

		// Check content-based cache — same content means same violations
		const contentHash = this._simpleHash(fileContent);
		const cached = this._resultCache.get(fileKey);
		if (cached && cached.hash === contentHash) {
			// Fire the event so the engine and diagnostics pick up the cached violations.
			this._onDidContractReasonResultsReady.fire(cached.result);
			return cached.result;
		}

		// Check persisted hash from a previous session.
		// Content unchanged — restore saved violations from audit trail instead of re-calling LLM.
		if (this._persistedHashes.get(fileKey) === contentHash) {
			const saved = await this.projectAnalyzerService.loadAuditData(fileUri);
			if (saved.length > 0) {
				const violations: ICheckResult[] = saved.map((v: any) => ({ ...v, fileUri, checkSource: 'ai' as const }));
				const restored: ContractReasonResult = {
					additionalViolations: violations,
					falsePositiveFlags: [],
					enrichments: new Map(),
					fileUri,
				};
				this._resultCache.set(fileKey, { result: restored, hash: contentHash });
				this._onDidContractReasonResultsReady.fire(restored);
				console.log(`[ContractReason] Restored ${violations.length} AI violation(s) for ${fileUri.path.split('/').pop()} from audit trail`);
			} else {
				console.log(`[ContractReason] Content unchanged for ${fileUri.path.split('/').pop()} — no prior AI violations`);
			}
			return undefined;
		}

		this._runningAnalyses.add(fileKey);

		// Route through rate limiter — waits for a slot before executing
		let result: ContractReasonResult | undefined;
		try {
			await this._rateLimiter.enqueue(async () => {
				result = await this._runAnalysis(fileUri, fileContent, patternResults, rules, context, contextFiles);
				if (result) {
					this._rateLimiter.reportSuccess();

					// Cache result in memory
					this._resultCache.set(fileKey, { result, hash: contentHash });

					// Evict old entries
					if (this._resultCache.size > ContractReasonService.MAX_CACHE) {
						const firstKey = this._resultCache.keys().next().value;
						if (firstKey) this._resultCache.delete(firstKey);
					}

					// Persist content hash so future sessions skip the LLM for unchanged files
					this._persistedHashes.set(fileKey, contentHash);
					this._savePersistedHashes();

					// Persist AI violations securely to .inverse/audit disk storage
					await this.projectAnalyzerService.saveAuditData(fileUri, result.additionalViolations);

					this._onDidContractReasonResultsReady.fire(result);
					this.accessibilitySignalService.playSignal(AccessibilitySignal.neuralInverseTaskComplete);
				}
			});
		} finally {
			this._runningAnalyses.delete(fileKey);
		}

		return result;
	}


	/**
	 * Run the actual LLM analysis.
	 */
	private async _runAnalysis(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		context?: INanoAgentContext,
		contextFiles?: Map<string, string>
	): Promise<ContractReasonResult | undefined> {
		const modelSelection = this._getModelSelection();
		if (!modelSelection) return undefined;

		// Gather contract understanding
		const allContexts = Array.from(this._contractContexts.values())
			.map(ctx => ctx.understanding)
			.join('\n\n---\n\n');

		// Build context files snippet (test/mock/config files for AI reference)
		const contextSnippet = this._buildContextFilesSnippet(contextFiles);

		// Extract functions from the file for function-level analysis.
		// Cap at 6 functions per file to avoid LLM flooding — prioritize functions
		// that overlap with existing pattern violations, then by code size.
		const allFunctions = this._extractFunctions(fileContent);
		const MAX_FUNCTIONS_PER_FILE = 6;
		const functions = allFunctions.length > MAX_FUNCTIONS_PER_FILE
			? [
				// Priority 1: functions that contain existing pattern violations
				...allFunctions.filter(fn => patternResults.some(r => r.line >= fn.startLine && r.line <= fn.endLine)),
				// Priority 2: largest functions (most likely to have issues)
				...allFunctions
					.filter(fn => !patternResults.some(r => r.line >= fn.startLine && r.line <= fn.endLine))
					.sort((a, b) => (b.endLine - b.startLine) - (a.endLine - a.startLine)),
			].slice(0, MAX_FUNCTIONS_PER_FILE)
			: allFunctions;

		// Get file extension for language hint
		const ext = fileUri.path.split('.').pop() || 'ts';
		const fileName = fileUri.path.split('/').pop() || 'unknown';

		// If we extracted functions, analyze each individually with relevant rules
		if (functions.length > 0) {
			console.log(`[ContractReason] Analyzing ${functions.length}/${allFunctions.length} functions in ${fileName}`);

			// Analyze functions concurrently (max 3 at a time)
			const allResults: (ContractReasonResult | undefined)[] = [];
			const concurrencyLimit = 3;

			for (let i = 0; i < functions.length; i += concurrencyLimit) {
				const batch = functions.slice(i, i + concurrencyLimit);
				const batchResults = await Promise.all(
					batch.map(fn => {
						// Get pattern results that fall within this function's line range
						const fnPatternResults = patternResults.filter(
							r => r.line >= fn.startLine && r.line <= fn.endLine
						);

						// Route relevant rules based on function content patterns
						const relevantRules = this._getRelevantRules(fn, rules, context);

						console.log(`[ContractReason] Analyzing function: ${fn.name} (lines ${fn.startLine}-${fn.endLine}, ${relevantRules.length} rules)`);

						return this._analyzeFunctionChunk(
							fileUri, fn, ext, fnPatternResults, relevantRules, allContexts, modelSelection, contextSnippet
						);
					})
				);
				allResults.push(...batchResults);
			}

			// Merge all function-level results into one file-level result
			return this._mergeResults(allResults, fileUri);
		}

		// Fallback: analyze the whole file if no functions were extracted
		return this._analyzeWholeFile(
			fileUri, fileContent, ext, patternResults, rules, allContexts, modelSelection, contextSnippet
		);
	}


	// ─── Function-Level Analysis ────────────────────────────────────

	/**
	 * Represents a function/method/arrow extracted from source code.
	 */
	private _extractFunctions(fileContent: string): Array<{
		name: string;
		startLine: number;
		endLine: number;
		code: string;
	}> {
		const functions: Array<{ name: string; startLine: number; endLine: number; code: string }> = [];
		const lines = fileContent.split('\n');

		// Match common function patterns: function decl, method, arrow, exports
		const fnPatterns = [
			/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
			/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,
			/^\s*(?:public|private|protected|static|async|\s)*\s+(\w+)\s*\([^)]*\)\s*[:{]/,
			/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?\(.*\)\s*=>/,
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let fnName: string | null = null;

			for (const pattern of fnPatterns) {
				const match = line.match(pattern);
				if (match) {
					fnName = match[1] || `anonymous_L${i + 1}`;
					break;
				}
			}

			if (fnName) {
				// Find the end of this function by tracking brace depth
				let braceDepth = 0;
				let foundOpen = false;
				let endLine = i;

				for (let j = i; j < lines.length; j++) {
					for (const ch of lines[j]) {
						if (ch === '{') { braceDepth++; foundOpen = true; }
						if (ch === '}') { braceDepth--; }
					}
					if (foundOpen && braceDepth <= 0) {
						endLine = j;
						break;
					}
					if (j === lines.length - 1) {
						endLine = j;
					}
				}

				// Only include functions with meaningful body (>2 lines)
				if (endLine - i >= 2) {
					functions.push({
						name: fnName,
						startLine: i + 1, // 1-indexed
						endLine: endLine + 1,
						code: lines.slice(i, endLine + 1).join('\n'),
					});
				}

				// Skip past this function body
				i = endLine;
			}
		}

		return functions;
	}

	/**
	 * Route relevant rules to a function based on its content patterns.
	 * Instead of sending ALL rules to AI for every function, we select
	 * rules that are likely relevant based on what the function does.
	 */
	private _getRelevantRules(
		fn: { name: string; code: string },
		allRules: IGRCRule[],
		context?: INanoAgentContext
	): IGRCRule[] {
		const code = fn.code.toLowerCase();
		const relevant: IGRCRule[] = [];

		for (const rule of allRules) {
			if (!rule.enabled) continue;

			// Always include critical/blocker rules
			if (rule.severity === 'blocker' || rule.severity === 'critical') {
				relevant.push(rule);
				continue;
			}

			// Route by tags or content analysis
			const tags = rule.tags || [];
			const isNetworkRelated = tags.some(t => ['network', 'authentication', 'api'].includes(t))
				|| code.includes('fetch') || code.includes('axios') || code.includes('http')
				|| code.includes('req.') || code.includes('res.');

			const isCryptoRelated = tags.some(t => ['crypto', 'encryption'].includes(t))
				|| code.includes('crypto') || code.includes('encrypt') || code.includes('hash');

			const isAuthRelated = tags.some(t => ['auth', 'authentication', 'credentials', 'secrets'].includes(t))
				|| code.includes('token') || code.includes('password') || code.includes('secret')
				|| code.includes('apikey') || code.includes('api_key');

			const isDbRelated = tags.some(t => ['sql', 'database', 'sql-injection'].includes(t))
				|| code.includes('query') || code.includes('execute') || code.includes('sql');

			const isErrorHandling = tags.some(t => ['error-handling', 'async'].includes(t))
				|| code.includes('async') || code.includes('try') || code.includes('catch');

			// Also use nano agent context if available
			const ctxRelevant = context && context.capabilities && (
				(context.capabilities.hasNetwork && isNetworkRelated) ||
				(context.capabilities.hasCrypto && isCryptoRelated) ||
				(context.capabilities.hasAuth && isAuthRelated)
			);

			if (isNetworkRelated || isCryptoRelated || isAuthRelated || isDbRelated || isErrorHandling || ctxRelevant) {
				relevant.push(rule);
			}
		}

		// If very few rules matched, include all (better safe than sorry)
		if (relevant.length < 3) {
			return allRules.filter(r => r.enabled);
		}

		return relevant;
	}

	/**
	 * Analyze a single function chunk with AI, using only relevant rules.
	 */
	private async _analyzeFunctionChunk(
		fileUri: URI,
		fn: { name: string; startLine: number; endLine: number; code: string },
		ext: string,
		patternResults: ICheckResult[],
		relevantRules: IGRCRule[],
		frameworkContext: string,
		modelSelection: { providerName: string; modelName: string },
		contextSnippet: string = ''
	): Promise<ContractReasonResult | undefined> {
		const patternSummary = patternResults.length > 0
			? patternResults.map(r =>
				`  Line ${r.line}: [${r.ruleId}] ${r.message.substring(0, 100)}`
			).join('\n')
			: '  (No violations found by pattern checks for this function)';

		const rulesSummary = relevantRules.map(r =>
			`- [${r.id}] "${r.message}" (severity: ${r.severity})\n  Intent: ${r.fix || 'N/A'}`
		).join('\n');

		const prompt = `You are a compliance auditor. Analyze this SINGLE FUNCTION against the framework rules below.

FRAMEWORK UNDERSTANDING:
${frameworkContext.substring(0, 2000)}

RULES TO CHECK (only these):
${rulesSummary}

PATTERN CHECKS ALREADY FOUND IN THIS FUNCTION:
${patternSummary}

FUNCTION: ${fn.name} (lines ${fn.startLine}-${fn.endLine})

\`\`\`${ext}
${fn.code}
\`\`\`

Respond with ONLY valid JSON:
{
  "additionalViolations": [
    {
      "line": <absolute line number in file>,
      "ruleId": "<rule ID from rules above>",
      "severity": "error|warning|info",
      "message": "<what's wrong, mentioning specific variables/flows>",
      "snippet": "<offending code, max 80 chars>",
      "aiExplanation": "<why this matters from framework perspective>",
      "aiConfidence": "high|medium|low"
    }
  ],
  "enrichments": [
    {
      "ruleId": "<rule ID>",
      "line": <number>,
      "aiExplanation": "<context-specific explanation using actual variable names>",
      "aiConfidence": "high|medium|low"
    }
  ],
  "falsePositives": [
    { "ruleId": "<rule ID>", "line": <number>, "reason": "<why this is likely wrong>" }
  ]
}

FOCUS ON:
- Violations patterns MISSED (obfuscated secrets, aliased variables, indirect flows)
- Each additionalViolation MUST reference a ruleId from the rules above
- Be conservative — only flag real issues with high confidence
- Return ONLY valid JSON${contextSnippet}`;

		return new Promise<ContractReasonResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				resolve(undefined);
			}, 20_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: prompt }] as LLMChatMessage[],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection: modelSelection as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					clearTimeout(timeoutId);
					const result = this._parseAnalysisResponse(params.fullText, fileUri, relevantRules);
					resolve(result);
				},
				onError: (err: { message: string }) => {
					clearTimeout(timeoutId);
					// Detect rate limit errors and signal the limiter
					if (err.message && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('quota'))) {
						this._rateLimiter.reportRateLimitError();
					}
					console.error(`[ContractReason] Function analysis error (${fn.name}):`, err.message);
					resolve(undefined);
				},
				onAbort: () => { clearTimeout(timeoutId); resolve(undefined); },
				logging: { loggingName: `GRC-ContractReason-Function-${fn.name}` },
			});
		});
	}

	/**
	 * Fallback: analyze the whole file when function extraction isn't possible.
	 */
	private async _analyzeWholeFile(
		fileUri: URI,
		fileContent: string,
		ext: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		frameworkContext: string,
		modelSelection: { providerName: string; modelName: string },
		contextSnippet: string = ''
	): Promise<ContractReasonResult | undefined> {
		const patternSummary = patternResults.length > 0
			? patternResults.map(r =>
				`  Line ${r.line}: [${r.ruleId}] ${r.message.substring(0, 100)}`
			).join('\n')
			: '  (No violations found by pattern checks)';

		const maxCodeLength = 8000;
		const truncatedCode = fileContent.length > maxCodeLength
			? fileContent.substring(0, maxCodeLength) + '\n... (truncated)'
			: fileContent;

		const rulesSummary = rules.filter(r => r.enabled).map(r =>
			`- [${r.id}] "${r.message}" (severity: ${r.severity})`
		).join('\n');

		const prompt = `You are a compliance auditor reviewing code against a regulatory framework.

FRAMEWORK UNDERSTANDING:
${frameworkContext.substring(0, 4000)}

RULES TO CHECK:
${rulesSummary}

PATTERN CHECKS ALREADY FOUND:
${patternSummary}

FILE: ${fileUri.path.split('/').pop()}

\`\`\`${ext}
${truncatedCode}
\`\`\`

Respond with ONLY valid JSON:
{
  "enrichments": [
    { "ruleId": "<rule ID>", "line": <number>, "aiExplanation": "<context explanation>", "aiConfidence": "high|medium|low" }
  ],
  "additionalViolations": [
    { "line": <number>, "ruleId": "<rule ID from framework>", "severity": "error|warning|info", "message": "<what's wrong>", "snippet": "<code, max 80 chars>", "aiExplanation": "<why this matters>", "aiConfidence": "high|medium|low" }
  ],
  "falsePositives": [
    { "ruleId": "<rule ID>", "line": <number>, "reason": "<why likely wrong>" }
  ]
}

FOCUS ON: violations patterns MISSED. Be conservative. Return ONLY valid JSON.${contextSnippet}`;

		return new Promise<ContractReasonResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				console.warn('[ContractReason] Whole-file analysis timed out for', fileUri.path);
				resolve(undefined);
			}, 30_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: prompt }] as LLMChatMessage[],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection: modelSelection as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					clearTimeout(timeoutId);
					resolve(this._parseAnalysisResponse(params.fullText, fileUri, rules));
				},
				onError: (err: { message: string }) => {
					clearTimeout(timeoutId);
					if (err.message && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('quota'))) {
						this._rateLimiter.reportRateLimitError();
					}
					console.error('[ContractReason] Analysis error:', err.message);
					resolve(undefined);
				},
				onAbort: () => { clearTimeout(timeoutId); resolve(undefined); },
				logging: { loggingName: 'GRC-ContractReason-WholeFile' },
			});
		});
	}

	/**
	 * Merge multiple function-level analysis results into one file-level result.
	 */
	private _mergeResults(
		results: (ContractReasonResult | undefined)[],
		fileUri: URI
	): ContractReasonResult {
		const merged: ContractReasonResult = {
			additionalViolations: [],
			falsePositiveFlags: [],
			enrichments: new Map(),
			fileUri,
		};

		for (const result of results) {
			if (!result) continue;
			merged.additionalViolations.push(...result.additionalViolations);
			merged.falsePositiveFlags.push(...result.falsePositiveFlags);
			for (const [key, value] of result.enrichments) {
				merged.enrichments.set(key, value);
			}
		}

		console.log(
			`[ContractReason] Merged results: ` +
			`${merged.additionalViolations.length} AI violations, ` +
			`${merged.enrichments.size} enrichments, ` +
			`${merged.falsePositiveFlags.length} false positives`
		);

		return merged;
	}


	// ─── Response Parsing ────────────────────────────────────────────

	/**
	 * Parse the LLM's JSON response into a structured ContractReasonResult.
	 */
	private _parseAnalysisResponse(
		response: string,
		fileUri: URI,
		rules: IGRCRule[]
	): ContractReasonResult | undefined {
		try {
			// Extract JSON from response (handle markdown-wrapped responses)
			let jsonStr = response.trim();

			// Strip markdown code fences if present
			const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (jsonMatch) {
				jsonStr = jsonMatch[1].trim();
			}

			const data = JSON.parse(jsonStr);
			const now = Date.now();

			// Build rule lookup map
			const ruleMap = new Map(rules.map(r => [r.id, r]));

			// Convert additional violations to ICheckResult[]
			const additionalViolations: ICheckResult[] = [];
			for (const v of (data.additionalViolations || [])) {
				const rule = ruleMap.get(v.ruleId);
				if (!rule) continue; // Skip violations referencing unknown rules

				additionalViolations.push({
					ruleId: v.ruleId,
					domain: rule.domain,
					severity: toDisplaySeverity(v.severity || rule.severity),
					message: `[${v.ruleId}] ${v.message}`,
					fileUri: fileUri,
					line: v.line || 1,
					column: 1,
					endLine: v.line || 1,
					endColumn: (v.snippet?.length || 0) + 1,
					codeSnippet: v.snippet,
					fix: rule.fix,
					timestamp: now,
					frameworkId: rule.frameworkId,
					references: rule.references,
					blockingBehavior: rule.blockingBehavior,
					// AI-generated fields
					checkSource: 'ai' as const,
					aiExplanation: v.aiExplanation || `AI detected a potential ${rule.domain} violation.`,
					aiConfidence: v.aiConfidence || 'medium',
				});
			}

			// Build enrichments map for existing pattern violations
			const enrichments = new Map<string, {
				aiExplanation: string;
				aiConfidence: 'high' | 'medium' | 'low';
			}>();
			for (const e of (data.enrichments || [])) {
				if (e.ruleId && e.line && e.aiExplanation) {
					enrichments.set(`${e.ruleId}:${e.line}`, {
						aiExplanation: e.aiExplanation,
						aiConfidence: e.aiConfidence || 'medium',
					});
				}
			}

			return {
				additionalViolations,
				falsePositiveFlags: data.falsePositives || [],
				enrichments,
				fileUri,
			};
		} catch (e) {
			console.error('[ContractReason] Failed to parse LLM response:', e);
			return undefined;
		}
	}


	// ─── One-Shot Query ─────────────────────────────────────────────

	/**
	 * Send a single prompt to the LLM, rate-limited.
	 * Used for non-file-analysis queries like ignore suggestions.
	 */
	public async sendOneShotQuery(prompt: string): Promise<string | undefined> {
		if (!this.isAvailable) return undefined;

		const modelSelection = this._getModelSelection();
		if (!modelSelection) return undefined;

		let response: string | undefined;
		await this._rateLimiter.enqueue(async () => {
			response = await new Promise<string | undefined>((resolve) => {
				const timeoutId = setTimeout(() => resolve(undefined), 30_000);

				this.llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					messages: [{ role: 'user', content: prompt }] as LLMChatMessage[],
					separateSystemMessage: undefined,
					chatMode: null,
					modelSelection: modelSelection as any,
					modelSelectionOptions: undefined,
					overridesOfModel: undefined,
					onText: () => { },
					onFinalMessage: (params: { fullText: string }) => {
						clearTimeout(timeoutId);
						this._rateLimiter.reportSuccess();
						resolve(params.fullText);
					},
					onError: (err: { message: string }) => {
						clearTimeout(timeoutId);
						if (err.message && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('quota'))) {
							this._rateLimiter.reportRateLimitError();
						}
						console.error('[ContractReason] One-shot query error:', err.message);
						resolve(undefined);
					},
					onAbort: () => { clearTimeout(timeoutId); resolve(undefined); },
					logging: { loggingName: 'GRC-ContractReason-OneShot' },
				});
			});
		});

		return response;
	}


	// ─── Helpers ─────────────────────────────────────────────────────

	/**
	 * Build a prompt snippet from context-only files (tests, mocks, configs).
	 * These files are excluded from scanning but provide important context
	 * for AI reasoning about the code being analyzed.
	 */
	private _buildContextFilesSnippet(contextFiles?: Map<string, string>): string {
		if (!contextFiles || contextFiles.size === 0) return '';

		const MAX_FILES = 5;
		const MAX_CHARS_PER_FILE = 2000;
		const entries = Array.from(contextFiles.entries()).slice(0, MAX_FILES);

		const snippets = entries.map(([uriStr, content]) => {
			const fileName = uriStr.split('/').pop() || 'unknown';
			const truncated = content.length > MAX_CHARS_PER_FILE
				? content.substring(0, MAX_CHARS_PER_FILE) + '\n... (truncated)'
				: content;
			return `--- ${fileName} ---\n${truncated}`;
		}).join('\n\n');

		return `\n\nCONTEXT FILES (excluded from scanning, for reference only — tests, mocks, configs):\n${snippets}`;
	}

	/**
	 * Simple hash for content-based caching.
	 * Uses djb2 algorithm — fast and sufficient for cache keys.
	 */
	private _simpleHash(str: string): string {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = ((hash << 5) + hash) + str.charCodeAt(i);
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}
}


// ─── Registration ────────────────────────────────────────────────────────────

registerSingleton(IContractReasonService, ContractReasonService, InstantiationType.Delayed);
