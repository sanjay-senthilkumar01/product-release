
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewService, IWebviewElement } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class ArchitectureAsCodeControl extends Disposable {
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
			title: 'Architecture as Code',
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
			if (e.message.command === 'saveComponent') {
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
            <title>Architecture as Code</title>
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

                /* Container */
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
                    overflow-y: auto;
                    padding: 20px;
                }
                .view-section.active { display: block; }

                /* VISUALIZER */
                .diagram-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 20px;
                    padding-bottom: 40px;
                }

                .component-card {
                    background: var(--card-bg);
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    padding: 15px;
                    position: relative;
                }
                .component-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; bottom: 0; width: 4px;
                    background: var(--primary);
                    border-radius: 4px 0 0 4px;
                }
                .card-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px; }
                .card-title { font-weight: 600; font-size: 1.1em; }
                .card-type { font-size: 0.75em; text-transform: uppercase; opacity: 0.7; border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; }

                .card-body { font-size: 0.9em; opacity: 0.9; margin-bottom: 15px; line-height: 1.5; }

                .tag { font-size: 0.75em; background: rgba(128,128,128,0.2); padding: 2px 6px; border-radius: 4px; margin-right: 5px; }

                /* EDITOR */
                .editor-layout { display: flex; gap: 30px; height: 100%; }
                .editor-sidebar { width: 250px; border-right: 1px solid var(--border); padding-right: 20px; }
                .editor-main { flex: 1; overflow-y: auto; }

                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: 500; font-size: 0.9em; }
                input, select, textarea {
                    width: 100%;
                    padding: 8px;
                    background: var(--input-bg);
                    border: 1px solid var(--input-border);
                    color: var(--text);
                    border-radius: 2px;
                    box-sizing: border-box;
                }
                .btn {
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                    font-size: 0.9em;
                }
                .btn:hover { background: var(--vscode-button-hoverBackground); }

                /* YAML VIEW */
                .code-block {
                    background: var(--input-bg);
                    padding: 20px;
                    border: 1px solid var(--border);
                    font-family: 'Menlo', 'Monaco', monospace;
                    white-space: pre;
                    font-size: 0.9em;
                    line-height: 1.5;
                    overflow-x: auto;
                }

                /* BOUNDARY STYLES */
                .boundary-card { border-style: dashed; }
                .boundary-card::before { background: var(--warning); }

                .module-card::before { background: var(--primary); }
            </style>
        </head>
        <body>
            <div class="nav-tabs">
                <div class="nav-item active" onclick="switchView('visualizer')">Visualizer</div>
                <div class="nav-item" onclick="switchView('editor')">Component Editor</div>
                <div class="nav-item" onclick="switchView('code')">YAML Definition</div>
            </div>

            <div class="view-container">
                <!-- VISUALIZER -->
                <div id="view-visualizer" class="view-section active">
                    <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                        <h2>System Components</h2>
                        <span style="font-size:0.9em; color:var(--text-muted);">3 Modules, 2 Boundaries</span>
                    </div>

                    <div class="diagram-container" id="componentGrid">
                        <!-- Rendered content -->
                    </div>
                </div>

                <!-- EDITOR -->
                <div id="view-editor" class="view-section">
                    <div class="editor-layout">
                        <div class="editor-sidebar">
                            <h3>Components</h3>
                            <ul style="list-style:none; padding:0; line-height:2;" id="editorList">
                                <!-- List -->
                            </ul>
                            <button class="btn" style="width:100%; margin-top:20px;" onclick="newComponent()">+ Add Component</button>
                        </div>
                        <div class="editor-main">
                            <h2>Edit Component</h2>
                            <div class="form-group">
                                <label>Name</label>
                                <input type="text" id="cName">
                            </div>
                            <div class="form-group">
                                <label>Type</label>
                                <select id="cType">
                                    <option value="module">Module</option>
                                    <option value="boundary">Trust Boundary</option>
                                    <option value="database">Database</option>
                                    <option value="queue">Queue</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Description</label>
                                <textarea id="cDesc" rows="3"></textarea>
                            </div>
                            <div class="form-group">
                                <label>Technical Tags</label>
                                <input type="text" id="cTags" placeholder="e.g. Node.js, PII, Public">
                            </div>

                            <div class="form-group" style="margin-top:20px;">
                                <button class="btn" onclick="saveComponent()">Save Definition</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- CODE -->
                <div id="view-code" class="view-section">
                    <h2>Architecture Definition (readonly)</h2>
                    <div class="code-block" id="yamlContent">
                        <!-- YAML content -->
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                let components = [
                    { id: '1', name: 'Internet Boundary', type: 'boundary', desc: 'Separates public internet from internal network.', tags: ['WAF', 'Public'] },
                    { id: '2', name: 'API Gateway', type: 'module', desc: 'Entry point for all mobile and web clients.', tags: ['Node.js', 'Express', 'Auth'] },
                    { id: '3', name: 'Payment Service', type: 'module', desc: 'Handles processing of credit card transactions.', tags: ['PCI-DSS', 'Go'] },
                    { id: '4', name: 'User DB', type: 'database', desc: 'Primary storage for user profiles and credentials.', tags: ['Postgres', 'Encrypted'] }
                ];

                let activeId = '1';

                function switchView(viewId) {
                    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
                    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
                    document.querySelector('.nav-item[onclick="switchView(\\'' + viewId + '\\')"]').classList.add('active');
                    document.getElementById('view-' + viewId).classList.add('active');

                    if(viewId === 'visualizer') renderVisualizer();
                    if(viewId === 'code') renderYaml();
                }

                function renderVisualizer() {
                    const grid = document.getElementById('componentGrid');
                    grid.innerHTML = '';
                    components.forEach(c => {
                        const styleClass = c.type === 'boundary' ? 'boundary-card' : 'module-card';
                        const tags = c.tags.map(t => '<span class="tag">' + t + '</span>').join('');

                        grid.innerHTML += \`
                            <div class="component-card \${styleClass}">
                                <div class="card-header">
                                    <div class="card-title">\${c.name}</div>
                                    <div class="card-type">\${c.type}</div>
                                </div>
                                <div class="card-body">\${c.desc}</div>
                                <div>\${tags}</div>
                            </div>
                        \`;
                    });
                }

                function renderEditorList() {
                    const list = document.getElementById('editorList');
                    list.innerHTML = '';
                    components.forEach(c => {
                        const selected = c.id === activeId ? 'font-weight:bold; color:var(--primary);' : '';
                        list.innerHTML += '<li style="cursor:pointer; ' + selected + '" onclick="loadComponent(\\'' + c.id + '\\')">' + c.name + '</li>';
                    });
                }

                function loadComponent(id) {
                    activeId = id;
                    const c = components.find(x => x.id === id);
                    if(!c) return;

                    document.getElementById('cName').value = c.name;
                    document.getElementById('cType').value = c.type;
                    document.getElementById('cDesc').value = c.desc;
                    document.getElementById('cTags').value = c.tags.join(', ');
                    renderEditorList();
                }

                function newComponent() {
                    const id = Date.now().toString();
                    components.push({
                        id,
                        name: 'New Component',
                        type: 'module',
                        desc: '',
                        tags: []
                    });
                    loadComponent(id);
                }

                function saveComponent() {
                    const c = components.find(x => x.id === activeId);
                    if(c) {
                        c.name = document.getElementById('cName').value;
                        c.type = document.getElementById('cType').value;
                        c.desc = document.getElementById('cDesc').value;
                        c.tags = document.getElementById('cTags').value.split(',').map(s => s.trim()).filter(x => x);

                        // Show feedback
                        const btn = document.querySelector('.btn[onclick="saveComponent()"]');
                        const oldText = btn.innerText;
                        btn.innerText = 'Saved!';
                        setTimeout(() => btn.innerText = oldText, 1000);

                        renderEditorList();
                        renderVisualizer();
                        vscode.postMessage({ command: 'saveComponent' });
                    }
                }

                function renderYaml() {
                    const yaml = components.map(c =>
                        \`- name: "\${c.name}"\\n  type: \${c.type}\\n  description: "\${c.desc}"\\n  tags: [\${c.tags.join(', ')}]\\n\`
                    ).join('\\n');
                    document.getElementById('yamlContent').textContent = yaml;
                }

                // Initial
                renderVisualizer();
                renderEditorList();
                loadComponent('1');

            </script>
        </body>
        </html>`;
	}
}
