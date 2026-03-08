/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * GRC Tools for the Checks Agent.
 *
 * All 10 built-in tools that give the Checks Agent real-time access to the
 * GRC engine, frameworks, external tools, and AI rule drafting.
 *
 * All tools are READ-ONLY except `run_workspace_scan` which triggers evaluation.
 */

import { IGRCEngineService } from '../../engine/services/grcEngineService.js';
import { IExternalToolService } from '../../engine/services/externalToolService.js';
import { IContractReasonService } from '../../engine/services/contractReasonService.js';
import { IChecksAgentService } from '../checksAgentService.js';
import { defineChecksTool } from '../checksToolRegistry.js';
import { IChecksTool } from '../checksAgentTypes.js';

/**
 * Build and return all 11 GRC tools, each bound to the live engine instances.
 */
export function buildChecksTools(
	grcEngine: IGRCEngineService,
	externalToolService: IExternalToolService,
	contractReasonService: IContractReasonService,
	checksAgentService: IChecksAgentService,
): IChecksTool[] {
	return [

		// ── 1. get_violations ─────────────────────────────────────────────────
		defineChecksTool(
			'get_violations',
			'Get current GRC violations from the engine. Filter by domain and/or severity. Returns up to `limit` violations (default 30).',
			[
				{ name: 'domain', type: 'string', description: 'Domain to filter by (e.g. "security", "compliance", "architecture"). Omit for all domains.', required: false },
				{ name: 'severity', type: 'string', description: 'Severity filter: "error", "warning", or "info". Omit for all severities.', required: false },
				{ name: 'limit', type: 'number', description: 'Maximum number of violations to return (default 30, max 100).', required: false },
			],
			async (args) => {
				const { domain, severity, limit = 30 } = args as { domain?: string; severity?: string; limit?: number };
				let results = grcEngine.getAllResults();

				if (domain) {
					results = results.filter(r => r.domain === domain);
				}
				if (severity) {
					results = results.filter(r => {
						const s = r.severity?.toLowerCase() ?? '';
						return s === severity.toLowerCase() || s.startsWith(severity.toLowerCase());
					});
				}

				const capped = results.slice(0, Math.min(limit, 100));
				if (capped.length === 0) {
					return `No violations found${domain ? ` in domain "${domain}"` : ''}${severity ? ` with severity "${severity}"` : ''}.`;
				}

				const rows = capped.map(r => ({
					ruleId: r.ruleId,
					domain: r.domain ?? 'unknown',
					severity: r.severity ?? 'info',
					file: r.fileUri?.path.split('/').pop() ?? 'unknown',
					line: r.line ?? 0,
					message: r.message,
					blocking: r.isBreakingChange ? true : undefined,
				}));

				return JSON.stringify(rows, null, 2);
			}
		),

		// ── 2. get_domain_summary ─────────────────────────────────────────────
		defineChecksTool(
			'get_domain_summary',
			'Get a summary of violations grouped by domain. Shows error, warning, and info counts per domain.',
			[],
			async (_args) => {
				const summary = grcEngine.getDomainSummary();
				if (summary.length === 0) {
					return 'No violations found in any domain.';
				}
				const rows = summary.map(d => ({
					domain: d.domain,
					errors: d.errorCount,
					warnings: d.warningCount,
					info: d.infoCount,
					total: d.errorCount + d.warningCount + d.infoCount,
				}));
				return JSON.stringify(rows, null, 2);
			}
		),

		// ── 3. get_rule_details ───────────────────────────────────────────────
		defineChecksTool(
			'get_rule_details',
			'Get the full definition of a GRC rule by its ID. Returns name, description, type, severity, domain, tags, and check pattern.',
			[
				{ name: 'ruleId', type: 'string', description: 'The rule ID to look up (e.g. "SEC-001", "ARCH-003").', required: true },
			],
			async (args) => {
				const { ruleId } = args as { ruleId: string };
				const rules = grcEngine.getRules();
				const rule = rules.find(r => r.id === ruleId);
				if (!rule) {
					return `Rule "${ruleId}" not found. Use get_framework_rules to list all available rules.`;
				}
				const details = {
					id: rule.id,
					message: rule.message,
					type: rule.type ?? 'regex',
					severity: rule.severity,
					domain: rule.domain,
					tags: rule.tags ?? [],
					enabled: rule.enabled !== false,
					blockingBehavior: rule.blockingBehavior,
				check: rule.check ? '[structured check]' : (rule.pattern || 'none'),
				};
				return JSON.stringify(details, null, 2);
			}
		),

		// ── 4. get_blocking_violations ────────────────────────────────────────
		defineChecksTool(
			'get_blocking_violations',
			'Get all violations that block commits or saves. These are critical violations that must be resolved before code can be committed.',
			[],
			async (_args) => {
				const violations = grcEngine.getBlockingViolations();
				if (violations.length === 0) {
					return 'No blocking violations found. All commits are currently permitted.';
				}
				const rows = violations.map(r => ({
					ruleId: r.ruleId,
					domain: r.domain ?? 'unknown',
					severity: r.severity ?? 'error',
					file: r.fileUri?.path.split('/').pop() ?? 'unknown',
					filePath: r.fileUri?.path ?? 'unknown',
					line: r.line ?? 0,
					message: r.message,
				}));
				return JSON.stringify({ count: rows.length, violations: rows }, null, 2);
			}
		),

		// ── 5. get_impact_chain ───────────────────────────────────────────────
		defineChecksTool(
			'get_impact_chain',
			'Get the cross-file impact tree for a file. Shows which other files depend on (import) this file, recursively. Useful for understanding blast radius of a change.',
			[
				{ name: 'file', type: 'string', description: 'File path or basename to analyze (e.g. "authService.ts" or full path).', required: true },
			],
			async (args) => {
				const { file } = args as { file: string };

				// Search by basename if not a full path
				const importedByMap = grcEngine.getImportedByMap();
				let matchedKey: string | undefined;

				for (const key of importedByMap.keys()) {
					const basename = key.split('/').pop() ?? '';
					if (key === file || basename === file || key.endsWith('/' + file)) {
						matchedKey = key;
						break;
					}
				}

				if (!matchedKey) {
					return `No import data found for "${file}". The file may not have been scanned yet, or it may not be imported by other files.`;
				}

				// Build the URI and get the impact chain
				const allResults = grcEngine.getAllResults();
				const matchingResult = allResults.find(r =>
					r.fileUri?.path.endsWith(matchedKey!) ||
					r.fileUri?.path.split('/').pop() === file
				);

				if (matchingResult?.fileUri) {
					const chain = grcEngine.getImpactChain(matchingResult.fileUri);
					if (chain) {
						return JSON.stringify(chain, null, 2);
					}
				}

				// Fallback: show raw importedBy data
				const importedBy = importedByMap.get(matchedKey) ?? [];
				return JSON.stringify({
					file: matchedKey,
					importedByCount: importedBy.length,
					importedBy: importedBy.slice(0, 20),
				}, null, 2);
			}
		),

		// ── 6. explain_violation ──────────────────────────────────────────────
		defineChecksTool(
			'explain_violation',
			'Explain a specific violation in context. Retrieves the violation details and surrounding code context to help understand why it was flagged.',
			[
				{ name: 'ruleId', type: 'string', description: 'The rule ID of the violation (e.g. "SEC-001").', required: true },
				{ name: 'file', type: 'string', description: 'File path or basename where the violation occurs.', required: true },
				{ name: 'line', type: 'number', description: 'Line number of the violation (optional, uses first match if omitted).', required: false },
			],
			async (args) => {
				const { ruleId, file, line } = args as { ruleId: string; file: string; line?: number };
				const allResults = grcEngine.getAllResults();

				const matches = allResults.filter(r =>
					r.ruleId === ruleId &&
					(r.fileUri?.path === file || r.fileUri?.path.split('/').pop() === file || r.fileUri?.path.endsWith('/' + file))
				);

				if (matches.length === 0) {
					return `No violation found for rule "${ruleId}" in file "${file}". Check that the file has been scanned recently.`;
				}

				const violation = line !== undefined
					? (matches.find(r => r.line === line) ?? matches[0])
					: matches[0];

				const rules = grcEngine.getRules();
				const rule = rules.find(r => r.id === ruleId);

				const explanation = {
					violation: {
						ruleId: violation.ruleId,
						domain: violation.domain,
						severity: violation.severity,
						file: violation.fileUri?.path ?? file,
						line: violation.line,
						column: violation.column,
						message: violation.message,
						isBreakingChange: violation.isBreakingChange ?? false,
					},
					rule: rule ? {
						message: rule.message,
						type: rule.type ?? 'regex',
						tags: rule.tags ?? [],
						blocksCommit: rule.blockingBehavior?.blocksCommit ?? false,
					} : { message: 'Rule definition not found.' },
					context: violation.traceInfo ?? 'No trace information available.',
					otherMatchesInFile: matches.length - 1,
				};

				return JSON.stringify(explanation, null, 2);
			}
		),

		// ── 7. get_framework_rules ────────────────────────────────────────────
		defineChecksTool(
			'get_framework_rules',
			'List GRC rules, optionally filtered to a specific framework. Returns rules grouped by domain with enabled/disabled status.',
			[
				{ name: 'frameworkId', type: 'string', description: 'Framework ID to filter by (e.g. "iso26262", "soc2"). Omit to list all rules.', required: false },
			],
			async (args) => {
				const { frameworkId } = args as { frameworkId?: string };
				let rules = grcEngine.getRules();

				if (frameworkId) {
					rules = rules.filter(r => r.frameworkId === frameworkId || r.tags?.includes(frameworkId));
				}

				if (rules.length === 0) {
					const frameworks = grcEngine.getActiveFrameworks();
					return `No rules found${frameworkId ? ` for framework "${frameworkId}"` : ''}.\nActive frameworks: ${frameworks.map(f => f.id).join(', ') || 'none'}.`;
				}

				// Group by domain
				const byDomain = new Map<string, typeof rules>();
				for (const rule of rules) {
					const d = rule.domain ?? 'unknown';
					if (!byDomain.has(d)) { byDomain.set(d, []); }
					byDomain.get(d)!.push(rule);
				}

				const grouped: Record<string, any[]> = {};
				for (const [domain, domainRules] of byDomain) {
					grouped[domain] = domainRules.map(r => ({
						id: r.id,
						type: r.type ?? 'regex',
						severity: r.severity,
						enabled: r.enabled !== false,
						blocksCommit: r.blockingBehavior?.blocksCommit ?? false,
					}));
				}

				return JSON.stringify({
					totalRules: rules.length,
					enabledCount: rules.filter(r => r.enabled !== false).length,
					byDomain: grouped,
				}, null, 2);
			}
		),

		// ── 8. get_external_tool_status ───────────────────────────────────────
		defineChecksTool(
			'get_external_tool_status',
			'Get the current status of external analysis tools (CodeQL, Semgrep, Polyspace, etc.). Shows last run time, hit count, and any errors.',
			[],
			async (_args) => {
				const jobs = externalToolService.getJobs();
				if (jobs.length === 0) {
					return 'No external tool jobs found. External tools may not be configured or have not been run yet.';
				}

				const rows = jobs.map(j => ({
					ruleId: j.ruleId,
					scope: j.scope,
					status: j.status,
					startedAt: j.startedAt ? new Date(j.startedAt).toISOString() : null,
					durationMs: j.durationMs ?? null,
					resultCount: j.resultCount ?? 0,
					error: j.error ?? null,
				}));

				return JSON.stringify(rows, null, 2);
			}
		),

		// ── 9. run_workspace_scan ─────────────────────────────────────────────
		defineChecksTool(
			'run_workspace_scan',
			'Trigger a full workspace scan. This re-evaluates all files against all enabled rules and updates the violation list. May take a few moments for large workspaces.',
			[],
			async (_args) => {
				try {
					// Fire and don't await — scan runs in background
					grcEngine.scanWorkspace().catch(e => {
						console.error('[ChecksAgent] Workspace scan error:', e);
					});
					return 'Workspace scan started. Results will update in the Checks Manager dashboard. Use get_violations to query results after a moment.';
				} catch (e: any) {
					return `Failed to start workspace scan: ${e.message}`;
				}
			}
		),

		// ── 10. draft_rule ────────────────────────────────────────────────────
		defineChecksTool(
			'draft_rule',
			'Draft a new GRC rule from a natural language description using AI. Returns a JSON rule definition ready to add to .inverse/rules.json.',
			[
				{ name: 'description', type: 'string', description: 'Natural language description of what the rule should enforce (e.g. "no use of eval() in auth modules").', required: true },
				{ name: 'type', type: 'string', description: 'Rule type hint: "regex", "ast", "file-level", or "universal". Defaults to "regex".', required: false },
				{ name: 'domain', type: 'string', description: 'Domain hint for the rule (e.g. "security", "compliance"). Defaults to best guess.', required: false },
			],
			async (args) => {
				const { description, type = 'regex', domain } = args as { description: string; type?: string; domain?: string };

				const frameworks = grcEngine.getActiveFrameworks();
				const frameworkContext = frameworks.length > 0
					? `Active frameworks: ${frameworks.map(f => f.name).join(', ')}.`
					: 'No frameworks currently active.';

				const prompt = [
					`You are a GRC rule author for the Neural Inverse compliance platform.`,
					``,
					`Generate a GRC rule JSON object for the following requirement:`,
					`"${description}"`,
					``,
					`Hints:`,
					`- Rule type: ${type}`,
					domain ? `- Domain: ${domain}` : `- Choose the most appropriate domain.`,
					frameworkContext,
					``,
					`Return ONLY valid JSON matching this schema (no markdown, no explanation):`,
					`{`,
					`  "id": "DOMAIN-XXX",`,
					`  "name": "Short rule name",`,
					`  "description": "What this rule enforces and why",`,
					`  "type": "${type}",`,
					`  "severity": "error" | "warning" | "info",`,
					`  "domain": "domain-name",`,
					`  "check": "regex-pattern-or-ast-selector",`,
					`  "message": "Violation message shown to developer",`,
					`  "tags": ["tag1", "tag2"],`,
					`  "enabled": true`,
					`}`,
				].join('\n');

				try {
					const result = await contractReasonService.sendOneShotQuery(prompt);
					if (!result) {
						return 'AI did not return a rule. Try again with a more specific description.';
					}
					// Extract JSON if wrapped in code block
					const jsonMatch = result.match(/```(?:json)?\n?([\s\S]*?)\n?```/) ?? result.match(/(\{[\s\S]*\})/);
					const jsonStr = jsonMatch ? jsonMatch[1] : result;
					try {
						JSON.parse(jsonStr); // validate
						return `Generated rule (add to .inverse/rules.json):\n\n${jsonStr}`;
					} catch {
						return `AI generated a rule but it may need minor edits:\n\n${result}`;
					}
				} catch (e: any) {
					return `Failed to generate rule: ${e.message}`;
				}
			}
		),

		// ── 11. request_code_context ──────────────────────────────────────────
		defineChecksTool(
			'request_code_context',
			'Request a code snippet from Power Mode via the agent bus. Use this when you need to see the actual source code around a violation to give a more precise compliance explanation. Budget-capped to 50 lines. Requires Power Mode to be running.',
			[
				{ name: 'file', type: 'string', description: 'Absolute file path or workspace-relative path (e.g. "src/auth/authService.ts").', required: true },
				{ name: 'startLine', type: 'number', description: 'First line to include (1-based).', required: true },
				{ name: 'endLine', type: 'number', description: 'Last line to include (1-based). Capped at startLine + 49.', required: true },
			],
			async (args) => {
				const { file, startLine, endLine } = args as { file: string; startLine: number; endLine: number };
				if (!file || typeof startLine !== 'number' || typeof endLine !== 'number') {
					return 'Invalid args: file, startLine, and endLine are required.';
				}
				try {
					const result = await checksAgentService.requestCodeContext(file, startLine, endLine);
					return result || 'No code context returned.';
				} catch (e: any) {
					return `Failed to request code context: ${e.message}`;
				}
			}
		),

	];
}
