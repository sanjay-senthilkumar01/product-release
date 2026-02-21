/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../../services/statusbar/browser/statusbar.js';
import { IGRCEnvironmentService, GRCMode } from '../gatekeeper/grcEnvironmentService.js';
import { ExtensionHostExtensions, IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';

export class GRCStatusContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.grcStatus';

	private readonly _entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IGRCEnvironmentService private readonly grcEnv: IGRCEnvironmentService,
	) {
		super();
		this._updateStatus(this.grcEnv.mode);
		this._register(this.grcEnv.onDidChangeMode(mode => this._updateStatus(mode)));
	}

	private _updateStatus(mode: GRCMode): void {
		let text = '', tooltip = '';

		switch (mode) {
			case 'draft':
				text = '$(beaker) Draft';
				tooltip = 'GRC Mode: Draft (No Blocking, Full AI Access)';
				break;
			case 'dev':
				text = '$(tools) Dev';
				tooltip = 'GRC Mode: Dev (Blocks Critical Security Risks)';
				break;
			case 'prod':
				text = '$(shield) Prod';
				tooltip = 'GRC Mode: Prod (Zero Trust, Strict Blocking)';
				break;
		}

		this._entry.value = this.statusbarService.addEntry({
			name: 'Neural Inverse GRC Mode',
			text: text,
			ariaLabel: tooltip,
			tooltip: tooltip,
			command: 'neuralInverse.setGRCMode',
			kind: 'standard',
		}, 'neuralInverse.grcStatus', StatusbarAlignment.RIGHT, 100);
	}
}

// Register Action to Change Mode
registerAction2(class SetGRCModeAction extends Action2 {
	constructor() {
		super({
			id: 'neuralInverse.setGRCMode',
			title: localize2('neuralInverse.setGRCMode', 'Neural Inverse: Set Environment Mode'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const grcEnv = accessor.get(IGRCEnvironmentService);

		const items: IQuickPickItem[] = [
			{
				label: '$(beaker) Draft Mode',
				description: 'Chaos Sandbox',
				detail: 'No blocking. AI unrestricted. For rapid prototyping.',
				id: 'draft'
			},
			{
				label: '$(tools) Dev Mode',
				description: 'Standard Workflow',
				detail: 'Blocks critical security risks. Standard tooling.',
				id: 'dev'
			},
			{
				label: '$(shield) Prod Mode',
				description: 'Zero Trust',
				detail: 'Strict blocking on all errors. AI restricted.',
				id: 'prod'
			}
		];

		const activeMode = grcEnv.mode;
		const activeItem = items.find(i => i.id === activeMode);

		const picked = await quickInputService.pick(items, {
			placeHolder: 'Select Neural Inverse GRC Environment Mode',
			activeItem: activeItem
		});

		if (picked && picked.id) {
			grcEnv.setMode(picked.id as GRCMode);
		}
	}
});
