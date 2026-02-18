/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from '../../../../../common/contributions.js';
import { IGRCEngineService } from '../services/grcEngineService.js';
import { AstAnalyzer } from './astAnalyzer.js';
import { ExternalCheckRunner } from '../services/externalCheckRunner.js';
import { DataFlowAnalyzer } from './dataFlowAnalyzer.js';
import { ImportGraphAnalyzer } from './importGraphAnalyzer.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';

/**
 * Registers default analyzers with the GRC engine.
 *
 * This contribution runs on startup and plugs the core analyzers
 * (AST, External, Data Flow, Import Graph) into the engine service.
 */
export class GRCAnalyzerRegistration implements IWorkbenchContribution {

	constructor(
		@IGRCEngineService grcEngine: IGRCEngineService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService
	) {
		// Register AST Analyzer (for type: "ast" rules)
		grcEngine.registerAnalyzer(new AstAnalyzer());

		// Register External Check Runner (for type: "external" rules)
		grcEngine.registerAnalyzer(new ExternalCheckRunner());

		// Register Data Flow Analyzer (for type: "dataflow" rules)
		grcEngine.registerAnalyzer(new DataFlowAnalyzer());

		// Register Import Graph Analyzer (for type: "import-graph" rules)
		grcEngine.registerAnalyzer(new ImportGraphAnalyzer(workspaceContextService));

		console.log('[GRCAnalyzerRegistration] Registered core analyzers (AST, External, DataFlow, ImportGraph)');
	}
}
