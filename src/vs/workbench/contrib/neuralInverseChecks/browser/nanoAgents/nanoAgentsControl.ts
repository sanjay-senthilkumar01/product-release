
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWebviewService, IWebviewElement } from '../../../webview/browser/webview.js';
import { getWindow } from '../../../../../base/browser/dom.js';

export class NanoAgentsControl extends Disposable {
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
		this.container.style.display = 'none'; // Hidden by default
		parent.appendChild(this.container);

		this.initWebview();
	}

	private initWebview() {
		this.webviewElement = this.webviewService.createWebviewElement({
			title: 'Nano Agents',
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
	}

	private getHtml(): string {
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Nano Agents</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    margin: 0;
                }
                h1 { font-size: 1.2em; font-weight: 500; margin-bottom: 10px; }
                .card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    padding: 15px;
                    border-radius: 6px;
                    margin-bottom: 15px;
                    max-width: 400px;
                }
            </style>
        </head>
        <body>
            <h1>Nano Agents</h1>
            <div class="card">
                <p>Nano Agents Registry initialized.</p>
                <p style="opacity: 0.7; font-size: 0.9em;">Ready to deploy micro-agents for specific tasks.</p>
            </div>
        </body>
        </html>`;
	}

	public show() {
		this.container.style.display = 'block';
	}

	public hide() {
		this.container.style.display = 'none';
	}

	public layout(width: number, height: number) {
		// Pass layout calls if needed, mostly for webview resizing
	}
}
