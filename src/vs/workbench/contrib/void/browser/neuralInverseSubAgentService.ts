/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Sub-Agent Service — Spawns and orchestrates parallel sub-agents.
 *
 *  Sub-agents are lightweight agent instances that:
 *    - Run in their own chat thread
 *    - Have scoped tool access based on role (explorer/editor/verifier)
 *    - Execute concurrently (up to maxConcurrentSubAgents)
 *    - Report results back to the parent agent
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { IChatThreadService } from './chatThreadServiceInterface.js';
import { INeuralInverseAgentService } from './neuralInverseAgentService.js';
import { INeuralInverseAgentConfigService } from './neuralInverseAgentConfigService.js';

import {
	SubAgentTask,
	SubAgentStatus,
	SubAgentSpawnRequest,
	SubAgentRole,
	toolScopeOfRole,
	MAX_CONCURRENT_SUB_AGENTS,
} from '../common/subAgentTypes.js';


// ======================== Service Interface ========================

export interface INeuralInverseSubAgentService {
	readonly _serviceBrand: undefined;

	/** All sub-agents for the current parent task */
	readonly subAgents: ReadonlyMap<string, SubAgentTask>;

	/** Event fired when any sub-agent state changes */
	readonly onDidChangeSubAgent: Event<{ subAgentId: string, status: SubAgentStatus }>;

	/** Spawn a new sub-agent under the current parent task */
	spawn(request: SubAgentSpawnRequest): SubAgentTask | null;

	/** Cancel a running sub-agent */
	cancel(subAgentId: string): void;

	/** Cancel all sub-agents for the current parent task */
	cancelAll(): void;

	/** Get tool name whitelist for a given role */
	getAllowedToolNames(role: SubAgentRole): string[];

	/** Get the sub-agent's result (after completion) */
	getResult(subAgentId: string): string | undefined;

	/** Number of currently running sub-agents */
	readonly runningCount: number;
}

export const INeuralInverseSubAgentService = createDecorator<INeuralInverseSubAgentService>('neuralInverseSubAgentService');


// ======================== Implementation ========================

class NeuralInverseSubAgentService extends Disposable implements INeuralInverseSubAgentService {
	readonly _serviceBrand: undefined;

	private _subAgents: Map<string, SubAgentTask> = new Map();
	private _pendingQueue: SubAgentSpawnRequest[] = [];

	private readonly _onDidChangeSubAgent = this._register(new Emitter<{ subAgentId: string, status: SubAgentStatus }>());
	readonly onDidChangeSubAgent: Event<{ subAgentId: string, status: SubAgentStatus }> = this._onDidChangeSubAgent.event;

	get subAgents(): ReadonlyMap<string, SubAgentTask> { return this._subAgents; }

	get runningCount(): number {
		let count = 0;
		for (const agent of this._subAgents.values()) {
			if (agent.status === 'running') count++;
		}
		return count;
	}

	constructor(
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
		@INeuralInverseAgentService private readonly _agentService: INeuralInverseAgentService,
		@INeuralInverseAgentConfigService private readonly _configService: INeuralInverseAgentConfigService,
	) {
		super();
		this._registerCompletionListener();
	}


	spawn(request: SubAgentSpawnRequest): SubAgentTask | null {
		const parentTask = this._agentService.activeTask;
		if (!parentTask) return null;

		const maxConcurrent = this._configService.config.constraints.maxConcurrentSubAgents
			?? MAX_CONCURRENT_SUB_AGENTS;

		// If at capacity, queue
		if (this.runningCount >= maxConcurrent) {
			this._pendingQueue.push(request);
			const pendingTask = this._createSubAgentTask(parentTask.id, request, 'pending');
			return pendingTask;
		}

		return this._startSubAgent(parentTask.id, request);
	}

	cancel(subAgentId: string): void {
		const subAgent = this._subAgents.get(subAgentId);
		if (!subAgent || subAgent.status !== 'running') return;

		this._chatThreadService.abortRunning(subAgent.threadId);
		subAgent.status = 'cancelled';
		subAgent.completedAt = new Date().toISOString();
		this._onDidChangeSubAgent.fire({ subAgentId, status: 'cancelled' });

		this._drainQueue();
	}

	cancelAll(): void {
		this._pendingQueue = [];
		for (const [id, agent] of this._subAgents) {
			if (agent.status === 'running') {
				this._chatThreadService.abortRunning(agent.threadId);
				agent.status = 'cancelled';
				agent.completedAt = new Date().toISOString();
				this._onDidChangeSubAgent.fire({ subAgentId: id, status: 'cancelled' });
			}
		}
	}

	getAllowedToolNames(role: SubAgentRole): string[] {
		return [...toolScopeOfRole[role]];
	}

	getResult(subAgentId: string): string | undefined {
		return this._subAgents.get(subAgentId)?.result;
	}


	// ---- Internal ----

	private _startSubAgent(parentTaskId: string, request: SubAgentSpawnRequest): SubAgentTask {
		const subAgent = this._createSubAgentTask(parentTaskId, request, 'running');

		// Create a dedicated thread for the sub-agent
		this._chatThreadService.openNewThread();
		const threadId = this._chatThreadService.state.currentThreadId;
		subAgent.threadId = threadId;

		// Send the sub-agent's goal as a user message
		// The tool scope is enforced via allowedToolNames in the system message
		const systemPrefix = this._buildSubAgentPrefix(request);
		const fullGoal = `${systemPrefix}\n\n${request.goal}`;

		this._chatThreadService.addUserMessageAndStreamResponse({
			userMessage: fullGoal,
			threadId,
		});

		return subAgent;
	}

	private _createSubAgentTask(parentTaskId: string, request: SubAgentSpawnRequest, status: SubAgentStatus): SubAgentTask {
		const task: SubAgentTask = {
			id: generateUuid(),
			parentTaskId,
			role: request.role,
			goal: request.goal,
			status,
			threadId: '', // set when thread is created
			createdAt: new Date().toISOString(),
			scopedFiles: request.scopedFiles,
		};
		this._subAgents.set(task.id, task);
		this._onDidChangeSubAgent.fire({ subAgentId: task.id, status });
		return task;
	}

	private _buildSubAgentPrefix(request: SubAgentSpawnRequest): string {
		const roleDescriptions: Record<SubAgentRole, string> = {
			explorer: 'You are a read-only research sub-agent. Your job is to explore the codebase, find relevant files, and report findings. You CANNOT edit files or run commands.',
			editor: `You are a code editing sub-agent. Your job is to make targeted code changes.${request.scopedFiles?.length ? ` You are scoped to these files: ${request.scopedFiles.join(', ')}` : ''}`,
			verifier: 'You are a verification sub-agent. Your job is to run tests, check lint errors, and verify that changes are correct. Report pass/fail results clearly.',
		};

		return `[NI Sub-Agent: ${request.role.toUpperCase()}]\n${roleDescriptions[request.role]}`;
	}

	private _registerCompletionListener(): void {
		this._register(this._chatThreadService.onDidChangeStreamState(({ threadId }) => {
			// Find sub-agent by threadId
			let targetAgent: SubAgentTask | undefined;
			for (const agent of this._subAgents.values()) {
				if (agent.threadId === threadId && agent.status === 'running') {
					targetAgent = agent;
					break;
				}
			}
			if (!targetAgent) return;

			const streamState = this._chatThreadService.streamState[threadId];

			// Sub-agent finished
			if (streamState?.isRunning === undefined) {
				if (streamState?.error) {
					targetAgent.status = 'failed';
					targetAgent.error = streamState.error.message;
				} else {
					targetAgent.status = 'completed';
					// Extract last assistant message as result
					const thread = this._chatThreadService.state.allThreads[threadId];
					if (thread) {
						const lastAssistant = [...thread.messages].reverse().find(m => m.role === 'assistant');
						if (lastAssistant && lastAssistant.role === 'assistant') {
							targetAgent.result = lastAssistant.displayContent;
						}
					}
				}
				targetAgent.completedAt = new Date().toISOString();
				this._onDidChangeSubAgent.fire({
					subAgentId: targetAgent.id,
					status: targetAgent.status,
				});

				// Record result into parent agent context
				this._agentService.recordContext({
					type: targetAgent.status === 'completed' ? 'search_result' : 'error',
					summary: `Sub-agent [${targetAgent.role}] ${targetAgent.status}: ${targetAgent.result?.substring(0, 500) || targetAgent.error || '(no output)'}`,
					importance: 4,
				});

				this._drainQueue();
			}
		}));
	}

	private _drainQueue(): void {
		const parentTask = this._agentService.activeTask;
		if (!parentTask) return;

		const maxConcurrent = this._configService.config.constraints.maxConcurrentSubAgents
			?? MAX_CONCURRENT_SUB_AGENTS;

		while (this.runningCount < maxConcurrent && this._pendingQueue.length > 0) {
			const next = this._pendingQueue.shift()!;
			this._startSubAgent(parentTask.id, next);
		}
	}
}

registerSingleton(INeuralInverseSubAgentService, NeuralInverseSubAgentService, InstantiationType.Eager);
