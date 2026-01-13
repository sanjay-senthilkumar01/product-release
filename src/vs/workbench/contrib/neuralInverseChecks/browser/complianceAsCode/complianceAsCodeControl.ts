/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class ComplianceAsCodeControl extends Disposable {

    private webviewElement: IWebviewElement;

    constructor(
        private readonly container: HTMLElement,
        @IWebviewService private readonly webviewService: IWebviewService
    ) {
        super();
        console.log('ComplianceAsCodeControl: Constructor called');

        this.webviewElement = this.webviewService.createWebviewElement({
            title: 'Compliance as Code',
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
                console.log('ComplianceAsCode Webview:', message.message);
            }
        }));
    }

    public layout(width: number, height: number): void {
        console.log('ComplianceAsCodeControl: Layout called', width, height);
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
            <title>Compliance as Code</title>
            <style>
                :root {
                    --vscode-editor-background: #1e1e1e;
                    --vscode-foreground: #cccccc;
                    --vscode-button-background: #0e639c;
                    --vscode-button-foreground: #ffffff;
                    --vscode-button-hoverBackground: #1177bb;
                    --vscode-input-background: #3c3c3c;
                    --vscode-input-foreground: #cccccc;
                    --vscode-sideBar-background: #252526;
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
                    border-bottom: 1px solid var(--vscode-panel-border);
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
                    gap: 8px;
                    color: #4fc1ff; /* Light blue for compliance/trust */
                }
                .badge {
                    background-color: #0e639c;
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
                    padding: 10px 15px;
                    cursor: pointer;
                    border-bottom: 2px solid transparent;
                    opacity: 0.7;
                    transition: all 0.2s;
                    font-size: 13px;
                }
                .tab:hover {
                    opacity: 1;
                    background-color: rgba(255,255,255,0.05);
                }
                .tab.active {
                    opacity: 1;
                    border-bottom-color: #4fc1ff;
                    color: #4fc1ff;
                }

                .content-area {
                    flex: 1;
                    overflow: auto;
                    padding: 20px;
                    display: none; /* Hidden by default */
                }
                .content-area.active {
                    display: block;
                    animation: fadeIn 0.3s ease;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Dashboard Styles */
                .dashboard-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                }
                .compliance-card {
                    background-color: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 20px;
                    position: relative;
                }
                .compliance-card h3 {
                    margin: 0 0 15px 0;
                    font-size: 16px;
                    display: flex;
                    justify-content: space-between;
                }
                .score-ring {
                    width: 100px;
                    height: 100px;
                    border-radius: 50%;
                    border: 8px solid #3c3c3c;
                    margin: 0 auto;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    font-weight: bold;
                    position: relative;
                }
                .score-ring.high { border-color: #4caf50; color: #4caf50; }
                .score-ring.medium { border-color: #ff9800; color: #ff9800; }
                .score-ring.low { border-color: #f44336; color: #f44336; }

                .card-stats {
                    margin-top: 20px;
                    display: flex;
                    justify-content: space-between;
                    font-size: 12px;
                    opacity: 0.8;
                }

                /* Standards List Styles */
                .standards-list {
                    width: 100%;
                }
                .req-item {
                    background-color: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    margin-bottom: 10px;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .req-header {
                    padding: 12px 15px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: pointer;
                }
                .req-header:hover {
                    background-color: rgba(255,255,255,0.03);
                }
                .req-id {
                    font-family: monospace;
                    background-color: rgba(255,255,255,0.1);
                    padding: 2px 6px;
                    border-radius: 3px;
                    margin-right: 10px;
                    color: #dcdcaa;
                }
                .req-title {
                    font-weight: 500;
                    flex: 1;
                }
                .req-status {
                    font-size: 11px;
                    padding: 2px 8px;
                    border-radius: 10px;
                    margin-left: 10px;
                }
                .status-pass { background-color: rgba(76, 175, 80, 0.2); color: #4caf50; }
                .status-fail { background-color: rgba(244, 67, 54, 0.2); color: #f44336; }
                .status-warn { background-color: rgba(255, 152, 0, 0.2); color: #ff9800; }

                .req-details {
                    padding: 15px;
                    border-top: 1px solid var(--vscode-panel-border);
                    background-color: rgba(0,0,0,0.1);
                    display: none;
                }
                .req-details.open {
                    display: block;
                }

                .mapping-section {
                    margin-top: 10px;
                }
                .mapping-btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                }

            </style>
        </head>
        <body>
            <div class="header">
                <div class="title-area">
                    <h2>
                        <span class="codicon codicon-shield"></span>
                        Compliance Console
                        <span class="badge">BETA</span>
                    </h2>
                </div>
            </div>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('dashboard')">Compliance Dashboard</div>
                <div class="tab" onclick="switchTab('standards')">Regulatory Standards</div>
                <div class="tab" onclick="switchTab('reports')">Reports & Audit</div>
            </div>

            <!-- Dashboard View -->
            <div id="dashboard" class="content-area active">
                <div class="dashboard-grid">
                    <!-- ISO 27001 -->
                    <div class="compliance-card">
                        <h3>ISO 27001 <span style="font-size: 12px; opacity: 0.7;">InfoSec</span></h3>
                        <div class="score-ring high">
                            85%
                        </div>
                        <div class="card-stats">
                            <span>Passed: 112</span>
                            <span>Failed: 14</span>
                            <span>Pending: 5</span>
                        </div>
                    </div>

                    <!-- SOC 2 Type II -->
                    <div class="compliance-card">
                        <h3>SOC 2 Type II <span style="font-size: 12px; opacity: 0.7;">Trust Services</span></h3>
                        <div class="score-ring medium">
                            62%
                        </div>
                        <div class="card-stats">
                            <span>Passed: 45</span>
                            <span>Failed: 12</span>
                            <span>Pending: 28</span>
                        </div>
                    </div>

                    <!-- GDPR -->
                    <div class="compliance-card">
                        <h3>GDPR <span style="font-size: 12px; opacity: 0.7;">Privacy</span></h3>
                        <div class="score-ring high">
                            94%
                        </div>
                        <div class="card-stats">
                            <span>Passed: 32</span>
                            <span>Failed: 2</span>
                            <span>Pending: 0</span>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 30px;">
                    <h3>Recent Compliance Alerts</h3>
                    <div class="req-item" style="border-left: 3px solid #f44336;">
                        <div class="req-header">
                            <span class="req-id">A.12.3.1</span>
                            <span class="req-title">Information Backup - Daily Snapshot Missing</span>
                            <span class="req-status status-fail">FAIL</span>
                        </div>
                    </div>
                    <div class="req-item" style="border-left: 3px solid #ff9800;">
                        <div class="req-header">
                            <span class="req-id">CC6.1</span>
                            <span class="req-title">Vulnerability Scanning - Scan > 30 days old</span>
                            <span class="req-status status-warn">WARN</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Standards View -->
            <div id="standards" class="content-area">
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <select style="background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-panel-border); padding: 5px; min-width: 200px;">
                        <option>ISO/IEC 27001:2013</option>
                        <option>SOC 2 Type II</option>
                        <option>GDPR</option>
                        <option>HIPAA</option>
                    </select>
                    <input type="text" placeholder="Search requirements..." style="flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-panel-border); padding: 5px;">
                </div>

                <div class="standards-list">
                    <!-- Req 1 -->
                    <div class="req-item">
                        <div class="req-header" onclick="toggleDetails(this)">
                            <span class="req-id">A.5.1.1</span>
                            <span class="req-title">Policies for Information Security</span>
                            <span class="req-status status-pass">PASS</span>
                        </div>
                        <div class="req-details">
                            <p><strong>Requirement:</strong> A set of policies for information security shall be defined, approved by management, published and communicated to employees and relevant external parties.</p>

                            <div class="mapping-section">
                                <h6>Mapped Controls (PaC/AaC)</h6>
                                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                                    <span style="background: rgba(79, 193, 255, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Policy: No Hardcoded Secrets</span>
                                    <span style="background: rgba(79, 193, 255, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Policy: Encryption at Rest</span>
                                </div>
                                <div style="margin-top: 10px;">
                                    <button class="mapping-btn">Edit Mappings</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Req 2 -->
                    <div class="req-item">
                        <div class="req-header" onclick="toggleDetails(this)">
                            <span class="req-id">A.9.2.1</span>
                            <span class="req-title">User Registration and De-registration</span>
                            <span class="req-status status-fail">FAIL</span>
                        </div>
                        <div class="req-details">
                            <p><strong>Requirement:</strong> A formal user registration and de-registration process shall be implemented to enable assignment of access rights.</p>

                            <div class="mapping-section">
                                <h6>Mapped Controls</h6>
                                <div style="font-style: italic; opacity: 0.6; margin-bottom: 5px;">No controls mapped.</div>
                                <button class="mapping-btn">Add Control Mapping</button>
                            </div>
                        </div>
                    </div>

                    <!-- Req 3 -->
                    <div class="req-item">
                        <div class="req-header" onclick="toggleDetails(this)">
                            <span class="req-id">A.12.6.1</span>
                            <span class="req-title">Technical Vulnerability Management</span>
                            <span class="req-status status-pass">PASS</span>
                        </div>
                        <div class="req-details">
                            <p><strong>Requirement:</strong> Information about technical vulnerabilities of information systems being used shall be obtained in a timely fashion, the organization's exposure to such vulnerabilities evaluated and appropriate measures taken to address the associated risk.</p>
                            <div class="mapping-section">
                                <h6>Mapped Controls</h6>
                                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                                    <span style="background: rgba(79, 193, 255, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Check: Depencency Audit</span>
                                </div>
                                <div style="margin-top: 10px;">
                                    <button class="mapping-btn">Edit Mappings</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Reports View -->
            <div id="reports" class="content-area">
                <div style="text-align: center; padding: 40px; color: #666;">
                    <div class="codicon codicon-cloud-download" style="font-size: 40px; margin-bottom: 10px;"></div>
                    <h3>Audit Reports</h3>
                    <p>Select a format to export the current compliance status.</p>

                    <div style="display: flex; justify-content: center; gap: 20px; margin-top: 30px;">
                        <button class="mapping-btn" style="padding: 10px 20px; font-size: 14px;">
                            <span class="codicon codicon-file-pdf"></span> Export as PDF
                        </button>
                        <button class="mapping-btn" style="padding: 10px 20px; font-size: 14px;">
                            <span class="codicon codicon-json"></span> Export as JSON
                        </button>
                        <button class="mapping-btn" style="padding: 10px 20px; font-size: 14px;">
                            <span class="codicon codicon-table"></span> Export as CSV
                        </button>
                    </div>
                </div>
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

                function toggleDetails(header) {
                    const details = header.nextElementSibling;
                    details.classList.toggle('open');
                }
            </script>
        </body>
        </html>`;
    }
}
