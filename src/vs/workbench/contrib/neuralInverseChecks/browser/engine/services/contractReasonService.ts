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
import { INanoAgentContext } from '../../nanoAgents/projectAnalyzerService.js';
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


/**
 * Per-file scan tracking entry.
 */
export interface IScanFileEntry {
	/** File URI string */
	fileUri: string;
	/** Short display name (filename) */
	fileName: string;
	/** Scan status */
	status: 'pending' | 'scanning' | 'scanned' | 'skipped' | 'error';
	/** When this entry was last updated */
	timestamp: number;
	/** Number of AI violations found (if scanned) */
	violationCount?: number;
	/** Skip reason if status is 'skipped' */
	skipReason?: string;
	/** Error message if status is 'error' */
	errorMessage?: string;
	/** Risk score computed during scan prioritization (0-100+) */
	riskScore?: number;
}

/**
 * Aggregate scan tracker state exposed to UI.
 */
export interface IScanTrackerState {
	/** All tracked file entries */
	entries: IScanFileEntry[];
	/** How many files total are queued or tracked */
	totalFiles: number;
	/** How many have been scanned (status === 'scanned') */
	scannedCount: number;
	/** How many were skipped (cache hit) */
	skippedCount: number;
	/** How many errored */
	errorCount: number;
	/** How many are currently in-flight */
	scanningCount: number;
	/** Whether a workspace scan is currently running */
	isScanning: boolean;
	/** Timestamp of last completed workspace scan */
	lastScanCompleted: number | undefined;
	/** Whether periodic scanning is active */
	periodicScanActive: boolean;
	/** Periodic scan interval in ms */
	periodicScanIntervalMs: number;
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
		contextFiles?: Map<string, string>,
		allFileContents?: Map<string, string>,
		riskScore?: number
	): Promise<ContractReasonResult | undefined>;

	/** Event fired when contract reasoning results are ready */
	readonly onDidContractReasonResultsReady: Event<ContractReasonResult>;

	/** Send a one-shot query to the LLM (rate-limited). Returns raw response text. */
	sendOneShotQuery(prompt: string): Promise<string | undefined>;

	// ─── Scan Tracker API ────────────────────────────────────────────

	/** Get the current scan tracker state for UI rendering */
	getScanTrackerState(): IScanTrackerState;

	/** Event fired when scan tracker state changes (file starts/completes/errors) */
	readonly onDidScanTrackerUpdate: Event<IScanTrackerState>;

	/** Mark scan as started (called by grcEngine before batch processing) */
	scanTrackerBeginScan(fileUris: URI[], riskScores?: Map<string, number>): void;

	/** Mark scan as completed */
	scanTrackerEndScan(): void;

	/** Reset scan tracker entries (e.g. on new workspace scan) */
	scanTrackerReset(): void;

	/** Update periodic scan state (called by grcEngine when periodic scan starts/stops) */
	scanTrackerSetPeriodicState(active: boolean, intervalMs?: number): void;
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

	/** Storage key for persisted AI violations — stored in IStorageService, NOT .inverse/audit */
	private static readonly VIOLATIONS_CACHE_KEY = 'grc.aiViolationsCache';

	/** Persisted content hashes from previous sessions: fileUri → hash */
	private _persistedHashes = new Map<string, string>();

	/** Persisted AI violations from previous sessions: fileUri → serialized violations */
	private _persistedViolations = new Map<string, any[]>();

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

	// ─── Scan Tracker State ──────────────────────────────────────────
	private readonly _scanEntries = new Map<string, IScanFileEntry>();
	private _isScanning = false;
	private _lastScanCompleted: number | undefined;
	private _periodicScanActive = false;
	private _periodicScanIntervalMs = 120_000; // 2 min default
	private readonly _onDidScanTrackerUpdate = this._register(new Emitter<IScanTrackerState>());
	public readonly onDidScanTrackerUpdate = this._onDidScanTrackerUpdate.event;

	constructor(
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IFrameworkRegistry private readonly frameworkRegistry: IFrameworkRegistry,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Restore framework comprehensions, file hashes, and violation cache from previous session.
		// Prevents re-running LLM calls on every IDE restart.
		this._loadPersistedComprehensions();
		this._loadPersistedHashes();
		this._loadPersistedViolations();

		// Auto-comprehend when frameworks change (only if enabled).
		// Also clear persisted content hashes so files are re-scanned with the new rules —
		// without this, the hash cache would skip all files that haven't changed on disk
		// even though the rules they're evaluated against have changed.
		this._register(this.frameworkRegistry.onDidFrameworksChange(() => {
			if (this._enabled) {
				this._comprehendAllFrameworks();
			}
			// Always invalidate hashes + violations on framework change regardless of enabled state,
			// so the next scan (whenever it runs) picks up new rules.
			this._persistedHashes.clear();
			this._savePersistedHashes();
			this._persistedViolations.clear();
			this._savePersistedViolations();
			console.log('[ContractReason] Frameworks changed — cleared caches so files are re-scanned with updated rules');
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

	private _loadPersistedViolations(): void {
		try {
			const stored = this.storageService.get(ContractReasonService.VIOLATIONS_CACHE_KEY, StorageScope.WORKSPACE);
			if (!stored) return;
			const entries: [string, any[]][] = JSON.parse(stored);
			this._persistedViolations = new Map(entries);
			console.log(`[ContractReason] Restored AI violations cache for ${this._persistedViolations.size} file(s)`);
		} catch (e) {
			console.error('[ContractReason] Failed to load persisted violations:', e);
		}
	}

	private _savePersistedViolations(): void {
		try {
			// Cap at 100 entries to keep storage size reasonable
			const entries = Array.from(this._persistedViolations.entries()).slice(-100);
			this.storageService.store(
				ContractReasonService.VIOLATIONS_CACHE_KEY,
				JSON.stringify(entries),
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE
			);
		} catch (e) {
			console.error('[ContractReason] Failed to persist violations cache:', e);
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

		const comprehensionSystemMsg = `You are a compliance framework analyst for critical and regulated software. Your job is to deeply understand compliance frameworks so you can later identify violations that static pattern matching misses.`;

		const comprehensionUserMsg = `Study this framework and build a structured understanding of what it enforces.

Framework: ${framework.definition.framework.name} v${fwVersion}
Description: ${framework.definition.framework.description || 'N/A'}

Rules:
${rulesDescription}

For each rule, identify:
1. The core intent (what security/reliability issue it prevents)
2. Edge cases that pattern matching might miss
3. Common code patterns that violate this rule but are hard to catch with regex/AST
4. How violations of this rule typically appear in real code

Be concise but thorough. Focus on what patterns MISS, not what they already catch.`;

		return new Promise<void>((resolve) => {
			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: comprehensionUserMsg }] as LLMChatMessage[],
				separateSystemMessage: comprehensionSystemMsg,
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
		contextFiles?: Map<string, string>,
		allFileContents?: Map<string, string>,
		riskScore?: number
	): Promise<ContractReasonResult | undefined> {
		if (!this.isAvailable) {
			return undefined;
		}

		// Prevent duplicate analysis for the same file
		const fileKey = fileUri.toString();
		if (this._runningAnalyses.has(fileKey)) {
			this._scanTrackerMarkSkipped(fileUri, 'already in-flight');
			return undefined;
		}

		// Check content-based cache — same content means same violations
		const contentHash = this._simpleHash(fileContent);
		const cached = this._resultCache.get(fileKey);
		if (cached && cached.hash === contentHash) {
			// Fire the event so the engine and diagnostics pick up the cached violations.
			this._onDidContractReasonResultsReady.fire(cached.result);
			this._scanTrackerMarkSkipped(fileUri, 'in-memory cache hit');
			return cached.result;
		}

		// Check persisted hash from a previous session.
		// Content unchanged — restore saved violations from in-memory/storage cache.
		if (this._persistedHashes.get(fileKey) === contentHash) {
			const saved = this._persistedViolations.get(fileKey);
			if (saved && saved.length > 0) {
				const violations: ICheckResult[] = saved.map((v: any) => ({ ...v, fileUri, checkSource: 'ai' as const }));
				const restored: ContractReasonResult = {
					additionalViolations: violations,
					falsePositiveFlags: [],
					enrichments: new Map(),
					fileUri,
				};
				this._resultCache.set(fileKey, { result: restored, hash: contentHash });
				this._onDidContractReasonResultsReady.fire(restored);
				this._scanTrackerMarkSkipped(fileUri, `restored ${violations.length} from cache`);
				console.log(`[ContractReason] Restored ${violations.length} AI violation(s) for ${fileUri.path.split('/').pop()} from cache`);
			} else {
				this._scanTrackerMarkSkipped(fileUri, 'content unchanged, no prior violations');
				console.log(`[ContractReason] Content unchanged for ${fileUri.path.split('/').pop()} — no prior AI violations`);
			}
			return undefined;
		}

		this._runningAnalyses.add(fileKey);
		this._scanTrackerMarkScanning(fileUri);

		// Route through rate limiter — waits for a slot before executing
		let result: ContractReasonResult | undefined;
		try {
			await this._rateLimiter.enqueue(async () => {
				try {
					result = await this._runAnalysis(fileUri, fileContent, patternResults, rules, context, contextFiles, allFileContents, riskScore);
					if (result) {
						this._rateLimiter.reportSuccess();

						// Cache result in memory
						this._resultCache.set(fileKey, { result, hash: contentHash });

						// Evict old entries
						if (this._resultCache.size > ContractReasonService.MAX_CACHE) {
							const firstKey = this._resultCache.keys().next().value;
							if (firstKey) this._resultCache.delete(firstKey);
						}

						// Persist content hash + violations to IStorageService (no .inverse disk writes)
						this._persistedHashes.set(fileKey, contentHash);
						this._savePersistedHashes();

						// Store violations in cache — survives IDE restarts via IStorageService
						this._persistedViolations.set(fileKey, result.additionalViolations.map(v => ({
							ruleId: v.ruleId, domain: v.domain, severity: v.severity,
							message: v.message, line: v.line, column: v.column,
							endLine: v.endLine, endColumn: v.endColumn,
							codeSnippet: v.codeSnippet, fix: v.fix,
							frameworkId: v.frameworkId, references: v.references,
							blockingBehavior: v.blockingBehavior,
							aiExplanation: v.aiExplanation, aiConfidence: v.aiConfidence,
							timestamp: v.timestamp,
						})));
						this._savePersistedViolations();

						this._onDidContractReasonResultsReady.fire(result);
						this.accessibilitySignalService.playSignal(AccessibilitySignal.neuralInverseTaskComplete);

						this._scanTrackerMarkScanned(fileUri, result.additionalViolations.length);
					} else {
						this._scanTrackerMarkError(fileUri, 'LLM returned no result');
					}
				} catch (e) {
					this._scanTrackerMarkError(fileUri, e instanceof Error ? e.message : 'unknown error');
					throw e;
				}
			});
		} finally {
			this._runningAnalyses.delete(fileKey);
		}

		return result;
	}


	/**
	 * Run the actual LLM analysis — routes to single-call or two-phase
	 * based on risk score.
	 *
	 * For high-risk files (riskScore > 50): Two-phase analysis
	 *   Phase A — Threat modeling (identify attack surfaces)
	 *   Phase B — Targeted violation detection (using threat model)
	 *
	 * For low-risk files: Single-call analysis (efficient, one LLM round-trip)
	 */
	private async _runAnalysis(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		context?: INanoAgentContext,
		contextFiles?: Map<string, string>,
		allFileContents?: Map<string, string>,
		riskScore?: number
	): Promise<ContractReasonResult | undefined> {
		const modelSelection = this._getModelSelection();
		if (!modelSelection) return undefined;

		const ext = fileUri.path.split('.').pop() || 'ts';
		const fileName = fileUri.path.split('/').pop() || 'unknown';
		const startTime = Date.now();

		// Gather contract understanding (compact — cap at 3000 chars)
		const frameworkContext = Array.from(this._contractContexts.values())
			.map(ctx => ctx.understanding)
			.join('\n---\n')
			.substring(0, 3000);

		// Context files snippet (tests, mocks, configs)
		const contextSnippet = this._buildContextFilesSnippet(contextFiles);

		// Cross-file dependency context (imports/imported-by)
		const dependencyContext = this._buildDependencyContext(fileUri, fileContent, allFileContents);

		// Enabled rules
		const enabledRules = rules.filter(r => r.enabled);

		// Pattern results summary
		const patternSummary = patternResults.length > 0
			? patternResults.map(r =>
				`  L${r.line}: [${r.ruleId}] ${r.message.substring(0, 80)}`
			).join('\n')
			: '  (none)';

		// Extract key functions and build a focused code view.
		const functions = this._extractFunctions(fileContent);

		// No functions extracted — delegate to whole-file analyzer
		if (functions.length === 0) {
			console.log(`[ContractReason] No functions extracted in ${fileName} — using whole-file analysis`);
			return this._analyzeWholeFile(
				fileUri, fileContent, ext, patternResults, enabledRules, frameworkContext, modelSelection, contextSnippet + dependencyContext
			);
		}

		// Use rule routing to get the relevant rules for the combined function content
		const combinedFn = { name: fileName, code: functions.map(f => f.code).join('\n') };
		const relevantRules = this._getRelevantRules(combinedFn, enabledRules, context);

		// Cap at 8 functions, prioritize ones with existing violations + largest
		const MAX_FNS = 8;
		const prioritized = functions.length > MAX_FNS
			? [
				...functions.filter(fn => patternResults.some(r => r.line >= fn.startLine && r.line <= fn.endLine)),
				...functions
					.filter(fn => !patternResults.some(r => r.line >= fn.startLine && r.line <= fn.endLine))
					.sort((a, b) => (b.endLine - b.startLine) - (a.endLine - a.startLine)),
			].slice(0, MAX_FNS)
			: functions;

		// Build batched code section with function boundaries marked
		const MAX_CODE = 10000;
		let codeLen = 0;
		const parts: string[] = [];
		for (const fn of prioritized) {
			const header = `// ── ${fn.name} (lines ${fn.startLine}-${fn.endLine}) ──`;
			const chunk = header + '\n' + fn.code;
			if (codeLen + chunk.length > MAX_CODE) break;
			parts.push(chunk);
			codeLen += chunk.length;
		}
		const codeSection = parts.join('\n\n');

		// Route: two-phase for high-risk files, single-call for low-risk
		const effectiveRisk = riskScore ?? 0;
		if (effectiveRisk > 50) {
			console.log(`[ContractReason] Two-phase analysis for ${fileName} (risk: ${effectiveRisk}, ${parts.length}/${functions.length} fns, ${relevantRules.length} rules)`);
			return this._runTwoPhaseAnalysis(
				fileUri, fileName, ext, codeSection, patternSummary, relevantRules, enabledRules,
				frameworkContext, contextSnippet, dependencyContext, modelSelection, startTime
			);
		}

		console.log(`[ContractReason] Single-call analysis for ${fileName} (risk: ${effectiveRisk}, ${parts.length}/${functions.length} fns, ${relevantRules.length} rules)`);

		const rulesSummary = relevantRules.map(r =>
			`- [${r.id}] "${r.message}" (${r.severity})`
		).join('\n');

		const systemMsg = `You are a security auditor and logic analyzer for critical software. Your analysis must be deeper than pattern matching.

ANALYSIS DEPTH:
1. DATA FLOW TRACING: Follow variables from input to output. Track through assignments, function calls, destructuring, spreads, and returns. Flag when tainted data reaches sensitive sinks without sanitization.
2. LOGIC INVARIANT CHECKING: Identify assumptions the code makes (non-null, specific types, array bounds, enum completeness) and check if they can be violated by callers or external input.
3. CROSS-FILE BOUNDARY ANALYSIS: When cross-file context is provided, check that data contracts between files are honored — types match, error cases are handled, auth checks aren't bypassed.
4. CONTROL FLOW ANALYSIS: Check for unreachable code, impossible conditions, race conditions in async code, and unhandled promise rejections.
5. SECURITY PATTERN DETECTION: Check for TOCTOU, prototype pollution, ReDoS patterns, insecure deserialization, and missing rate limiting on sensitive endpoints.

Be conservative — only flag issues you are confident about. For each violation, explain the EXACT data flow or logic path that leads to the issue. Respond with ONLY valid JSON, no prose.`;

		const userMsg = `Analyze this code against the compliance rules.
${frameworkContext ? `\nFRAMEWORK CONTEXT:\n${frameworkContext}\n` : ''}
RULES (use exact IDs):
${rulesSummary}

EXISTING PATTERN VIOLATIONS:
${patternSummary}
${contextSnippet}${dependencyContext}
FILE: ${fileName}

\`\`\`${ext}
${codeSection}
\`\`\`

JSON response:
{"additionalViolations":[{"line":<number>,"ruleId":"<ID>","severity":"error|warning|info","message":"<what>","snippet":"<code max 80ch>","aiExplanation":"<why>","aiConfidence":"high|medium|low","dataFlowTrace":[{"file":"<filename>","line":<n>,"description":"<step>"}],"brokenAssumption":"<optional>"}],"enrichments":[{"ruleId":"<ID>","line":<n>,"aiExplanation":"<context>","aiConfidence":"high|medium|low"}],"falsePositives":[{"ruleId":"<ID>","line":<n>,"reason":"<why wrong>"}]}`;

		return new Promise<ContractReasonResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				console.warn(`[ContractReason] Analysis timed out for ${fileName} after 30s`);
				resolve(undefined);
			}, 30_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: userMsg }] as LLMChatMessage[],
				separateSystemMessage: systemMsg,
				chatMode: null,
				modelSelection: modelSelection as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					clearTimeout(timeoutId);
					const elapsed = Date.now() - startTime;
					console.log(`[ContractReason] ${fileName} analyzed in ${elapsed}ms`);
					resolve(this._parseAnalysisResponse(params.fullText, fileUri, enabledRules, riskScore));
				},
				onError: (err: { message: string }) => {
					clearTimeout(timeoutId);
					if (err.message && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('quota'))) {
						this._rateLimiter.reportRateLimitError();
					}
					console.error(`[ContractReason] Analysis error for ${fileName}:`, err.message);
					resolve(undefined);
				},
				onAbort: () => { clearTimeout(timeoutId); resolve(undefined); },
				logging: { loggingName: `GRC-ContractReason-${fileName}` },
			});
		});
	}


	// ─── Two-Phase Analysis (high-risk files) ────────────────────────

	/**
	 * Phase A: Threat modeling — identify attack surfaces and data flows.
	 * Phase B: Targeted violation detection using the threat model.
	 */
	private async _runTwoPhaseAnalysis(
		fileUri: URI,
		fileName: string,
		ext: string,
		codeSection: string,
		patternSummary: string,
		relevantRules: IGRCRule[],
		allEnabledRules: IGRCRule[],
		frameworkContext: string,
		contextSnippet: string,
		dependencyContext: string,
		modelSelection: { providerName: string; modelName: string },
		startTime: number,
	): Promise<ContractReasonResult | undefined> {

		// ── Phase A: Threat Modeling ──
		const phaseASystem = `You are a security threat modeler. Identify potential attack surfaces and logic vulnerabilities. Respond with ONLY valid JSON, no prose.`;

		const phaseAUser = `Given this code and its cross-file context, identify:
1. Data entry points (user input, API params, env vars, file reads)
2. Sensitive operations (DB writes, auth decisions, crypto, file system)
3. Data flow paths from entry points to sensitive operations
4. Logic assumptions that could be violated (null checks, type coercions, race conditions)
${dependencyContext}${contextSnippet}
FILE: ${fileName}

\`\`\`${ext}
${codeSection}
\`\`\`

JSON response:
{"entryPoints":["<description>"],"sensitiveOps":["<description>"],"dataFlows":["<source → transform → sink>"],"assumptions":["<assumption that could be broken>"]}`;

		const threatModel = await new Promise<string | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				console.warn(`[ContractReason] Phase A (threat model) timed out for ${fileName}`);
				resolve(undefined);
			}, 20_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: phaseAUser }] as LLMChatMessage[],
				separateSystemMessage: phaseASystem,
				chatMode: null,
				modelSelection: modelSelection as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					clearTimeout(timeoutId);
					resolve(params.fullText);
				},
				onError: (err: { message: string }) => {
					clearTimeout(timeoutId);
					if (err.message && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('quota'))) {
						this._rateLimiter.reportRateLimitError();
					}
					console.error(`[ContractReason] Phase A error for ${fileName}:`, err.message);
					resolve(undefined);
				},
				onAbort: () => { clearTimeout(timeoutId); resolve(undefined); },
				logging: { loggingName: `GRC-ContractReason-PhaseA-${fileName}` },
			});
		});

		if (!threatModel) {
			// Fallback to single-call if threat modeling fails
			console.log(`[ContractReason] Phase A failed for ${fileName}, falling back to single-call`);
			return undefined;
		}

		const phaseAElapsed = Date.now() - startTime;
		console.log(`[ContractReason] Phase A complete for ${fileName} in ${phaseAElapsed}ms`);

		// Parse threat model to enhance rule routing
		let parsedThreatModel: { entryPoints?: string[]; sensitiveOps?: string[]; dataFlows?: string[]; assumptions?: string[] } | undefined;
		try {
			let jsonStr = threatModel.trim();
			const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (jsonMatch) jsonStr = jsonMatch[1].trim();
			parsedThreatModel = JSON.parse(jsonStr);
		} catch {
			// Use raw threat model text as context even if not parseable
		}

		// Re-route rules using threat model for better relevance
		const threatEnhancedRules = parsedThreatModel
			? this._getRelevantRules({ name: fileName, code: codeSection }, allEnabledRules, undefined, parsedThreatModel)
			: relevantRules;

		// ── Phase B: Targeted Violation Detection ──
		const rulesSummary = threatEnhancedRules.map(r =>
			`- [${r.id}] "${r.message}" (${r.severity})`
		).join('\n');

		const phaseBSystem = `You are a compliance auditor for critical software. Use the threat model to find real violations. For each violation, trace the data flow path that leads to it. Be conservative — only flag issues you are confident about. Respond with ONLY valid JSON, no prose.`;

		const phaseBUser = `THREAT MODEL (from security analysis):
${threatModel}

RULES TO CHECK (use exact IDs):
${rulesSummary}
${frameworkContext ? `\nFRAMEWORK CONTEXT:\n${frameworkContext}\n` : ''}
EXISTING PATTERN VIOLATIONS:
${patternSummary}
${dependencyContext}
FILE: ${fileName}

\`\`\`${ext}
${codeSection}
\`\`\`

Using the threat model above, find violations that match the identified data flows and broken assumptions.
For each violation, trace the data flow path that leads to it.

JSON response:
{"additionalViolations":[{"line":<number>,"ruleId":"<ID>","severity":"error|warning|info","message":"<what>","snippet":"<code max 80ch>","aiExplanation":"<why — reference specific threat model findings>","aiConfidence":"high|medium|low","dataFlowTrace":[{"file":"<filename>","line":<n>,"description":"<step>"}],"brokenAssumption":"<from threat model>"}],"enrichments":[{"ruleId":"<ID>","line":<n>,"aiExplanation":"<context>","aiConfidence":"high|medium|low"}],"falsePositives":[{"ruleId":"<ID>","line":<n>,"reason":"<why wrong>"}]}`;

		return new Promise<ContractReasonResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				console.warn(`[ContractReason] Phase B timed out for ${fileName}`);
				resolve(undefined);
			}, 30_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: phaseBUser }] as LLMChatMessage[],
				separateSystemMessage: phaseBSystem,
				chatMode: null,
				modelSelection: modelSelection as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					clearTimeout(timeoutId);
					const elapsed = Date.now() - startTime;
					console.log(`[ContractReason] ${fileName} two-phase analysis complete in ${elapsed}ms`);
					resolve(this._parseAnalysisResponse(params.fullText, fileUri, allEnabledRules));
				},
				onError: (err: { message: string }) => {
					clearTimeout(timeoutId);
					if (err.message && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('quota'))) {
						this._rateLimiter.reportRateLimitError();
					}
					console.error(`[ContractReason] Phase B error for ${fileName}:`, err.message);
					resolve(undefined);
				},
				onAbort: () => { clearTimeout(timeoutId); resolve(undefined); },
				logging: { loggingName: `GRC-ContractReason-PhaseB-${fileName}` },
			});
		});
	}


	// ─── Function Extraction (used by single-call analysis) ─────────

	/**
	 * Extract function/method boundaries from source code.
	 */
	private _extractFunctions(fileContent: string): Array<{
		name: string;
		startLine: number;
		endLine: number;
		code: string;
	}> {
		const functions: Array<{ name: string; startLine: number; endLine: number; code: string }> = [];
		const lines = fileContent.split('\n');

		const CONTROL_FLOW = new Set(['if', 'for', 'while', 'switch', 'do', 'else', 'try', 'catch', 'finally', 'return', 'class', 'new', 'typeof', 'instanceof', 'void', 'delete', 'throw']);

		const fnPatterns = [
			/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
			/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,
			/^\s*(?:(?:public|private|protected|static|async|override)\s+)+(\w+)\s*\([^)]*\)\s*[:{]/,
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

			if (fnName && !CONTROL_FLOW.has(fnName)) {
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

				if (endLine - i >= 2) {
					functions.push({
						name: fnName,
						startLine: i + 1,
						endLine: endLine + 1,
						code: lines.slice(i, endLine + 1).join('\n'),
					});
				}

				i = endLine;
			}
		}

		return functions;
	}


	// ─── Rule Routing & Legacy Multi-Call Helpers ───────────────────

	/**
	 * Route relevant rules to a function based on its content patterns.
	 * Optionally uses a parsed threat model (from Phase A) for semantic routing.
	 */
	private _getRelevantRules(
		fn: { name: string; code: string },
		allRules: IGRCRule[],
		_context?: INanoAgentContext,
		threatModel?: { entryPoints?: string[]; sensitiveOps?: string[]; dataFlows?: string[]; assumptions?: string[] }
	): IGRCRule[] {
		const code = fn.code.toLowerCase();
		const relevant: IGRCRule[] = [];

		// Build threat keyword set for semantic routing
		const threatKeywords = threatModel
			? [...(threatModel.entryPoints || []), ...(threatModel.sensitiveOps || []), ...(threatModel.dataFlows || [])].join(' ').toLowerCase()
			: '';

		for (const rule of allRules) {
			if (!rule.enabled) continue;

			// Always include critical/blocker rules
			if (rule.severity === 'blocker' || rule.severity === 'critical') {
				relevant.push(rule);
				continue;
			}

			// Threat model semantic routing — if threat model found something related to this rule
			if (threatModel && threatKeywords) {
				const ruleTags = (rule.tags || []).map(t => t.toLowerCase());
				if (ruleTags.some(t => threatKeywords.includes(t))) {
					relevant.push(rule);
					continue;
				}
				// Also match rule domain against threat keywords
				if (rule.domain && threatKeywords.includes(rule.domain.toLowerCase())) {
					relevant.push(rule);
					continue;
				}
			}

			// Domain-based routing using rule.check patterns
			if (rule.check) {
				const checkStr = JSON.stringify(rule.check).toLowerCase();
				const concepts = checkStr.match(/\b\w{4,}\b/g) || [];
				if (concepts.some(c => code.includes(c))) {
					relevant.push(rule);
					continue;
				}
			}

			// Fallback: tag / content keyword matching
			const tags = (rule.tags || []).map(t => t.toLowerCase());
			const isNetworkRelated = tags.some(t => ['network', 'authentication', 'api'].includes(t))
				|| code.includes('fetch') || code.includes('axios') || code.includes('http')
				|| code.includes('req.') || code.includes('res.');

			const isCryptoRelated = tags.some(t => ['crypto', 'encryption', 'hash'].includes(t))
				|| code.includes('crypto') || code.includes('encrypt') || code.includes('hash');

			const isAuthRelated = tags.some(t => ['auth', 'authentication', 'credentials', 'secrets', 'token'].includes(t))
				|| code.includes('token') || code.includes('password') || code.includes('secret')
				|| code.includes('apikey') || code.includes('api_key');

			const isDbRelated = tags.some(t => ['sql', 'database', 'sql-injection', 'db'].includes(t))
				|| code.includes('query') || code.includes('execute') || code.includes('sql');

			const isErrorHandling = tags.some(t => ['error-handling', 'async', 'exception'].includes(t))
				|| code.includes('async') || code.includes('try') || code.includes('catch');

			const ctxRelevant = _context && _context.capabilities && (
				(_context.capabilities.hasNetwork && isNetworkRelated) ||
				(_context.capabilities.hasCrypto && isCryptoRelated) ||
				(_context.capabilities.hasAuth && isAuthRelated)
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
	 * (Preserved for targeted single-function analysis if needed externally.)
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

		const fnSystemMsg = `You are a compliance auditor for critical software. You find violations that static pattern matching misses — aliased variables, indirect flows, obfuscated secrets, and context-dependent issues. Be conservative: only flag real issues with high confidence. Respond ONLY with valid JSON, no prose.`;

		const fnUserMsg = `Analyze this function against the compliance rules below.

FRAMEWORK UNDERSTANDING:
${frameworkContext.substring(0, 6000)}

RULES TO CHECK (only these — use their exact IDs in your response):
${rulesSummary}

PATTERN CHECKS ALREADY FOUND IN THIS FUNCTION:
${patternSummary}
${contextSnippet}
FUNCTION: ${fn.name} (lines ${fn.startLine}-${fn.endLine} in file)

\`\`\`${ext}
${fn.code}
\`\`\`

Respond with ONLY this JSON structure:
{
  "additionalViolations": [
    { "line": <absolute line number in file>, "ruleId": "<exact rule ID from above>", "severity": "error|warning|info", "message": "<what's wrong>", "snippet": "<offending code max 80 chars>", "aiExplanation": "<why this matters>", "aiConfidence": "high|medium|low" }
  ],
  "enrichments": [
    { "ruleId": "<exact rule ID>", "line": <number>, "aiExplanation": "<context-specific explanation using actual variable names>", "aiConfidence": "high|medium|low" }
  ],
  "falsePositives": [
    { "ruleId": "<exact rule ID>", "line": <number>, "reason": "<why the pattern check was wrong>" }
  ]
}`;

		return new Promise<ContractReasonResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				resolve(undefined);
			}, 20_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: fnUserMsg }] as LLMChatMessage[],
				separateSystemMessage: fnSystemMsg,
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
	 * Analyze the whole file when function extraction isn't possible.
	 * (Preserved for fallback / external use.)
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

		const wfSystemMsg = `You are a compliance auditor for critical software. You find violations that static pattern matching misses. Be conservative: only flag real issues with high confidence. Respond ONLY with valid JSON, no prose.`;

		const wfUserMsg = `Analyze this file against the compliance rules below.

FRAMEWORK UNDERSTANDING:
${frameworkContext.substring(0, 6000)}

RULES TO CHECK (use their exact IDs in your response):
${rulesSummary}

PATTERN CHECKS ALREADY FOUND:
${patternSummary}
${contextSnippet}
FILE: ${fileUri.path.split('/').pop()}

\`\`\`${ext}
${truncatedCode}
\`\`\`

Respond with ONLY this JSON structure:
{
  "additionalViolations": [
    { "line": <number>, "ruleId": "<exact rule ID>", "severity": "error|warning|info", "message": "<what's wrong>", "snippet": "<code max 80 chars>", "aiExplanation": "<why this matters>", "aiConfidence": "high|medium|low" }
  ],
  "enrichments": [
    { "ruleId": "<exact rule ID>", "line": <number>, "aiExplanation": "<context explanation using actual variable names>", "aiConfidence": "high|medium|low" }
  ],
  "falsePositives": [
    { "ruleId": "<exact rule ID>", "line": <number>, "reason": "<why the pattern check was wrong>" }
  ]
}`;

		return new Promise<ContractReasonResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				console.warn('[ContractReason] Whole-file analysis timed out for', fileUri.path);
				resolve(undefined);
			}, 30_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: wfUserMsg }] as LLMChatMessage[],
				separateSystemMessage: wfSystemMsg,
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
		rules: IGRCRule[],
		riskScore?: number
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
					// Deep analysis fields
					dataFlowTrace: Array.isArray(v.dataFlowTrace) ? v.dataFlowTrace : undefined,
					brokenAssumption: v.brokenAssumption || undefined,
					riskScore: riskScore,
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


	// ─── Scan Tracker API ────────────────────────────────────────────

	public getScanTrackerState(): IScanTrackerState {
		const entries = Array.from(this._scanEntries.values());
		return {
			entries,
			totalFiles: entries.length,
			scannedCount: entries.filter(e => e.status === 'scanned').length,
			skippedCount: entries.filter(e => e.status === 'skipped').length,
			errorCount: entries.filter(e => e.status === 'error').length,
			scanningCount: entries.filter(e => e.status === 'scanning').length,
			isScanning: this._isScanning,
			lastScanCompleted: this._lastScanCompleted,
			periodicScanActive: this._periodicScanActive,
			periodicScanIntervalMs: this._periodicScanIntervalMs,
		};
	}

	public scanTrackerBeginScan(fileUris: URI[], riskScores?: Map<string, number>): void {
		this._isScanning = true;
		for (const uri of fileUris) {
			const key = uri.toString();
			const riskScore = riskScores?.get(key);
			// Only set to pending if not already tracked from a previous scan
			if (!this._scanEntries.has(key)) {
				this._scanEntries.set(key, {
					fileUri: key,
					fileName: uri.path.split('/').pop() || 'unknown',
					status: 'pending',
					timestamp: Date.now(),
					riskScore,
				});
			} else {
				// Re-queue: reset to pending unless already scanned with same hash
				const existing = this._scanEntries.get(key)!;
				if (existing.status !== 'scanned' && existing.status !== 'skipped') {
					existing.status = 'pending';
					existing.timestamp = Date.now();
				}
				// Always update risk score when available
				if (riskScore !== undefined) existing.riskScore = riskScore;
			}
		}
		this._fireScanTrackerUpdate();
	}

	public scanTrackerEndScan(): void {
		this._isScanning = false;
		this._lastScanCompleted = Date.now();
		this._fireScanTrackerUpdate();
	}

	public scanTrackerReset(): void {
		this._scanEntries.clear();
		this._fireScanTrackerUpdate();
	}

	public scanTrackerSetPeriodicState(active: boolean, intervalMs?: number): void {
		this._periodicScanActive = active;
		if (intervalMs !== undefined) {
			this._periodicScanIntervalMs = intervalMs;
		}
		this._fireScanTrackerUpdate();
	}

	/** Internal: mark a file as scanning */
	private _scanTrackerMarkScanning(fileUri: URI): void {
		const key = fileUri.toString();
		const entry = this._scanEntries.get(key);
		if (entry) {
			entry.status = 'scanning';
			entry.timestamp = Date.now();
		} else {
			this._scanEntries.set(key, {
				fileUri: key,
				fileName: fileUri.path.split('/').pop() || 'unknown',
				status: 'scanning',
				timestamp: Date.now(),
			});
		}
		this._fireScanTrackerUpdate();
	}

	/** Internal: mark a file as scanned with result count */
	private _scanTrackerMarkScanned(fileUri: URI, violationCount: number): void {
		const key = fileUri.toString();
		const entry = this._scanEntries.get(key) || {
			fileUri: key,
			fileName: fileUri.path.split('/').pop() || 'unknown',
			status: 'scanned' as const,
			timestamp: Date.now(),
		};
		entry.status = 'scanned';
		entry.violationCount = violationCount;
		entry.timestamp = Date.now();
		this._scanEntries.set(key, entry);
		this._fireScanTrackerUpdate();
	}

	/** Internal: mark a file as skipped (cache hit or duplicate) */
	private _scanTrackerMarkSkipped(fileUri: URI, reason: string): void {
		const key = fileUri.toString();
		const entry = this._scanEntries.get(key) || {
			fileUri: key,
			fileName: fileUri.path.split('/').pop() || 'unknown',
			status: 'skipped' as const,
			timestamp: Date.now(),
		};
		entry.status = 'skipped';
		entry.skipReason = reason;
		entry.timestamp = Date.now();
		this._scanEntries.set(key, entry);
		// Don't fire on every skip during bulk scan — too noisy
	}

	/** Internal: mark a file as errored */
	private _scanTrackerMarkError(fileUri: URI, errorMessage: string): void {
		const key = fileUri.toString();
		const entry = this._scanEntries.get(key) || {
			fileUri: key,
			fileName: fileUri.path.split('/').pop() || 'unknown',
			status: 'error' as const,
			timestamp: Date.now(),
		};
		entry.status = 'error';
		entry.errorMessage = errorMessage;
		entry.timestamp = Date.now();
		this._scanEntries.set(key, entry);
		this._fireScanTrackerUpdate();
	}

	private _fireScanTrackerUpdate(): void {
		this._onDidScanTrackerUpdate.fire(this.getScanTrackerState());
	}


	// ─── Helpers ─────────────────────────────────────────────────────

	/**
	 * Build a prompt snippet from context-only files (tests, mocks, configs).
	 * These files are excluded from scanning but provide important context
	 * for AI reasoning about the code being analyzed.
	 */
	/**
	 * Build a cross-file dependency context snippet for the LLM prompt.
	 * Includes focused excerpts from files that import or are imported by the target.
	 */
	private _buildDependencyContext(
		fileUri: URI,
		fileContent: string,
		allFileContents?: Map<string, string>
	): string {
		if (!allFileContents || allFileContents.size === 0) return '';

		const targetPath = fileUri.path;
		const targetName = targetPath.split('/').pop() || 'unknown';
		const targetDir = targetPath.replace(/\/[^/]+$/, '');

		// Find what this file imports (simple relative import scan)
		const importedPaths: string[] = [];
		const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
		let match: RegExpExecArray | null;
		while ((match = importRegex.exec(fileContent)) !== null) {
			importedPaths.push(match[1]);
		}

		// Find files that import this file (dependents) by scanning allFileContents
		const targetBaseName = targetName.replace(/\.[^.]+$/, '');
		const dependentEntries: Array<[string, string]> = [];
		const dependencyEntries: Array<[string, string]> = [];

		for (const [uriStr, content] of allFileContents) {
			if (uriStr === fileUri.toString()) continue;

			// Check if this file imports the target
			const importsTarget = content.includes(`'${targetBaseName}'`) ||
				content.includes(`"${targetBaseName}"`) ||
				content.includes(`/${targetBaseName}'`) ||
				content.includes(`/${targetBaseName}"`);

			if (importsTarget && dependentEntries.length < 3) {
				dependentEntries.push([uriStr, content]);
			}
		}

		// For each import path, find the matching file in allFileContents
		for (const importPath of importedPaths.slice(0, 3)) {
			// Resolve relative to target dir
			const parts = importPath.split('/');
			let resolved = targetDir;
			for (const part of parts) {
				if (part === '.' || part === '') continue;
				if (part === '..') { resolved = resolved.replace(/\/[^/]+$/, ''); }
				else resolved = `${resolved}/${part}`;
			}

			// Find matching entry in allFileContents
			for (const [uriStr, content] of allFileContents) {
				const uriPath = URI.parse(uriStr).path;
				const uriBase = uriPath.replace(/\.[^.]+$/, '');
				if (uriBase === resolved || uriBase.endsWith(resolved.split('/').pop() || '')) {
					if (dependencyEntries.length < 3) {
						dependencyEntries.push([uriStr, content]);
					}
					break;
				}
			}
		}

		if (dependentEntries.length === 0 && dependencyEntries.length === 0) return '';

		const MAX_CHARS = 2000;
		const sections: string[] = [];

		// Files this file imports (dependencies)
		for (const [uriStr, content] of dependencyEntries) {
			const name = uriStr.split('/').pop() || 'unknown';
			const excerpt = content.length > MAX_CHARS ? content.substring(0, MAX_CHARS) + '\n... (truncated)' : content;
			sections.push(`// DEPENDENCY: ${name} (imported by ${targetName})\n${excerpt}`);
		}

		// Files that import this file (dependents)
		for (const [uriStr, content] of dependentEntries) {
			const name = uriStr.split('/').pop() || 'unknown';
			const excerpt = content.length > MAX_CHARS ? content.substring(0, MAX_CHARS) + '\n... (truncated)' : content;
			sections.push(`// DEPENDENT: ${name} (imports from ${targetName})\n${excerpt}`);
		}

		return `\n\nCROSS-FILE CONTEXT:
These files are connected to ${targetName} via imports. Check for:
- Tainted data flowing across file boundaries
- Missing validation at import boundaries
- Inconsistent error handling across the call chain
- Auth checks bypassed by callers

${sections.join('\n\n---\n\n')}`;
	}

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

	// Preserved for targeted per-function analysis (future: coding agent deep-scan)
	private readonly _legacyAnalyzers = [this._analyzeFunctionChunk, this._mergeResults];
}


// ─── Registration ────────────────────────────────────────────────────────────

registerSingleton(IContractReasonService, ContractReasonService, InstantiationType.Delayed);
