/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { IGRCEngineService } from './grcEngineService.js';
import { IAuditTrailService } from './auditTrailService.js';
import { IFrameworkRegistry } from '../framework/frameworkRegistry.js';

export const IComplianceReportService = createDecorator<IComplianceReportService>('complianceReportService');

export interface IComplianceReportService {
	readonly _serviceBrand: undefined;

	/** Generate a Markdown compliance report */
	generateReport(): Promise<string>;

	/** Generate and write report to .inverse/reports/ */
	exportReport(): Promise<URI | undefined>;
}

class ComplianceReportService extends Disposable implements IComplianceReportService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IGRCEngineService private readonly grcEngine: IGRCEngineService,
		@IAuditTrailService private readonly auditTrail: IAuditTrailService,
		@IFrameworkRegistry private readonly frameworkRegistry: IFrameworkRegistry,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
	}

	async generateReport(): Promise<string> {
		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];
		const timeStr = now.toISOString().split('T')[1].split('.')[0];

		// Gather data
		const allResults = this.grcEngine.getAllResults();
		const domainSummary = this.grcEngine.getDomainSummary();
		const blockingViolations = this.grcEngine.getBlockingViolations();
		const rules = this.grcEngine.getRules();
		const activeFrameworks = this.grcEngine.getActiveFrameworks();
		const loadedFrameworks = this.frameworkRegistry.getActiveFrameworks();

		const workspaceName = this._getWorkspaceName();
		const enabledRules = rules.filter(r => r.enabled);
		const errorCount = allResults.filter(r => r.severity === 'error' || r.severity === 'critical' || r.severity === 'blocker').length;
		const warningCount = allResults.filter(r => r.severity === 'warning' || r.severity === 'major').length;
		const infoCount = allResults.filter(r => r.severity === 'info' || r.severity === 'minor').length;

		// Pass rate: rules with zero violations
		const violatedRuleIds = new Set(allResults.map(r => r.ruleId));
		const passingRules = enabledRules.filter(r => !violatedRuleIds.has(r.id));
		const passRate = enabledRules.length > 0
			? ((passingRules.length / enabledRules.length) * 100).toFixed(1)
			: '100.0';

		// Build report
		const lines: string[] = [];

		// Header
		lines.push('# GRC Compliance Report');
		lines.push('');
		lines.push(`**Generated:** ${dateStr} ${timeStr}`);
		lines.push(`**Workspace:** ${workspaceName}`);
		lines.push(`**Neural Inverse Checks Engine**`);
		lines.push('');

		// Executive Summary
		lines.push('## Executive Summary');
		lines.push('');
		lines.push('| Metric | Value |');
		lines.push('|--------|-------|');
		lines.push(`| Total Violations | ${allResults.length} |`);
		lines.push(`| Errors / Critical | ${errorCount} |`);
		lines.push(`| Warnings | ${warningCount} |`);
		lines.push(`| Info | ${infoCount} |`);
		lines.push(`| Pass Rate | ${passRate}% |`);
		lines.push(`| Blocking Violations | ${blockingViolations.length} |`);
		lines.push(`| Total Rules | ${enabledRules.length} / ${rules.length} enabled |`);
		lines.push(`| Active Frameworks | ${activeFrameworks.length} |`);
		lines.push('');

		// Framework Compliance
		if (loadedFrameworks.length > 0) {
			lines.push('## Framework Compliance');
			lines.push('');

			for (const fw of loadedFrameworks) {
				if (!fw.validation.valid) { continue; }

				const meta = fw.definition.framework;
				const fwRules = fw.rules.filter(r => r.enabled !== false);
				const fwViolations = allResults.filter(r => r.frameworkId === meta.id);
				const fwViolatedRuleIds = new Set(fwViolations.map(r => r.ruleId));
				const fwPassingRules = fwRules.filter(r => !fwViolatedRuleIds.has(r.id));
				const fwCompliance = fwRules.length > 0
					? ((fwPassingRules.length / fwRules.length) * 100).toFixed(1)
					: '100.0';

				lines.push(`### ${meta.name} v${meta.version}`);
				if (meta.description) {
					lines.push(`> ${meta.description}`);
				}
				lines.push('');
				lines.push(`- **Rules:** ${fwRules.length} total`);
				lines.push(`- **Compliance:** ${fwCompliance}%`);
				lines.push(`- **Violations:** ${fwViolations.length}`);

				if (fwViolations.length > 0) {
					lines.push('');
					lines.push('| Rule | Severity | Count | Message |');
					lines.push('|------|----------|-------|---------|');

					const byRule = new Map<string, { count: number; severity: string; message: string }>();
					for (const v of fwViolations) {
						const existing = byRule.get(v.ruleId);
						if (existing) {
							existing.count++;
						} else {
							byRule.set(v.ruleId, { count: 1, severity: v.severity, message: v.message });
						}
					}

					for (const [ruleId, info] of byRule) {
						lines.push(`| ${ruleId} | ${info.severity} | ${info.count} | ${this._truncate(info.message, 60)} |`);
					}
				}

				lines.push('');
			}
		}

		// Domain Summary
		lines.push('## Domain Summary');
		lines.push('');
		lines.push('| Domain | Errors | Warnings | Info | Rules |');
		lines.push('|--------|--------|----------|------|-------|');

		for (const ds of domainSummary) {
			lines.push(`| ${ds.domain} | ${ds.errorCount} | ${ds.warningCount} | ${ds.infoCount} | ${ds.enabledRules}/${ds.totalRules} |`);
		}
		lines.push('');

		// Top Violations
		if (allResults.length > 0) {
			lines.push('## Top 20 Violations');
			lines.push('');
			lines.push('| # | Rule | File | Line | Severity | Message |');
			lines.push('|---|------|------|------|----------|---------|');

			const topViolations = allResults
				.sort((a, b) => {
					const severityOrder: Record<string, number> = { error: 0, critical: 0, blocker: 0, warning: 1, major: 1, info: 2, minor: 2 };
					return (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1);
				})
				.slice(0, 20);

			topViolations.forEach((v, i) => {
				const fileName = v.fileUri.path.split('/').pop() ?? v.fileUri.path;
				lines.push(`| ${i + 1} | ${v.ruleId} | ${fileName} | ${v.line} | ${v.severity} | ${this._truncate(v.message, 50)} |`);
			});
			lines.push('');
		}

		// Historical Trend
		const trend = await this._getHistoricalTrend();
		if (trend.length > 0) {
			lines.push('## Historical Trend (Last 7 Days)');
			lines.push('');
			lines.push('| Date | Violations |');
			lines.push('|------|------------|');

			for (const { date, count } of trend) {
				lines.push(`| ${date} | ${count} |`);
			}
			lines.push('');
		}

		// Footer
		lines.push('---');
		lines.push(`*Report generated by Neural Inverse Checks Engine on ${dateStr}*`);

		return lines.join('\n');
	}

	async exportReport(): Promise<URI | undefined> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}

		const rootUri = folders[0].uri;
		const reportsFolder = URI.joinPath(rootUri, '.inverse', 'reports');

		try {
			// Ensure reports folder exists
			try {
				if (!(await this.fileService.exists(reportsFolder))) {
					await this.fileService.createFolder(reportsFolder);
				}
			} catch {
				// May already exist
			}

			const markdown = await this.generateReport();
			const dateStr = new Date().toISOString().split('T')[0];
			const fileUri = URI.joinPath(reportsFolder, `compliance-${dateStr}.md`);

			await this.fileService.writeFile(fileUri, VSBuffer.fromString(markdown));
			console.log('[ComplianceReport] Exported to', fileUri.path);

			return fileUri;
		} catch (e) {
			console.error('[ComplianceReport] Failed to export report:', e);
			return undefined;
		}
	}

	private _getWorkspaceName(): string {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return folders[0].name;
		}
		return 'Unknown Workspace';
	}

	private async _getHistoricalTrend(): Promise<Array<{ date: string; count: number }>> {
		const trend: Array<{ date: string; count: number }> = [];
		const availableDates = await this.auditTrail.getAvailableDates();

		// Last 7 days
		const dates = availableDates.slice(0, 7);

		for (const date of dates) {
			const entries = await this.auditTrail.getEntries(date);
			trend.push({ date, count: entries.length });
		}

		return trend;
	}

	private _truncate(text: string, maxLen: number): string {
		if (text.length <= maxLen) {
			return text;
		}
		return text.substring(0, maxLen - 3) + '...';
	}
}

registerSingleton(IComplianceReportService, ComplianceReportService, InstantiationType.Delayed);
