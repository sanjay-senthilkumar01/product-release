/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { ICheckResult } from './grcTypes.js';
import { IGRCEngineService } from './grcEngineService.js';

export const IAuditTrailService = createDecorator<IAuditTrailService>('neuralInverseAuditTrailService');

export interface IAuditEntry {
	timestamp: number;
	date: string;
	ruleId: string;
	domain: string;
	severity: string;
	file: string;
	line: number;
	message: string;
	codeSnippet?: string;
}

export interface IAuditTrailService {
	readonly _serviceBrand: undefined;

	/** Get audit entries for today */
	getEntries(date?: string): Promise<IAuditEntry[]>;

	/** Get all available audit dates */
	getAvailableDates(): Promise<string[]>;

	/** Get count of entries for today */
	getTodayCount(): number;
}

const AUDIT_FOLDER = '.inverse/audit';

export class AuditTrailService extends Disposable implements IAuditTrailService {
	declare readonly _serviceBrand: undefined;

	private _todayCount = 0;
	private _writeQueue: IAuditEntry[] = [];
	private _writeTimer: any;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IGRCEngineService private readonly grcEngine: IGRCEngineService
	) {
		super();
		this._subscribeToEngine();
	}

	private _subscribeToEngine(): void {
		this._register(this.grcEngine.onDidCheckComplete(results => {
			if (results.length === 0) {
				return;
			}

			const entries = results.map(r => this._resultToEntry(r));
			this._todayCount += entries.length;
			this._writeQueue.push(...entries);

			// Debounce writes to avoid thrashing disk
			if (this._writeTimer) {
				clearTimeout(this._writeTimer);
			}
			this._writeTimer = setTimeout(() => this._flushQueue(), 2000);
		}));
	}

	private _resultToEntry(result: ICheckResult): IAuditEntry {
		return {
			timestamp: result.timestamp,
			date: new Date(result.timestamp).toISOString(),
			ruleId: result.ruleId,
			domain: result.domain,
			severity: result.severity,
			file: result.fileUri.path,
			line: result.line,
			message: result.message,
			codeSnippet: result.codeSnippet
		};
	}

	private async _flushQueue(): Promise<void> {
		if (this._writeQueue.length === 0) {
			return;
		}

		const entries = [...this._writeQueue];
		this._writeQueue = [];

		const auditUri = this._getAuditFileUri();
		if (!auditUri) {
			return;
		}

		try {
			// Ensure audit folder exists
			const folderUri = this._getAuditFolderUri();
			if (folderUri) {
				try {
					if (!(await this.fileService.exists(folderUri))) {
						await this.fileService.createFolder(folderUri);
					}
				} catch {
					// May already exist
				}
			}

			// Read existing entries
			let existing: IAuditEntry[] = [];
			try {
				if (await this.fileService.exists(auditUri)) {
					const content = await this.fileService.readFile(auditUri);
					existing = JSON.parse(content.value.toString());
				}
			} catch {
				existing = [];
			}

			// Append new entries
			const combined = [...existing, ...entries];

			// Write back
			const buffer = VSBuffer.fromString(JSON.stringify(combined, null, 2));
			await this.fileService.writeFile(auditUri, buffer);

			console.log('[AuditTrail] Wrote', entries.length, 'entries to audit log');
		} catch (e) {
			console.error('[AuditTrail] Failed to write audit log:', e);
		}
	}

	private _getTodayDateString(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	private _getAuditFolderUri(): URI | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}
		return URI.joinPath(folders[0].uri, AUDIT_FOLDER);
	}

	private _getAuditFileUri(date?: string): URI | undefined {
		const folderUri = this._getAuditFolderUri();
		if (!folderUri) {
			return undefined;
		}
		const dateStr = date ?? this._getTodayDateString();
		return URI.joinPath(folderUri, `${dateStr}.json`);
	}

	public async getEntries(date?: string): Promise<IAuditEntry[]> {
		const fileUri = this._getAuditFileUri(date);
		if (!fileUri) {
			return [];
		}

		try {
			if (!(await this.fileService.exists(fileUri))) {
				return [];
			}
			const content = await this.fileService.readFile(fileUri);
			return JSON.parse(content.value.toString());
		} catch {
			return [];
		}
	}

	public async getAvailableDates(): Promise<string[]> {
		const folderUri = this._getAuditFolderUri();
		if (!folderUri) {
			return [];
		}

		try {
			if (!(await this.fileService.exists(folderUri))) {
				return [];
			}

			const stat = await this.fileService.resolve(folderUri);
			if (!stat.children) {
				return [];
			}

			return stat.children
				.filter(c => !c.isDirectory && c.name.endsWith('.json'))
				.map(c => c.name.replace('.json', ''))
				.sort()
				.reverse();
		} catch {
			return [];
		}
	}

	public getTodayCount(): number {
		return this._todayCount;
	}

	override dispose(): void {
		// Flush any remaining entries before disposal
		if (this._writeTimer) {
			clearTimeout(this._writeTimer);
		}
		this._flushQueue();
		super.dispose();
	}
}

registerSingleton(IAuditTrailService, AuditTrailService, InstantiationType.Eager);
