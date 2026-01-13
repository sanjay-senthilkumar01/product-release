/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class AuditAndEvidenceControl extends Disposable {

	private webviewElement: IWebviewElement;

	constructor(
		private readonly container: HTMLElement,
		@IWebviewService private readonly webviewService: IWebviewService
	) {
		super();
		console.log('AuditAndEvidenceControl: Constructor called');

		this.webviewElement = this.webviewService.createWebviewElement({
			title: 'Audit & Evidence',
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
				console.log('AuditAndEvidence Webview:', message.message);
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
            <title>Audit & Evidence</title>
            <style>
                :root {
                    --vscode-editor-background: #1e1e1e;
                    --vscode-foreground: #cccccc;
                    --vscode-button-background: #ffb300; /* Amber/Gold */
                    --vscode-button-foreground: #000000;
                    --vscode-button-hoverBackground: #ffca28;
                    --vscode-input-background: #3c3c3c;
                    --vscode-input-foreground: #cccccc;
                    --vscode-sideBar-background: #252526;
                    --audit-primary: #ffc107; /* Amber */
                    --audit-secondary: #ffe082; /* Light Amber */
                    --audit-accent: #ff6f00; /* Dark Amber */
                    --legal-font: "Times New Roman", Times, serif;
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
                    background-color: #151515;
                    border-bottom: 2px solid var(--audit-primary);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .title-area h2 {
                    margin: 0;
                    font-family: var(--legal-font);
                    font-size: 20px;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: var(--audit-primary);
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                }
                .badge {
                    background-color: var(--audit-primary);
                    color: black;
                    font-size: 10px;
                    font-family: sans-serif;
                    font-weight: bold;
                    padding: 2px 6px;
                    border-radius: 2px;
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
                    opacity: 0.6;
                    transition: all 0.2s;
                    font-size: 13px;
                }
                .tab:hover {
                    opacity: 1;
                    color: var(--audit-primary);
                    background-color: rgba(255, 193, 7, 0.05);
                }
                .tab.active {
                    opacity: 1;
                    border-bottom-color: var(--audit-primary);
                    color: var(--audit-primary);
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

                /* Audit Timeline */
                .timeline {
                    position: relative;
                    margin-left: 20px;
                    border-left: 2px solid #444;
                    padding-left: 20px;
                }
                .timeline-item {
                    position: relative;
                    margin-bottom: 25px;
                }
                .timeline-dot {
                    position: absolute;
                    left: -27px;
                    top: 0;
                    width: 12px;
                    height: 12px;
                    background: var(--vscode-editor-background);
                    border: 2px solid var(--audit-primary);
                    border-radius: 50%;
                }
                .timeline-time {
                    font-size: 11px;
                    color: #888;
                    margin-bottom: 4px;
                    font-family: monospace;
                }
                .timeline-content {
                    background: var(--vscode-sideBar-background);
                    padding: 15px;
                    border-radius: 4px;
                    border: 1px solid #333;
                }
                .timeline-title {
                    font-weight: bold;
                    color: var(--audit-secondary);
                    margin-bottom: 5px;
                    display: flex;
                    justify-content: space-between;
                }
                .tag {
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 2px;
                    background: #333;
                    color: #aaa;
                }

                /* Evidence Grid */
                .evidence-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 15px;
                }
                .evidence-card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid #444;
                    padding: 15px;
                    border-radius: 2px;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }
                .evidence-card:hover { border-color: var(--audit-primary); }
                .evidence-icon {
                    font-size: 24px;
                    color: var(--audit-primary);
                    margin-bottom: 10px;
                }
                .evidence-title { font-weight: 500; font-size: 13px; margin-bottom: 5px; }
                .evidence-meta { font-size: 11px; color: #888; }

                /* Chain of Custody */
                .chain-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .chain-table th {
                    text-align: left;
                    padding: 10px;
                    border-bottom: 1px solid var(--audit-primary);
                    color: var(--audit-primary);
                    font-family: var(--legal-font);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .chain-table td {
                    padding: 10px;
                    border-bottom: 1px solid #333;
                }
                .hash-code {
                    font-family: monospace;
                    color: #888;
                    background: rgba(255,255,255,0.05);
                    padding: 2px 4px;
                    border-radius: 2px;
                }

                .action-btn {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 14px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                }
                .action-btn:hover { background: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title-area">
                    <h2>
                        <span class="codicon codicon-law"></span>
                        Audit & Evidence
                        <span class="badge">Legal Hold</span>
                    </h2>
                </div>
            </div>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('trail')">Audit Trail</div>
                <div class="tab" onclick="switchTab('locker')">Evidence Locker</div>
                <div class="tab" onclick="switchTab('custody')">Chain of Custody</div>
            </div>

            <!-- Audit Trail -->
            <div id="trail" class="content-area active">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <div style="font-size:12px; color:#888;">System Activity Log • Last 24 Hours</div>
                    <button class="action-btn">Export Log (CSV)</button>
                </div>

                <div class="timeline">
                    <div class="timeline-item">
                        <div class="timeline-dot"></div>
                        <div class="timeline-time">10:42:15 AM</div>
                        <div class="timeline-content">
                            <div class="timeline-title">
                                <span>Policy Violation Blocked</span>
                                <span class="tag" style="color:#ff5252; background:rgba(255,82,82,0.1)">CRITICAL</span>
                            </div>
                            <div style="font-size:12px; opacity:0.8;">Action blocked by \`CreditCardHandlingPolicy\`. User attempted to commit unmasked PAN.</div>
                            <div style="font-size:11px; margin-top:5px; font-family:monospace; color:#888;">User: dev_user_1 | IP: 10.0.0.52</div>
                        </div>
                    </div>

                    <div class="timeline-item">
                        <div class="timeline-dot"></div>
                        <div class="timeline-time">09:30:00 AM</div>
                        <div class="timeline-content">
                            <div class="timeline-title">
                                <span>Compliance Scan Completed</span>
                                <span class="tag">INFO</span>
                            </div>
                            <div style="font-size:12px; opacity:0.8;">Daily ISO 27001 compliance check executed successfully. Score: 92%.</div>
                        </div>
                    </div>

                    <div class="timeline-item">
                        <div class="timeline-dot"></div>
                        <div class="timeline-time">08:15:22 AM</div>
                        <div class="timeline-content">
                            <div class="timeline-title">
                                <span>Schema Updated</span>
                                <span class="tag">CHANGE</span>
                            </div>
                            <div style="font-size:12px; opacity:0.8;">UserProfile.v2 schema updated by \`admin\`. Added fields for GDPR consent.</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Evidence Locker -->
            <div id="locker" class="content-area">
                <div style="background: rgba(255, 193, 7, 0.1); border: 1px solid var(--audit-primary); padding: 15px; border-radius: 4px; margin-bottom: 20px; display:flex; gap:10px; align-items:center;">
                    <span class="codicon codicon-lock" style="font-size:20px; color:var(--audit-primary);"></span>
                    <div>
                        <strong style="color:var(--audit-primary);">Immutable Storage Active</strong>
                        <div style="font-size:12px; opacity:0.8;">All artifacts in this locker are hashed and cryptographically signed.</div>
                    </div>
                </div>

                <div class="evidence-grid">
                    <div class="evidence-card">
                        <div class="evidence-icon codicon codicon-file-pdf"></div>
                        <div class="evidence-title">GDPR_Audit_Report_2025.pdf</div>
                        <div class="evidence-meta">Size: 4.2 MB<br>Added: Jan 10, 2025</div>
                    </div>
                    <div class="evidence-card">
                        <div class="evidence-icon codicon codicon-code"></div>
                        <div class="evidence-title">auth_service_v1.2.0.snap</div>
                        <div class="evidence-meta">Source Code Snapshot<br>SHA-256 Verified</div>
                    </div>
                    <div class="evidence-card">
                        <div class="evidence-icon codicon codicon-json"></div>
                        <div class="evidence-title">security_scan_results.json</div>
                        <div class="evidence-meta">Raw Scan Output<br>Automated Entry</div>
                    </div>
                </div>
            </div>

            <!-- Chain of Custody -->
            <div id="custody" class="content-area">
                <h3 style="margin-top:0; font-family:var(--legal-font); color:var(--audit-primary); text-transform:uppercase;">Asset Integrity Ledger</h3>
                <p style="font-size:12px; color:#888; margin-bottom:20px;">Verification of digital chain of custody for critical assets.</p>

                <table class="chain-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Asset</th>
                            <th>Action</th>
                            <th>Actor / Signer</th>
                            <th>Integrity Hash</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>2025-01-12 14:02:11</td>
                            <td>PaymentModule.dll</td>
                            <td>BUILD_RELEASE</td>
                            <td>Jenkins_CI (Key ID: 9A2F...)</td>
                            <td><span class="hash-code">e3b0c442...</span></td>
                        </tr>
                        <tr>
                            <td>2025-01-12 13:55:00</td>
                            <td>PaymentModule.cs</td>
                            <td>CODE_REVIEW</td>
                            <td>Reviewer: Sarah_J</td>
                            <td><span class="hash-code">8f43a2b1...</span></td>
                        </tr>
                         <tr>
                            <td>2025-01-12 13:40:22</td>
                            <td>PaymentModule.cs</td>
                            <td>COMMIT</td>
                            <td>Dev: Mike_T</td>
                            <td><span class="hash-code">7d11e9a5...</span></td>
                        </tr>
                    </tbody>
                </table>
                 <div style="margin-top:20px; text-align:right;">
                    <button class="action-btn" style="background:transparent; border:1px solid var(--audit-primary); color:var(--audit-primary);">Verify Signatures</button>
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
            </script>
        </body>
        </html>`;
	}
}
