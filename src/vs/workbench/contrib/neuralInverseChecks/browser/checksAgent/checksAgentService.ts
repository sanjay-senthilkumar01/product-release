/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks Agent Service — GRC compliance specialist AI.
 *
 * A dedicated agent that:
 * - Talks ONLY about GRC compliance, violations, frameworks, and risk.
 * - Does NOT write or edit source code.
 * - Uses native tool-calling (10 built-in GRC tools).
 * - Exposes a programmatic API so other coding agents can query GRC state directly.
 *
 * Adapted from PowerModeService. Simplified (single session per workspace,
 * no approval dialogs, GRC-only tools).
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ILLMMessageService } from '../../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService, ModelOption } from '../../../void/common/voidSettingsService.js';
import { ModelSelection } from '../../../void/common/voidSettingsTypes.js';
import { IGRCEngineService } from '../engine/services/grcEngineService.js';
import { IExternalToolService } from '../engine/services/externalToolService.js';
import { IContractReasonService } from '../engine/services/contractReasonService.js';
import { ICheckResult, IDomainSummary, IGRCRule } from '../engine/types/grcTypes.js';
import { IExternalJob } from '../engine/types/externalJobTypes.js';
import { IPowerBusService } from '../../powerMode/browser/powerBusService.js';
import { buildChecksSystemPrompt } from './checksSystemPrompt.js';
import { ChecksContextBuilder } from './checksContextBuilder.js';
import {
	IChecksSession,
	IChecksMessage,
	IChecksMessagePart,
	ChecksSessionStatus,
	ChecksAgentUIEvent,
} from './checksAgentTypes.js';
import { ChecksToolRegistry } from './checksToolRegistry.js';
import { buildChecksTools } from './tools/checksTools.js';
import { ChecksAgentLLMBridge } from './checksAgentLLMBridge.js';
import { runChecksAgentLoop, IProcessorCallbacks } from './checksAgentProcessor.js';

// ─── Service Interface ────────────────────────────────────────────────────────

export const IChecksAgentService = createDecorator<IChecksAgentService>('checksAgentService');

export interface IChecksAgentService {
	readonly _serviceBrand: undefined;

	/** Fires for all UI events (streamed to webview) */
	readonly onDidEmitUIEvent: Event<ChecksAgentUIEvent>;

	// ─── Session management ──────────────────────────────────────────────

	/** Create or return the active session */
	createSession(): IChecksSession;

	/** Get the active session */
	getActiveSession(): IChecksSession | undefined;

	/** Send a user message and start the agent loop */
	sendMessage(sessionId: string, text: string): Promise<void>;

	/** Cancel the active run */
	cancel(sessionId: string): void;

	/** Clear all messages in a session */
	clearSession(sessionId: string): void;

	// ─── Programmatic API (for other coding agents) ──────────────────────

	/**
	 * Query current violations directly (no LLM round-trip).
	 * For use by coding agents that need GRC state programmatically.
	 */
	queryViolations(domain?: string, severity?: string, limit?: number): ICheckResult[];

	/** Get per-domain violation summary */
	getDomainSummary(): IDomainSummary[];

	/** Get violations that block commits */
	getBlockingViolations(): ICheckResult[];

	/** Get a rule definition by ID */
	getRuleDetails(ruleId: string): IGRCRule | undefined;

	/** Get external tool job states */
	getExternalToolStatus(): IExternalJob[];

	/** Get the current model info string */
	getModelInfo(): string;

	/** Get all available models the user has configured */
	getAvailableModels(): ModelOption[];

	/** Set the Checks Agent's own model selection */
	setModel(selection: ModelSelection): void;

	/**
	 * Request a code snippet from Power Mode via the agent bus.
	 * Goes through Power Mode's permission gate. Budget-capped to avoid context bloat.
	 * Returns empty string if bus unavailable or request times out.
	 */
	requestCodeContext(file: string, startLine: number, endLine: number): Promise<string>;

	/** Prefill the input with a question (called from dashboard) */
	prefill(text: string): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'checksAgent.session';
const MAX_PERSISTED_MESSAGES = 40;

export class ChecksAgentService extends Disposable implements IChecksAgentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidEmitUIEvent = this._register(new Emitter<ChecksAgentUIEvent>());
	readonly onDidEmitUIEvent = this._onDidEmitUIEvent.event;

	private _session: IChecksSession | undefined;
	private readonly _abortControllers = new Map<string, AbortController>();
	private readonly _llmBridge: ChecksAgentLLMBridge;
	private readonly _toolRegistry: ChecksToolRegistry;
	private readonly _contextBuilder: ChecksContextBuilder;
	private _idCounter = 0;
	/** Checks Agent's own model selection — null means fall back to Chat */
	private _checksModelSelection: ModelSelection | null = null;
	/** Pending bus tool-requests: message ID → resolver */
	private readonly _pendingBusRequests = new Map<string, (result: string) => void>();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
		@IFileService fileService: IFileService,
		@ILLMMessageService llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IGRCEngineService private readonly grcEngine: IGRCEngineService,
		@IExternalToolService private readonly externalToolService: IExternalToolService,
		@IContractReasonService private readonly contractReasonService: IContractReasonService,
		@IPowerBusService private readonly powerBus: IPowerBusService,
	) {
		super();
		this._llmBridge = new ChecksAgentLLMBridge(llmMessageService, voidSettingsService);
		this._contextBuilder = new ChecksContextBuilder(fileService);
		this._toolRegistry = new ChecksToolRegistry();
		this._toolRegistry.registerMany(
			buildChecksTools(grcEngine, externalToolService, contractReasonService, this)
		);
		this._restoreSession();
		this._registerOnBus();
	}

	// ─── Agent Bus ────────────────────────────────────────────────────────────

	private _registerOnBus(): void {
		// Register as a participant that can answer compliance queries and request tools
		this.powerBus.register('checks-agent', ['send:query', 'send:tool-request', 'receive:all'], 'Checks Agent');

		// Subscribe to incoming messages
		this._register(this.powerBus.onMessage(msg => {
			if (msg.to !== 'checks-agent' && msg.to !== '*') { return; }

			if (msg.type === 'tool-result' && msg.replyTo) {
				// Route tool result back to waiting requestCodeContext() call
				const resolve = this._pendingBusRequests.get(msg.replyTo);
				if (resolve) {
					this._pendingBusRequests.delete(msg.replyTo);
					resolve(msg.content);
				}
				return;
			}

			if (msg.type === 'query') {
				this._handleBusQuery(msg.from, msg.id, msg.content);
			}
		}));

		// Broadcast blocking violation count changes
		this._register(this.grcEngine.onDidCheckComplete(() => {
			try {
				const blocking = this.grcEngine.getBlockingViolations();
				const total = this.grcEngine.getAllResults().length;
				this.powerBus.send(
					'checks-agent', '*', 'broadcast',
					JSON.stringify({ type: 'grc-posture-update', blocking: blocking.length, total }),
				);
			} catch { /* engine not ready */ }
		}));
	}

	private _handleBusQuery(fromAgent: string, replyTo: string, content: string): void {
		// Answer compliance queries from other agents without LLM round-trip
		let response: string;
		try {
			const lower = content.toLowerCase();
			if (lower.includes('blocking') || lower.includes('block commit')) {
				const violations = this.grcEngine.getBlockingViolations();
				response = JSON.stringify({ blocking: violations.length, violations: violations.slice(0, 10) });
			} else if (lower.includes('summary') || lower.includes('posture') || lower.includes('domain')) {
				const summary = this.grcEngine.getDomainSummary();
				response = JSON.stringify({ domains: summary });
			} else if (lower.includes('violation') || lower.includes('error') || lower.includes('warning')) {
				const results = this.grcEngine.getAllResults().slice(0, 20);
				response = JSON.stringify({ total: this.grcEngine.getAllResults().length, sample: results });
			} else {
				const total = this.grcEngine.getAllResults().length;
				const blocking = this.grcEngine.getBlockingViolations().length;
				const frameworks = this.grcEngine.getActiveFrameworks().map(f => f.name);
				response = JSON.stringify({ total, blocking, frameworks });
			}
		} catch (e: any) {
			response = JSON.stringify({ error: e.message ?? 'GRC engine not ready' });
		}

		this.powerBus.send('checks-agent', fromAgent, 'response', response, { replyTo });
	}

	// ─── Session management ───────────────────────────────────────────────────

	createSession(): IChecksSession {
		const id = `ca_${Date.now()}_${++this._idCounter}`;
		const session: IChecksSession = {
			id,
			status: 'idle',
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		this._session = session;
		this._persistSession();
		this._onDidEmitUIEvent.fire({ type: 'session-created', session });
		return session;
	}

	getActiveSession(): IChecksSession | undefined {
		return this._session;
	}

	async sendMessage(sessionId: string, text: string): Promise<void> {
		const session = this._session;
		if (!session || session.id !== sessionId) { return; }
		if (session.status === 'busy') { return; }

		// Create user message
		const userMsgId = this._nextId();
		const userMessage: IChecksMessage = {
			id: userMsgId,
			sessionId,
			role: 'user',
			createdAt: Date.now(),
			parts: [{ type: 'text', id: this._nextId(), text }],
		};
		session.messages.push(userMessage);
		session.updatedAt = Date.now();
		this._onDidEmitUIEvent.fire({ type: 'message-created', message: userMessage });

		// Create assistant message
		const assistantMsgId = this._nextId();
		const assistantMessage: IChecksMessage = {
			id: assistantMsgId,
			sessionId,
			role: 'assistant',
			createdAt: Date.now(),
			parts: [],
		};
		session.messages.push(assistantMessage);
		this._onDidEmitUIEvent.fire({ type: 'message-created', message: assistantMessage });

		// Set busy
		this._setStatus(session, 'busy');

		const abortController = new AbortController();
		this._abortControllers.set(sessionId, abortController);

		const directory = this.workspaceContext.getWorkspace().folders[0]?.uri.fsPath ?? '/';
		const wsCtx = await this._contextBuilder.build(directory);
		const systemPrompt = this._buildSystemPrompt(wsCtx);

		const callbacks: IProcessorCallbacks = {
			onPartCreated: (part: IChecksMessagePart) => {
				assistantMessage.parts.push(part);
				this._onDidEmitUIEvent.fire({
					type: 'part-updated',
					sessionId,
					messageId: assistantMsgId,
					part,
				});
			},
			onPartUpdated: (part: IChecksMessagePart) => {
				this._onDidEmitUIEvent.fire({
					type: 'part-updated',
					sessionId,
					messageId: assistantMsgId,
					part,
				});
			},
			onTextDelta: (partId: string, delta: string) => {
				this._onDidEmitUIEvent.fire({
					type: 'part-delta',
					sessionId,
					messageId: assistantMsgId,
					partId,
					delta,
				});
			},
			sendToLLM: (request) => this._llmBridge.sendToLLM(request, this._checksModelSelection),
		};

		try {
			await runChecksAgentLoop({
				assistantMessage,
				sessionMessages: session.messages,
				toolRegistry: this._toolRegistry,
				callbacks,
				abort: abortController.signal,
				systemPrompt,
			});
		} catch (e: any) {
			this._onDidEmitUIEvent.fire({ type: 'error', error: e.message });
		} finally {
			this._abortControllers.delete(sessionId);
			this._setStatus(session, 'idle');
			this._persistSession();
		}
	}

	cancel(sessionId: string): void {
		const controller = this._abortControllers.get(sessionId);
		if (controller) {
			controller.abort();
			this._abortControllers.delete(sessionId);
		}
		if (this._session?.id === sessionId) {
			this._setStatus(this._session, 'idle');
		}
	}

	clearSession(sessionId: string): void {
		if (this._session?.id === sessionId) {
			this.cancel(sessionId);
			this._session.messages = [];
			this._session.updatedAt = Date.now();
			const directory = this.workspaceContext.getWorkspace().folders[0]?.uri.fsPath;
			if (directory) { this._contextBuilder.invalidate(directory); }
			this.storageService.remove(STORAGE_KEY, StorageScope.WORKSPACE);
			this._onDidEmitUIEvent.fire({ type: 'session-cleared' as any, sessionId } as any);
		}
	}

	// ─── Programmatic API ─────────────────────────────────────────────────────

	queryViolations(domain?: string, severity?: string, limit = 30): ICheckResult[] {
		let results = this.grcEngine.getAllResults();
		if (domain) { results = results.filter(r => r.domain === domain); }
		if (severity) { results = results.filter(r => (r.severity ?? '').toLowerCase() === severity.toLowerCase()); }
		return results.slice(0, limit);
	}

	getDomainSummary(): IDomainSummary[] {
		return this.grcEngine.getDomainSummary();
	}

	getBlockingViolations(): ICheckResult[] {
		return this.grcEngine.getBlockingViolations();
	}

	getRuleDetails(ruleId: string): IGRCRule | undefined {
		return this.grcEngine.getRules().find(r => r.id === ruleId);
	}

	getExternalToolStatus(): IExternalJob[] {
		return this.externalToolService.getJobs();
	}

	getModelInfo(): string {
		const sel = this._checksModelSelection
			?? this.voidSettingsService.state.modelSelectionOfFeature['Checks']
			?? this.voidSettingsService.state.modelSelectionOfFeature['Chat']
			?? null;
		if (!sel) { return 'no model'; }
		return `${sel.modelName} · ${sel.providerName}`;
	}

	getAvailableModels(): ModelOption[] {
		return this.voidSettingsService.state._modelOptions ?? [];
	}

	setModel(selection: ModelSelection): void {
		this._checksModelSelection = selection;
	}

	async requestCodeContext(file: string, startLine: number, endLine: number): Promise<string> {
		const directory = this.workspaceContext.getWorkspace().folders[0]?.uri.fsPath ?? '/';
		// Budget cap: max 50 lines to avoid flooding the LLM context
		const cappedEnd = Math.min(endLine, startLine + 49);

		return new Promise<string>((resolve) => {
			const timeoutMs = 10_000;
			let capturedRequestId: string | undefined;

			const timer = setTimeout(() => {
				if (capturedRequestId) { this._pendingBusRequests.delete(capturedRequestId); }
				resolve('[Code context request timed out — Power Mode may not be running]');
			}, timeoutMs);

			// Capture the message ID from the bus synchronously before the response can arrive
			const once = this.powerBus.onMessage(msg => {
				if (msg.from === 'checks-agent' && msg.type === 'tool-request' && !capturedRequestId) {
					capturedRequestId = msg.id;
					this._pendingBusRequests.set(msg.id, (result) => {
						clearTimeout(timer);
						once.dispose();
						resolve(result);
					});
					once.dispose();
				}
			});

			// publish() fires onMessage synchronously — capturedRequestId is set before we continue
			this.powerBus.publish({
				from: 'checks-agent',
				to: 'power-mode',
				type: 'tool-request',
				content: `Read code context: ${file}:${startLine}-${cappedEnd}`,
				toolName: 'read',
				toolArgs: { path: file, startLine, endLine: cappedEnd },
				toolDirectory: directory,
			});
		});
	}

	prefill(text: string): void {
		this._onDidEmitUIEvent.fire({ type: 'prefill' as any, text } as any);
	}

	// ─── Private ──────────────────────────────────────────────────────────────

	private _nextId(): string {
		return `ca_${Date.now()}_${generateUuid().substring(0, 8)}`;
	}

	private _setStatus(session: IChecksSession, status: ChecksSessionStatus): void {
		session.status = status;
		this._onDidEmitUIEvent.fire({ type: 'session-updated', sessionId: session.id, status });
	}

	private _buildSystemPrompt(wsCtx?: { isGitRepo: boolean; workingDirectory: string; customInstructions?: string }): string {
		let posture = '';
		try {
			const allResults = this.grcEngine.getAllResults();
			const blocking = this.grcEngine.getBlockingViolations();
			const summary = this.grcEngine.getDomainSummary();
			const frameworks = this.grcEngine.getActiveFrameworks();
			const errors = allResults.filter(r => (r.severity ?? '').toLowerCase() === 'error').length;
			const warnings = allResults.filter(r => (r.severity ?? '').toLowerCase() === 'warning').length;
			const domainsWithIssues = summary
				.filter(d => d.errorCount + d.warningCount > 0)
				.map(d => `${d.domain}(${d.errorCount}e,${d.warningCount}w)`)
				.join(', ');

			posture = [
				`<grc_posture>`,
				`  Total violations: ${allResults.length} (${errors} errors, ${warnings} warnings)`,
				`  Blocking violations: ${blocking.length}`,
				`  Active frameworks: ${frameworks.map(f => f.name).join(', ') || 'none'}`,
				`  Rules loaded: ${this.grcEngine.getRules().length}`,
				`  Domains with issues: ${domainsWithIssues || 'none'}`,
				`</grc_posture>`,
			].join('\n');
		} catch {
			posture = '<grc_posture>Engine not ready yet.</grc_posture>';
		}

		const directory = wsCtx?.workingDirectory ?? this.workspaceContext.getWorkspace().folders[0]?.uri.fsPath ?? '/';

		return buildChecksSystemPrompt({
			grcPosture: posture,
			workingDirectory: directory,
			isGitRepo: wsCtx?.isGitRepo ?? false,
			customInstructions: wsCtx?.customInstructions,
		});
	}

	private _restoreSession(): void {
		const stored = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (!stored) { return; }
		try {
			const data = JSON.parse(stored) as IChecksSession;
			// Only restore if it has recent activity (last 24 hours)
			if (Date.now() - data.updatedAt < 24 * 60 * 60 * 1000) {
				data.status = 'idle'; // never restore as busy
				this._session = data;
			}
		} catch {
			// Ignore corrupt data
		}
	}

	private _persistSession(): void {
		if (!this._session) { return; }
		// Keep only the last N messages to avoid storage bloat
		const sessionToPersist: IChecksSession = {
			...this._session,
			messages: this._session.messages.slice(-MAX_PERSISTED_MESSAGES),
		};
		this.storageService.store(
			STORAGE_KEY,
			JSON.stringify(sessionToPersist),
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
	}
}

registerSingleton(IChecksAgentService, ChecksAgentService, InstantiationType.Delayed);
