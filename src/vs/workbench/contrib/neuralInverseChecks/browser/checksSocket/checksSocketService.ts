/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *
 *  Checks Socket Service
 *  ─────────────────────
 *  Connects the IDE GRC engine to the enterprise checks-socket backend.
 *
 *  Responsibilities:
 *  1. On auth: pull project-specific GRC frameworks from checks-socket and import
 *     them into the local FrameworkRegistry (.inverse/frameworks/).
 *  2. Subscribe to onDidCheckComplete — report new violations to checks-socket
 *     via REST POST (debounced, deduped, severity-filtered).
 *  3. Poll frameworks every 5 minutes so org admins can push rule changes.
 *
 *  ARCH: Follows enterprisePolicyService pattern — REST via nativeHostService,
 *        auth token from INeuralInverseAuthService, DI singleton, cached state.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { INeuralInverseAuthService } from '../../../../services/neuralInverseAuth/common/neuralInverseAuth.js';
import { IGRCEngineService } from '../engine/services/grcEngineService.js';
import { IFrameworkRegistry } from '../engine/framework/frameworkRegistry.js';
import { ICheckResult } from '../engine/types/grcTypes.js';
import { CHECKS_API_URL } from '../../../void/common/neuralInverseConfig.js';

// ─── Service Interface ────────────────────────────────────────────────────────

export interface IChecksSocketService {
	readonly _serviceBrand: undefined;

	/** Whether the service is connected to checks-socket */
	readonly isConnected: boolean;

	/** Fires when connection state changes */
	readonly onDidChangeConnection: Event<boolean>;

	/** The project ID returned from the backend after registration, if registered */
	readonly registeredProjectId: string | undefined;

	/** Fires when the current project is registered or re-registered */
	readonly onDidRegisterProject: Event<string>;

	/** Manually refresh frameworks from checks-socket */
	refreshFrameworks(): Promise<void>;

	/** Register the current workspace project with the enterprise backend */
	registerCurrentProject(): Promise<void>;
}

export const IChecksSocketService = createDecorator<IChecksSocketService>('checksSocketService');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Severities that get reported to the enterprise backend */
const REPORTABLE_SEVERITIES = new Set(['blocker', 'critical', 'error', 'major', 'warning']);

/** How long to hold violations before sending (batching window) */
const VIOLATION_DEBOUNCE_MS = 3000;

/** Framework refresh interval */
const FRAMEWORK_POLL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Implementation ───────────────────────────────────────────────────────────

class ChecksSocketService extends Disposable implements IChecksSocketService {
	declare readonly _serviceBrand: undefined;

	private _isConnected = false;
	private readonly _onDidChangeConnection = this._register(new Emitter<boolean>());
	readonly onDidChangeConnection: Event<boolean> = this._onDidChangeConnection.event;

	private _registeredProjectId: string | undefined;
	private readonly _onDidRegisterProject = this._register(new Emitter<string>());
	readonly onDidRegisterProject: Event<string> = this._onDidRegisterProject.event;

	get isConnected(): boolean { return this._isConnected; }
	get registeredProjectId(): string | undefined { return this._registeredProjectId; }

	/** Pending violations waiting to be flushed */
	private readonly _pendingViolations: ICheckResult[] = [];
	private _debounceTimer: any = null;

	/** Violation dedup: key = ruleId:filePath:line — prevents reporting the same violation twice per session */
	private readonly _reportedViolations = new Set<string>();

	/** Framework IDs currently synced from checks-socket */
	private readonly _syncedFrameworkIds = new Set<string>();

	private _pollTimer: any = null;

	constructor(
		@INeuralInverseAuthService private readonly _authService: INeuralInverseAuthService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@ILogService private readonly _logService: ILogService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IGRCEngineService private readonly _grcEngine: IGRCEngineService,
		@IFrameworkRegistry private readonly _frameworkRegistry: IFrameworkRegistry,
	) {
		super();

		// Bootstrap if already authenticated
		this._authService.isAuthenticated().then((authed: boolean) => {
			if (authed) this._onConnect();
		});

		// React to login / logout
		this._register(this._authService.onDidChangeAuthStatus((authed: boolean) => {
			if (authed) {
				this._onConnect();
			} else {
				this._onDisconnect();
			}
		}));

		// Tap into violation stream from GRC engine
		this._register(this._grcEngine.onDidCheckComplete(results => {
			this._onCheckResults(results);
		}));
	}

	// ─── Connection lifecycle ─────────────────────────────────────────────────

	private _onConnect(): void {
		this._logService.info('[ChecksSocket] Connected — registering project and fetching frameworks');
		this._setConnected(true);
		this.registerCurrentProject().then(() => this.refreshFrameworks());
		this._startPoll();
	}

	private _onDisconnect(): void {
		this._logService.info('[ChecksSocket] Disconnected');
		this._setConnected(false);
		this._stopPoll();
		this._registeredProjectId = undefined;
		this._reportedViolations.clear();
		this._syncedFrameworkIds.clear();
	}

	private _setConnected(value: boolean): void {
		if (this._isConnected !== value) {
			this._isConnected = value;
			this._onDidChangeConnection.fire(value);
		}
	}

	// ─── Project registration ─────────────────────────────────────────────────

	async registerCurrentProject(): Promise<void> {
		const token = await this._authService.getToken();
		if (!token) return;

		const projectName = this._getProjectName();
		if (!projectName) return;

		const folders = this._workspaceService.getWorkspace().folders;
		const repoUrl = folders.length > 0 ? folders[0].uri.toString() : undefined;

		try {
			const response = await this._nativeHostService.request(`${CHECKS_API_URL}/projects`, {
				type: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				data: JSON.stringify({ name: projectName, repoUrl }),
			});

			if (response.statusCode >= 400) {
				this._logService.warn(`[ChecksSocket] Project registration returned ${response.statusCode}`);
				return;
			}

			const project = JSON.parse(response.body);
			this._registeredProjectId = project.id;
			this._logService.info(`[ChecksSocket] Project registered: ${projectName} (${project.id})`);
			this._onDidRegisterProject.fire(project.id);
		} catch (err) {
			this._logService.warn('[ChecksSocket] Failed to register project:', err);
		}
	}

	// ─── Framework sync ───────────────────────────────────────────────────────

	async refreshFrameworks(): Promise<void> {
		const token = await this._authService.getToken();
		if (!token) return;

		const projectName = this._getProjectName();

		try {
			const url = projectName
				? `${CHECKS_API_URL}/frameworks?projectName=${encodeURIComponent(projectName)}`
				: `${CHECKS_API_URL}/frameworks`;

			const response = await this._nativeHostService.request(url, {
				type: 'GET',
				headers: { 'Authorization': `Bearer ${token}` },
			});

			if (response.statusCode >= 400) {
				this._logService.warn(`[ChecksSocket] Framework fetch returned ${response.statusCode}`);
				return;
			}

			const frameworks: any[] = JSON.parse(response.body);
			this._logService.info(`[ChecksSocket] Received ${frameworks.length} framework(s) for project "${projectName || 'all'}"`);

			await this._syncFrameworks(frameworks);
		} catch (err) {
			this._logService.warn('[ChecksSocket] Failed to fetch frameworks:', err);
		}
	}

	private async _syncFrameworks(frameworks: any[]): Promise<void> {
		const newIds = new Set<string>();

		for (const fw of frameworks) {
			if (!fw.definition || !fw.frameworkId) continue;
			newIds.add(fw.frameworkId);

			// Skip if already loaded (no duplicate imports)
			const existing = this._frameworkRegistry.getFrameworkById(fw.frameworkId);
			if (existing) continue;

			try {
				const result = await this._frameworkRegistry.importFramework(JSON.stringify(fw.definition));
				if (result.valid) {
					this._syncedFrameworkIds.add(fw.frameworkId);
					this._logService.info(`[ChecksSocket] Imported framework: ${fw.name} (${fw.frameworkId})`);
				} else {
					this._logService.warn(`[ChecksSocket] Framework ${fw.frameworkId} failed validation: ${result.errors.join(', ')}`);
				}
			} catch (err) {
				this._logService.warn(`[ChecksSocket] Failed to import framework ${fw.frameworkId}:`, err);
			}
		}
	}

	// ─── Violation reporting ──────────────────────────────────────────────────

	private _onCheckResults(results: ICheckResult[]): void {
		if (!this._isConnected) return;

		const reportable = results.filter(r => REPORTABLE_SEVERITIES.has(r.severity.toLowerCase()));
		if (reportable.length === 0) return;

		for (const r of reportable) {
			const key = `${r.ruleId}:${r.fileUri.path}:${r.line}`;
			if (!this._reportedViolations.has(key)) {
				this._pendingViolations.push(r);
				this._reportedViolations.add(key);
			}
		}

		// Debounce flush so rapid saves don't spam the backend
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		this._debounceTimer = setTimeout(() => this._flushViolations(), VIOLATION_DEBOUNCE_MS);
	}

	private async _flushViolations(): Promise<void> {
		if (this._pendingViolations.length === 0) return;

		const batch = this._pendingViolations.splice(0);
		const token = await this._authService.getToken();
		if (!token) return;

		const projectName = this._getProjectName();

		for (const v of batch) {
			try {
				await this._nativeHostService.request(`${CHECKS_API_URL}/violations`, {
					type: 'POST',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
					data: JSON.stringify({
						projectName,
						frameworkId: v.frameworkId,
						ruleId: v.ruleId,
						severity: v.severity,
						message: v.message,
						filePath: v.fileUri.path,
						line: v.line,
						snippet: v.codeSnippet,
					}),
				});
			} catch (err) {
				this._logService.warn(`[ChecksSocket] Failed to report violation ${v.ruleId}:`, err);
			}
		}
	}

	// ─── Polling ──────────────────────────────────────────────────────────────

	private _startPoll(): void {
		this._stopPoll();
		this._pollTimer = setInterval(() => {
			this.refreshFrameworks();
		}, FRAMEWORK_POLL_MS);
		this._register({ dispose: () => this._stopPoll() });
	}

	private _stopPoll(): void {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	private _getProjectName(): string | undefined {
		const folders = this._workspaceService.getWorkspace().folders;
		if (folders.length === 0) return undefined;
		return folders[0].name;
	}

	override dispose(): void {
		this._stopPoll();
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		super.dispose();
	}
}

registerSingleton(IChecksSocketService, ChecksSocketService, InstantiationType.Eager);
