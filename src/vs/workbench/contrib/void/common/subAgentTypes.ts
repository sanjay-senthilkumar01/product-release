/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Sub-Agent Types — Types for parallel sub-agent orchestration.
 *--------------------------------------------------------------------------------------*/

import { BuiltinToolName } from './toolsServiceTypes.js';

// ======================== Sub-Agent Roles ========================

export type SubAgentRole = 'explorer' | 'editor' | 'verifier';

/**
 * Tool access scopes per sub-agent role.
 * - explorer: read-only tools (cannot edit files or run commands)
 * - editor: read + edit tools (scoped to specific files)
 * - verifier: read + terminal tools (run tests/lint, report results)
 */
export const toolScopeOfRole: Record<SubAgentRole, readonly BuiltinToolName[]> = {
	explorer: [
		'read_file',
		'ls_dir',
		'get_dir_tree',
		'search_pathnames_only',
		'search_for_files',
		'search_in_file',
		'read_lint_errors',
		'update_agent_status',
		'generate_document',
	],
	editor: [
		'read_file',
		'ls_dir',
		'get_dir_tree',
		'search_pathnames_only',
		'search_for_files',
		'search_in_file',
		'read_lint_errors',
		'edit_file',
		'rewrite_file',
		'multi_replace_file_content',
		'create_file_or_folder',
		'update_agent_status',
		'generate_document',
	],
	verifier: [
		'read_file',
		'ls_dir',
		'get_dir_tree',
		'search_pathnames_only',
		'search_for_files',
		'search_in_file',
		'read_lint_errors',
		'read_terminal',
		'run_command',
		'run_persistent_command',
		'open_persistent_terminal',
		'send_command_input',
		'kill_persistent_terminal',
		'update_agent_status',
		'generate_document',
	],
} as const;


// ======================== Sub-Agent Instance ========================

export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubAgentTask {
	id: string;
	parentTaskId: string;
	role: SubAgentRole;
	goal: string;
	status: SubAgentStatus;
	threadId: string; // dedicated chat thread for this sub-agent
	result?: string;
	error?: string;
	createdAt: string;
	completedAt?: string;

	/** Files this sub-agent is scoped to (editor role) */
	scopedFiles?: string[];
}


// ======================== Sub-Agent Orchestration ========================

export const MAX_CONCURRENT_SUB_AGENTS = 3;

export interface SubAgentSpawnRequest {
	role: SubAgentRole;
	goal: string;
	/** Optional: scope editor sub-agents to specific files */
	scopedFiles?: string[];
}
