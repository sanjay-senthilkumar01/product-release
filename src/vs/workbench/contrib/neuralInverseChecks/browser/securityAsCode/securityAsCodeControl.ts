/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class SecurityAsCodeControl extends Disposable {

    private webviewElement: IWebviewElement;

    constructor(
        private readonly container: HTMLElement,
        @IWebviewService private readonly webviewService: IWebviewService
    ) {
        super();
        console.log('SecurityAsCodeControl: Constructor called');

        this.webviewElement = this.webviewService.createWebviewElement({
            title: 'Security as Code',
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

        this._register(this.webviewElement.onMessage(async e => {
            const message = e.message;
            if (message && message.command === 'log') {
                console.log('SecurityAsCode Webview:', message.message);
            }
        }));
    }

    public layout(width: number, height: number): void {
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;
    }

    public show(): void {
        this.container.style.display = 'block';
    }

    public hide(): void {
        this.container.style.display = 'none';
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Security as Code</title>
            <style>
                :root {
                    --vscode-editor-background: #1e1e1e;
                    --vscode-foreground: #cccccc;
                    --vscode-button-background: #d32f2f; /* Red for security actions */
                    --vscode-button-foreground: #ffffff;
                    --vscode-button-hoverBackground: #b71c1c;
                    --vscode-input-background: #3c3c3c;
                    --vscode-input-foreground: #cccccc;
                    --vscode-sideBar-background: #252526;
                    --red-team-primary: #ff5252;
                    --red-team-secondary: #ff8a80;
                    --alert-bg: rgba(255, 82, 82, 0.1);
                }
                body {
                    font-family: var(--vscode-font-family, 'Courier New', monospace); /* Hacker aesthetic */
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-foreground);
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                .header {
                    padding: 15px 20px;
                    background-color: #1a1a1a;
                    border-bottom: 2px solid var(--red-team-primary);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .title-area h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: var(--red-team-primary);
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .badge {
                    background-color: var(--red-team-primary);
                    color: black;
                    font-weight: bold;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 2px;
                }
                .tabs {
                    display: flex;
                    background-color: var(--vscode-sideBar-background);
                    padding: 0 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .tab {
                    padding: 12px 20px;
                    cursor: pointer;
                    border-bottom: 2px solid transparent;
                    opacity: 0.6;
                    transition: all 0.2s;
                    font-size: 13px;
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                }
                .tab:hover {
                    opacity: 1;
                    color: var(--red-team-secondary);
                }
                .tab.active {
                    opacity: 1;
                    border-bottom-color: var(--red-team-primary);
                    color: var(--red-team-primary);
                }

                .content-area {
                    flex: 1;
                    overflow: auto;
                    padding: 20px;
                    display: none;
                }
                .content-area.active {
                    display: block;
                    animation: fadeIn 0.3s ease;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Dashboard Stats */
                .stats-container {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 15px;
                    margin-bottom: 30px;
                }
                .stat-card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid #444;
                    padding: 15px;
                    border-radius: 4px;
                }
                .stat-card h4 {
                    margin: 0;
                    font-size: 11px;
                    opacity: 0.7;
                    text-transform: uppercase;
                }
                .stat-value {
                    font-size: 28px;
                    font-weight: bold;
                    margin-top: 5px;
                    color: #fff;
                }
                .stat-value.crit { color: var(--red-team-primary); text-shadow: 0 0 10px rgba(255,82,82,0.5); }
                .stat-value.high { color: #ff9800; }

                /* Threat Table/List */
                .threat-section {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 20px;
                }
                .section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                    border-bottom: 1px solid #444;
                    padding-bottom: 10px;
                }
                .table-row {
                    display: flex;
                    padding: 10px;
                    border-bottom: 1px solid #333;
                    align-items: center;
                }
                .table-row:hover { background: rgba(255,255,255,0.02); }
                .col-id { width: 80px; font-family: monospace; color: #888; }
                .col-name { flex: 1; font-weight: 500; }
                .col-sev { width: 100px; text-align: center; }
                .col-status { width: 100px; text-align: right; font-size: 11px; }

                .sev-tag {
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 10px;
                    font-weight: bold;
                }
                .sev-critical { background: rgba(255,82,82,0.2); color: #ff5252; border: 1px solid #ff5252; }
                .sev-high { background: rgba(255,152,0,0.2); color: #ff9800; border: 1px solid #ff9800; }
                .sev-med { background: rgba(255,235,59,0.2); color: #ffeb3b; border: 1px solid #ffeb3b; }

                /* STRIDE Cards */
                .stride-card {
                    background: #1e1e1e;
                    border: 1px solid #333;
                    margin-bottom: 10px;
                    padding: 15px;
                    border-left: 3px solid #666;
                }
                .stride-card.active-threat { border-left-color: var(--red-team-primary); background: var(--alert-bg); }
                .stride-header { display: flex; justify-content: space-between; cursor: pointer; }
                .stride-tags { display: flex; gap: 5px; margin-top: 10px; }
                .stride-tag {
                    font-size: 10px;
                    padding: 2px 5px;
                    background: #333;
                    border-radius: 3px;
                    color: #aaa;
                }
                .stride-tag.hit { background: var(--red-team-primary); color: black; font-weight: bold; }

                .action-btn {
                    background: var(--vscode-button-background);
                    color: white;
                    border: none;
                    padding: 8px 15px;
                    cursor: pointer;
                    font-family: inherit;
                    font-size: 12px;
                    border-radius: 2px;
                }
                .action-btn:hover { background: var(--vscode-button-hoverBackground); }

            </style>
        </head>
        <body>
            <div class="header">
                <div class="title-area">
                    <h2>
                        <span class="codicon codicon-bug"></span>
                        RED TEAM CONSOLE
                        <span class="badge">ACTIVE</span>
                    </h2>
                </div>
            </div>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('dashboard')">Threat Posture</div>
                <div class="tab" onclick="switchTab('stride')">STRIDE Model</div>
                <div class="tab" onclick="switchTab('risks')">Risk Register</div>
            </div>

            <!-- Dashboard View -->
            <div id="dashboard" class="content-area active">
                <div class="stats-container">
                    <div class="stat-card">
                        <h4>Critical Threats</h4>
                        <div class="stat-value crit">3</div>
                    </div>
                    <div class="stat-card">
                        <h4>High Risks</h4>
                        <div class="stat-value high">12</div>
                    </div>
                    <div class="stat-card">
                        <h4>Open Vectors</h4>
                        <div class="stat-value">8</div>
                    </div>
                    <div class="stat-card">
                        <h4>Security Score</h4>
                        <div class="stat-value" style="color: #4caf50;">C+</div>
                    </div>
                </div>

                <div class="threat-section">
                    <div class="section-header">
                        <h3 style="margin:0">Active Attack Vectors</h3>
                        <button class="action-btn">Run Threat Scan</button>
                    </div>
                    <div class="table-row">
                        <div class="col-id">VEC-001</div>
                        <div class="col-name">Unauthenticated API Endpoint (User Profile)</div>
                        <div class="col-sev"><span class="sev-tag sev-critical">CRITICAL</span></div>
                        <div class="col-status">Open</div>
                    </div>
                    <div class="table-row">
                        <div class="col-id">VEC-004</div>
                        <div class="col-name">Weak Encryption Key Rotation</div>
                        <div class="col-sev"><span class="sev-tag sev-high">HIGH</span></div>
                        <div class="col-status">Investigating</div>
                    </div>
                    <div class="table-row">
                        <div class="col-id">VEC-007</div>
                        <div class="col-name">Missing CSRF Tokens on Admin Panel</div>
                        <div class="col-sev"><span class="sev-tag sev-high">HIGH</span></div>
                        <div class="col-status">Open</div>
                    </div>
                </div>
            </div>

            <!-- STRIDE View -->
            <div id="stride" class="content-area">
                <div style="background: rgba(255,255,255,0.05); padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                    <h4 style="margin:0 0 10px 0">Component: Auth Service (Identity)</h4>
                    <p style="margin:0; font-size:12px; opacity:0.7;">Analyzing threat boundaries and data flows for potential vulnerabilities.</p>
                </div>

                <div class="stride-card active-threat">
                    <div class="stride-header">
                        <span style="font-weight:bold;">Spoofing Identity</span>
                        <span class="sev-tag sev-critical">LIKELY</span>
                    </div>
                    <p style="font-size: 12px; margin: 10px 0;">Attacker may impersonate a legitimate user via weak JWT signing.</p>
                    <div class="stride-tags">
                        <span class="stride-tag hit">S</span>
                        <span class="stride-tag">T</span>
                        <span class="stride-tag">R</span>
                        <span class="stride-tag">I</span>
                        <span class="stride-tag">D</span>
                        <span class="stride-tag">E</span>
                    </div>
                </div>

                <div class="stride-card active-threat">
                    <div class="stride-header">
                        <span style="font-weight:bold;">Tampering with Data</span>
                        <span class="sev-tag sev-med">POSSIBLE</span>
                    </div>
                    <p style="font-size: 12px; margin: 10px 0;">Data in transit is encrypted, but internal service cache is mutable.</p>
                    <div class="stride-tags">
                        <span class="stride-tag">S</span>
                        <span class="stride-tag hit">T</span>
                        <span class="stride-tag">R</span>
                        <span class="stride-tag">I</span>
                        <span class="stride-tag">D</span>
                        <span class="stride-tag">E</span>
                    </div>
                </div>

                <div class="stride-card">
                    <div class="stride-header">
                        <span style="font-weight:bold;">Repudiation</span>
                        <span class="sev-tag" style="background:#444;">UNLIKELY</span>
                    </div>
                    <p style="font-size: 12px; margin: 10px 0;">Audit logging covers all write transactions.</p>
                    <div class="stride-tags">
                        <span class="stride-tag">S</span>
                        <span class="stride-tag">T</span>
                        <span class="stride-tag hit">R</span>
                        <span class="stride-tag">I</span>
                        <span class="stride-tag">D</span>
                        <span class="stride-tag">E</span>
                    </div>
                </div>
            </div>

            <!-- Risk Register -->
            <div id="risks" class="content-area">
                <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
                    <button class="action-btn">Add New Risk</button>
                </div>

                <table style="width:100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="border-bottom: 1px solid #555; text-align: left;">
                            <th style="padding: 10px;">ID</th>
                            <th style="padding: 10px;">Risk Description</th>
                            <th style="padding: 10px;">Prob.</th>
                            <th style="padding: 10px;">Impact</th>
                            <th style="padding: 10px;">Owner</th>
                            <th style="padding: 10px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid #333;">
                            <td style="padding: 10px; color: #888;">R-102</td>
                            <td style="padding: 10px;">Data Leakage via 3rd Party Libs</td>
                            <td style="padding: 10px; color: #ff9800;">High</td>
                            <td style="padding: 10px; color: #ff5252;">Crit</td>
                            <td style="padding: 10px;">SecOps</td>
                            <td style="padding: 10px;">Mitigated</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #333;">
                            <td style="padding: 10px; color: #888;">R-105</td>
                            <td style="padding: 10px;">DDoS on Public Gateway</td>
                            <td style="padding: 10px; color: #ffeb3b;">Med</td>
                            <td style="padding: 10px; color: #ff9800;">High</td>
                            <td style="padding: 10px;">Infra</td>
                            <td style="padding: 10px;">Accepted</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #333;">
                            <td style="padding: 10px; color: #888;">R-109</td>
                            <td style="padding: 10px;">Insider Threat (Privileged Access)</td>
                            <td style="padding: 10px; color: #aaa;">Low</td>
                            <td style="padding: 10px; color: #ff5252;">Crit</td>
                            <td style="padding: 10px;">HR/Sec</td>
                            <td style="padding: 10px;">Open</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function switchTab(tabId) {
                    // Update tabs
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    event.target.classList.add('active');

                    // Update content
                    document.querySelectorAll('.content-area').forEach(c => c.classList.remove('active'));
                    document.getElementById(tabId).classList.add('active');
                }
            </script>
        </body>
        </html>`;
    }
}
