/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # GRC Engine Service
 *
 * The core evaluation engine of the Neural Inverse GRC platform.
 *
 * ## How Evaluation Works
 *
 * When a document is evaluated (`evaluateDocument()`), the engine:
 *
 * 1. Gets all enabled rules from the config loader (built-in + framework + user)
 * 2. Routes each rule to the appropriate analyzer based on `rule.type`:
 *    - `regex` → regex pattern matching (inline, fast)
 *    - `file-level` → file-level checks (line count, headers)
 *    - `ast` → AST analyzer (when available)
 *    - `dataflow` → Data flow analyzer (when available)
 *    - `import-graph` → Import graph analyzer (workspace-level)
 *    - `external` → External tool runner (CLI delegation)
 * 3. Collects all violations as `ICheckResult[]`
 * 4. Caches results per file URI
 * 5. Fires `onDidCheckComplete` event for diagnostics and UI consumers
 *
 * ## Analyzer Registration
 *
 * The engine uses a pluggable analyzer architecture. Analyzers register
 * themselves via `registerAnalyzer()`. If an analyzer is not registered
 * for a rule type, the engine logs a warning and skips those rules.
 *
 * This allows Phase 2 analyzers (AST, dataflow, etc.) to be built
 * independently and plugged into the engine without modifying this file.
 *
 * ## Domain Discovery
 *
 * Domains are NOT hardcoded. The engine discovers all unique domains
 * from loaded rules (built-in, framework, and user-defined). This
 * supports the framework-agnostic architecture where enterprises
 * define their own categories.
 */

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { URI } from '../../../../../../base/common/uri.js';
import { GRCDomain, IGRCRule, ICheckResult, IDomainSummary, GRC_BUILTIN_DOMAIN_LIST, toDisplaySeverity } from '../types/grcTypes.js';
import { GRCConfigLoader } from '../config/grcConfigLoader.js';
import { IFrameworkRegistry } from '../framework/frameworkRegistry.js';
import { IRegexCheck, IFileLevelCheck, IFrameworkMetadata, IFrameworkValidationResult } from '../framework/frameworkSchema.js';

export const IGRCEngineService = createDecorator<IGRCEngineService>('neuralInverseGRCEngineService');


// ─── Analyzer Interface ──────────────────────────────────────────────────────

/**
 * Interface for pluggable rule analyzers.
 *
 * Each analyzer handles one or more rule types. The engine routes
 * rules to analyzers based on `rule.type`.
 *
 * ## Implementing a New Analyzer
 *
 * ```typescript
 * class MyAstAnalyzer implements IRuleAnalyzer {
 *   readonly supportedTypes = ['ast'];
 *
 *   evaluate(rule: IGRCRule, model: ITextModel, fileUri: URI): ICheckResult[] {
 *     // Parse AST, match against rule.check, return violations
 *   }
 * }
 *
 * // Register with the engine:
 * engineService.registerAnalyzer(myAstAnalyzer);
 * ```
 */
export interface IRuleAnalyzer {
	/** Which rule types this analyzer can handle */
	readonly supportedTypes: string[];

	/**
	 * Evaluate a single rule against a document.
	 * Returns an array of violations found.
	 */
	evaluate(rule: IGRCRule, model: ITextModel, fileUri: URI, timestamp: number): ICheckResult[];
}


// ─── Service Interface ───────────────────────────────────────────────────────

export interface IGRCEngineService {
	readonly _serviceBrand: undefined;

	/** Fires when a document has been evaluated and new results are available */
	readonly onDidCheckComplete: Event<ICheckResult[]>;

	/** Fires when rules are reloaded from config or frameworks */
	readonly onDidRulesChange: Event<void>;

	/** Evaluate all enabled rules against a text model */
	evaluateDocument(model: ITextModel): ICheckResult[];

	/** Get cached results filtered by domain */
	getResultsForDomain(domain: GRCDomain): ICheckResult[];

	/** Get all cached results across all domains */
	getAllResults(): ICheckResult[];

	/** Get summary counts per domain (dynamic, not hardcoded) */
	getDomainSummary(): IDomainSummary[];

	/**
	 * Get all unique domains from loaded rules.
	 * Includes built-in + framework + user-defined domains.
	 */
	getActiveDomains(): GRCDomain[];

	/**
	 * Get metadata for all currently loaded frameworks.
	 */
	getActiveFrameworks(): IFrameworkMetadata[];

	/** Get all loaded rules */
	getRules(): IGRCRule[];

	/**
	 * Get violations that block commits.
	 * These are violations from rules with blockingBehavior.blocksCommit === true.
	 */
	getBlockingViolations(): ICheckResult[];

	/** Force reload rules from disk */
	reloadRules(): Promise<void>;

	/** Clear cached results for a file */
	clearResultsForFile(fileUri: URI): void;

	/**
	 * Register a pluggable analyzer for specific rule types.
	 * Used by Phase 2 analyzers (AST, dataflow, etc.) to plug into the engine.
	 */
	registerAnalyzer(analyzer: IRuleAnalyzer): void;

	/** Save (add or update) a rule via the config loader */
	saveRule(rule: IGRCRule): Promise<void>;

	/** Toggle a rule on/off */
	toggleRule(ruleId: string, enabled: boolean): Promise<void>;

	/** Delete a user-defined rule */
	deleteRule(ruleId: string): Promise<void>;

	/**
	 * Import a framework from a JSON string.
	 * Delegates to IFrameworkRegistry.importFramework().
	 */
	importFramework(json: string): Promise<IFrameworkValidationResult>;
}


// ─── Implementation ──────────────────────────────────────────────────────────

export class GRCEngineService extends Disposable implements IGRCEngineService {
	declare readonly _serviceBrand: undefined;

	private readonly _configLoader: GRCConfigLoader;

	/** Cached check results per file URI string */
	private readonly _resultsByFile = new Map<string, ICheckResult[]>();

	/** Compiled regex cache per rule ID */
	private readonly _regexCache = new Map<string, RegExp>();

	/** Registered analyzers by rule type */
	private readonly _analyzers = new Map<string, IRuleAnalyzer>();

	private readonly _onDidCheckComplete = this._register(new Emitter<ICheckResult[]>());
	public readonly onDidCheckComplete: Event<ICheckResult[]> = this._onDidCheckComplete.event;

	private readonly _onDidRulesChange = this._register(new Emitter<void>());
	public readonly onDidRulesChange: Event<void> = this._onDidRulesChange.event;

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IFrameworkRegistry private readonly frameworkRegistry: IFrameworkRegistry,
	) {
		super();

		this._configLoader = this._register(
			new GRCConfigLoader(fileService, workspaceContextService, frameworkRegistry)
		);

		// When config/framework changes, clear caches and fire event
		this._register(this._configLoader.onDidChange(() => {
			this._regexCache.clear();
			this._onDidRulesChange.fire();
			console.log('[GRCEngine] Rules reloaded:', this._configLoader.getRules().length, 'total rules');
		}));
	}


	// ─── Analyzer Registration ───────────────────────────────────────

	/**
	 * Register a pluggable analyzer for specific rule types.
	 *
	 * Example:
	 * ```typescript
	 * engineService.registerAnalyzer(new AstAnalyzer());
	 * ```
	 *
	 * If an analyzer is already registered for a type, it is replaced.
	 */
	public registerAnalyzer(analyzer: IRuleAnalyzer): void {
		for (const type of analyzer.supportedTypes) {
			this._analyzers.set(type, analyzer);
			console.log(`[GRCEngine] Registered analyzer for type: ${type}`);
		}
	}


	// ─── Evaluation ──────────────────────────────────────────────────

	/**
	 * Evaluate all enabled rules against a text model.
	 *
	 * Routes each rule to the appropriate analyzer based on `rule.type`:
	 * - `regex` → built-in regex matching (handled here)
	 * - `file-level` → built-in file-level checks (handled here)
	 * - Other types → delegated to registered analyzers
	 *
	 * Results are cached per file URI and an event is fired.
	 */
	public evaluateDocument(model: ITextModel): ICheckResult[] {
		const fileUri = model.uri;
		const rules = this._configLoader.getRules().filter(r => r.enabled);
		const results: ICheckResult[] = [];
		const lines = model.getLinesContent();
		const now = Date.now();

		for (const rule of rules) {
			const ruleType = rule.type ?? 'regex';

			switch (ruleType) {
				case 'regex':
					results.push(...this._evaluateRegexRule(rule, lines, fileUri, now));
					break;

				case 'file-level':
					results.push(...this._evaluateFileLevelRule(rule, lines, fileUri, now));
					break;

				default: {
					// Delegate to registered analyzer
					const analyzer = this._analyzers.get(ruleType);
					if (analyzer) {
						try {
							const analyzerResults = analyzer.evaluate(rule, model, fileUri, now);
							results.push(...analyzerResults);
						} catch (e) {
							console.error(`[GRCEngine] Analyzer error for rule ${rule.id} (type: ${ruleType}):`, e);
						}
					}
					// Silently skip if no analyzer registered — Phase 2 analyzers
					// will register themselves when they are implemented.
					break;
				}
			}
		}

		// Cache results
		this._resultsByFile.set(fileUri.toString(), results);

		// Fire event
		this._onDidCheckComplete.fire(results);

		return results;
	}


	// ─── Regex Evaluation (built-in) ─────────────────────────────────

	/**
	 * Evaluate a regex-type rule against all lines of code.
	 *
	 * Supports two patterns:
	 * 1. Rule has `pattern` field directly (backward compat / built-in rules)
	 * 2. Rule has `check.pattern` (framework-imported rules)
	 */
	private _evaluateRegexRule(rule: IGRCRule, lines: string[], fileUri: URI, timestamp: number): ICheckResult[] {
		const results: ICheckResult[] = [];

		const regex = this._getRegex(rule);
		if (!regex) {
			return results;
		}

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Skip comment-only lines (basic heuristic)
			const trimmed = line.trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
				continue;
			}

			regex.lastIndex = 0; // Reset for global regex
			const match = regex.exec(line);
			if (match) {
				results.push({
					ruleId: rule.id,
					domain: rule.domain,
					severity: toDisplaySeverity(rule.severity),
					message: `[${rule.id}] ${rule.message}`,
					fileUri: fileUri,
					line: i + 1,        // 1-based
					column: match.index + 1,  // 1-based
					endLine: i + 1,
					endColumn: match.index + match[0].length + 1,
					codeSnippet: match[0],
					fix: rule.fix,
					timestamp: timestamp,
					frameworkId: rule.frameworkId,
					references: rule.references,
					blockingBehavior: rule.blockingBehavior,
				});
			}
		}

		return results;
	}


	// ─── File-Level Evaluation (built-in) ────────────────────────────

	/**
	 * Evaluate a file-level rule.
	 *
	 * Supports:
	 * - `max-lines`: file exceeds a line count threshold
	 * - `missing-header`: file doesn't start with expected pattern
	 * - `naming`: filename doesn't match expected pattern
	 *
	 * Also supports legacy rule IDs for backward compat (ARC-001).
	 */
	private _evaluateFileLevelRule(rule: IGRCRule, lines: string[], fileUri: URI, timestamp: number): ICheckResult[] {
		const results: ICheckResult[] = [];

		// Determine what to check — use structured check if available, else legacy
		const check = rule.check as IFileLevelCheck | undefined;
		const detectType = check?.detect ?? (rule.id === 'ARC-001' ? 'max-lines' : undefined);

		if (!detectType) {
			return results;
		}

		switch (detectType) {
			case 'max-lines': {
				const threshold = check?.threshold ?? rule.threshold ?? 500;
				if (lines.length > threshold) {
					results.push({
						ruleId: rule.id,
						domain: rule.domain,
						severity: toDisplaySeverity(rule.severity),
						message: `[${rule.id}] ${rule.message} (${lines.length} lines, limit: ${threshold})`,
						fileUri: fileUri,
						line: 1,
						column: 1,
						endLine: 1,
						endColumn: 1,
						fix: rule.fix,
						timestamp: timestamp,
						frameworkId: rule.frameworkId,
						references: rule.references,
						blockingBehavior: rule.blockingBehavior,
					});
				}
				break;
			}

			case 'missing-header': {
				const headerPattern = check?.headerPattern;
				if (headerPattern && lines.length > 0) {
					// Check first 5 lines for the header pattern
					const headerText = lines.slice(0, 5).join('\n');
					const headerRegex = new RegExp(headerPattern);
					if (!headerRegex.test(headerText)) {
						results.push({
							ruleId: rule.id,
							domain: rule.domain,
							severity: toDisplaySeverity(rule.severity),
							message: `[${rule.id}] ${rule.message}`,
							fileUri: fileUri,
							line: 1,
							column: 1,
							endLine: 1,
							endColumn: 1,
							fix: rule.fix,
							timestamp: timestamp,
							frameworkId: rule.frameworkId,
							references: rule.references,
						});
					}
				}
				break;
			}

			case 'naming': {
				const namePattern = check?.namePattern;
				if (namePattern) {
					const fileName = fileUri.path.split('/').pop() ?? '';
					const nameRegex = new RegExp(namePattern);
					if (!nameRegex.test(fileName)) {
						results.push({
							ruleId: rule.id,
							domain: rule.domain,
							severity: toDisplaySeverity(rule.severity),
							message: `[${rule.id}] ${rule.message} (file: ${fileName})`,
							fileUri: fileUri,
							line: 1,
							column: 1,
							endLine: 1,
							endColumn: 1,
							fix: rule.fix,
							timestamp: timestamp,
							frameworkId: rule.frameworkId,
							references: rule.references,
						});
					}
				}
				break;
			}
		}

		return results;
	}


	// ─── Regex Cache ─────────────────────────────────────────────────

	/**
	 * Gets or compiles a regex for a rule.
	 *
	 * Supports:
	 * - `rule.pattern` (legacy/built-in rules)
	 * - `rule.check.pattern` (framework rules with type: "regex")
	 */
	private _getRegex(rule: IGRCRule): RegExp | null {
		// Determine pattern — prefer check.pattern, fall back to rule.pattern
		let pattern = rule.pattern;
		let flags = 'gi';

		if (rule.check && rule.check.type === 'regex') {
			const regexCheck = rule.check as IRegexCheck;
			pattern = regexCheck.pattern || pattern;
			if (regexCheck.flags) {
				flags = regexCheck.flags + (regexCheck.flags.includes('g') ? '' : 'g');
			}
		}

		if (!pattern) {
			return null;
		}

		const cacheKey = `${rule.id}:${pattern}:${flags}`;
		const cached = this._regexCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const regex = new RegExp(pattern, flags);
			this._regexCache.set(cacheKey, regex);
			return regex;
		} catch (e) {
			console.error(`[GRCEngine] Invalid regex for rule ${rule.id}:`, pattern, e);
			return null;
		}
	}


	// ─── Query Methods ───────────────────────────────────────────────

	/**
	 * Get cached results filtered by domain.
	 */
	public getResultsForDomain(domain: GRCDomain): ICheckResult[] {
		const allResults: ICheckResult[] = [];
		for (const [, results] of this._resultsByFile) {
			for (const r of results) {
				if (r.domain === domain) {
					allResults.push(r);
				}
			}
		}
		return allResults;
	}

	/**
	 * Get all cached results across all domains and files.
	 */
	public getAllResults(): ICheckResult[] {
		const allResults: ICheckResult[] = [];
		for (const [, results] of this._resultsByFile) {
			allResults.push(...results);
		}
		return allResults;
	}

	/**
	 * Get summary counts per domain.
	 *
	 * IMPORTANT: Domains are NOT hardcoded. This method discovers all
	 * unique domains from loaded rules, supporting enterprise-defined
	 * categories from imported frameworks.
	 */
	public getDomainSummary(): IDomainSummary[] {
		const rules = this._configLoader.getRules();

		// Discover all unique domains from rules
		const domainSet = new Set<GRCDomain>(GRC_BUILTIN_DOMAIN_LIST);
		for (const rule of rules) {
			domainSet.add(rule.domain);
		}

		return Array.from(domainSet).map(domain => {
			const domainRules = rules.filter(r => r.domain === domain);
			const domainResults = this.getResultsForDomain(domain);

			// Find which frameworks contribute to this domain
			const frameworkIds = new Set<string>();
			for (const r of domainRules) {
				if (r.frameworkId) {
					frameworkIds.add(r.frameworkId);
				}
			}

			return {
				domain,
				errorCount: domainResults.filter(r => toDisplaySeverity(r.severity) === 'error').length,
				warningCount: domainResults.filter(r => toDisplaySeverity(r.severity) === 'warning').length,
				infoCount: domainResults.filter(r => toDisplaySeverity(r.severity) === 'info').length,
				totalRules: domainRules.length,
				enabledRules: domainRules.filter(r => r.enabled).length,
				frameworkIds: frameworkIds.size > 0 ? Array.from(frameworkIds) : undefined,
			};
		});
	}

	/**
	 * Get all unique domains from loaded rules.
	 * Includes built-in + framework + user-defined domains.
	 */
	public getActiveDomains(): GRCDomain[] {
		const rules = this._configLoader.getRules();
		const domainSet = new Set<GRCDomain>(GRC_BUILTIN_DOMAIN_LIST);
		for (const rule of rules) {
			domainSet.add(rule.domain);
		}
		return Array.from(domainSet);
	}

	public getActiveFrameworks(): IFrameworkMetadata[] {
		return this.frameworkRegistry.getActiveFrameworks()
			.filter(fw => fw.validation.valid)
			.map(fw => fw.definition.framework);
	}

	public async importFramework(json: string): Promise<IFrameworkValidationResult> {
		return this.frameworkRegistry.importFramework(json);
	}

	/**
	 * Get violations that block commits.
	 *
	 * Returns only violations from rules that have
	 * `blockingBehavior.blocksCommit === true`.
	 */
	public getBlockingViolations(): ICheckResult[] {
		const allResults = this.getAllResults();
		return allResults.filter(r => r.blockingBehavior?.blocksCommit === true);
	}

	/**
	 * Get all loaded rules.
	 */
	public getRules(): IGRCRule[] {
		return this._configLoader.getRules();
	}

	/**
	 * Force reload rules from disk.
	 */
	public async reloadRules(): Promise<void> {
		await this._configLoader.reload();
	}

	/**
	 * Clear cached results for a specific file.
	 */
	public clearResultsForFile(fileUri: URI): void {
		this._resultsByFile.delete(fileUri.toString());
	}


	// ─── Rule Management (delegated to config loader) ────────────────

	public async saveRule(rule: IGRCRule): Promise<void> {
		await this._configLoader.saveRule(rule);
	}

	public async toggleRule(ruleId: string, enabled: boolean): Promise<void> {
		await this._configLoader.toggleRule(ruleId, enabled);
	}

	public async deleteRule(ruleId: string): Promise<void> {
		await this._configLoader.deleteRule(ruleId);
	}
}

registerSingleton(IGRCEngineService, GRCEngineService, InstantiationType.Eager);
