/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class FormalVerificationControl extends Disposable {

	private webviewElement: IWebviewElement;

	constructor(
		private readonly container: HTMLElement,
		@IWebviewService private readonly webviewService: IWebviewService
	) {
		super();
		console.log('FormalVerificationControl: Constructor called');

		this.webviewElement = this.webviewService.createWebviewElement({
			title: 'Formal Verification',
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
            <title>Formal Verification</title>
            <style>
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

                /* Title Area */
                .title-bar {
                    padding: 8px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background-color: var(--vscode-sideBar-background);
                }
                .title-bar h2 {
                    margin: 0;
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                    color: var(--vscode-sideBarTitle-foreground);
                }

                /* Layout */
                .split-view {
                    display: flex;
                    flex: 1;
                    height: 100%;
                }
                .sidebar {
                    width: 250px;
                    border-right: 1px solid var(--vscode-panel-border);
                    background-color: var(--vscode-sideBar-background);
                    display: flex;
                    flex-direction: column;
                }
                .main-view {
                    flex: 1;
                    padding: 0;
                    display: flex;
                    flex-direction: column;
                    background-color: var(--vscode-editor-background);
                }

                /* Section Headers */
                .section-header {
                    padding: 6px 16px;
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                    color: var(--vscode-sideBarSectionHeader-foreground);
                    background-color: var(--vscode-sideBarSectionHeader-background);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                /* Lists */
                .list-item {
                    padding: 4px 16px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: var(--vscode-foreground);
                }
                .list-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    color: var(--vscode-list-hoverForeground);
                }
                .list-item.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }

                /* Editors / Forms */
                .editor-group {
                    padding: 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .label {
                    display: block;
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--vscode-foreground);
                    margin-bottom: 6px;
                }
                input[type="text"], textarea {
                    width: 100%;
                    box-sizing: border-box;
                    padding: 4px 6px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border, transparent);
                    margin-bottom: 10px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                }
                input:focus, textarea:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }

                /* Tree / Console Output */
                .console-output {
                    flex: 1;
                    padding: 8px;
                    overflow: auto;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 12px;
                    white-space: pre-wrap;
                }
                .log-info { color: var(--vscode-editorInfo-foreground); }
                .log-error { color: var(--vscode-editorError-foreground); }
                .log-warn { color: var(--vscode-editorWarning-foreground); }

                /* Toolbar */
                .toolbar {
                    padding: 8px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    gap: 8px;
                }
                .btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 12px;
                    cursor: pointer;
                    font-size: 11px;
                }
                .btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .btn-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .btn-secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="split-view">
                <!-- Sidebar: Models & Invariants -->
                <div class="sidebar">
                    <div class="section-header">
                        <span>Verifiable Modules</span>
                        <span class="codicon codicon-add" style="cursor:pointer"></span>
                    </div>
                    <div class="list-item selected">
                        <span class="codicon codicon-symbol-class"></span>
                        <span>PaymentGateway.ts</span>
                    </div>
                    <div class="list-item">
                        <span class="codicon codicon-symbol-class"></span>
                        <span>AuthToken.ts</span>
                    </div>
                    <div class="list-item">
                        <span class="codicon codicon-symbol-method"></span>
                        <span>TransactionMutex</span>
                    </div>

                    <div class="section-header" style="margin-top: auto; border-top:1px solid var(--vscode-panel-border)">
                        <span>Invariants</span>
                    </div>
                    <div class="list-item">
                        <span class="codicon codicon-shield"></span>
                        <span>bal >= 0</span>
                    </div>
                    <div class="list-item">
                        <span class="codicon codicon-shield"></span>
                        <span>mutex.locked != true</span>
                    </div>
                </div>

                <!-- Main View: Definition & Checker -->
                <div class="main-view">
                    <!-- Toolbar -->
                    <div class="toolbar">
                        <button class="btn">Run Model Checker</button>
                        <button class="btn btn-secondary">Generate Proof</button>
                    </div>

                    <!-- Editor Area -->
                    <div class="editor-group">
                        <label class="label">Invariant Definition (TLA+ / Metric Temporal Logic)</label>
                        <textarea rows="3" placeholder="Enter logic formula...">ALWAYS (balance >= 0) AND (transaction_active -> user_authenticated)</textarea>
                    </div>

                    <!-- Results / Output -->
                    <div class="section-header">Verification Output</div>
                    <div class="console-output">
                        <div class="log-info">[INFO] Starting Model Checker v2.4.1...</div>
                        <div class="log-info">[INFO] Loaded state space for 'PaymentGateway.ts' (14 states)</div>
                        <div class="log-info">[INFO] Verifying invariant: ALWAYS (balance >= 0)</div>
                        <div class="log-info">... checking state 1/14</div>
                        <div class="log-info">... checking state 5/14</div>
                        <div class="log-warn">[WARN] Potential race condition detected in 'processRefund()'</div>
                        <div class="log-error">[FAIL] Counter-example found:</div>
                        <div style="color:var(--vscode-textPreformat-foreground); padding-left:20px;">
                            Trace:
                            1. Init(balance=100)
                            2. debit(amount=120) -> Allowed?
                            State: balance = -20
                            Violates: balance >= 0
                        </div>
                        <div class="log-info">[Done] Finished in 0.42s</div>
                    </div>
                </div>
            </div>
        </body>
        </html>`;
	}
}
