/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class DataIntegrityControl extends Disposable {

    private webviewElement: IWebviewElement;

    constructor(
        private readonly container: HTMLElement,
        @IWebviewService private readonly webviewService: IWebviewService
    ) {
        super();
        console.log('DataIntegrityControl: Constructor called');

        this.webviewElement = this.webviewService.createWebviewElement({
            title: 'Data Integrity',
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
                console.log('DataIntegrity Webview:', message.message);
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
            <title>Data Integrity</title>
            <style>
                :root {
                    --vscode-editor-background: #1e1e1e;
                    --vscode-foreground: #cccccc;
                    --vscode-button-background: #00acc1; /* Teal for Data/Precision */
                    --vscode-button-foreground: #ffffff;
                    --vscode-button-hoverBackground: #00838f;
                    --vscode-input-background: #3c3c3c;
                    --vscode-input-foreground: #cccccc;
                    --vscode-sideBar-background: #252526;
                    --data-primary: #00e5ff; /* Bright Cyan/Teal */
                    --data-secondary: #00b0ff; /* Light Blue */
                    --pass-color: #00e676;
                    --fail-color: #ff1744;
                }
                body {
                    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
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
                    background-color: var(--vscode-sideBar-background);
                    border-bottom: 2px solid var(--data-primary);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .title-area h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: var(--data-primary);
                }
                .badge {
                    background-color: var(--vscode-button-background);
                    color: white;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 10px;
                    text-transform: uppercase;
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
                    opacity: 0.7;
                    transition: all 0.2s;
                    font-size: 13px;
                }
                .tab:hover {
                    opacity: 1;
                    color: var(--data-primary);
                    background-color: rgba(0, 229, 255, 0.05);
                }
                .tab.active {
                    opacity: 1;
                    border-bottom-color: var(--data-primary);
                    color: var(--data-primary);
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

                /* Stats Grid */
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 15px;
                    margin-bottom: 25px;
                }
                .stat-box {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 15px;
                    text-align: center;
                }
                .stat-label { font-size: 11px; opacity: 0.7; text-transform: uppercase; margin-bottom: 5px; }
                .stat-num { font-size: 24px; font-weight: bold; color: var(--data-primary); }
                .stat-sub { font-size: 11px; color: var(--pass-color); margin-top: 5px; }

                /* Data Table */
                .data-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }
                .data-table th {
                    text-align: left;
                    padding: 10px;
                    border-bottom: 1px solid #444;
                    color: var(--data-secondary);
                    font-weight: 500;
                    font-size: 12px;
                    text-transform: uppercase;
                }
                .data-table td {
                    padding: 10px;
                    border-bottom: 1px solid #333;
                }
                .data-table tr:hover { background: rgba(255,255,255,0.02); }

                .status-badge {
                    padding: 3px 8px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 500;
                }
                .st-pass { background: rgba(0, 230, 118, 0.15); color: var(--pass-color); }
                .st-fail { background: rgba(255, 23, 68, 0.15); color: var(--fail-color); }
                .st-warn { background: rgba(255, 145, 0, 0.15); color: #ff9100; }

                .schema-card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    margin-bottom: 10px;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .schema-header {
                    padding: 12px 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                }
                .schema-header:hover { background: rgba(255,255,255,0.02); }
                .format-tag {
                    font-family: monospace;
                    background: #333;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 11px;
                    color: #aaa;
                    margin-left: 10px;
                }

                .action-btn {
                    background: var(--vscode-button-background);
                    color: white;
                    border: none;
                    padding: 6px 14px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .action-btn:hover { background: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title-area">
                    <h2>
                        <span class="codicon codicon-database"></span>
                        Data Integrity
                        <span class="badge">Live</span>
                    </h2>
                </div>
            </div>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('dashboard')">Validation Dashboard</div>
                <div class="tab" onclick="switchTab('schemas')">Schema Registry</div>
                <div class="tab" onclick="switchTab('anomalies')">Anomaly Monitor</div>
            </div>

            <!-- Dashboard -->
            <div id="dashboard" class="content-area active">
                <div class="stats-grid">
                    <div class="stat-box">
                        <div class="stat-label">Validation Rate</div>
                        <div class="stat-num">99.8%</div>
                        <div class="stat-sub">▲ 0.2% this week</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">Schemas Active</div>
                        <div class="stat-num">42</div>
                        <div class="stat-sub" style="color:#aaa">3 Deprecated</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">Failed Records</div>
                        <div class="stat-num" style="color:var(--fail-color)">152</div>
                        <div class="stat-sub" style="color:var(--fail-color)">Last 24h</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">Drift Alerts</div>
                        <div class="stat-num">2</div>
                        <div class="stat-sub">Needs Review</div>
                    </div>
                </div>

                <h3 style="margin-top:0; font-size:14px; color:var(--data-primary);">Recent Validation Runs</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Dataset / Stream</th>
                            <th>Records</th>
                            <th>Valid</th>
                            <th>Invalid</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>UserEvents.Proto (Kafka)</td>
                            <td>1.2M</td>
                            <td>1,199,850</td>
                            <td>150</td>
                            <td><span class="status-badge st-pass">HEALTHY</span></td>
                        </tr>
                        <tr>
                            <td>TransactionLedger (DB)</td>
                            <td>450k</td>
                            <td>450,000</td>
                            <td>0</td>
                            <td><span class="status-badge st-pass">HEALTHY</span></td>
                        </tr>
                        <tr>
                            <td>ThirdPartyIntegrations.JSON</td>
                            <td>5,000</td>
                            <td>4,992</td>
                            <td>8</td>
                            <td><span class="status-badge st-warn">WARNING</span></td>
                        </tr>
                         <tr>
                            <td>LegacyImport.CSV</td>
                            <td>120</td>
                            <td>85</td>
                            <td>35</td>
                            <td><span class="status-badge st-fail">CRITICAL</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Schemas -->
            <div id="schemas" class="content-area">
                <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
                    <button class="action-btn">Import New Schema</button>
                    <button class="action-btn" style="background:#444; margin-left:10px;">Compare Versions</button>
                </div>

                <div class="schema-card">
                    <div class="schema-header">
                        <div>
                            <span style="font-weight:600;">UserProfile.v2</span>
                            <span class="format-tag">Protobuf</span>
                        </div>
                        <span class="status-badge st-pass">ACTIVE</span>
                    </div>
                    <div style="padding:15px; border-top:1px solid #444; display:none;">
                        <!-- Mock Schema Detail -->
                        Schema definition content...
                    </div>
                </div>

                <div class="schema-card">
                    <div class="schema-header">
                        <div>
                            <span style="font-weight:600;">OrderManifest.v1</span>
                            <span class="format-tag">JSON Schema</span>
                        </div>
                        <span class="status-badge st-pass">ACTIVE</span>
                    </div>
                </div>

                <div class="schema-card">
                    <div class="schema-header">
                        <div>
                            <span style="font-weight:600;">AuditLog.v1alpha</span>
                            <span class="format-tag">Avro</span>
                        </div>
                        <span class="status-badge st-warn">DEPRECATED</span>
                    </div>
                </div>
            </div>

            <!-- Anomalies -->
            <div id="anomalies" class="content-area">
                 <div style="background: rgba(0, 229, 255, 0.1); border: 1px solid var(--data-primary); padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span class="codicon codicon-pulse" style="font-size:20px; color:var(--data-primary);"></span>
                        <div>
                            <strong style="color:var(--data-primary);">AI Integrity Monitor Running</strong>
                            <div style="font-size:12px; opacity:0.8;">Analyzing data streams for statistical anomalies and schema drift.</div>
                        </div>
                    </div>
                 </div>

                 <h3 style="font-size:14px;">Detected Anomalies</h3>
                 <table class="data-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Detected At</th>
                            <th>Severity</th>
                            <th>Description</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="font-family:monospace; color:#888;">ANM-492</td>
                            <td>10:42 AM</td>
                            <td><span class="status-badge st-fail">HIGH</span></td>
                            <td>Unexpected null values in 'payment_method_id' field (UserEvents).</td>
                            <td><button class="action-btn" style="padding:4px 8px; font-size:11px;">Investigate</button></td>
                        </tr>
                         <tr>
                            <td style="font-family:monospace; color:#888;">ANM-491</td>
                            <td>09:15 AM</td>
                            <td><span class="status-badge st-warn">MEDIUM</span></td>
                            <td>Schema Drift: New field 'device_meta' detected in ingestion stream.</td>
                            <td><button class="action-btn" style="padding:4px 8px; font-size:11px;">Review</button></td>
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
