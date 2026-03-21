/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VoidDiscoveryToolsContrib
 *
 * Workbench contribution that registers discovery and modernisation tools with
 * the VoidInternalToolService at startup, making them available to:
 *   - Void agent (agent mode)
 *   - Void copilot / validate modes
 *
 * Uses the same tool factories as PowerMode so there is no logic duplication —
 * only a thin adapter that converts IPowerTool → IVoidInternalTool.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IVoidInternalToolService, IVoidInternalTool } from '../../void/browser/voidInternalToolService.js';
import { IDiscoveryService } from './engine/discovery/discoveryService.js';
import { IMigrationPlannerService } from './engine/migrationPlannerService.js';
import { IModernisationSessionService } from './modernisationSessionService.js';
import { buildDiscoveryTools } from '../../powerMode/browser/tools/discoveryTools.js';
import { buildModernisationPowerTools } from '../../powerMode/browser/tools/modernisationTools.js';
import { IPowerTool, IToolContext } from '../../powerMode/common/powerModeTypes.js';


// ─── IPowerTool → IVoidInternalTool adapter ───────────────────────────────────

const _dummyCtx: IToolContext = {
	sessionId: 'void-internal',
	messageId: 'void-internal',
	agentId:   'void-internal',
	abort:     new AbortController().signal,
	metadata:  () => {},
};

function _adapt(tool: IPowerTool): IVoidInternalTool {
	const params: Record<string, { description: string }> = {};
	for (const p of tool.parameters) {
		params[p.name] = { description: p.description };
	}
	return {
		name:        tool.id,
		description: tool.description,
		params,
		async execute(args) {
			const result = await tool.execute(args, _dummyCtx);
			return result.output;
		},
	};
}


// ─── Contribution ─────────────────────────────────────────────────────────────

export class VoidDiscoveryToolsContrib extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.neuralInverseModernisation.voidDiscoveryTools';

	constructor(
		@IVoidInternalToolService internalToolService: IVoidInternalToolService,
		@IDiscoveryService        discoveryService: IDiscoveryService,
		@IMigrationPlannerService plannerService: IMigrationPlannerService,
		@IModernisationSessionService sessionService: IModernisationSessionService,
	) {
		super();

		// Standalone discovery tools (useful for any codebase)
		const discoveryTools = buildDiscoveryTools(discoveryService).map(_adapt);

		// Migration-specific tools (session context + planning)
		const modernisationTools = buildModernisationPowerTools(
			discoveryService, plannerService, sessionService,
		).map(_adapt);

		internalToolService.registerMany([...discoveryTools, ...modernisationTools]);
	}
}

registerWorkbenchContribution2(VoidDiscoveryToolsContrib.ID, VoidDiscoveryToolsContrib, WorkbenchPhase.AfterRestored);
