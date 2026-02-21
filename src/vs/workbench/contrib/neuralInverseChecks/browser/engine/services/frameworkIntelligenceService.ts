/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Framework Intelligence Service
 *
 * A **separate AI system** that makes GRC checks smarter without touching
 * framework definitions. Frameworks stay pure pattern-based (regex, AST,
 * dataflow, import-graph). This service operates alongside them.
 *
 * ## How It Works
 *
 * **Phase 1 — Framework Comprehension (on import)**
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
 * **Phase 2 — Intelligent Analysis (on file save)**
 *
 * After pattern checks run, this service receives the code + pattern results
 * and uses the framework understanding to:
 * - Find violations that patterns missed
 * - Flag likely false positives
 * - Add contextual explanations
 *
 * ## Void LLM API Reference
 *
 * This service calls Void's LLM module without modifying Void core:
 *
 * ```typescript
 * import { ILLMMessageService } from '../../void/common/sendLLMMessageService.js';
 * import { IVoidSettingsService } from '../../void/common/voidSettingsService.js';
 *
 * // Get user's configured model:
 * const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
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


// ─── Service Interface ───────────────────────────────────────────────────────

export const IFrameworkIntelligenceService = createDecorator<IFrameworkIntelligenceService>('frameworkIntelligenceService');

/**
 * Intelligence results from AI analysis.
 */
export interface IntelligenceResult {
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
 * Cached framework comprehension.
 */
interface FrameworkContext {
	frameworkId: string;
	version: string;
	/** LLM's structured understanding of the framework */
	understanding: string;
	/** When the comprehension was created */
	timestamp: number;
}


export interface IFrameworkIntelligenceService {
	readonly _serviceBrand: undefined;

	/** Whether intelligence is available (model configured + framework comprehended + enabled) */
	readonly isAvailable: boolean;

	/** Whether the hybrid intelligence system is enabled (defaults to OFF) */
	readonly isEnabled: boolean;

	/** Enable or disable the hybrid intelligence system */
	setEnabled(enabled: boolean): void;

	/** Event fired when enabled state changes */
	readonly onDidEnabledChange: Event<boolean>;

	/** Comprehend a framework — called on import/load */
	comprehendFramework(framework: ILoadedFramework): Promise<void>;

	/** Get intelligence-enhanced results for a file */
	analyzeFile(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		context?: INanoAgentContext
	): Promise<IntelligenceResult | undefined>;

	/** Event fired when intelligence results are ready */
	readonly onDidIntelligenceResultsReady: Event<IntelligenceResult>;
}


// ─── Implementation ──────────────────────────────────────────────────────────

export class FrameworkIntelligenceService extends Disposable implements IFrameworkIntelligenceService {
	declare readonly _serviceBrand: undefined;

	/** Cached framework comprehension contexts */
	private readonly _frameworkContexts = new Map<string, FrameworkContext>();

	/** Currently running analysis requests (prevent duplicates) */
	private readonly _runningAnalyses = new Set<string>();

	/** Cached analysis results per file hash (LRU) */
	private readonly _resultCache = new Map<string, { result: IntelligenceResult; hash: string }>();

	/** Maximum cached analysis entries */
	private static readonly MAX_CACHE = 50;

	private readonly _onDidIntelligenceResultsReady = this._register(new Emitter<IntelligenceResult>());
	public readonly onDidIntelligenceResultsReady = this._onDidIntelligenceResultsReady.event;

	/** Hybrid intelligence enabled state — OFF by default */
	private _enabled = false;
	private readonly _onDidEnabledChange = this._register(new Emitter<boolean>());
	public readonly onDidEnabledChange = this._onDidEnabledChange.event;

	constructor(
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IFrameworkRegistry private readonly frameworkRegistry: IFrameworkRegistry,
	) {
		super();

		// Auto-comprehend when frameworks change (only if enabled)
		this._register(this.frameworkRegistry.onDidFrameworksChange(() => {
			if (this._enabled) {
				this._comprehendAllFrameworks();
			}
		}));

		console.log('[FrameworkIntelligence] Service initialized (hybrid intelligence OFF by default)');
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
			console.log('[FrameworkIntelligence] Hybrid Intelligence ENABLED');
			// Comprehend frameworks now that we're enabled
			this._comprehendAllFrameworks();
		} else {
			console.log('[FrameworkIntelligence] Hybrid Intelligence DISABLED');
		}
	}

	public get isAvailable(): boolean {
		if (!this._enabled) return false;
		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
		return !!modelSelection && this._frameworkContexts.size > 0;
	}


	// ─── Phase 1: Framework Comprehension ────────────────────────────

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
		if (this._frameworkContexts.has(cacheKey)) {
			return;
		}

		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
		if (!modelSelection) {
			console.log('[FrameworkIntelligence] No model configured — skipping comprehension');
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
					this._frameworkContexts.set(cacheKey, {
						frameworkId: fwId,
						version: fwVersion,
						understanding: params.fullText,
						timestamp: Date.now()
					});
					console.log(`[FrameworkIntelligence] Comprehended framework: ${fwId} v${fwVersion} (${params.fullText.length} chars)`);
					resolve();
				},
				onError: (err: { message: string }) => {
					console.error(`[FrameworkIntelligence] Comprehension failed for ${fwId}:`, err.message);
					resolve(); // Don't block on failure
				},
				onAbort: () => { resolve(); },
				logging: { loggingName: 'GRC-Intelligence-Comprehend' },
			});
		});
	}


	// ─── Phase 2: Intelligent File Analysis ──────────────────────────

	/**
	 * Analyze a file using the framework understanding + pattern results.
	 *
	 * Called after pattern checks complete (on file save, not keystroke).
	 * Returns additional violations, false positive flags, and explanations.
	 */
	public async analyzeFile(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		context?: INanoAgentContext
	): Promise<IntelligenceResult | undefined> {
		if (!this.isAvailable) {
			return undefined;
		}

		// Prevent duplicate analysis for the same file
		const fileKey = fileUri.toString();
		if (this._runningAnalyses.has(fileKey)) {
			return undefined;
		}

		// Check content-based cache
		const contentHash = this._simpleHash(fileContent);
		const cached = this._resultCache.get(fileKey);
		if (cached && cached.hash === contentHash) {
			return cached.result;
		}

		this._runningAnalyses.add(fileKey);

		try {
			const result = await this._runAnalysis(fileUri, fileContent, patternResults, rules, context);
			if (result) {
				// Cache result
				this._resultCache.set(fileKey, { result, hash: contentHash });

				// Evict old entries
				if (this._resultCache.size > FrameworkIntelligenceService.MAX_CACHE) {
					const firstKey = this._resultCache.keys().next().value;
					if (firstKey) this._resultCache.delete(firstKey);
				}

				this._onDidIntelligenceResultsReady.fire(result);
			}
			return result;
		} finally {
			this._runningAnalyses.delete(fileKey);
		}
	}


	/**
	 * Run the actual LLM analysis.
	 */
	private async _runAnalysis(
		fileUri: URI,
		fileContent: string,
		patternResults: ICheckResult[],
		rules: IGRCRule[],
		_context?: INanoAgentContext
	): Promise<IntelligenceResult | undefined> {
		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
		if (!modelSelection) return undefined;

		// Gather framework understanding
		const allContexts = Array.from(this._frameworkContexts.values())
			.map(ctx => ctx.understanding)
			.join('\n\n---\n\n');

		// Summarize pattern results already found
		const patternSummary = patternResults.length > 0
			? patternResults.map(r =>
				`  Line ${r.line}: [${r.ruleId}] ${r.message.substring(0, 100)}`
			).join('\n')
			: '  (No violations found by pattern checks)';

		// Truncate file content for LLM context window
		const maxCodeLength = 8000;
		const truncatedCode = fileContent.length > maxCodeLength
			? fileContent.substring(0, maxCodeLength) + '\n... (truncated)'
			: fileContent;

		// Get file extension for language hint
		const ext = fileUri.path.split('.').pop() || 'ts';

		const analysisPrompt = `You are a compliance auditor reviewing code against a regulatory framework. You have already studied the framework rules and understand their intent.

YOUR UNDERSTANDING OF THE FRAMEWORK:
${allContexts.substring(0, 4000)}

PATTERN CHECKS ALREADY FOUND:
${patternSummary}

FILE: ${fileUri.path.split('/').pop()}

\`\`\`${ext}
${truncatedCode}
\`\`\`

Analyze this code and respond with ONLY valid JSON (no markdown, no explanation outside JSON):

{
  "enrichments": [
    {
      "ruleId": "<rule ID from pattern results above>",
      "line": <line number from pattern results above>,
      "aiExplanation": "<context-specific explanation of why this code violates the rule, using actual variable names from the code. Be concise (1-2 sentences).>",
      "aiConfidence": "high|medium|low"
    }
  ],
  "additionalViolations": [
    {
      "line": <number>,
      "ruleId": "<closest matching rule ID from framework>",
      "severity": "error|warning|info",
      "message": "<specific explanation of what's wrong>",
      "snippet": "<the offending code, max 80 chars>",
      "aiExplanation": "<why this matters>",
      "aiConfidence": "high|medium|low"
    }
  ],
  "falsePositives": [
    {
      "ruleId": "<rule ID>",
      "line": <number>,
      "reason": "<why this pattern match is likely wrong>"
    }
  ]
}

RULES:
- ENRICHMENTS are the MOST IMPORTANT part. For EVERY pattern check found above, provide an enrichment with a context-specific explanation.
- For additionalViolations: only report violations that patterns MISSED. Do not duplicate.
- Be conservative with additionalViolations. Only flag real issues.
- Ensure your analysis specifically mentions relevant variables and flow within the snippet.
- Return ONLY valid JSON.`;

		return new Promise<IntelligenceResult | undefined>((resolve) => {
			const timeoutId = setTimeout(() => {
				console.warn('[FrameworkIntelligence] Analysis timed out for', fileUri.path);
				resolve(undefined);
			}, 30_000);

			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: analysisPrompt }] as LLMChatMessage[],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					clearTimeout(timeoutId);
					const result = this._parseAnalysisResponse(params.fullText, fileUri, rules);
					resolve(result);
				},
				onError: (err: { message: string }) => {
					clearTimeout(timeoutId);
					console.error('[FrameworkIntelligence] Analysis error:', err.message);
					resolve(undefined);
				},
				onAbort: () => {
					clearTimeout(timeoutId);
					resolve(undefined);
				},
				logging: { loggingName: 'GRC-Intelligence-Analyze' },
			});
		});
	}


	// ─── Response Parsing ────────────────────────────────────────────

	/**
	 * Parse the LLM's JSON response into a structured IntelligenceResult.
	 */
	private _parseAnalysisResponse(
		response: string,
		fileUri: URI,
		rules: IGRCRule[]
	): IntelligenceResult | undefined {
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
					aiExplanation: v.aiExplanation,
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
			console.error('[FrameworkIntelligence] Failed to parse LLM response:', e);
			return undefined;
		}
	}


	// ─── Helpers ─────────────────────────────────────────────────────

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

registerSingleton(IFrameworkIntelligenceService, FrameworkIntelligenceService, InstantiationType.Delayed);
