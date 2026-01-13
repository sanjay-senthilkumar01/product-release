/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
		container.style.gap = '10px';

		const description = document.createElement('div');
		description.textContent = 'Create a secure checkpoint of your current project state for analysis.';
		description.style.marginBottom = '10px';
		description.style.color = 'var(--vscode-descriptionForeground)';
		container.appendChild(description);

		const buttonContainer = document.createElement('div');
		container.appendChild(buttonContainer);

		const button = new Button(buttonContainer, {
			title: 'Analyze Project & Create Checkpoint',
			secondary: false,
			...defaultButtonStyles
		});
		button.label = 'Create Checkpoint';

		this._register(button.onDidClick(async () => {
			button.enabled = false;
			button.label = 'Running Analysis...';
			try {
				await this.projectAnalyzer.analyzeProject();
				await this.projectAnalyzer.createCheckpoint();
			} catch (error) {
				console.error('Analysis failed', error);
			} finally {
				button.enabled = true;
				button.label = 'Create Checkpoint';
			}
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		// No specific layout needed for this simple view
	}
}
