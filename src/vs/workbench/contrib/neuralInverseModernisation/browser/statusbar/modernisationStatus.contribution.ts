/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ModernisationStatusContribution
 *
 * Shows a persistent statusbar item when a modernisation session is active:
 *
 *   $(combine) Modernising  [1/5 Discovery]
 *
 * Clickable — focuses the Compliance Center aux window.
 * Hidden when no session is active.
 */

import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../../services/statusbar/browser/statusbar.js';
import { IModernisationSessionService, IModernisationSessionData, STAGE_LABELS } from '../modernisationSessionService.js';

export class ModernisationStatusContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.modernisationStatus';

	private readonly _entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IModernisationSessionService sessionService: IModernisationSessionService,
	) {
		super();
		this._update(sessionService.session);
		this._register(sessionService.onDidChangeSession(s => this._update(s)));
	}

	private _update(session: IModernisationSessionData): void {
		if (!session.isActive) {
			this._entry.value = undefined;
			return;
		}

		const stageLabel  = STAGE_LABELS[session.currentStage];
		const sourceNames = session.sources.map(s => s.label || this._basename(s.folderUri)).join(', ') || '?';
		const targetNames = session.targets.map(t => t.label || this._basename(t.folderUri)).join(', ') || '?';

		this._entry.value = this.statusbarService.addEntry({
			name: 'NeuralInverse Modernisation',
			text: `$(combine) Modernising  \u00b7  ${stageLabel}`,
			ariaLabel: `Modernisation active: ${sourceNames} → ${targetNames}, stage: ${stageLabel}`,
			tooltip: `NeuralInverse Modernisation Mode\nSources: ${sourceNames}\nTargets: ${targetNames}\nStage: ${stageLabel}\n\nClick to open Compliance Center`,
			command: 'neuralInverse.focusModernisationComplianceCenter',
			kind: 'prominent',
		}, 'neuralInverse.modernisationStatus', StatusbarAlignment.LEFT, 999);
	}

	private _basename(uri: string): string {
		return uri.split(/[/\\]/).filter(Boolean).pop() ?? uri;
	}
}
