/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GRCDomain, IGRCRule, ICheckResult, IDomainSummary } from '../types/grcTypes.js';

function esc(t: string): string {
	return t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
}

/**
 * Theme accent colors per domain
 */
const DOMAIN_THEME: Record<GRCDomain, { accent: string; accentBg: string; label: string }> = {
	'security': { accent: '#ff5252', accentBg: '#1a1a2e', label: 'SECURITY AS CODE' },
	'compliance': { accent: '#7c4dff', accentBg: '#1a1a2e', label: 'COMPLIANCE AS CODE' },
	'data-integrity': { accent: '#00bcd4', accentBg: '#1a2a1a', label: 'DATA INTEGRITY CHECKS' },
	'fail-safe': { accent: '#ff9800', accentBg: '#1a1a1a', label: 'FAIL-SAFE DEFAULTS' },
	'architecture': { accent: '#42a5f5', accentBg: '#1a1a2e', label: 'ARCHITECTURE AS CODE' },
	'policy': { accent: '#66bb6a', accentBg: '#1a1a2e', label: 'CODE AS POLICY' },
};

export interface CheckViewOptions {
	domain: GRCDomain;
	results: ICheckResult[];
	rules: IGRCRule[];
	activeFrameworks?: { id: string; name: string; version: string }[];
}

/**
 * Generates the complete interactive HTML for a check view.
 * Includes:
 * - Dashboard with live stats and framework summary
 * - Issues list with references and framework attribution
 * - Interactive Rules management
 */
export function buildCheckViewHtml(opts: CheckViewOptions): string {
	const { domain, results, rules, activeFrameworks } = opts;
	const theme = DOMAIN_THEME[domain];

	const errors = results.filter(r => r.severity === 'error');
	const warnings = results.filter(r => r.severity === 'warning');
	const infos = results.filter(r => r.severity === 'info');
	const enabledRules = rules.filter(r => r.enabled);

	// ─── Frameworks Summary ──────────────────────────────────
	const frameworkTags = (activeFrameworks || []).map(fw =>
		`<span class="fw-tag" title="${esc(fw.name)} v${esc(fw.version)}">${esc(fw.id)}</span>`
	).join('');

	// ─── Issues rows ─────────────────────────────────────────
	const issueRows = results.map(r => {
		const filePath = r.fileUri.path.split('/').pop() || r.fileUri.path;
		const sevClass = r.severity === 'error' ? 'sev-error' : r.severity === 'warning' ? 'sev-warn' : 'sev-info';

		let meta = '';
		if (r.frameworkId) meta += `<span class="meta-tag fw">${esc(r.frameworkId)}</span>`;
		if (r.references?.length) meta += r.references.map(ref => `<span class="meta-tag ref">${esc(ref)}</span>`).join('');

		return `<div class="row">
            <div class="row-main">
                <span class="rule-id">${esc(r.ruleId)}</span>
                <span class="msg">${esc(r.message)}</span>
                <div class="row-meta">
                    <span class="file-ref">${esc(filePath)}:${r.line}</span>
                    ${meta}
                </div>
            </div>
            <span class="sev ${sevClass}">${r.severity.toUpperCase()}</span>
        </div>`;
	}).join('');

	// ─── Rules rows with toggle + delete ─────────────────────
	const ruleRows = rules.map(r => {
		const count = results.filter(res => res.ruleId === r.id).length;
		const statusClass = count > 0 ? 'sev-fail' : 'sev-pass';
		const statusText = count > 0 ? `${count} issue${count > 1 ? 's' : ''}` : 'PASS';
		const checked = r.enabled ? 'checked' : '';
		const builtinBadge = r.builtin ? '<span class="builtin-badge">BUILT-IN</span>' : '<button class="del-btn" onclick="delRule(\'' + esc(r.id) + '\')" title="Delete rule">✕</button>';

		let meta = '';
		if (r.frameworkId) meta += `<span class="meta-tag fw">${esc(r.frameworkId)}</span>`;
		if (r.references?.length) meta += r.references.map(ref => `<span class="meta-tag ref">${esc(ref)}</span>`).join('');

		return `<div class="row rule-row">
            <label class="toggle"><input type="checkbox" ${checked} onchange="toggleRule('${esc(r.id)}', this.checked)"><span class="slider"></span></label>
            <div class="row-main">
                <div style="display:flex;align-items:center;gap:6px">
                    <span class="rule-id">${esc(r.id)}</span>
                    ${meta}
                </div>
                <span class="msg">${esc(r.message)}</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                <span class="sev ${statusClass}">${statusText}</span>
                ${builtinBadge}
            </div>
        </div>`;
	}).join('');

	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
	<style>
		* { box-sizing: border-box; }
		body { font-family: var(--vscode-font-family, -apple-system, sans-serif); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin:0; padding:0; height:100vh; display:flex; flex-direction:column; overflow:hidden; }


		/* ─── Header ─── */
		.header { padding:14px 20px; background:linear-gradient(135deg,${theme.accentBg} 0%,#16213e 100%); border-bottom:2px solid ${theme.accent}; display:flex; flex-direction:column; gap:10px; }
		.header-top { display:flex; justify-content:space-between; align-items:center; }
		.header h2 { margin:0; font-size:15px; color:${theme.accent}; display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:0.5px; }
		.badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:3px; }
		.badge-ok { background:#4caf50; color:#000; } .badge-issues { background:${theme.accent}; color:#fff; }
		.fw-summary { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
		.fw-tag { font-size:10px; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:3px; color:#fff; border:1px solid rgba(255,255,255,0.1); }
		.fw-label { font-size:10px; opacity:0.6; margin-right:4px; text-transform:uppercase; letter-spacing:0.5px; }

		/* ─── Tabs ─── */
		.tabs { display:flex; background:var(--vscode-sideBar-background); padding:0 20px; border-bottom:1px solid var(--vscode-panel-border); flex-shrink:0; }
		.tab { padding:10px 18px; cursor:pointer; border-bottom:2px solid transparent; opacity:0.6; font-size:12px; transition:all 0.2s; user-select:none; }
		.tab:hover { opacity:1; } .tab.active { opacity:1; border-bottom-color:${theme.accent}; color:${theme.accent}; }

		/* ─── Panels ─── */
		.panel { flex:1; overflow:auto; padding:20px; display:none; } .panel.active { display:block; }

		/* ─── Stats ─── */
		.stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
		.stat { background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); padding:14px; border-radius:6px; }
		.stat h4 { margin:0; font-size:10px; opacity:0.6; text-transform:uppercase; letter-spacing:0.5px; }
		.stat-val { font-size:28px; font-weight:700; margin-top:4px; }
		.stat-val.e { color:#ff5252; } .stat-val.w { color:#ff9800; } .stat-val.i { color:#64b5f6; } .stat-val.p { color:#4caf50; }

		/* ─── Sections ─── */
		.section { background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); border-radius:6px; padding:16px; margin-bottom:16px; }
		.section h3 { margin:0 0 12px; font-size:13px; border-bottom:1px solid var(--vscode-panel-border); padding-bottom:10px; display:flex; justify-content:space-between; align-items:center; }

		/* ─── Rows ─── */
		.row { display:flex; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.05); align-items:flex-start; font-size:12px; gap:10px; }
		.row:hover { background:rgba(255,255,255,0.03); }
		.row-main { flex:1; display:flex; flex-direction:column; gap:4px; min-width:0; }
		.row-meta { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }

		.rule-id { font-family:monospace; color:#888; font-size:11px; flex-shrink:0; background:rgba(255,255,255,0.05); padding:1px 4px; border-radius:3px; }
		.msg { line-height:1.4; }
		.file-ref { font-size:10px; color:#aaa; font-family:monospace; }
		.meta-tag { font-size:9px; padding:1px 5px; border-radius:3px; text-transform:uppercase; font-weight:600; }
		.meta-tag.fw { background:rgba(255,255,255,0.1); color:#fff; }
		.meta-tag.ref { background:rgba(100,181,246,0.1); color:#64b5f6; }

		.sev { min-width:60px; text-align:center; font-size:9px; font-weight:700; padding:2px 6px; border-radius:3px; flex-shrink:0; align-self:flex-start; margin-top:2px; }
		.sev-error { background:rgba(255,82,82,0.15); color:#ff5252; } .sev-warn { background:rgba(255,152,0,0.15); color:#ff9800; }
		.sev-info { background:rgba(100,181,246,0.15); color:#64b5f6; } .sev-fail { color:#ff5252; } .sev-pass { color:#4caf50; }
		.empty { text-align:center; padding:40px; opacity:0.5; }

		/* ─── Toggle Switch ─── */
		.toggle { position:relative; width:32px; height:18px; flex-shrink:0; margin-top:2px; }
		.toggle input { opacity:0; width:0; height:0; }
		.slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:#555; border-radius:18px; transition:0.3s; }
		.slider::before { content:''; position:absolute; height:14px; width:14px; left:2px; bottom:2px; background:#fff; border-radius:50%; transition:0.3s; }
		.toggle input:checked + .slider { background:${theme.accent}; }
		.toggle input:checked + .slider::before { transform:translateX(14px); }

		/* ─── Builtin/Delete ─── */
		.builtin-badge { font-size:9px; color:#888; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:3px; flex-shrink:0; }
		.del-btn { background:none; border:1px solid rgba(255,82,82,0.3); color:#ff5252; cursor:pointer; font-size:12px; padding:2px 6px; border-radius:3px; flex-shrink:0; transition:0.2s; }
		.del-btn:hover { background:rgba(255,82,82,0.15); }

		/* ─── Add Rule Form ─── */
		.add-form { background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); border-radius:6px; padding:16px; }
		.add-form h3 { margin:0 0 12px; font-size:13px; color:${theme.accent}; }
		.form-row { display:flex; gap:10px; margin-bottom:10px; align-items:center; }
		.form-row label { font-size:11px; opacity:0.7; width:70px; flex-shrink:0; text-align:right; }
		.form-row input, .form-row select { flex:1; background:var(--vscode-input-background, #1e1e1e); color:var(--vscode-input-foreground, #ccc); border:1px solid var(--vscode-input-border, #444); border-radius:3px; padding:6px 10px; font-size:12px; font-family:inherit; }
		.form-row input:focus, .form-row select:focus { outline:none; border-color:${theme.accent}; }
		.form-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:14px; }
		.btn { padding:7px 16px; border:none; border-radius:4px; font-size:12px; cursor:pointer; font-weight:600; transition:0.2s; }
		.btn-primary { background:${theme.accent}; color:#fff; } .btn-primary:hover { opacity:0.85; }
		.btn-secondary { background:transparent; border:1px solid var(--vscode-panel-border); color:var(--vscode-editor-foreground); } .btn-secondary:hover { background:rgba(255,255,255,0.05); }
	</style></head><body>
		<div class="header">
			<div class="header-top">
				<h2>${theme.label} <span class="badge ${results.length === 0 ? 'badge-ok' : 'badge-issues'}">${results.length === 0 ? 'ALL CLEAR' : results.length + ' ISSUE' + (results.length > 1 ? 'S' : '')}</span></h2>
			</div>
			${activeFrameworks && activeFrameworks.length > 0 ? `<div class="fw-summary"><span class="fw-label">ACTIVE FRAMEWORKS:</span>${frameworkTags}</div>` : ''}
		</div>
		<div class="tabs">
			<div class="tab active" onclick="sw('dash')">Dashboard</div>
			<div class="tab" onclick="sw('issues')">Issues (${results.length})</div>
			<div class="tab" onclick="sw('rules')">Rules (${rules.length})</div>
			<div class="tab" onclick="sw('add')">+ Add Rule</div>
		</div>

		<!-- Dashboard Panel -->
		<div id="dash" class="panel active">
			<div class="stats">
				<div class="stat"><h4>Errors</h4><div class="stat-val e">${errors.length}</div></div>
				<div class="stat"><h4>Warnings</h4><div class="stat-val w">${warnings.length}</div></div>
				<div class="stat"><h4>Info</h4><div class="stat-val i">${infos.length}</div></div>
				<div class="stat"><h4>Rules Active</h4><div class="stat-val p">${enabledRules.length}/${rules.length}</div></div>
			</div>
			${results.length === 0 ? '<div class="empty">&#x2713; No issues detected</div>' : ''}
		</div>

		<!-- Issues Panel -->
		<div id="issues" class="panel">
			<div class="section"><h3>Active Issues</h3>${issueRows || '<div class="empty">No issues</div>'}</div>
		</div>

		<!-- Rules Panel (interactive) -->
		<div id="rules" class="panel">
			<div class="section">
				<h3>Rules <span style="font-size:10px;opacity:0.5;font-weight:400">(click toggle to enable/disable)</span></h3>
				${ruleRows || '<div class="empty">No rules configured</div>'}
			</div>
		</div>

		<!-- Add Rule Panel -->
		<div id="add" class="panel">
			<div class="add-form">
				<h3>Create Custom Rule</h3>
				<div class="form-row"><label>Rule ID</label><input id="f-id" placeholder="e.g. CUSTOM-001" /></div>
				<div class="form-row"><label>Severity</label><select id="f-sev"><option value="error">Error</option><option value="warning" selected>Warning</option><option value="info">Info</option></select></div>
				<div class="form-row"><label>Pattern</label><input id="f-pattern" placeholder="Regex pattern, e.g. \\bfoo\\b" /></div>
				<div class="form-row"><label>Message</label><input id="f-msg" placeholder="Description shown in diagnostics" /></div>
				<div class="form-row"><label>Fix</label><input id="f-fix" placeholder="Suggested fix (optional)" /></div>
				<div class="form-actions">
					<button class="btn btn-secondary" onclick="clearForm()">Clear</button>
					<button class="btn btn-primary" onclick="addRule()">Add Rule</button>
				</div>
			</div>
		</div>

		<script>
			const vscode = acquireVsCodeApi();
			const DOMAIN = '${domain}';

			function sw(id) {
				document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
				event.target.classList.add('active');
				document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
				document.getElementById(id).classList.add('active');
			}

			function toggleRule(ruleId, enabled) {
				vscode.postMessage({ command: 'toggleRule', ruleId, enabled });
			}

			function delRule(ruleId) {
				if (confirm('Delete rule ' + ruleId + '?')) {
					vscode.postMessage({ command: 'deleteRule', ruleId });
				}
			}

			function addRule() {
				const id = document.getElementById('f-id').value.trim();
				const severity = document.getElementById('f-sev').value;
				const pattern = document.getElementById('f-pattern').value.trim();
				const message = document.getElementById('f-msg').value.trim();
				const fix = document.getElementById('f-fix').value.trim();

				if (!id || !pattern || !message) {
					alert('Rule ID, Pattern, and Message are required.');
					return;
				}

				vscode.postMessage({
					command: 'saveRule',
					rule: { id, domain: DOMAIN, severity, pattern, message, fix: fix || undefined, enabled: true, type: 'regex' }
				});
				clearForm();
				// Switch to rules tab
				document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
				document.querySelectorAll('.tab')[2].classList.add('active');
				document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
				document.getElementById('rules').classList.add('active');
			}

			function clearForm() {
				document.getElementById('f-id').value = '';
				document.getElementById('f-pattern').value = '';
				document.getElementById('f-msg').value = '';
				document.getElementById('f-fix').value = '';
			}
		</script>
	</body></html>`;
}

/**
 * Generates HTML for the Audit & Evidence view (special case - reads from audit trail).
 */
export function buildAuditViewHtml(
	entries: { timestamp: number; domain: string; severity: string; message: string; file: string; line: number }[],
	dates: string[],
	summary: IDomainSummary[]
): string {
	const totalErrors = summary.reduce((a, s) => a + s.errorCount, 0);
	const totalWarnings = summary.reduce((a, s) => a + s.warningCount, 0);
	const totalInfos = summary.reduce((a, s) => a + s.infoCount, 0);

	const recentEntries = entries.slice(-50).reverse();

	const entryRows = recentEntries.map(e => {
		const time = new Date(e.timestamp).toLocaleTimeString();
		const sevClass = e.severity === 'error' ? 'sev-error' : e.severity === 'warning' ? 'sev-warn' : 'sev-info';
		const filePath = e.file.split('/').pop() || e.file;
		return `<div class="entry">
			<span class="time">${time}</span>
			<span class="domain-tag domain-${e.domain}">${esc(e.domain)}</span>
			<span class="sev ${sevClass}">${e.severity.toUpperCase()}</span>
			<span class="entry-msg">${esc(e.message)}</span>
			<span class="file-ref">${esc(filePath)}:${e.line}</span>
		</div>`;
	}).join('');

	const summaryRows = summary.map(s => {
		const total = s.errorCount + s.warningCount + s.infoCount;
		return `<div class="summary-row">
			<span class="domain-name">${esc(s.domain)}</span>
			<span class="count-err">${s.errorCount}</span>
			<span class="count-warn">${s.warningCount}</span>
			<span class="count-info">${s.infoCount}</span>
			<span class="count-total">${total}</span>
			<span class="rules-info">${s.enabledRules}/${s.totalRules} rules</span>
		</div>`;
	}).join('');

	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
	<style>
		body { font-family: var(--vscode-font-family, -apple-system, sans-serif); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin:0; padding:0; height:100vh; display:flex; flex-direction:column; overflow:hidden; }
		.header { padding:14px 20px; background:linear-gradient(135deg,#1a1a2e 0%,#2d1b2e 100%); border-bottom:2px solid #ab47bc; display:flex; justify-content:space-between; align-items:center; }
		.header h2 { margin:0; font-size:15px; color:#ce93d8; display:flex; align-items:center; gap:10px; font-weight:700; }
		.badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:3px; background:#ab47bc; color:#fff; }
		.tabs { display:flex; background:var(--vscode-sideBar-background); padding:0 20px; border-bottom:1px solid var(--vscode-panel-border); flex-shrink:0; }
		.tab { padding:10px 18px; cursor:pointer; border-bottom:2px solid transparent; opacity:0.6; font-size:12px; transition:all 0.2s; }
		.tab:hover { opacity:1; } .tab.active { opacity:1; border-bottom-color:#ab47bc; color:#ce93d8; }
		.panel { flex:1; overflow:auto; padding:20px; display:none; } .panel.active { display:block; }
		.stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
		.stat { background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); padding:14px; border-radius:6px; }
		.stat h4 { margin:0; font-size:10px; opacity:0.6; text-transform:uppercase; } .stat-val { font-size:28px; font-weight:700; margin-top:4px; }
		.stat-val.e { color:#ff5252; } .stat-val.w { color:#ff9800; } .stat-val.i { color:#64b5f6; } .stat-val.p { color:#ab47bc; }
		.section { background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); border-radius:6px; padding:16px; margin-bottom:15px; }
		.section h3 { margin:0 0 12px; font-size:13px; border-bottom:1px solid var(--vscode-panel-border); padding-bottom:10px; }
		.entry { display:flex; padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.05); align-items:center; font-size:11px; gap:8px; }
		.entry:hover { background:rgba(255,255,255,0.03); }
		.time { width:70px; font-family:monospace; color:#888; flex-shrink:0; }
		.domain-tag { font-size:9px; font-weight:600; padding:1px 6px; border-radius:3px; flex-shrink:0; text-transform:uppercase; }
		.domain-security { background:rgba(255,82,82,0.15); color:#ff5252; }
		.domain-compliance { background:rgba(124,77,255,0.15); color:#b388ff; }
		.domain-data-integrity { background:rgba(0,188,212,0.15); color:#00e5ff; }
		.domain-fail-safe { background:rgba(255,152,0,0.15); color:#ffb74d; }
		.domain-architecture { background:rgba(66,165,245,0.15); color:#90caf9; }
		.domain-policy { background:rgba(102,187,106,0.15); color:#81c784; }
		.sev { font-size:9px; font-weight:700; padding:1px 6px; border-radius:3px; flex-shrink:0; }
		.sev-error { background:rgba(255,82,82,0.15); color:#ff5252; } .sev-warn { background:rgba(255,152,0,0.15); color:#ff9800; }
		.sev-info { background:rgba(100,181,246,0.15); color:#64b5f6; }
		.entry-msg { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
		.file-ref { font-size:10px; color:#888; font-family:monospace; flex-shrink:0; }
		.summary-row { display:flex; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.05); align-items:center; font-size:12px; gap:10px; }
		.summary-row:hover { background:rgba(255,255,255,0.03); }
		.domain-name { width:120px; font-weight:600; text-transform:capitalize; }
		.count-err { width:50px; text-align:center; color:#ff5252; } .count-warn { width:50px; text-align:center; color:#ff9800; }
		.count-info { width:50px; text-align:center; color:#64b5f6; } .count-total { width:50px; text-align:center; font-weight:600; }
		.rules-info { flex:1; text-align:right; color:#888; font-size:11px; }
		.empty { text-align:center; padding:40px; opacity:0.5; }
	</style></head><body>
		<div class="header"><h2>AUDIT & EVIDENCE <span class="badge">${entries.length} ENTRIES</span></h2></div>
		<div class="tabs">
			<div class="tab active" onclick="sw('overview')">Overview</div>
			<div class="tab" onclick="sw('timeline')">Timeline (${recentEntries.length})</div>
			<div class="tab" onclick="sw('dates')">Dates (${dates.length})</div>
		</div>
		<div id="overview" class="panel active">
			<div class="stats">
				<div class="stat"><h4>Total Errors</h4><div class="stat-val e">${totalErrors}</div></div>
				<div class="stat"><h4>Total Warnings</h4><div class="stat-val w">${totalWarnings}</div></div>
				<div class="stat"><h4>Total Info</h4><div class="stat-val i">${totalInfos}</div></div>
				<div class="stat"><h4>Audit Entries</h4><div class="stat-val p">${entries.length}</div></div>
			</div>
			<div class="section">
				<h3>Domain Summary</h3>
				<div class="summary-row" style="font-weight:700; opacity:0.6; font-size:11px;">
					<span class="domain-name">Domain</span>
					<span class="count-err">Errors</span>
					<span class="count-warn">Warns</span>
					<span class="count-info">Info</span>
					<span class="count-total">Total</span>
					<span class="rules-info">Rules</span>
				</div>
				${summaryRows}
			</div>
		</div>
		<div id="timeline" class="panel"><div class="section"><h3>Recent Audit Trail</h3>${entryRows || '<div class="empty">No audit entries yet</div>'}</div></div>
		<div id="dates" class="panel"><div class="section"><h3>Available Audit Dates</h3>${dates.map(d => `<div class="entry"><span class="time">${esc(d)}</span><span class="entry-msg">.inverse/audit/${esc(d)}.json</span></div>`).join('') || '<div class="empty">No audit files yet</div>'}</div></div>
		<script>
			const vscode = acquireVsCodeApi();
			function sw(id) { document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); event.target.classList.add('active'); document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active')); document.getElementById(id).classList.add('active'); }
		</script>
	</body></html>`;
}
