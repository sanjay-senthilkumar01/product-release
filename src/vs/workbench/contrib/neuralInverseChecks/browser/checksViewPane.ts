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
import { ProjectAnalyzer } from './nanoAgents/projectAnalyzer.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';

export class ChecksViewPane extends ViewPane {

	public static readonly ID = 'workbench.view.checks.pane';
	private projectAnalyzer: ProjectAnalyzer;
	private lastCheckpointLabel: HTMLElement | undefined;

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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this.projectAnalyzer = this.instantiationService.createInstance(ProjectAnalyzer);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.padding = '20px';
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.alignItems = 'flex-start';
		container.style.gap = '15px';

		// Header / Description
		const headerContainer = document.createElement('div');
		headerContainer.style.display = 'flex';
		headerContainer.style.flexDirection = 'column';
		headerContainer.style.gap = '5px';
		container.appendChild(headerContainer);

		const title = document.createElement('h3');
		title.textContent = 'Project Security & Integrity';
		title.style.margin = '0';
		title.style.fontSize = '1.1em';
		title.style.fontWeight = '500';
		title.style.color = 'var(--vscode-foreground)';
		headerContainer.appendChild(title);

		const description = document.createElement('div');
		description.textContent = 'Create a secure checkpoint to analyze your project structure, dependencies, and code patterns for security insights.';
		description.style.color = 'var(--vscode-descriptionForeground)';
		description.style.lineHeight = '1.4';
		description.style.fontSize = '12px';
		headerContainer.appendChild(description);

		// Action Area
		const actionContainer = document.createElement('div');
		actionContainer.style.display = 'flex';
		actionContainer.style.flexDirection = 'column';
		actionContainer.style.gap = '10px';
		actionContainer.style.width = '100%';
		actionContainer.style.maxWidth = '400px';
		container.appendChild(actionContainer);

		const button = new Button(actionContainer, {
			title: 'Run full analysis and create an encrypted checkpoint',
			secondary: false,
			...defaultButtonStyles
		});
		button.label = 'Run Analysis & Create Checkpoint';

		// Status / Timestamp
		this.lastCheckpointLabel = document.createElement('div');
		this.lastCheckpointLabel.style.fontSize = '11px';
		this.lastCheckpointLabel.style.color = 'var(--vscode-descriptionForeground)';
		this.lastCheckpointLabel.style.display = 'flex';
		this.lastCheckpointLabel.style.alignItems = 'center';
		this.lastCheckpointLabel.style.gap = '5px';
		this.lastCheckpointLabel.textContent = 'Last checkpoint: Checking...';
		actionContainer.appendChild(this.lastCheckpointLabel);

		this._register(button.onDidClick(async () => {
			button.enabled = false;
			const originalLabel = button.label;
			button.label = '$(loading~spin) Analyzing Project...';

			try {
				await this.projectAnalyzer.analyzeProject();
				await this.projectAnalyzer.createCheckpoint();
				await this.updateLastCheckpointTime(); // Update time after success
			} catch (error) {
				console.error('Analysis failed', error);
			} finally {
				button.enabled = true;
				button.label = originalLabel;
			}
		}));

		// Initial fetch
		this.updateLastCheckpointTime();
	}

	private async updateLastCheckpointTime(): Promise<void> {
		if (!this.lastCheckpointLabel) return;

		try {
			const checkpoints = await this.projectAnalyzer.historyService.getCheckpoints();
			if (checkpoints.length > 0) {
				const latest = checkpoints[0];
				const date = new Date(latest.date);
				this.lastCheckpointLabel.innerHTML = `$(check) Last checkpoint: <span style="color: var(--vscode-textLink-foreground);">${date.toLocaleString()}</span>`;
			} else {
				this.lastCheckpointLabel.textContent = 'Last checkpoint: Never';
			}
		} catch (e) {
			this.lastCheckpointLabel.textContent = 'Last checkpoint: Unknown';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		// Dynamic layout adjustments if needed
	}
}
