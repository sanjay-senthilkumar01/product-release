/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewService, IWebviewElement } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class CodeAsPolicyControl extends Disposable {
    private readonly container: HTMLElement;
    private webviewElement: IWebviewElement | undefined;

    constructor(
        parent: HTMLElement,
        @IWebviewService private readonly webviewService: IWebviewService
    ) {
        super();
        this.container = document.createElement('div');
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.display = 'none';
        parent.appendChild(this.container);

        this.initWebview();
    }

    public layout(width: number, height: number) {
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;
    }

    public show() {
        this.container.style.display = 'block';
    }

    public hide() {
        this.container.style.display = 'none';
    }

    private initWebview() {
        this.webviewElement = this.webviewService.createWebviewElement({
            title: 'Policy as Code',
            options: {
                enableFindWidget: true,
                tryRestoreScrollPosition: true,
                retainContextWhenHidden: true,
            },
            contentOptions: {
                allowScripts: true,
            },
            extension: undefined
        });

        this.webviewElement.mountTo(this.container, getWindow(this.container));
        this.webviewElement.setHtml(this.getHtml());

        this._register(this.webviewElement);

        this._register(this.webviewElement.onMessage(e => {
            if (e.message.command === 'savePolicy') {
                // Mock Save
                this.webviewElement?.postMessage({ command: 'saveSuccess' });
            }
        }));
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Policy as Code: Mission Control</title>
            <style>
                :root {
                    --bg-color: var(--vscode-editor-background);
                    --sidebar-bg: var(--vscode-sideBar-background);
                    --border: var(--vscode-panel-border);
                    --text: var(--vscode-foreground);
                    --text-muted: var(--vscode-descriptionForeground);
                    --primary: var(--vscode-textLink-foreground);
                    --danger: var(--vscode-errorForeground);
                    --warning: var(--vscode-charts-yellow, #cca700);
                    --success: var(--vscode-charts-green, #89d185);
                    --card-bg: var(--vscode-editor-background);
                    --input-bg: var(--vscode-input-background);
                    --input-border: var(--vscode-input-border);
                    --header-height: 40px;
                }

                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    background-color: var(--bg-color);
                    color: var(--text);
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                /* Navigation Tabs */
                .nav-tabs {
                    display: flex;
                    height: var(--header-height);
                    background-color: var(--sidebar-bg);
                    border-bottom: 1px solid var(--border);
                    align-items: center;
                    padding: 0 10px;
                }

                .nav-item {
                    padding: 0 15px;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    font-weight: 600;
                    border-bottom: 2px solid transparent;
                    transition: all 0.2s;
                }

                .nav-item:hover { color: var(--text); }
                .nav-item.active {
                    color: var(--text);
                    border-bottom-color: var(--primary);
                }

                /* View Container */
                .view-container {
                    flex: 1;
                    position: relative;
                    overflow: hidden;
                }

                .view-section {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    display: none;
                    background-color: var(--bg-color);
                    overflow: hidden; /* Individual views manage scroll */
                }
                .view-section.active { display: flex; }

                /* DASHBOARD VIEW */
                #view-dashboard {
                    flex-direction: column;
                    padding: 20px;
                    overflow-y: auto;
                }

                .hero-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 30px;
                }

                .card {
                    background: var(--card-bg);
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    padding: 15px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }

                .stat-card {
                    display: flex;
                    flex-direction: column;
                }
                .stat-label { font-size: 0.85em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
                .stat-value { font-size: 1.8em; font-weight: 300; }
                .stat-trend { font-size: 0.8em; margin-top: 5px; }
                .trend-up { color: var(--success); }
                .trend-down { color: var(--danger); }

                .compliance-ring {
                    width: 100%; height: 8px;
                    background: var(--border);
                    border-radius: 4px;
                    margin-top: 10px;
                    overflow: hidden;
                }
                .compliance-fill {
                    height: 100%;
                    background: var(--success);
                    width: 92%;
                }

                h2 { font-size: 1.1em; font-weight: 500; margin-bottom: 15px; border-bottom: 1px solid var(--border); padding-bottom: 5px; }

                /* POLICIES VIEW */
                #view-policies {
                    flex-direction: row;
                    height: 100%;
                }

                .policy-sidebar {
                    width: 260px;
                    background: var(--sidebar-bg);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                }

                .search-box {
                    padding: 10px;
                    border-bottom: 1px solid var(--border);
                }
                .search-box input {
                    width: 100%;
                    background: var(--input-bg);
                    border: 1px solid var(--input-border);
                    color: var(--text);
                    padding: 4px 8px;
                    border-radius: 2px;
                }

                .policy-list { flex: 1; overflow-y: auto; list-style: none; padding: 0; margin: 0; }
                .policy-item {
                    padding: 8px 15px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    border-bottom: 1px solid var(--border);
                    opacity: 0.8;
                }
                .policy-item:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
                .policy-item.active {
                    background: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                    opacity: 1;
                }

                .pi-header { display: flex; justify-content: space-between; align-items: center; width: 100%; }
                .pi-name { font-weight: 600; font-size: 0.9em; }
                .pi-meta { font-size: 0.75em; opacity: 0.7; margin-top: 2px; }

                .badge {
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 0.7em;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                .badge-critical { background: var(--danger); color: white; }
                .badge-warning { background: var(--warning); color: #1e1e1e; }
                .badge-info { background: #3794ff; color: white; }

                .policy-editor {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    background: var(--bg-color);
                }

                .editor-toolbar {
                    padding: 10px 20px;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--sidebar-bg);
                }
                .btn {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 0.85em;
                }
                .btn:hover { background: var(--vscode-button-hoverBackground); }
                .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
                .btn-secondary:hover { background: var(--vscode-toolbar-hoverBackground); }

                .editor-content {
                    flex: 1;
                    padding: 20px;
                    overflow-y: auto;
                    max-width: 800px;
                }

                .form-section { margin-bottom: 25px; }
                .form-section h3 {
                    font-size: 0.8em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: 10px;
                    border-bottom: 1px solid var(--border);
                    padding-bottom: 4px;
                }

                .form-row { display: flex; gap: 20px; margin-bottom: 15px; }
                .form-group { flex: 1; }
                label { display: block; margin-bottom: 6px; font-size: 0.85em; font-weight: 500; }

                input, select, textarea {
                    width: 100%;
                    padding: 8px;
                    background: var(--input-bg);
                    border: 1px solid var(--input-border);
                    color: var(--text);
                    border-radius: 2px;
                    font-family: inherit;
                    box-sizing: border-box;
                }
                input:focus, select:focus, textarea:focus { border-color: var(--primary); outline: none; }

                .code-input { font-family: 'Menlo', 'Monaco', monospace; font-size: 0.9em; line-height: 1.4; }

                /* VIOLATIONS VIEW */
                #view-violations { padding: 20px; flex-direction: column; overflow-y: auto; }
                .violation-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
                .violation-table th { text-align: left; padding: 10px; border-bottom: 2px solid var(--border); color: var(--text-muted); text-transform: uppercase; font-size: 0.8em; }
                .violation-table td { padding: 10px; border-bottom: 1px solid var(--border); }
                .violation-table tr:last-child td { border-bottom: none; }
                .status-new { color: var(--danger); font-weight: 600; }

            </style>
        </head>
        <body>
            <div class="nav-tabs">
                <div class="nav-item active" onclick="switchView('dashboard')">Compliance Dashboard</div>
                <div class="nav-item" onclick="switchView('policies')">Policy Editor</div>
                <div class="nav-item" onclick="switchView('violations')">Active Violations <span class="badge badge-critical" style="margin-left:5px; font-size:9px;">3</span></div>
            </div>

            <div class="view-container">
                <!-- DASHBOARD -->
                <div id="view-dashboard" class="view-section active">
                    <div class="hero-grid">
                        <div class="card stat-card">
                            <span class="stat-label">Compliance Score</span>
                            <span class="stat-value" style="color: var(--success)">92%</span>
                            <div class="compliance-ring"><div class="compliance-fill"></div></div>
                            <span class="stat-trend trend-up">↑ 2.4% this week</span>
                        </div>
                        <div class="card stat-card">
                            <span class="stat-label">Critical Issues</span>
                            <span class="stat-value" style="color: var(--danger)">0</span>
                            <span class="stat-trend">Clean state</span>
                        </div>
                        <div class="card stat-card">
                            <span class="stat-label">Active Policies</span>
                            <span class="stat-value">24</span>
                            <span class="stat-trend">All engines operational</span>
                        </div>
                    </div>

                    <h2>Recent Activity</h2>
                    <div class="card">
                        <div style="padding: 10px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
                            <span>Scan #1024 completed successfully.</span>
                            <span style="color:var(--text-muted); font-size:0.9em;">2 mins ago</span>
                        </div>
                        <div style="padding: 10px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
                            <span>Policy "No Hardcoded Secrets" updated by Admin.</span>
                            <span style="color:var(--text-muted); font-size:0.9em;">1 hour ago</span>
                        </div>
                        <div style="padding: 10px 0; display:flex; justify-content:space-between;">
                            <span>New remediation rule added for "Console Log".</span>
                            <span style="color:var(--text-muted); font-size:0.9em;">3 hours ago</span>
                        </div>
                    </div>
                </div>

                <!-- POLICIES -->
                <div id="view-policies" class="view-section">
                    <div class="policy-sidebar">
                        <div class="search-box">
                            <input type="text" placeholder="Filter policies...">
                        </div>
                        <ul class="policy-list" id="policyList"></ul>
                        <button class="btn" style="margin: 10px; width:calc(100% - 20px);" onclick="addNewPolicy()">+ New Policy</button>
                    </div>
                    <div class="policy-editor">
                        <div class="editor-toolbar">
                            <span style="font-weight:600;">Edit Policy Definition</span>
                            <div>
                                <button class="btn-secondary" style="margin-right:10px;">Revert</button>
                                <button class="btn" onclick="savePolicy()">Save Changes</button>
                            </div>
                        </div>
                        <div class="editor-content">
                            <div class="form-section">
                                <h3>General Information</h3>
                                <div class="form-row">
                                    <div class="form-group" style="flex:2;">
                                        <label>Policy Name</label>
                                        <input type="text" id="pName" placeholder="e.g. No API Keys">
                                    </div>
                                    <div class="form-group">
                                        <label>Severity</label>
                                        <select id="pSeverity">
                                            <option value="critical">Critical</option>
                                            <option value="warning">Warning</option>
                                            <option value="info">Info</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Description</label>
                                    <input type="text" id="pDesc" placeholder="Explanation of why this policy exists">
                                </div>
                            </div>

                            <div class="form-section">
                                <h3>Technical Rule</h3>
                                <div class="form-group">
                                    <label>Engine Type</label>
                                    <div class="form-row">
                                        <select id="pType" onchange="updatePlaceholders()">
                                            <option value="regex">Regex Match</option>
                                            <option value="metrics">Metric Threshold</option>
                                            <option value="ast">AST Selector</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Rule Definition</label>
                                    <textarea id="pRule" class="code-input" rows="6" placeholder="Regex pattern..."></textarea>
                                </div>
                            </div>

                            <div class="form-section">
                                <h3>Remediation</h3>
                                <div class="form-group">
                                    <label>Suggested Fix (Markdown)</label>
                                    <textarea id="pFix" class="code-input" rows="4" placeholder="Steps to resolve this violation..."></textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- VIOLATIONS -->
                <div id="view-violations" class="view-section">
                    <h2>Active Violations</h2>
                    <div class="card" style="padding:0;">
                         <table class="violation-table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Policy</th>
                                    <th>File</th>
                                    <th>Line</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="status-new">NEW</td>
                                    <td><span class="badge badge-warning">No Console Log</span></td>
                                    <td>src/utils/logger.ts</td>
                                    <td>42</td>
                                    <td><button class="btn-secondary" style="padding: 2px 6px; font-size:10px;">View</button></td>
                                </tr>
                                <tr>
                                    <td class="status-new">NEW</td>
                                    <td><span class="badge badge-warning">No Console Log</span></td>
                                    <td>src/main.ts</td>
                                    <td>108</td>
                                    <td><button class="btn-secondary" style="padding: 2px 6px; font-size:10px;">View</button></td>
                                </tr>
                                <tr>
                                    <td style="color:var(--text-muted)">MUTED</td>
                                    <td><span class="badge badge-info">Max Line Length</span></td>
                                    <td>src/legacy/parser.ts</td>
                                    <td>1</td>
                                    <td><button class="btn-secondary" style="padding: 2px 6px; font-size:10px;">View</button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                // --- DATA MOCK ---
                let policies = [
                    { id: '1', name: 'No Console Log', desc: 'Ensure logs are removed before production build.', severity: 'warning', type: 'regex', rule: 'console\\\\.log\\\\(', fix: 'Use the standard Logger service instead.' },
                    { id: '2', name: 'No Hardcoded Secrets', desc: 'Prevent committing API keys or tokens.', severity: 'critical', type: 'regex', rule: '(API_KEY|SECRET) = ".*"', fix: 'Move secrets to environment variables (.env).' },
                    { id: '3', name: 'Max File Size', desc: 'Maintain maintainability by limiting file size.', severity: 'info', type: 'metrics', rule: 'lines > 500', fix: 'Refactor logic into smaller components.' }
                ];
                let activePolicyId = '1';

                // --- VIEW LOGIC ---
                function switchView(viewId) {
                    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
                    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));

                    document.querySelector('.nav-item[onclick="switchView(\\'' + viewId + '\\')"]').classList.add('active');
                    document.getElementById('view-' + viewId).classList.add('active');
                }

                function renderPolicyList() {
                    const list = document.getElementById('policyList');
                    list.innerHTML = '';
                    policies.forEach(p => {
                        const li = document.createElement('li');
                        li.className = 'policy-item ' + (p.id === activePolicyId ? 'active' : '');
                        li.onclick = () => loadPolicy(p.id);

                        const badgeClass = 'badge-' + p.severity;

                        li.innerHTML = \`
                            <div class="pi-header">
                                <span class="pi-name">\${p.name}</span>
                                <span class="badge \${badgeClass}">\${p.severity}</span>
                            </div>
                            <div class="pi-meta">\${p.type}</div>
                        \`;
                        list.appendChild(li);
                    });
                }

                function loadPolicy(id) {
                    activePolicyId = id;
                    const p = policies.find(x => x.id === id);
                    if(!p) return;

                    document.getElementById('pName').value = p.name;
                    document.getElementById('pDesc').value = p.desc || '';
                    document.getElementById('pSeverity').value = p.severity;
                    document.getElementById('pType').value = p.type;
                    document.getElementById('pRule').value = p.rule;
                    document.getElementById('pFix').value = p.fix || '';

                    updatePlaceholders();
                    renderPolicyList();
                }

                function addNewPolicy() {
                    const id = Date.now().toString();
                    policies.push({
                        id,
                        name: 'New Policy',
                        desc: '',
                        severity: 'info',
                        type: 'regex',
                        rule: '',
                        fix: ''
                    });
                    loadPolicy(id);
                }

                function savePolicy() {
                    const p = policies.find(x => x.id === activePolicyId);
                    if(p) {
                        p.name = document.getElementById('pName').value;
                        p.desc = document.getElementById('pDesc').value;
                        p.severity = document.getElementById('pSeverity').value;
                        p.type = document.getElementById('pType').value;
                        p.rule = document.getElementById('pRule').value;
                        p.fix = document.getElementById('pFix').value;

                        renderPolicyList();

                        // Visual feedback
                        const btn = document.querySelector('.btn[onclick="savePolicy()"]');
                        const oldText = btn.textContent;
                        btn.textContent = 'Saved!';
                        setTimeout(() => btn.textContent = oldText, 1500);

                        vscode.postMessage({ command: 'savePolicy', policy: p });
                    }
                }

                function updatePlaceholders() {
                    const type = document.getElementById('pType').value;
                    const rule = document.getElementById('pRule');
                    if(type === 'regex') rule.placeholder = 'e.g. console\\\\.log';
                    else if(type === 'metrics') rule.placeholder = 'e.g. lines > 500';
                    else rule.placeholder = 'e.g. node.kind === SyntaxKind.ClassDeclaration && ...';
                }

                // Initial Load
                renderPolicyList();
                loadPolicy('1');

                window.addEventListener('message', e => {
                    // Handle messages from extension
                });

            </script>
        </body>
        </html>`;
    }
}
