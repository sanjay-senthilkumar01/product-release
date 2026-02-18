/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';

const GRC_MARKER_OWNER = 'neuralInverse.grc';

export class ChecksViewPane extends ViewPane {

	public static readonly ID = 'workbench.view.checks.pane';
	private _container: HTMLElement | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMarkerService private readonly markerService: IMarkerService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = container;
		container.style.overflow = 'auto';

		this._renderContent();

		// Re-render when markers change
		this._register(this.markerService.onMarkerChanged(() => {
			this._renderContent();
		}));
	}

	private _renderContent(): void {
		if (!this._container) { return; }
		const c = this._container;
		c.innerHTML = '';

		// Read all GRC markers from the marker service
		const allMarkers = this.markerService.read({ owner: GRC_MARKER_OWNER });

		const errors = allMarkers.filter(m => m.severity === MarkerSeverity.Error);
		const warnings = allMarkers.filter(m => m.severity === MarkerSeverity.Warning);
		const infos = allMarkers.filter(m => m.severity === MarkerSeverity.Info);
		const total = allMarkers.length;

		// ─── Styles ───
		const style = document.createElement('style');
		style.textContent = `
			.grc-panel { padding:12px 16px; font-family:var(--vscode-font-family); font-size:12px; color:var(--vscode-foreground); }
			.grc-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
			.grc-header h3 { margin:0; font-size:13px; font-weight:600; }
			.grc-badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; }
			.grc-badge-ok { background:#4caf50; color:#000; }
			.grc-badge-issues { background:#ff5252; color:#fff; }
			.grc-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px; }
			.grc-stat { background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); padding:8px; border-radius:4px; text-align:center; }
			.grc-stat-label { font-size:9px; opacity:0.6; text-transform:uppercase; letter-spacing:0.3px; }
			.grc-stat-val { font-size:20px; font-weight:700; margin-top:2px; }
			.grc-stat-val.err { color:#ff5252; } .grc-stat-val.warn { color:#ff9800; } .grc-stat-val.info { color:#64b5f6; }
			.grc-sep { border:none; border-top:1px solid var(--vscode-panel-border); margin:10px 0; }
			.grc-issue { display:flex; align-items:flex-start; gap:6px; padding:6px 8px; font-size:11px; border-left:2px solid transparent; cursor:default; }
			.grc-issue:hover { background:rgba(255,255,255,0.04); }
			.grc-issue-err { border-left-color:#ff5252; } .grc-issue-warn { border-left-color:#ff9800; } .grc-issue-info { border-left-color:#64b5f6; }
			.grc-issue-sev { font-size:9px; font-weight:700; flex-shrink:0; width:60px; font-family:monospace; }
			.grc-issue-msg { flex:1; line-height:1.4; }
			.grc-issue-file { font-size:10px; color:#888; font-family:monospace; }
			.grc-empty { text-align:center; padding:24px; opacity:0.5; font-size:12px; }
			.grc-file-group { margin-bottom:10px; }
			.grc-file-header { padding:4px 8px; font-size:11px; font-weight:600; opacity:0.7; cursor:pointer; user-select:none; border-radius:3px; }
			.grc-file-header:hover { background:rgba(255,255,255,0.04); }
		`;
		c.appendChild(style);

		const panel = document.createElement('div');
		panel.className = 'grc-panel';
		c.appendChild(panel);

		// ─── Header ───
		const header = document.createElement('div');
		header.className = 'grc-header';
		header.innerHTML = `<h3>GRC Checks</h3><span class="grc-badge ${total === 0 ? 'grc-badge-ok' : 'grc-badge-issues'}">${total === 0 ? 'ALL CLEAR' : total + ' issue' + (total > 1 ? 's' : '')}</span>`;
		panel.appendChild(header);

		// ─── Stats ───
		const stats = document.createElement('div');
		stats.className = 'grc-stats';
		stats.innerHTML = `
			<div class="grc-stat"><div class="grc-stat-label">Errors</div><div class="grc-stat-val err">${errors.length}</div></div>
			<div class="grc-stat"><div class="grc-stat-label">Warnings</div><div class="grc-stat-val warn">${warnings.length}</div></div>
			<div class="grc-stat"><div class="grc-stat-label">Info</div><div class="grc-stat-val info">${infos.length}</div></div>
		`;
		panel.appendChild(stats);

		panel.appendChild(Object.assign(document.createElement('hr'), { className: 'grc-sep' }));

		// ─── Issues grouped by file ───
		if (total === 0) {
			const empty = document.createElement('div');
			empty.className = 'grc-empty';
			empty.textContent = '✓ No GRC violations detected';
			panel.appendChild(empty);
			return;
		}

		// Group by file
		const byFile = new Map<string, typeof allMarkers>();
		for (const m of allMarkers) {
			const key = m.resource.path;
			if (!byFile.has(key)) { byFile.set(key, []); }
			byFile.get(key)!.push(m);
		}

		for (const [filePath, markers] of byFile) {
			const group = document.createElement('div');
			group.className = 'grc-file-group';
			panel.appendChild(group);

			const fileName = filePath.split('/').pop() || filePath;
			const fileHeader = document.createElement('div');
			fileHeader.className = 'grc-file-header';
			fileHeader.textContent = `${fileName} (${markers.length})`;
			group.appendChild(fileHeader);

			const issuesDiv = document.createElement('div');
			group.appendChild(issuesDiv);

			fileHeader.addEventListener('click', () => {
				issuesDiv.style.display = issuesDiv.style.display === 'none' ? 'block' : 'none';
			});

			for (const m of markers) {
				const sevClass = m.severity === MarkerSeverity.Error ? 'grc-issue-err' : m.severity === MarkerSeverity.Warning ? 'grc-issue-warn' : 'grc-issue-info';
				const sevColor = m.severity === MarkerSeverity.Error ? '#ff5252' : m.severity === MarkerSeverity.Warning ? '#ff9800' : '#64b5f6';
				const issue = document.createElement('div');
				issue.className = `grc-issue ${sevClass}`;
				issue.innerHTML = `
					<span class="grc-issue-sev" style="color:${sevColor}">${this._esc(String(m.code || ''))}</span>
					<span class="grc-issue-msg">${this._esc(m.message)}<br><span class="grc-issue-file">${this._esc(fileName)}:${m.startLineNumber}</span></span>
				`;
				issuesDiv.appendChild(issue);
			}
		}
	}

	private _esc(t: string): string {
		return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
