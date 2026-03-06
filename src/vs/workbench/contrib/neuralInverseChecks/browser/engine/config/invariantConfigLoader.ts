/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { IGRCRule } from '../types/grcTypes.js';
import { IInvariantConfig, IInvariantDefinition, DEFAULT_INVARIANT_CONFIG } from '../types/invariantTypes.js';
import { withInverseWriteAccess } from '../utils/inverseFs.js';

const INVERSE_FOLDER = '.inverse';
const INVARIANT_FILE = 'invariants.json';

/**
 * Loads invariant definitions from `.inverse/invariants.json`.
 *
 * Converts invariants into GRC rules with `type: 'invariant'` so the
 * InvariantAnalyzer can evaluate them through the standard engine pipeline.
 *
 * Watches the file for changes and emits `onDidChange` to trigger re-merge.
 */
export class InvariantConfigLoader extends Disposable {

	private _config: IInvariantConfig = DEFAULT_INVARIANT_CONFIG;

	private readonly _onDidChange = this._register(new Emitter<void>());
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		await this._loadConfig();
		this._registerFileWatcher();
	}

	private _getConfigUri(): URI | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}
		return URI.joinPath(folders[0].uri, INVERSE_FOLDER, INVARIANT_FILE);
	}

	private _registerFileWatcher(): void {
		const configUri = this._getConfigUri();
		if (!configUri) {
			return;
		}

		this._register(this.fileService.onDidFilesChange(e => {
			if (e.contains(configUri)) {
				console.log('[InvariantConfigLoader] Invariants file changed, reloading...');
				this._loadConfig();
			}
		}));
	}

	private async _loadConfig(): Promise<void> {
		const configUri = this._getConfigUri();
		if (!configUri) {
			return;
		}

		try {
			const exists = await this.fileService.exists(configUri);
			if (!exists) {
				this._config = DEFAULT_INVARIANT_CONFIG;
				this._onDidChange.fire();
				return;
			}

			const content = await this.fileService.readFile(configUri);
			const json = content.value.toString();
			this._config = JSON.parse(json) as IInvariantConfig;
			console.log('[InvariantConfigLoader] Loaded', this._config.invariants.length, 'invariants');
		} catch (e) {
			console.error('[InvariantConfigLoader] Failed to load invariants:', e);
			this._config = DEFAULT_INVARIANT_CONFIG;
		}

		this._onDidChange.fire();
	}

	/**
	 * Get all invariant definitions.
	 */
	public getInvariants(): IInvariantDefinition[] {
		return this._config.invariants;
	}

	/**
	 * Convert invariant definitions to GRC rules for the engine.
	 *
	 * Each invariant becomes an IGRCRule with:
	 * - type: 'invariant'
	 * - domain: 'formal-verification' (or custom)
	 * - check: the full invariant definition (cast to ICheckDefinition)
	 */
	public toGRCRules(): IGRCRule[] {
		return this._config.invariants
			.filter(inv => inv.enabled !== false)
			.map(inv => ({
				id: inv.id,
				domain: inv.domain ?? 'formal-verification',
				severity: inv.severity,
				pattern: '', // not used for invariant type
				message: `Invariant violated: ${inv.name} (${inv.expression})`,
				enabled: true,
				type: 'invariant' as const,
				check: inv as any, // InvariantAnalyzer reads this as IInvariantDefinition
				tags: ['invariant', 'formal-verification'],
			}));
	}

	/**
	 * Save a new or updated invariant definition.
	 */
	public async saveInvariant(invariant: IInvariantDefinition): Promise<void> {
		const idx = this._config.invariants.findIndex(i => i.id === invariant.id);
		if (idx >= 0) {
			this._config.invariants[idx] = invariant;
		} else {
			this._config.invariants.push(invariant);
		}
		await this._persistConfig();
	}

	/**
	 * Delete an invariant by ID.
	 */
	public async deleteInvariant(id: string): Promise<void> {
		this._config.invariants = this._config.invariants.filter(i => i.id !== id);
		await this._persistConfig();
	}

	/**
	 * Toggle an invariant's enabled state.
	 */
	public async toggleInvariant(id: string, enabled: boolean): Promise<void> {
		const inv = this._config.invariants.find(i => i.id === id);
		if (inv) {
			inv.enabled = enabled;
			await this._persistConfig();
		}
	}

	private async _persistConfig(): Promise<void> {
		const configUri = this._getConfigUri();
		if (!configUri) {
			return;
		}

		const folderUri = URI.joinPath(this.workspaceContextService.getWorkspace().folders[0].uri, INVERSE_FOLDER);
		try {
			const json = JSON.stringify(this._config, null, 4);
			const buffer = VSBuffer.fromString(json);
			await withInverseWriteAccess(folderUri.fsPath, async () => {
				try {
					if (!(await this.fileService.exists(folderUri))) {
						await this.fileService.createFolder(folderUri);
					}
				} catch { /* May already exist */ }
				await this.fileService.writeFile(configUri, buffer);
			});
			console.log('[InvariantConfigLoader] Invariants saved');
		} catch (e) {
			console.error('[InvariantConfigLoader] Failed to save invariants:', e);
		}
	}
}
