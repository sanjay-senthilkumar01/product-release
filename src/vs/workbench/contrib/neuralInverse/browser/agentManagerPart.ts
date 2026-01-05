/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, getWindow } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { Part } from '../../../browser/part.js';
import { IWebviewService, IWebviewElement } from '../../webview/browser/webview.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IAgentRegistryService } from '../common/agentRegistryService.js';
import { IContextGatheringService } from '../../void/browser/contextGatheringService.js';
import { ILLMMessageService } from '../../void/common/sendLLMMessageService.js';

import { IConvertToLLMMessageService } from '../../void/browser/convertToLLMMessageService.js';
import { mountSidebar } from '../../void/browser/react/out/sidebar-tsx/index.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';

export class AgentManagerPart extends Part {

	static readonly ID = 'workbench.parts.agentManager';

	minimumWidth: number = 300;
	maximumWidth: number = Infinity;
	minimumHeight: number = 300;
	maximumHeight: number = Infinity;

	private webviewElement: IWebviewElement | undefined;
	private readonly disposables = new DisposableStore();

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IAgentRegistryService private readonly agentRegistryService: IAgentRegistryService,
		@IContextGatheringService private readonly contextGatheringService: IContextGatheringService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IConvertToLLMMessageService private readonly convertToLLMMessageService: IConvertToLLMMessageService
	) {
		super(AgentManagerPart.ID, { hasTitle: false }, themeService, storageService, layoutService);
		this.registerListeners();
	}

	override createContentArea(parent: HTMLElement): HTMLElement | undefined {
		// Create main container
		const container = document.createElement('div');
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.width = '100%';
		container.style.height = '100%';
		container.style.overflow = 'hidden';
		parent.appendChild(container);

		// Header Container (Tabs style)
		const header = document.createElement('div');
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'flex-start';
		header.style.height = '35px';
		header.style.minHeight = '35px';
		header.style.borderBottom = '1px solid var(--vscode-panel-border)';
		header.style.backgroundColor = 'var(--vscode-panel-background)';
		header.style.padding = '0 10px';
		container.appendChild(header);

		// Tabs Container
		const tabsContainer = document.createElement('div');
		tabsContainer.style.display = 'flex';
		tabsContainer.style.height = '100%';
		header.appendChild(tabsContainer);

		const createTab = (text: string, onClick: () => void) => {
			const tab = document.createElement('div');
			tab.textContent = text;
			tab.style.padding = '0 10px';
			tab.style.cursor = 'pointer';
			tab.style.fontSize = '11px';
			tab.style.textTransform = 'uppercase';
			tab.style.display = 'flex';
			tab.style.alignItems = 'center';
			tab.style.height = '100%';
			tab.style.userSelect = 'none';
			tab.style.borderBottom = '1px solid transparent';
			tab.style.color = 'var(--vscode-panelTitle-inactiveForeground)';

			tab.addEventListener('click', onClick);
			return tab;
		};

		// Content Body container
		const body = document.createElement('div');
		body.style.flex = '1';
		body.style.position = 'relative';
		body.style.overflow = 'hidden';
		container.appendChild(body);

		// VIEW 1: Agent Manager Webview
		const agentContainer = document.createElement('div');
		agentContainer.style.width = '100%';
		agentContainer.style.height = '100%';
		// agentContainer.style.display = 'none'; // Initially hidden or shown
		body.appendChild(agentContainer);

		// VIEW 2: Void Sidebar
		const voidContainer = document.createElement('div');
		voidContainer.style.width = '100%';
		voidContainer.style.height = '100%';
		// voidContainer.style.display = 'none';
		body.appendChild(voidContainer);


		// State Management
		let activeView: 'manager' | 'chat' = 'chat'; // Default to Chat

		const updateView = (view: 'manager' | 'chat') => {
			activeView = view;
			if (view === 'manager') {
				agentContainer.style.display = 'block';
				voidContainer.style.display = 'none';

				styleActive(tabAgents);
				styleInactive(tabChat);
			} else {
				agentContainer.style.display = 'none';
				voidContainer.style.display = 'block';

				styleInactive(tabAgents);
				styleActive(tabChat);
			}
		};

		const styleActive = (el: HTMLElement) => {
			el.style.borderBottom = '1px solid var(--vscode-panelTitle-activeBorder)';
			el.style.color = 'var(--vscode-panelTitle-activeForeground)';
			el.style.fontWeight = 'normal';
		};

		const styleInactive = (el: HTMLElement) => {
			el.style.borderBottom = '1px solid transparent';
			el.style.color = 'var(--vscode-panelTitle-inactiveForeground)';
			el.style.fontWeight = 'normal';
		};

		const tabChat = createTab('Chat', () => updateView('chat'));
		const tabAgents = createTab('Agents', () => updateView('manager'));

		tabsContainer.appendChild(tabChat);
		tabsContainer.appendChild(tabAgents);

		// Initialize view
		updateView('chat');

		this.webviewElement = this.webviewService.createWebviewElement({
			title: 'Agent Manager',
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

		this.webviewElement.mountTo(agentContainer, getWindow(agentContainer));

		// Mount Void Sidebar
		console.log('AgentManagerPart: mounting sidebar...');

		// HACK: Override createElement to bypass "Not allowed to create elements in child window" error
		const auxDoc = parent.ownerDocument;
		let observer: MutationObserver | undefined;

		let intervalId: any;

		if (auxDoc && auxDoc !== document) {
			console.log('AgentManagerPart: patching auxDoc.createElement');
			(auxDoc as any).createElement = function (tagName: string, options?: any) {
				return document.createElement(tagName, options);
			};

			// HACK: Mirror styles from main window to aux window (including dynamic ones)
			console.log('AgentManagerPart: starting style mirror');
			const mainHead = document.head;
			const auxHead = auxDoc.head;
			const mainBody = document.body;
			const auxBody = auxDoc.body;
			const mainHtml = document.documentElement;
			const auxHtml = auxDoc.documentElement;

			// Mirror attributes/classes (CRITICAL for VS Code themes/layout)
			const copyAttributes = (src: HTMLElement, dest: HTMLElement) => {
				Array.from(src.attributes).forEach(attr => {
					dest.setAttribute(attr.name, attr.value);
				});
			};
			copyAttributes(mainHtml, auxHtml);
			copyAttributes(mainBody, auxBody);

			// Watch for attribute changes on body/html (theme changes)
			const attrObserver = new MutationObserver((mutations) => {
				mutations.forEach(m => {
					if (m.target === mainBody) copyAttributes(mainBody, auxBody);
					if (m.target === mainHtml) copyAttributes(mainHtml, auxHtml);
				});
			});
			attrObserver.observe(mainBody, { attributes: true });
			attrObserver.observe(mainHtml, { attributes: true });


			const copyNode = (node: Node) => {
				if (node instanceof HTMLElement) {
					if (node.tagName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet') {
						const href = (node as HTMLLinkElement).href;
						if (Array.from(auxHead.querySelectorAll('link')).some(l => l.href === href)) return;
						const newLink = auxDoc.createElement('link');
						newLink.rel = 'stylesheet';
						newLink.href = href;
						auxHead.appendChild(newLink);
					} else if (node.tagName === 'STYLE') {
						const textContent = node.textContent;
						if (!textContent) return;
						if (Array.from(auxHead.querySelectorAll('style')).some(s => s.textContent === textContent)) return;

						const newStyle = auxDoc.createElement('style');
						newStyle.textContent = textContent;
						auxHead.appendChild(newStyle);
					}
				}
			};

			// Copy existing styles
			Array.from(mainHead.children).forEach(copyNode);

			// Watch for new styles (e.g. injected by webpack/vite)
			observer = new MutationObserver((mutations) => {
				mutations.forEach((m) => {
					m.addedNodes.forEach(copyNode);
				});
			});
			observer.observe(mainHead, { childList: true, subtree: false });

			// POLLING FALLBACK: Force re-sync every 1s to catch lazy-loaded styles
			intervalId = setInterval(() => {
				// Re-copy attributes
				copyAttributes(mainHtml, auxHtml);
				copyAttributes(mainBody, auxBody);
				// Re-copy styles
				Array.from(mainHead.children).forEach(copyNode);
			}, 1000);

			// Force base font style if missing
			auxBody.style.fontFamily = 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif)';
			auxBody.style.fontSize = 'var(--vscode-font-size, 13px)';
			auxBody.style.color = 'var(--vscode-foreground)';
		}

		this.instantiationService.invokeFunction(accessor => {
			try {
				const disposeFn = mountSidebar(voidContainer, accessor)?.dispose;
				this._register(toDisposable(() => {
					disposeFn?.();
					observer?.disconnect();
					// attrObserver?.disconnect();
					clearInterval(intervalId);
				}));
				console.log('AgentManagerPart: sidebar mounted successfully');
			} catch (e) {
				console.error('AgentManagerPart: failed to mount sidebar', e);
			}
		});

		this.updateWebviewContent();
		this.registerWebviewListeners();
		this.registerConfigurationListeners();

		// Initial agent load
		setTimeout(() => this.updateAgentsList(), 1000); // Give webview a moment to load

		return parent;
	}

	private registerListeners(): void {
		this.disposables.add(this.agentRegistryService.onDidAgentsChange(() => {
			this.updateAgentsList();
		}));
	}

	private updateAgentsList(): void {
		const agents = this.agentRegistryService.getAgents();
		this.webviewElement?.postMessage({ command: 'updateAgents', data: agents });
	}

	private updateWebviewContent(): void {
		if (this.webviewElement) {
			this.webviewElement.setHtml(this.getDashboardHtml());
		}
	}

	private registerWebviewListeners(): void {
		if (!this.webviewElement) { return; }

		this.disposables.add(this.webviewElement.onMessage(e => {
			if (e.message.command === 'sendMessage') {
				this.handleAgentMessage(e.message.data);
			} else if (e.message.command === 'refreshAgents') {
				this.updateAgentsList();
			} else if (e.message.command === 'createAgent') {
				this.handleCreateAgent(e.message.data);
			}
		}));
	}

	private registerConfigurationListeners(): void {
		this.disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			// Forward configuration changes to webview if needed
			// For now, just re-render if something major changes? Or post message.
			this.webviewElement?.postMessage({ command: 'configChanged', data: e });
		}));
	}

	private getMappedTools(agentTools: string[] | undefined): string[] {
		const TOOLS_MAP: { [key: string]: string[] } = {
			'Terminal': ['run_command', 'run_persistent_command', 'open_persistent_terminal', 'kill_persistent_terminal'],
			'FileSystem': ['read_file', 'ls_dir', 'get_dir_tree', 'search_pathnames_only', 'search_for_files', 'search_in_file', 'create_file_or_folder', 'delete_file_or_folder', 'edit_file', 'rewrite_file', 'read_lint_errors']
		};

		if (!agentTools || agentTools.length === 0) return []; // No tools

		const allowed: string[] = [];
		agentTools.forEach(t => {
			const mapped = TOOLS_MAP[t];
			if (mapped) allowed.push(...mapped);
			// Also allow direct builtin tool names if specified? Maybe later.
		});
		return [...new Set(allowed)];
	}

	private async handleAgentMessage(data: { agentName: string; input: string }): Promise<void> {
		const agent = this.agentRegistryService.getAgents().find(a => a.name === data.agentName);
		if (!agent) {
			console.error('Agent not found:', data.agentName);
			return;
		}

		const allowedTools = this.getMappedTools(agent.tools);
		// If allowedTools is empty, we might want to use 'normal' mode, but 'agent' mode handles system prompt better.
		// If allowedTools is empty, prompts.ts will filter all tools out, which is what we want.

		// Generate the robust system message including tools definitions and context
		const systemMessage = await this.convertToLLMMessageService.generateSystemMessage('agent', undefined, allowedTools);

		// Combine agent instructions with the scaffolded system message
		const fullSystemMessage = `AGENT INSTRUCTIONS:\n${agent.systemInstructions}\n\n${systemMessage}`;

		const messages = [
			{ role: 'system', content: fullSystemMessage },
			{ role: 'user', content: data.input }
		];

		this.webviewElement?.postMessage({ command: 'agentResponseStart' });

		this.llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			messages: messages as any, // Type check bypass for now
			modelSelection: { providerName: 'openAI', modelName: agent.model }, // Defaulting to OpenAI for now
			logging: { loggingName: 'AgentManager' },
			modelSelectionOptions: undefined,
			overridesOfModel: undefined,
			separateSystemMessage: undefined,
			chatMode: 'agent', // Important to trigger tool use logic in downstream services if any
			onText: (params) => {
				this.webviewElement?.postMessage({ command: 'agentResponseText', data: params.fullText });
			},
			onFinalMessage: (params) => {
				this.webviewElement?.postMessage({ command: 'agentResponseEnd' });
			},
			onError: (params) => {
				this.webviewElement?.postMessage({ command: 'agentResponseError', data: params.message });
			},
			onAbort: () => { },
		});
	}

	private async handleCreateAgent(data: { name: string; model: string; instructions: string; tools: string[] }): Promise<void> {
		try {
			await this.agentRegistryService.createAgent({
				name: data.name,
				model: data.model,
				systemInstructions: data.instructions,
				tools: data.tools
			});
			this.webviewElement?.postMessage({ command: 'agentCreated', data: data.name });
			// The registry service listener will trigger updateAgentsList anyway
		} catch (e) {
			this.webviewElement?.postMessage({ command: 'agentResponseError', data: 'Failed to create agent: ' + (e instanceof Error ? e.message : String(e)) });
		}
	}

	private getDashboardHtml(): string {
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Agent</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    margin: 0;
                }
                .header-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                h1 {
                    font-size: 1.2em;
                    font-weight: 500;
                    margin: 0;
                    color: var(--vscode-foreground);
                }
                .section {
                    margin-bottom: 20px;
                }
                .label {
                    display: block;
                    font-size: 0.9em;
                    font-weight: 600;
                    margin-bottom: 6px;
                    color: var(--vscode-descriptionForeground);
                    text-transform: uppercase;
                }

                input, select, textarea {
                    width: 100%;
                    padding: 6px 8px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    box-sizing: border-box;
                    margin-bottom: 10px;
                    border-radius: 2px;
                    font-family: inherit;
                    font-size: inherit;
                }
                input:focus, select:focus, textarea:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    border-color: var(--vscode-focusBorder);
                }

                textarea { resize: vertical; min-height: 80px; }

                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 14px;
                    cursor: pointer;
                    border-radius: 2px;
                    font-family: inherit;
                }
                button:hover { background: var(--vscode-button-hoverBackground); }
                .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

                #output {
                    white-space: pre-wrap;
                    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
                    padding: 10px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border: 1px solid var(--vscode-widget-border);
                    min-height: 150px;
                    border-radius: 3px;
                    overflow-x: auto;
                }

                /* Modal */
                .modal {
                    display: none;
                    position: fixed;
                    z-index: 10;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden; /* Parent scroll */
                    background-color: rgba(0,0,0,0.5);
                    backdrop-filter: blur(2px);
                }
                .modal-content {
                    background-color: var(--vscode-editor-background);
                    margin: 5% auto;
                    padding: 20px;
                    border: 1px solid var(--vscode-widget-border);
                    width: 80%;
                    max-width: 600px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    border-radius: 4px;
                }
                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    font-size: 1.1em;
                    font-weight: bold;
                }
                .close {
                    color: var(--vscode-descriptionForeground);
                    font-size: 24px;
                    font-weight: bold;
                    cursor: pointer;
                    line-height: 1;
                }
                .close:hover { color: var(--vscode-foreground); }

                .checkbox-group { margin-top: 10px; margin-bottom: 20px; border: 1px solid var(--vscode-widget-border); padding: 10px; border-radius: 3px; }
                .checkbox-group label { display: flex; align-items: center; margin-bottom: 5px; cursor: pointer; }
                .checkbox-group input { width: auto; margin-right: 8px; margin-bottom: 0; }

                .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="header-row">
                <h1>Agents</h1>
                <button onclick="openModal()">+ New Agent</button>
            </div>

            <div class="section">
                <span class="label">Select Agent</span>
                <select id="agent-selector">
                    <option value="" disabled selected>Loading agents...</option>
                </select>
            </div>

            <div class="section">
                <span class="label">Input</span>
                <input type="text" id="user-input" placeholder="Ask the agent to do something..." />
                <button onclick="sendMessage()">Send</button>
            </div>

            <div class="section">
                <span class="label">Output</span>
                <div id="output">ready.</div>
            </div>

            <!-- Create Agent Modal -->
            <div id="createModal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <span>Create New Agent</span>
                        <span class="close" onclick="closeModal()">&times;</span>
                    </div>

                    <span class="label">Name</span>
                    <input type="text" id="new-agent-name" placeholder="e.g. CodeReviewer">

                    <span class="label">Model</span>
                    <select id="new-agent-model">
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet</option>
                    </select>

                    <span class="label">System Instructions</span>
                    <textarea id="new-agent-instructions" placeholder="You are a helpful assistant specialized in..."></textarea>

                    <span class="label">Tools</span>
                    <div class="checkbox-group">
                        <label><input type="checkbox" value="FileSystem" class="tool-check"> FileSystem (Read/Write)</label>
                        <label><input type="checkbox" value="Terminal" class="tool-check"> Terminal (Run commands)</label>
                    </div>

                    <div class="actions">
                        <button class="secondary-btn" onclick="closeModal()">Cancel</button>
                        <button onclick="createAgent()">Create</button>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const agentSelector = document.getElementById('agent-selector');
                const outputDiv = document.getElementById('output');
                const userInput = document.getElementById('user-input');
                const modal = document.getElementById('createModal');

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'updateAgents':
                            const current = agentSelector.value;
                            agentSelector.innerHTML = '<option value="" disabled selected>Select an agent...</option>';
                            if (message.data && message.data.length > 0) {
                                message.data.forEach(agent => {
                                    const option = document.createElement('option');
                                    option.value = agent.name;
                                    option.textContent = agent.name;
                                    agentSelector.appendChild(option);
                                });
                            } else {
                                const option = document.createElement('option');
                                option.textContent = "No agents found...";
                                option.disabled = true;
                                agentSelector.appendChild(option);
                            }

                            if (current && Array.from(agentSelector.options).some(o => o.value === current)) {
                                agentSelector.value = current;
                            }
                            break;
                        case 'agentResponseStart':
                            outputDiv.textContent = 'Thinking...';
                            break;
                        case 'agentResponseText':
                            outputDiv.textContent = message.data;
                            break;
                         case 'agentResponseError':
                            outputDiv.textContent = 'Error: ' + message.data;
                            break;
                        case 'agentCreated':
                            closeModal();
                            // Ideally, verify selection
                            break;
                    }
                });

                // Request initial agents
                vscode.postMessage({ command: 'refreshAgents' });

                function sendMessage() {
                    const input = userInput.value;
                    const agentName = agentSelector.value;
                    if (!agentName) {
                        outputDiv.textContent = "Please select an agent.";
                        return;
                    }
                    if (!input) { return; }

                    vscode.postMessage({ command: 'sendMessage', data: { agentName, input } });
                    userInput.value = '';
                }

                // Modal functions
                function openModal() { modal.style.display = "block"; }
                function closeModal() { modal.style.display = "none"; }
                window.onclick = function(event) { if (event.target == modal) { closeModal(); } }

                function createAgent() {
                    const name = document.getElementById('new-agent-name').value;
                    const model = document.getElementById('new-agent-model').value;
                    const instructions = document.getElementById('new-agent-instructions').value;

                    const tools = [];
                    document.querySelectorAll('.tool-check:checked').forEach(cb => tools.push(cb.value));

                    if (!name || !instructions) {
                        // Using native alert for simplicity, though could be nicer
                        // In VS Code webviews, alert() works but looks basic.
                        return;
                    }

                    vscode.postMessage({
                        command: 'createAgent',
                        data: { name, model, instructions, tools }
                    });
                }
            </script>
        </body>
        </html>`;
	}

	override layout(width: number, height: number, top: number, left: number): void {
		super.layout(width, height, top, left);
		if (this.webviewElement) {
			// Webview layout logic if part doesn't handle it automatically via CSS
		}
	}

	toJSON(): object {
		return {
			type: AgentManagerPart.ID
		};
	}

	override dispose(): void {
		this.disposables.dispose();
		super.dispose();
	}
}
