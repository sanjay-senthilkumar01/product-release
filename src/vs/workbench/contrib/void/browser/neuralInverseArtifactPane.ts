/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import * as nls from '../../../../nls.js';
import { EditorExtensions, DEFAULT_EDITOR_ASSOCIATION } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { URI } from '../../../../base/common/uri.js';

import { mountNeuralInverseArtifact } from './react/out/neural-inverse-artifact-tsx/index.js'
import { Codicon } from '../../../../base/common/codicons.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';

export class NeuralInverseArtifactInput extends EditorInput {

	static readonly ID: string = 'workbench.input.neuralinverse.artifact';

	constructor(public readonly resource: URI) {
		super();
	}

	override get typeId(): string {
		return NeuralInverseArtifactInput.ID;
	}

	override getName(): string {
		return nls.localize('neuralInverseArtifactInputsName', `Artifact: ${this.resource.path.split('/').pop()}`);
	}

	override getIcon() {
		return Codicon.fileCode;
	}
}

export class NeuralInverseArtifactPane extends EditorPane {
	static readonly ID = 'workbench.editor.neuralinverse.artifactPane';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(NeuralInverseArtifactPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';

		const artifactElt = document.createElement('div');
		artifactElt.style.height = '100%';
		artifactElt.style.width = '100%';

		parent.appendChild(artifactElt);

		// Mount React into the content
		this.instantiationService.invokeFunction(accessor => {
			const uri = (this.input as NeuralInverseArtifactInput)?.resource;
			const disposeFn = mountNeuralInverseArtifact(artifactElt, accessor, { uri })?.dispose;
			this._register(toDisposable(() => disposeFn?.()))
		});
	}

	layout(dimension: Dimension): void {
		// No specific layout handling needed for React wrapper
	}

	override get minimumWidth() { return 400 }
}

// Register Artifact pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(NeuralInverseArtifactPane, NeuralInverseArtifactPane.ID, nls.localize('NeuralInverseArtifactPane', "NeuralInverse Artifact Pane")),
	[new SyncDescriptor(NeuralInverseArtifactInput)]
);

class NeuralInverseArtifactEditorContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.neuralinverse.artifact.editor';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		editorResolverService.registerEditor(
			'**/.neural-inverse/artifacts/*.md',
			{
				id: NeuralInverseArtifactInput.ID,
				label: nls.localize('neuralInverseArtifact.displayName', "NeuralInverse Artifact Viewer"),
				detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
				priority: RegisteredEditorPriority.default,
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.path.includes('.neural-inverse/artifacts/') && resource.path.endsWith('.md')
			},
			{
				createEditorInput: ({ resource }) => {
					return { editor: instantiationService.createInstance(NeuralInverseArtifactInput, resource) };
				}
			}
		);
	}
}

registerWorkbenchContribution2(NeuralInverseArtifactEditorContribution.ID, NeuralInverseArtifactEditorContribution, WorkbenchPhase.BlockStartup);

