/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { ILLMMessageService } from '../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService, ModelOption } from '../../void/common/voidSettingsService.js';
import { ModelSelection } from '../../void/common/voidSettingsTypes.js';
import { IExternalCommandExecutor } from '../../neuralInverseChecks/browser/engine/services/externalCommandExecutor.js';
import {
	IPowerSession,
	IPowerMessage,
	IPowerMessagePart,
	IPowerAgent,
	PowerModeUIEvent,
	ToolPermissionDecision,
} from '../common/powerModeTypes.js';
import { runAgentLoop, IProcessorCallbacks, ILLMRequest } from './session/powerModeProcessor.js';
import { PowerModeLLMBridge } from './session/powerModeLLMBridge.js';
import { PowerToolRegistry } from './tools/powerToolRegistry.js';
import { buildSystemPrompt } from './session/systemPrompt.js';
import { PowerModeContextBuilder } from './session/powerModeContextBuilder.js';
import {
	createBrowserBashTool,
	createBrowserReadTool,
	createBrowserWriteTool,
	createBrowserEditTool,
	createBrowserGlobTool,
	createBrowserGrepTool,
	createBrowserListTool,
} from './tools/browserTools.js';
import { IPowerBusService } from './powerBusService.js';
import type { IRegisteredAgent, IAgentBusMessage } from '../common/powerBusTypes.js';

// ─── Service Interface ────────────────────────────────────────────────────────

export const IPowerModeService = createDecorator<IPowerModeService>('powerModeService');

export interface IPowerModeService {
	readonly _serviceBrand: undefined;

	/** All tracked sessions */
	readonly sessions: readonly IPowerSession[];

	/** The currently active session (shown in UI) */
	readonly activeSession: IPowerSession | undefined;

	/** Fires when any session state changes */
	readonly onDidChangeSession: Event<IPowerSession>;

	/** Fires for real-time part updates (streaming text, tool progress) */
	readonly onDidUpdatePart: Event<{ sessionId: string; messageId: string; part: IPowerMessagePart }>;

	/** Fires for text deltas (streaming) */
	readonly onDidEmitDelta: Event<{ sessionId: string; messageId: string; partId: string; field: string; delta: string }>;

	/** Fires for UI events (aggregated for webview) */
	readonly onDidEmitUIEvent: Event<PowerModeUIEvent>;

	// ─── Session Management ──────────────────────────────────────────────

	createSession(agentId?: string): IPowerSession;
	switchSession(sessionId: string): void;
	deleteSession(sessionId: string): void;
	getSession(sessionId: string): IPowerSession | undefined;

	// ─── Execution ──────────────────────────────────────────────────────

	/** Send a user message and start the agent loop */
	sendMessage(sessionId: string, text: string): Promise<void>;

	/** Cancel the active run in a session */
	cancel(sessionId: string): void;

	/** Resolve a pending tool permission request from the terminal */
	resolvePermission(requestId: string, decision: ToolPermissionDecision): void;

	// ─── Agents ─────────────────────────────────────────────────────────

	getAgents(): IPowerAgent[];

	// ─── Model ───────────────────────────────────────────────────────────

	/** Get current Power Mode model (own selection or falls back to Chat) */
	getModelInfo(): { provider: string; model: string } | undefined;

	/** Get full ModelSelection for use with the LLM bridge */
	getModelSelection(): ModelSelection | null;

	/** Get all available models the user has configured */
	getAvailableModels(): ModelOption[];

	/** Set Power Mode's own model selection */
	setModel(selection: ModelSelection): void;

	/** Clear all messages in a session */
	clearSession(sessionId: string): void;

	// ─── Bus ─────────────────────────────────────────────────────────────

	/** All agents currently registered on the PowerBus */
	getAgentsOnBus(): IRegisteredAgent[];

	/** Recent PowerBus message history */
	getBusHistory(limit?: number): IAgentBusMessage[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'powerMode.sessions';

export class PowerModeService extends Disposable implements IPowerModeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<IPowerSession>());
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private readonly _onDidUpdatePart = this._register(new Emitter<{ sessionId: string; messageId: string; part: IPowerMessagePart }>());
	readonly onDidUpdatePart = this._onDidUpdatePart.event;

	private readonly _onDidEmitDelta = this._register(new Emitter<{ sessionId: string; messageId: string; partId: string; field: string; delta: string }>());
	readonly onDidEmitDelta = this._onDidEmitDelta.event;

	private readonly _onDidEmitUIEvent = this._register(new Emitter<PowerModeUIEvent>());
	readonly onDidEmitUIEvent = this._onDidEmitUIEvent.event;

	private readonly _sessions = new Map<string, IPowerSession>();
	private _activeSessionId: string | undefined;

	/** Active abort controllers per session */
	private readonly _abortControllers = new Map<string, AbortController>();

	/** Pending tool permission requests: requestId → resolver */
	private readonly _pendingApprovals = new Map<string, (decision: ToolPermissionDecision) => void>();

	private _approvalCounter = 0;

	/** LLM bridge for processor */
	private readonly _llmBridge: PowerModeLLMBridge;

	/** Tool registries per working directory */
	private readonly _toolRegistries = new Map<string, PowerToolRegistry>();

	/** Workspace context builder (reads AGENTS.md, package.json, etc.) */
	private readonly _contextBuilder: PowerModeContextBuilder;

	/** Built-in agent definitions */
	private readonly _agents: IPowerAgent[] = [
		{
			id: 'build',
			name: 'Build',
			description: 'The default agent. Full access to tools for building and editing code.',
			mode: 'primary',
			maxSteps: 200,
			permissions: {
				tools: { '*': 'allow', bash: 'allow', write: 'allow', edit: 'allow' },
			},
		},
		{
			id: 'plan',
			name: 'Plan',
			description: 'Read-only agent for planning. Cannot modify files.',
			mode: 'primary',
			maxSteps: 50,
			permissions: {
				tools: { '*': 'allow', write: 'deny', edit: 'deny', bash: 'ask' },
			},
		},
	];

	private _idCounter = 0;

	/** Power Mode's own model selection — null means fall back to Chat selection */
	private _powerModeModelSelection: ModelSelection | null = null;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ISearchService private readonly searchService: ISearchService,
		@IExternalCommandExecutor private readonly commandExecutor: IExternalCommandExecutor,
		@ILLMMessageService llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IPowerBusService private readonly powerBusService: IPowerBusService,
	) {
		super();
		this._llmBridge = new PowerModeLLMBridge(llmMessageService, voidSettingsService);
		this._contextBuilder = new PowerModeContextBuilder(fileService);

		// ── PowerBus: register Power Mode as the central agent ──────────
		this.powerBusService.register('power-mode', ['receive:all', 'send:query', 'broadcast'], 'Power Mode');

		// Forward all bus messages to the terminal as UI events
		this._register(this.powerBusService.onMessage(msg => {
			this._onDidEmitUIEvent.fire({
				type: 'bus-message',
				from: msg.from,
				to: msg.to,
				messageType: msg.type,
				content: msg.content,
			});
		}));

		// Handle tool requests arriving from other agents on the bus
		this._register(this.powerBusService.onToolRequest(async (msg) => {
			if (!msg.toolName || !msg.toolArgs || !msg.toolDirectory) { return; }

			// Ask user permission — reuses the same permission gate as normal tool calls
			const requestId = `perm_${++this._approvalCounter}`;
			const preview = _buildToolPreview(msg.toolName, msg.toolArgs);

			const decision = await new Promise<ToolPermissionDecision>((resolve) => {
				this._pendingApprovals.set(requestId, resolve);
				this._onDidEmitUIEvent.fire({
					type: 'permission-request',
					request: {
						requestId,
						sessionId: msg.from, // use sender agent ID as context
						toolName: `[${msg.from}] ${msg.toolName}`,
						preview,
					},
				});
			});

			if (decision === 'deny') {
				this.powerBusService.resolveToolRequest(msg.id, 'Tool execution denied by user.', true);
				return;
			}

			// Execute via the tool registry for the requested directory
			try {
				const registry = this._getToolRegistry(msg.toolDirectory);
				const tool = registry.get(msg.toolName);
				if (!tool) {
					this.powerBusService.resolveToolRequest(msg.id, `Tool '${msg.toolName}' not found.`, true);
					return;
				}
				const result = await tool.execute(msg.toolArgs, {
					sessionId: msg.from,
					messageId: msg.id,
					agentId: msg.from,
					abort: new AbortController().signal,
					metadata: () => { /* no-op for bus-requested tools */ },
				});
				this.powerBusService.resolveToolRequest(msg.id, result.output);
			} catch (err: any) {
				this.powerBusService.resolveToolRequest(msg.id, String(err?.message ?? err), true);
			}
		}));

		this._restoreSessions();
	}

	// ─── Getters ─────────────────────────────────────────────────────────────

	get sessions(): readonly IPowerSession[] {
		return [...this._sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	get activeSession(): IPowerSession | undefined {
		return this._activeSessionId ? this._sessions.get(this._activeSessionId) : undefined;
	}

	// ─── Session Management ──────────────────────────────────────────────────

	createSession(agentId: string = 'build'): IPowerSession {
		const id = `ps_${Date.now()}_${++this._idCounter}`;
		const workspace = this.workspaceContext.getWorkspace();
		const directory = workspace.folders[0]?.uri.fsPath ?? '/';

		const session: IPowerSession = {
			id,
			title: 'New session',
			agentId,
			directory,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			status: 'idle',
			messages: [],
		};

		this._sessions.set(id, session);
		this._activeSessionId = id;
		this._persistSessions();

		this._onDidChangeSession.fire(session);
		this._onDidEmitUIEvent.fire({ type: 'session-created', session });
		return session;
	}

	switchSession(sessionId: string): void {
		if (!this._sessions.has(sessionId)) { return; }
		this._activeSessionId = sessionId;
		const session = this._sessions.get(sessionId)!;
		this._onDidChangeSession.fire(session);
	}

	deleteSession(sessionId: string): void {
		this.cancel(sessionId);
		this._sessions.delete(sessionId);
		if (this._activeSessionId === sessionId) {
			this._activeSessionId = this.sessions[0]?.id;
		}
		this._persistSessions();
	}

	getSession(sessionId: string): IPowerSession | undefined {
		return this._sessions.get(sessionId);
	}

	// ─── Tool Registry ───────────────────────────────────────────────────────

	private _getToolRegistry(directory: string): PowerToolRegistry {
		let registry = this._toolRegistries.get(directory);
		if (!registry) {
			registry = new PowerToolRegistry();
			registry.registerMany([
				createBrowserBashTool(directory, this.commandExecutor),
				createBrowserReadTool(directory, this.fileService),
				createBrowserWriteTool(directory, this.fileService),
				createBrowserEditTool(directory, this.fileService),
				createBrowserListTool(directory, this.fileService),
				createBrowserGlobTool(directory, this.searchService),
				createBrowserGrepTool(directory, this.searchService),
			]);
			this._toolRegistries.set(directory, registry);
		}
		return registry;
	}

	// ─── Execution ───────────────────────────────────────────────────────────

	async sendMessage(sessionId: string, text: string): Promise<void> {
		const session = this._sessions.get(sessionId);
		if (!session) { return; }
		if (session.status === 'busy') { return; }

		// Create user message
		const userMsg: IPowerMessage = {
			id: `msg_${Date.now()}_${++this._idCounter}`,
			sessionId,
			role: 'user',
			createdAt: Date.now(),
			parts: [{ type: 'text', id: `p_${++this._idCounter}`, text }],
		};

		// Auto-title session from first user message
		if (session.messages.length === 0 && session.title === 'New session') {
			(session as any).title = text.length > 60 ? text.substring(0, 60) + '…' : text;
			this._onDidChangeSession.fire(session);
		}

		session.messages.push(userMsg);
		session.status = 'busy';
		session.updatedAt = Date.now();

		this._onDidEmitUIEvent.fire({ type: 'message-created', message: userMsg });
		this._onDidEmitUIEvent.fire({ type: 'session-updated', sessionId, status: 'busy' });
		this._onDidChangeSession.fire(session);

		// Create abort controller for this run
		const abortController = new AbortController();
		this._abortControllers.set(sessionId, abortController);

		try {
			// Create assistant message
			const assistantMsg: IPowerMessage = {
				id: `msg_${Date.now()}_${++this._idCounter}`,
				sessionId,
				role: 'assistant',
				createdAt: Date.now(),
				agentId: session.agentId,
				parts: [],
			};
			session.messages.push(assistantMsg);
			this._onDidEmitUIEvent.fire({ type: 'message-created', message: assistantMsg });

			// Resolve agent
			const agent = this._agents.find(a => a.id === session.agentId) ?? this._agents[0];

			// Build workspace context (AGENTS.md, package.json, git detection)
			const wsCtx = await this._contextBuilder.build(session.directory);

			// Build system prompt with real workspace context
			const systemPrompt = buildSystemPrompt({
				workingDirectory: session.directory,
				agentId: agent.id,
				agentPrompt: agent.systemPrompt,
				isGitRepo: wsCtx.isGitRepo,
				customInstructions: wsCtx.customInstructions || undefined,
			});

			// Build callbacks that bridge processor events → UI events
			const callbacks: IProcessorCallbacks = {
				onPartCreated: (part: IPowerMessagePart) => {
					this._onDidEmitUIEvent.fire({
						type: 'part-updated',
						sessionId,
						messageId: assistantMsg.id,
						part,
					});
				},
				onPartUpdated: (part: IPowerMessagePart) => {
					this._onDidEmitUIEvent.fire({
						type: 'part-updated',
						sessionId,
						messageId: assistantMsg.id,
						part,
					});
				},
				onTextDelta: (partId: string, delta: string) => {
					this._onDidEmitUIEvent.fire({
						type: 'part-delta',
						sessionId,
						messageId: assistantMsg.id,
						partId,
						field: 'text',
						delta,
					});
				},
				sendToLLM: (request: ILLMRequest) => {
					return this._llmBridge.sendToLLM(request, this.getModelSelection());
				},
				askPermission: (toolName: string, input: Record<string, any>) => {
					const requestId = `perm_${++this._approvalCounter}`;
					const preview = _buildToolPreview(toolName, input);
					return new Promise<ToolPermissionDecision>((resolve) => {
						this._pendingApprovals.set(requestId, resolve);
						this._onDidEmitUIEvent.fire({
							type: 'permission-request',
							request: { requestId, sessionId, toolName, preview },
						});
					});
				},
			};

			// Run the agent loop (tools registered separately — currently empty registry)
			const result = await runAgentLoop({
				agent,
				assistantMessage: assistantMsg,
				sessionMessages: session.messages,
				toolRegistry: this._getToolRegistry(session.directory),
				callbacks,
				abort: abortController.signal,
				workingDirectory: session.directory,
				systemPrompt,
			});

			session.status = result === 'error' ? 'error' : 'idle';
		} catch (err: any) {
			session.status = 'error';
			this._onDidEmitUIEvent.fire({ type: 'error', error: String(err?.message ?? err) });
		} finally {
			this._abortControllers.delete(sessionId);
			session.updatedAt = Date.now();
			this._onDidEmitUIEvent.fire({ type: 'session-updated', sessionId, status: session.status });
			this._onDidChangeSession.fire(session);
			this._persistSessions();
		}
	}

	cancel(sessionId: string): void {
		const controller = this._abortControllers.get(sessionId);
		if (controller) {
			controller.abort();
			this._abortControllers.delete(sessionId);
		}
		// Deny any pending permission requests for this session
		for (const [requestId, resolve] of this._pendingApprovals) {
			if (requestId.startsWith('perm_')) {
				resolve('deny');
				this._pendingApprovals.delete(requestId);
			}
		}
		const session = this._sessions.get(sessionId);
		if (session && session.status === 'busy') {
			session.status = 'idle';
			session.updatedAt = Date.now();
			this._onDidChangeSession.fire(session);
			this._onDidEmitUIEvent.fire({ type: 'session-updated', sessionId, status: 'idle' });
		}
	}

	resolvePermission(requestId: string, decision: ToolPermissionDecision): void {
		const resolve = this._pendingApprovals.get(requestId);
		if (resolve) {
			this._pendingApprovals.delete(requestId);
			resolve(decision);
		}
	}

	// ─── Agents ──────────────────────────────────────────────────────────────

	getAgents(): IPowerAgent[] {
		return [...this._agents];
	}

	// ─── Info ─────────────────────────────────────────────────────────────────

	getModelSelection(): ModelSelection | null {
		// Use Power Mode's own selection if set, else fall back to Chat
		return this._powerModeModelSelection ?? this.voidSettingsService.state.modelSelectionOfFeature['Chat'];
	}

	getModelInfo(): { provider: string; model: string } | undefined {
		const sel = this.getModelSelection();
		if (!sel) { return undefined; }
		return { provider: sel.providerName, model: sel.modelName };
	}

	getAvailableModels(): ModelOption[] {
		return this.voidSettingsService.state._modelOptions;
	}

	setModel(selection: ModelSelection): void {
		this._powerModeModelSelection = selection;
	}

	clearSession(sessionId: string): void {
		const session = this._sessions.get(sessionId);
		if (!session) { return; }
		this.cancel(sessionId);
		session.messages = [];
		(session as any).title = 'New session';
		session.updatedAt = Date.now();
		this._contextBuilder.invalidate(session.directory);
		this._onDidChangeSession.fire(session);
		this._persistSessions();
	}

	// ─── Bus ─────────────────────────────────────────────────────────────

	getAgentsOnBus(): IRegisteredAgent[] {
		return this.powerBusService.getAgents();
	}

	getBusHistory(limit = 20): IAgentBusMessage[] {
		return this.powerBusService.getHistory(limit);
	}

	// ─── Persistence ─────────────────────────────────────────────────────────

	private _persistSessions(): void {
		const data = [...this._sessions.values()].map(s => ({
			id: s.id,
			title: s.title,
			agentId: s.agentId,
			directory: s.directory,
			createdAt: s.createdAt,
			updatedAt: s.updatedAt,
			messageCount: s.messages.length,
		}));
		this.storageService.store(STORAGE_KEY, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private _restoreSessions(): void {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) { return; }
		try {
			const entries = JSON.parse(raw) as Array<{ id: string; title: string; agentId: string; directory: string; createdAt: number; updatedAt: number }>;
			for (const entry of entries) {
				this._sessions.set(entry.id, {
					...entry,
					status: 'idle',
					messages: [],
				});
			}
			if (entries.length > 0) {
				this._activeSessionId = entries[0].id;
			}
		} catch { /* ignore corrupt data */ }
	}
}

registerSingleton(IPowerModeService, PowerModeService, InstantiationType.Delayed);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a short human-readable preview of a tool call for the approval prompt */
function _buildToolPreview(toolName: string, input: Record<string, any>): string {
	switch (toolName) {
		case 'bash':
			return String(input.command ?? '').substring(0, 200);
		case 'write':
			return `${input.filePath ?? ''}  (${String(input.content ?? '').split('\n').length} lines)`;
		case 'edit':
			return `${input.filePath ?? ''}`;
		default:
			return JSON.stringify(input).substring(0, 200);
	}
}
