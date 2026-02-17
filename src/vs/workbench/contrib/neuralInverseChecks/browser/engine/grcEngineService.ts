/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { URI } from '../../../../../base/common/uri.js';
import { GRCDomain, IGRCRule, ICheckResult, IDomainSummary } from './grcTypes.js';
import { GRCConfigLoader } from './grcConfigLoader.js';

export const IGRCEngineService = createDecorator<IGRCEngineService>('neuralInverseGRCEngineService');

export interface IGRCEngineService {
	readonly _serviceBrand: undefined;

	/** Fires when a document has been evaluated and new results are available */
	readonly onDidCheckComplete: Event<ICheckResult[]>;

	/** Fires when rules are reloaded from config */
	readonly onDidRulesChange: Event<void>;

	/** Evaluate all enabled rules against a text model */
	evaluateDocument(model: ITextModel): ICheckResult[];

	/** Get cached results filtered by domain */
	getResultsForDomain(domain: GRCDomain): ICheckResult[];

	/** Get all cached results across all domains */
	getAllResults(): ICheckResult[];

	/** Get summary counts per domain */
	getDomainSummary(): IDomainSummary[];

	/** Get all loaded rules */
	getRules(): IGRCRule[];

	/** Force reload rules from disk */
	reloadRules(): Promise<void>;

	/** Clear cached results for a file */
	clearResultsForFile(fileUri: URI): void;

	/** Save (add or update) a rule via the config loader */
	saveRule(rule: IGRCRule): Promise<void>;

	/** Toggle a rule on/off */
	toggleRule(ruleId: string, enabled: boolean): Promise<void>;

	/** Delete a user-defined rule */
	deleteRule(ruleId: string): Promise<void>;
}

export class GRCEngineService extends Disposable implements IGRCEngineService {
	declare readonly _serviceBrand: undefined;

	private readonly _configLoader: GRCConfigLoader;

	/** Cached check results per file URI string */
	private readonly _resultsByFile = new Map<string, ICheckResult[]>();

	/** Compiled regex cache per rule ID */
	private readonly _regexCache = new Map<string, RegExp>();

	private readonly _onDidCheckComplete = this._register(new Emitter<ICheckResult[]>());
	public readonly onDidCheckComplete: Event<ICheckResult[]> = this._onDidCheckComplete.event;

	private readonly _onDidRulesChange = this._register(new Emitter<void>());
	public readonly onDidRulesChange: Event<void> = this._onDidRulesChange.event;

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService
	) {
		super();

		this._configLoader = this._register(new GRCConfigLoader(fileService, workspaceContextService));

		// When config changes, clear regex cache and fire event
		this._register(this._configLoader.onDidChange(() => {
			this._regexCache.clear();
			this._onDidRulesChange.fire();
			console.log('[GRCEngine] Rules reloaded:', this._configLoader.getRules().length, 'total rules');
		}));
	}

	/**
	 * Evaluate all enabled rules against a text model.
	 * Results are cached per file URI and an event is fired.
	 */
	public evaluateDocument(model: ITextModel): ICheckResult[] {
		const fileUri = model.uri;
		const rules = this._configLoader.getRules().filter(r => r.enabled);
		const results: ICheckResult[] = [];
		const lines = model.getLinesContent();
		const now = Date.now();

		for (const rule of rules) {
			if (rule.type === 'file-level') {
				// File-level rules (e.g. max line count)
				const fileLevelResults = this._evaluateFileLevelRule(rule, lines, fileUri, now);
				results.push(...fileLevelResults);
			} else {
				// Regex rules - evaluate line by line
				const regex = this._getRegex(rule);
				if (!regex) {
					continue;
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
							severity: rule.severity,
							message: `[${rule.id}] ${rule.message}`,
							fileUri: fileUri,
							line: i + 1, // 1-based
							column: match.index + 1, // 1-based
							endLine: i + 1,
							endColumn: match.index + match[0].length + 1,
							codeSnippet: match[0],
							fix: rule.fix,
							timestamp: now
						});
					}
				}
			}
		}

		// Cache results
		this._resultsByFile.set(fileUri.toString(), results);

		// Fire event
		this._onDidCheckComplete.fire(results);

		return results;
	}

	private _evaluateFileLevelRule(rule: IGRCRule, lines: string[], fileUri: URI, timestamp: number): ICheckResult[] {
		const results: ICheckResult[] = [];

		switch (rule.id) {
			case 'ARC-001': {
				// File exceeds max lines
				const threshold = rule.threshold ?? 500;
				if (lines.length > threshold) {
					results.push({
						ruleId: rule.id,
						domain: rule.domain,
						severity: rule.severity,
						message: `[${rule.id}] ${rule.message} (${lines.length} lines, limit: ${threshold})`,
						fileUri: fileUri,
						line: 1,
						column: 1,
						endLine: 1,
						endColumn: 1,
						fix: rule.fix,
						timestamp: timestamp
					});
				}
				break;
			}
			// Add more file-level rules here as needed
		}

		return results;
	}

	private _getRegex(rule: IGRCRule): RegExp | null {
		if (!rule.pattern) {
			return null;
		}

		const cached = this._regexCache.get(rule.id);
		if (cached) {
			return cached;
		}

		try {
			const regex = new RegExp(rule.pattern, 'gi');
			this._regexCache.set(rule.id, regex);
			return regex;
		} catch (e) {
			console.error(`[GRCEngine] Invalid regex for rule ${rule.id}:`, rule.pattern, e);
			return null;
		}
	}

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
	 */
	public getDomainSummary(): IDomainSummary[] {
		const rules = this._configLoader.getRules();
		const domains: GRCDomain[] = ['security', 'compliance', 'data-integrity', 'architecture', 'fail-safe', 'policy'];

		return domains.map(domain => {
			const domainRules = rules.filter(r => r.domain === domain);
			const domainResults = this.getResultsForDomain(domain);

			return {
				domain,
				errorCount: domainResults.filter(r => r.severity === 'error').length,
				warningCount: domainResults.filter(r => r.severity === 'warning').length,
				infoCount: domainResults.filter(r => r.severity === 'info').length,
				totalRules: domainRules.length,
				enabledRules: domainRules.filter(r => r.enabled).length
			};
		});
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

	// ─── Rule Management (delegated to config loader) ───────────────

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
