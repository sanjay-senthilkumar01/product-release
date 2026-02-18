/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # GRC Diagnostics Contribution
 *
 * Bridges the GRC engine to the editor's marker system for real-time
 * inline diagnostics (squiggly underlines).
 *
 * ## How It Works
 *
 * 1. Listens for editor changes (active editor switch + content changes)
 * 2. Debounces evaluation to avoid thrashing on rapid typing
 * 3. Calls `grcEngine.evaluateDocument()` which runs all enabled rules
 * 4. Converts `ICheckResult[]` to `IMarkerData[]` for the marker service
 * 5. Markers appear as squiggly underlines in the editor
 *
 * ## Severity Mapping
 *
 * Framework rules may use custom severities (e.g. "blocker", "critical").
 * These are mapped to VS Code's marker severity via `toDisplaySeverity()`:
 * - error/blocker/critical → red squiggly
 * - warning/major → yellow squiggly
 * - info/minor → blue hint
 *
 * ## Framework Attribution
 *
 * When violations come from an imported framework, the marker source
 * includes the framework name for traceability.
 */

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IMarkerService, IMarkerData, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { IGRCEngineService } from '../engine/services/grcEngineService.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { toDisplaySeverity } from '../engine/types/grcTypes.js';
import { isCodeEditor } from '../../../../../editor/browser/editorBrowser.js';

const GRC_MARKER_OWNER = 'neuralInverse.grc';
const DEBOUNCE_MS = 800;

export class GRCDiagnosticsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.grcDiagnostics';

	private _debounceTimer: any;
	private _modelListeners = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IGRCEngineService private readonly grcEngine: IGRCEngineService
	) {
		super();

		this._register(this.editorService.onDidActiveEditorChange(() => {
			this._onEditorChange();
		}));

		this._register(this.grcEngine.onDidRulesChange(() => {
			this._runCheck();
		}));

		this._onEditorChange();
	}

	private _onEditorChange(): void {
		this._modelListeners.clear();

		const model = this._getActiveModel();
		if (!model) { return; }

		this._modelListeners.add(model.onDidChangeContent(() => {
			this._scheduleCheck();
		}));

		this._runCheck();
	}

	private _scheduleCheck(): void {
		if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
		this._debounceTimer = setTimeout(() => this._runCheck(), DEBOUNCE_MS);
	}

	private _runCheck(): void {
		const model = this._getActiveModel();
		if (!model) { return; }

		// Evaluate → caches in engine + fires onDidCheckComplete (for Checks panel)
		const results = this.grcEngine.evaluateDocument(model);

		// Convert to markers for inline editor diagnostics
		const markers: IMarkerData[] = results.map(r => {
			// Build message with references if available
			let message = r.message;
			if (r.fix) {
				message += `\nFix: ${r.fix}`;
			}
			if (r.references && r.references.length > 0) {
				message += `\nRef: ${r.references.join(', ')}`;
			}

			return {
				severity: this._toMarkerSeverity(r.severity),
				message,
				startLineNumber: r.line,
				startColumn: r.column,
				endLineNumber: r.endLine,
				endColumn: r.endColumn,
				source: r.frameworkId
					? `Neural Inverse GRC [${r.frameworkId}]`
					: 'Neural Inverse GRC',
				code: r.ruleId
			};
		});

		this.markerService.changeOne(GRC_MARKER_OWNER, model.uri, markers);
	}

	/**
	 * Maps a severity string (which may be a custom framework severity)
	 * to VS Code's MarkerSeverity enum.
	 *
	 * Uses `toDisplaySeverity()` to normalize custom severities first.
	 */
	private _toMarkerSeverity(severity: string): MarkerSeverity {
		const displaySeverity = toDisplaySeverity(severity);
		switch (displaySeverity) {
			case 'error': return MarkerSeverity.Error;
			case 'warning': return MarkerSeverity.Warning;
			case 'info': return MarkerSeverity.Info;
		}
	}

	private _getActiveModel(): ITextModel | undefined {
		const editor = this.editorService.activeTextEditorControl;
		if (editor && isCodeEditor(editor)) {
			return editor.getModel() ?? undefined;
		}
		return undefined;
	}

	override dispose(): void {
		if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
		super.dispose();
	}
}
