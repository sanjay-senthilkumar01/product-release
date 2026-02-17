/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IGRCConfig, IGRCRule, DEFAULT_GRC_CONFIG } from './grcTypes.js';
import { BUILTIN_RULES } from './builtinRules.js';

const GRC_FOLDER = '.inverse';
const GRC_CONFIG_FILE = 'grc-rules.json';

/**
 * Loads GRC rules from:
 * 1. Built-in rules (builtinRules.ts) - always present
 * 2. User config (.inverse/grc-rules.json) - overrides/additions
 *
 * Watches the config file for changes and reloads automatically.
 */
export class GRCConfigLoader extends Disposable {

	private _config: IGRCConfig = DEFAULT_GRC_CONFIG;
	private _mergedRules: IGRCRule[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		await this._ensureConfigExists();
		await this._loadConfig();
		this._registerFileWatcher();
	}

	private _registerFileWatcher(): void {
		const configUri = this._getConfigUri();
		if (!configUri) {
			return;
		}

		this._register(this.fileService.onDidFilesChange(e => {
			if (e.contains(configUri)) {
				console.log('[GRCConfigLoader] Config file changed, reloading...');
				this._loadConfig();
			}
		}));
	}

	private _getConfigUri(): URI | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}
		return URI.joinPath(folders[0].uri, GRC_FOLDER, GRC_CONFIG_FILE);
	}

	private async _ensureConfigExists(): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}

		const rootUri = folders[0].uri;
		const folderUri = URI.joinPath(rootUri, GRC_FOLDER);
		const configUri = URI.joinPath(folderUri, GRC_CONFIG_FILE);

		try {
			// Ensure .inverse folder exists
			try {
				if (!(await this.fileService.exists(folderUri))) {
					await this.fileService.createFolder(folderUri);
				}
			} catch {
				// Folder may already exist
			}

			// Create default config if missing
			if (!(await this.fileService.exists(configUri))) {
				const content = VSBuffer.fromString(JSON.stringify(DEFAULT_GRC_CONFIG, null, 4));
				await this.fileService.createFile(configUri, content);
				console.log('[GRCConfigLoader] Created default GRC config file');
			}
		} catch (e) {
			console.error('[GRCConfigLoader] Failed to ensure config file exists:', e);
		}
	}

	private async _loadConfig(): Promise<void> {
		const configUri = this._getConfigUri();
		if (!configUri) {
			this._mergedRules = [...BUILTIN_RULES];
			return;
		}

		try {
			const exists = await this.fileService.exists(configUri);
			if (!exists) {
				this._config = DEFAULT_GRC_CONFIG;
				this._mergedRules = [...BUILTIN_RULES];
				this._onDidChange.fire();
				return;
			}

			const content = await this.fileService.readFile(configUri);
			const json = content.value.toString();
			this._config = JSON.parse(json) as IGRCConfig;
			console.log('[GRCConfigLoader] Loaded GRC config with', this._config.rules.length, 'user rules');

		} catch (e) {
			console.error('[GRCConfigLoader] Failed to load config, using defaults:', e);
			this._config = DEFAULT_GRC_CONFIG;
		}

		// Merge: start with built-in rules, then apply user overrides
		this._mergedRules = this._mergeRules();
		this._onDidChange.fire();
	}

	private _mergeRules(): IGRCRule[] {
		const merged: IGRCRule[] = [];
		const userRulesById = new Map<string, IGRCRule>();

		// Index user rules by ID for override lookup
		for (const rule of this._config.rules) {
			userRulesById.set(rule.id, rule);
		}

		// Process built-in rules (may be overridden by user)
		for (const builtin of BUILTIN_RULES) {
			const userOverride = userRulesById.get(builtin.id);
			if (userOverride) {
				// User overrides the built-in: merge, keeping builtin flag
				merged.push({
					...builtin,
					...userOverride,
					builtin: true // Cannot remove builtin flag
				});
				userRulesById.delete(builtin.id);
			} else {
				merged.push({ ...builtin });
			}
		}

		// Add remaining user-defined rules (non-overrides)
		for (const [, userRule] of userRulesById) {
			merged.push({
				...userRule,
				builtin: false
			});
		}

		return merged;
	}

	/**
	 * Get all merged rules (built-in + user overrides + user additions).
	 */
	public getRules(): IGRCRule[] {
		return this._mergedRules;
	}

	/**
	 * Get the current config settings.
	 */
	public getSettings(): IGRCConfig['settings'] {
		return this._config.settings;
	}

	/**
	 * Force a reload of the config from disk.
	 */
	public async reload(): Promise<void> {
		await this._loadConfig();
	}

	// ─── Write Methods (for UI console) ──────────────────────────────

	/**
	 * Add or update a rule in the user config.
	 * For built-in rules, this creates an override entry.
	 */
	public async saveRule(rule: IGRCRule): Promise<void> {
		const idx = this._config.rules.findIndex(r => r.id === rule.id);
		if (idx >= 0) {
			this._config.rules[idx] = { ...rule, builtin: undefined } as IGRCRule;
		} else {
			this._config.rules.push({ ...rule, builtin: undefined } as IGRCRule);
		}
		await this._persistConfig();
	}

	/**
	 * Toggle enable/disable for a rule.
	 */
	public async toggleRule(ruleId: string, enabled: boolean): Promise<void> {
		const existing = this._config.rules.find(r => r.id === ruleId);
		if (existing) {
			existing.enabled = enabled;
		} else {
			// Create override entry for built-in rule
			this._config.rules.push({ id: ruleId, enabled } as IGRCRule);
		}
		await this._persistConfig();
	}

	/**
	 * Delete a user-defined rule. Built-in rules cannot be deleted (only disabled).
	 */
	public async deleteRule(ruleId: string): Promise<void> {
		this._config.rules = this._config.rules.filter(r => r.id !== ruleId);
		await this._persistConfig();
	}

	/**
	 * Write the current config back to .inverse/grc-rules.json
	 */
	private async _persistConfig(): Promise<void> {
		const configUri = this._getConfigUri();
		if (!configUri) {
			return;
		}

		try {
			const json = JSON.stringify(this._config, null, 4);
			const buffer = VSBuffer.fromString(json);
			await this.fileService.writeFile(configUri, buffer);
			console.log('[GRCConfigLoader] Config saved');
			// Reload to re-merge rules
			await this._loadConfig();
		} catch (e) {
			console.error('[GRCConfigLoader] Failed to save config:', e);
		}
	}
}
