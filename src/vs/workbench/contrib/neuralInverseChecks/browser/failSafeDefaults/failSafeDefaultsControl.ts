/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class FailSafeDefaultsControl extends Disposable {

	private webviewElement: IWebviewElement;

	constructor(
		private readonly container: HTMLElement,
		@IWebviewService private readonly webviewService: IWebviewService
	) {
		super();
		console.log('FailSafeDefaultsControl: Constructor called');

		this.webviewElement = this.webviewService.createWebviewElement({
			title: 'Fail-Safe Defaults',
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
				console.log('FailSafeDefaults Webview:', message.message);
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
            <title>Fail-Safe Defaults</title>
            <style>
                :root {
                    --vscode-editor-background: #1e1e1e;
                    --vscode-foreground: #cccccc;
                    --vscode-button-background: #2e7d32; /* Green */
                    --vscode-button-foreground: #ffffff;
                    --vscode-button-hoverBackground: #388e3c;
                    --vscode-input-background: #3c3c3c;
                    --vscode-input-foreground: #cccccc;
                    --vscode-sideBar-background: #252526;
                    --safe-primary: #4caf50; /* Green 500 */
                    --safe-secondary: #81c784; /* Green 300 */
                    --safe-bg: rgba(76, 175, 80, 0.1);
                    --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
                }
                body {
                    font-family: var(--font-family);
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
                    border-bottom: 2px solid var(--safe-primary);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .title-area h2 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: var(--safe-primary);
                    letter-spacing: 0.5px;
                }
                .status-badge {
                    background-color: var(--safe-primary);
                    color: white;
                    font-size: 11px;
                    font-weight: bold;
                    padding: 4px 8px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    gap: 5px;
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
                    color: var(--safe-primary);
                    background-color: var(--safe-bg);
                }
                .tab.active {
                    opacity: 1;
                    border-bottom-color: var(--safe-primary);
                    color: var(--safe-primary);
                    font-weight: 500;
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

                /* Dashboard Grid */
                .dashboard-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 20px;
                }
                .card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid #333;
                    border-radius: 6px;
                    padding: 20px;
                    position: relative;
                }
                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }
                .card-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--safe-secondary);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .metric-value {
                    font-size: 24px;
                    font-weight: 300;
                    margin-bottom: 5px;
                }
                .metric-label {
                    font-size: 12px;
                    color: #888;
                }

                /* Toggles */
                .toggle-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 0;
                    border-bottom: 1px solid #333;
                }
                .toggle-row:last-child { border-bottom: none; }
                .toggle-info strong { display: block; font-size: 13px; margin-bottom: 4px; }
                .toggle-info span { font-size: 11px; color: #888; }

                .switch {
                    position: relative;
                    display: inline-block;
                    width: 40px;
                    height: 20px;
                }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #444;
                    transition: .4s;
                    border-radius: 20px;
                }
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 16px;
                    width: 16px;
                    left: 2px;
                    bottom: 2px;
                    background-color: white;
                    transition: .4s;
                    border-radius: 50%;
                }
                input:checked + .slider { background-color: var(--safe-primary); }
                input:checked + .slider:before { transform: translateX(20px); }

                /* Hardening Profiles */
                .profile-card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid #333;
                    border-radius: 6px;
                    padding: 20px;
                    cursor: pointer;
                    transition: all 0.2s;
                    border-left: 4px solid transparent;
                }
                .profile-card:hover { transform: translateY(-2px); border-color: #555; }
                .profile-card.active {
                    border-color: var(--safe-primary);
                    border-left-color: var(--safe-primary);
                    background: linear-gradient(90deg, rgba(76, 175, 80, 0.05) 0%, transparent 100%);
                }
                .profile-name { font-size: 16px; font-weight: 600; margin-bottom: 5px; color: white; }
                .profile-desc { font-size: 12px; color: #888; margin-bottom: 15px; }
                .profile-features { font-size: 11px; color: #aaa; line-height: 1.5; }
                .check-list div { display: flex; align-items: center; gap: 6px; }
                .check-list .codicon-check { color: var(--safe-primary); font-size: 10px; }

                .shield-icon {
                    font-size: 48px;
                    color: var(--safe-primary);
                    opacity: 0.2;
                    position: absolute;
                    right: 20px;
                    bottom: 20px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title-area">
                    <h2>
                        <span class="codicon codicon-shield"></span>
                        Fail-Safe Defaults
                    </h2>
                </div>
                <div class="status-badge">
                    <span class="codicon codicon-check"></span>
                    SYSTEM SECURE
                </div>
            </div>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('config')">Configuration</div>
                <div class="tab" onclick="switchTab('toggles')">Safety Toggles</div>
                <div class="tab" onclick="switchTab('profiles')">Hardening Profiles</div>
            </div>

            <!-- Configuration -->
            <div id="config" class="content-area active">
                <div class="dashboard-grid">
                    <div class="card">
                        <div class="card-header">
                            <div class="card-title"><span class="codicon codicon-lock"></span> Global Defaults</div>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-info">
                                <strong>Block Unknown Extensions</strong>
                                <span>Prevents installation of unverified extensions.</span>
                            </div>
                            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-info">
                                <strong>Require Signed Commits</strong>
                                <span>Enforce GPG signing for all git operations.</span>
                            </div>
                            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                         <div class="toggle-row">
                            <div class="toggle-info">
                                <strong>Auto-Patch Dependencies</strong>
                                <span>Automatically update minor versions for security fixes.</span>
                            </div>
                            <label class="switch"><input type="checkbox"><span class="slider"></span></label>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <div class="card-title"><span class="codicon codicon-pulse"></span> Security Health</div>
                        </div>
                        <div style="text-align:center; padding: 20px 0;">
                            <div style="font-size:36px; font-weight:300; color:var(--safe-primary);">98%</div>
                            <div style="font-size:12px; color:#888;">Compliance Score</div>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-info">
                                <strong>Active Policies</strong>
                            </div>
                            <span style="font-family:monospace; color:white;">42</span>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-info">
                                <strong>Blocked Actions (Today)</strong>
                            </div>
                             <span style="font-family:monospace; color:#ff5252;">3</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Safety Toggles -->
            <div id="toggles" class="content-area">
                <div style="background: var(--safe-bg); border: 1px solid var(--safe-primary); padding: 20px; border-radius: 6px; margin-bottom: 20px; display:flex; align-items:center; gap:20px;">
                    <span class="codicon codicon-shield" style="font-size:32px; color:var(--safe-primary);"></span>
                    <div>
                        <strong style="color:var(--safe-primary); font-size:16px;">System Wide Safe Mode</strong>
                        <div style="font-size:13px; opacity:0.8; margin-top:5px;">
                            Running in secure mode. Network access restricted to allow-listed domains only. Code execution sandbox enabled.
                        </div>
                    </div>
                    <div style="margin-left:auto;">
                         <label class="switch" style="width:60px; height:30px;">
                            <input type="checkbox" checked>
                            <span class="slider" style="border-radius:30px;"></span>
                        </label>
                    </div>
                </div>

                <div class="dashboard-grid">
                    <div class="card">
                        <div class="card-header"><div class="card-title">Network Isolation</div></div>
                         <p style="font-size:12px; color:#888; margin-bottom:15px;">Restrict outbound connections to known APIs.</p>
                         <div class="toggle-row">
                            <div class="toggle-info"><strong>Block HTTP (Non-HTTPS)</strong></div>
                            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-info"><strong>Allow Localhost</strong></div>
                            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                    </div>
                     <div class="card">
                        <div class="card-header"><div class="card-title">Runtime Protection</div></div>
                         <p style="font-size:12px; color:#888; margin-bottom:15px;">Monitor and block suspicious runtime behavior.</p>
                         <div class="toggle-row">
                            <div class="toggle-info"><strong>Memory Safety Check</strong></div>
                            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-info"><strong>Prevent Process Spawning</strong></div>
                            <label class="switch"><input type="checkbox"><span class="slider"></span></label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Hardening Profiles -->
            <div id="profiles" class="content-area">
                <div style="display:grid; grid-template-columns: 1fr; gap:15px;">
                    <div class="profile-card" onclick="selectProfile(this)">
                        <div class="profile-name">Development (Standard)</div>
                        <div class="profile-desc">Balanced security for active development environments.</div>
                        <div class="check-list">
                            <div><span class="codicon codicon-check"></span> Basic Linting & Formatting</div>
                            <div><span class="codicon codicon-check"></span> Secrets Scanning (Warning Only)</div>
                            <div><span class="codicon codicon-check"></span> Unrestricted Network Access</div>
                        </div>
                    </div>

                    <div class="profile-card active" onclick="selectProfile(this)">
                         <div style="float:right; background:var(--safe-primary); color:black; font-size:10px; padding:2px 6px; border-radius:2px; font-weight:bold;">ACTIVE</div>
                        <div class="profile-name">Staging (Hardened)</div>
                        <div class="profile-desc">Stricter controls mirroring production constraints.</div>
                        <div class="check-list">
                            <div><span class="codicon codicon-check"></span> Strict Policy Enforcement</div>
                            <div><span class="codicon codicon-check"></span> Network Whitelisting</div>
                            <div><span class="codicon codicon-check"></span> Signed Commits Required</div>
                        </div>
                    </div>

                    <div class="profile-card" onclick="selectProfile(this)">
                        <div class="profile-name">Production (Locked Down)</div>
                        <div class="profile-desc">Maximum security for release builds and prod access.</div>
                        <div class="check-list">
                            <div><span class="codicon codicon-check"></span> Read-Only Filesystem (except /tmp)</div>
                            <div><span class="codicon codicon-check"></span> Zero Trust Networking</div>
                            <div><span class="codicon codicon-check"></span> Full Audit Logging</div>
                        </div>
                         <span class="codicon codicon-shield shield-icon"></span>
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

                function selectProfile(card) {
                    document.querySelectorAll('.profile-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    // In real app, would post message to backend
                }
            </script>
        </body>
        </html>`;
	}
}
