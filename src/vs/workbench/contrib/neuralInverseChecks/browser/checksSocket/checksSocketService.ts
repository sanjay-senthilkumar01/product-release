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
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { IInverseAccessService } from '../engine/services/inverseAccessService.js';
import { IGRCEngineService } from '../engine/services/grcEngineService.js';
import { IFrameworkRegistry } from '../engine/framework/frameworkRegistry.js';
import { ICheckResult } from '../engine/types/grcTypes.js';
import { CHECKS_API_URL } from '../../../void/common/neuralInverseConfig.js';
import { IProjectConfigSyncService } from '../projectConfigSyncService.js';
import { GRC_BUILTIN_DOMAINS } from '../engine/types/grcTypes.js';

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
	private _registeredProjectName: string | undefined; // server-resolved name (may differ from workspace folder)
	private readonly _onDidRegisterProject = this._register(new Emitter<string>());
	readonly onDidRegisterProject: Event<string> = this._onDidRegisterProject.event;

	get isConnected(): boolean { return this._isConnected; }
	get registeredProjectId(): string | undefined { return this._registeredProjectId; }

	/** Pending violations waiting to be flushed */
	private readonly _pendingViolations: ICheckResult[] = [];
	private _debounceTimer: any = null;

	/** Violation dedup: key = ruleId:filePath:line — prevents reporting the same violation twice per session */
	private readonly _reportedViolations = new Set<string>();

	/** Per-file tracking: filePath → Set of "ruleId:line" keys currently reported as open.
	 *  When a file is rescanned we diff old vs new — any key that disappeared means the
	 *  developer fixed the code and the violation should be auto-resolved in the DB. */
	private readonly _reportedByFile = new Map<string, Set<string>>();

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
		@IFileService private readonly _fileService: IFileService,
		@IInverseAccessService private readonly _inverseAccessService: IInverseAccessService,
		@IProjectConfigSyncService private readonly _projectConfigSync: IProjectConfigSyncService,
	) {
		super();

		void this._inverseAccessService; // ensures InverseAccessService is instantiated before any .inverse write
		console.log('[ChecksSocket] Service instantiated');

		// Bootstrap if already authenticated
		this._authService.isAuthenticated().then((authed: boolean) => {
			console.log('[ChecksSocket] isAuthenticated ->', authed);
			if (authed) this._onConnect();
		});

		// React to login / logout
		this._register(this._authService.onDidChangeAuthStatus((authed: boolean) => {
			console.log('[ChecksSocket] onDidChangeAuthStatus ->', authed);
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

		// When web console resolves violations, clear their diagnostics in the IDE immediately
		this._register(this._projectConfigSync.onDidChangeSuppressedViolations(newlySuppressed => {
			this._clearSuppressedDiagnostics(newlySuppressed);
		}));
	}

	// ─── Connection lifecycle ─────────────────────────────────────────────────

	private _onConnect(): void {
		console.log('[ChecksSocket] _onConnect fired');
		this._logService.info('[ChecksSocket] Connected — registering project and fetching frameworks');
		this._setConnected(true);
		this.registerCurrentProject().then(() => {
			this.refreshFrameworks();
			// Load saved violations from DB — makes DB the source of truth instead of
			// the fragile local IStorageService cache, so AI scan results survive IDE restarts.
			setTimeout(() => this._loadViolationsFromDB(), 2_000);
		});
		this._startPoll();
	}

	private _onDisconnect(): void {
		this._logService.info('[ChecksSocket] Disconnected');
		this._setConnected(false);
		this._stopPoll();
		this._registeredProjectId = undefined;
		this._reportedViolations.clear();
		this._reportedByFile.clear();
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
		const localUri = folders.length > 0 ? folders[0].uri : undefined;

		// Prefer git remote origin URL — lets checks-socket match this workspace to a
		// web-console project (e.g. "NodeMasterX") even when the folder name differs ("nmx").
		let repoUrl: string | undefined;
		if (localUri) {
			try {
				const gitConfig = await this._fileService.readFile(URI.joinPath(localUri, '.git', 'config'));
				const match = gitConfig.value.toString().match(/\[remote\s+"origin"\][^\[]*\burl\s*=\s*([^\r\n]+)/);
				if (match) {
					repoUrl = match[1].trim();
				}
			} catch { /* no git config — fall back to local URI */ }
			if (!repoUrl) {
				repoUrl = localUri.toString(); // file:///...
			}
		}

		console.log(`[ChecksSocket] registerCurrentProject → POST ${CHECKS_API_URL}/projects`, { projectName, repoUrl });
		try {
			const response = await this._nativeHostService.request(`${CHECKS_API_URL}/projects`, {
				type: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				data: JSON.stringify({ name: projectName, repoUrl }),
			});

			console.log('[ChecksSocket] project registration response:', response.statusCode, response.body.substring(0, 300));

			if (response.statusCode >= 400) {
				this._logService.warn(`[ChecksSocket] Project registration returned ${response.statusCode}`);
				return;
			}

			const project = JSON.parse(response.body);
			this._registeredProjectId = project.id;
			this._registeredProjectName = project.name; // use server-resolved name for framework lookups
			this._logService.info(`[ChecksSocket] Project registered: ${projectName} → "${project.name}" (${project.id})`);
			this._onDidRegisterProject.fire(project.id);
		} catch (err) {
			console.error('[ChecksSocket] registerCurrentProject error:', err);
			this._logService.warn('[ChecksSocket] Failed to register project:', err);
		}
	}

	// ─── DB violation restore ─────────────────────────────────────────────────

	/**
	 * Fetch unresolved violations for this project from the DB via checks-socket
	 * and restore them into the GRC engine's results cache.
	 *
	 * This replaces the fragile IStorageService cache as the source of truth:
	 * AI violations found in any session are written to the DB immediately when
	 * found, so they survive IDE restarts, re-installs, and cache clears.
	 *
	 * Called 2s after project registration so the engine has time to load rules first.
	 */
	private async _loadViolationsFromDB(): Promise<void> {
		const token = await this._authService.getToken();
		if (!token) return;

		const projectName = this._registeredProjectName ?? this._getProjectName();
		if (!projectName) return;

		try {
			const response = await this._nativeHostService.request(
				`${CHECKS_API_URL}/violations?projectName=${encodeURIComponent(projectName)}&resolved=false&limit=500`,
				{ type: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
			);
			if (response.statusCode >= 400) return;

			const violations: any[] = JSON.parse(response.body);
			if (violations.length === 0) return;

			// Group by filePath so we can call restoreAIViolations once per file
			const byFile = new Map<string, any[]>();
			for (const v of violations) {
				if (!v.filePath) continue;
				if (!byFile.has(v.filePath)) byFile.set(v.filePath, []);
				byFile.get(v.filePath)!.push(v);
			}

			for (const [filePath, fileViolations] of byFile) {
				const fileUri = URI.file(filePath);
				const mapped = fileViolations.map(v => ({
					ruleId: v.ruleId,
					domain: GRC_BUILTIN_DOMAINS.SECURITY,
					severity: v.severity,
					message: v.message,
					line: v.line ?? 1,
					column: 0,
					endLine: v.line ?? 1,
					endColumn: 100,
					fileUri,
					codeSnippet: v.snippet ?? '',
					frameworkId: v.frameworkId,
					timestamp: new Date(v.createdAt).getTime(),
					checkSource: 'ai' as const,
				}));
				this._grcEngine.restoreAIViolations(fileUri, mapped);

				// Mark as already reported so we don't re-POST them to the backend
				for (const v of fileViolations) {
					this._reportedViolations.add(`${v.ruleId}:${filePath}:${v.line ?? 1}`);
				}
			}

			this._logService.info(`[ChecksSocket] Restored ${violations.length} violation(s) from DB for project "${projectName}"`);
		} catch (err) {
			this._logService.warn('[ChecksSocket] Failed to load violations from DB:', err);
		}
	}

	// ─── Framework sync ───────────────────────────────────────────────────────

	async refreshFrameworks(): Promise<void> {
		const token = await this._authService.getToken();
		if (!token) return;

		// Prefer server-resolved project name (e.g. "NodeMasterX") over local folder name (e.g. "nmx")
		const projectName = this._registeredProjectName ?? this._getProjectName();

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

		const reportable = results.filter(r =>
			REPORTABLE_SEVERITIES.has(r.severity.toLowerCase()) &&
			!this._projectConfigSync.isViolationSuppressed(r.ruleId, r.fileUri.path, r.line)
		);

		// Auto-resolve: find previously reported violations for this file that are now gone
		if (reportable.length > 0 || results.length > 0) {
			const filePath = (reportable[0] ?? results[0]).fileUri.path;
			const newKeys = new Set(reportable.map(r => `${r.ruleId}:${r.line}`));
			const prevKeys = this._reportedByFile.get(filePath);
			if (prevKeys && prevKeys.size > 0) {
				const staleKeys = [...prevKeys].filter(k => !newKeys.has(k));
				if (staleKeys.length > 0) {
					this._autoResolveViolations(filePath, staleKeys);
					for (const k of staleKeys) prevKeys.delete(k);
				}
			}
		}

		for (const r of reportable) {
			const globalKey = `${r.ruleId}:${r.fileUri.path}:${r.line}`;
			if (!this._reportedViolations.has(globalKey)) {
				this._pendingViolations.push(r);
				this._reportedViolations.add(globalKey);
				// Track per-file so we can detect when violations disappear
				const fileKey = `${r.ruleId}:${r.line}`;
				if (!this._reportedByFile.has(r.fileUri.path)) {
					this._reportedByFile.set(r.fileUri.path, new Set());
				}
				this._reportedByFile.get(r.fileUri.path)!.add(fileKey);
			}
		}

		if (this._pendingViolations.length > 0) {
			if (this._debounceTimer) clearTimeout(this._debounceTimer);
			this._debounceTimer = setTimeout(() => this._flushViolations(), VIOLATION_DEBOUNCE_MS);
		}
	}

	/** Called when web console resolves/false-alarms a violation — clears the diagnostic immediately */
	private _clearSuppressedDiagnostics(suppressed: Array<{ ruleId: string; filePath: string | null; line: number | null }>): void {
		// Group by filePath
		const byFile = new Map<string, Array<{ ruleId: string; line: number }>>();
		for (const sv of suppressed) {
			if (!sv.filePath) continue;
			if (!byFile.has(sv.filePath)) byFile.set(sv.filePath, []);
			byFile.get(sv.filePath)!.push({ ruleId: sv.ruleId, line: sv.line ?? 0 });
		}
		for (const [filePath, keys] of byFile) {
			this._grcEngine.clearSpecificViolations(URI.file(filePath), keys);
			// Remove from per-file tracker so they don't trigger auto-resolve again
			const fileTracker = this._reportedByFile.get(filePath);
			if (fileTracker) {
				for (const k of keys) fileTracker.delete(`${k.ruleId}:${k.line}`);
			}
		}
	}

	/** Send auto-resolve signal to backend for violations that disappeared from the codebase */
	private async _autoResolveViolations(filePath: string, staleFileKeys: string[]): Promise<void> {
		const token = await this._authService.getToken();
		if (!token) return;
		const projectName = this._registeredProjectName ?? this._getProjectName();
		try {
			await this._nativeHostService.request(`${CHECKS_API_URL}/violations/auto-resolve`, {
				type: 'POST',
				headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
				data: JSON.stringify({ projectName, filePath, resolvedRuleKeys: staleFileKeys }),
			});
			this._logService.info(`[ChecksSocket] Auto-resolved ${staleFileKeys.length} fixed violation(s) in ${filePath.split('/').pop()}`);
		} catch (err) {
			this._logService.warn('[ChecksSocket] Failed to auto-resolve violations:', err);
		}
	}

	private async _flushViolations(): Promise<void> {
		if (this._pendingViolations.length === 0) return;

		const batch = this._pendingViolations.splice(0);
		const token = await this._authService.getToken();
		if (!token) return;

		// Use server-resolved project name (e.g. "NodeMasterX") so violations are
		// stored under the canonical project name, not the local folder name (e.g. "nmx").
		const projectName = this._registeredProjectName ?? this._getProjectName();

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
