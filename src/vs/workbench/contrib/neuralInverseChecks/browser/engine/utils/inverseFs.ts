/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Inverse Filesystem Utilities
 *
 * The `.inverse/` directory is write-locked by the nano agent after each analysis
 * cycle (`chmod -R a-w .inverse`). Any IDE service that needs to write files there
 * must temporarily unlock it first, then re-lock after the write.
 *
 * Usage:
 * ```typescript
 * await withInverseWriteAccess(rootPath, async () => {
 *     await this.fileService.writeFile(uri, buffer);
 * });
 * ```
 */

import { isWindows } from '../../../../../../base/common/platform.js';

/**
 * Temporarily grants write access to the `.inverse` directory,
 * runs the callback, then re-locks it — even if the callback throws.
 *
 * Uses `(globalThis as any).require('child_process')` which works in
 * VS Code's Electron renderer process (not available in pure web builds).
 *
 * @param inversePath - Absolute filesystem path to the `.inverse` folder
 * @param fn - Async callback that performs the write operation(s)
 */
export async function withInverseWriteAccess(inversePath: string, fn: () => Promise<void>): Promise<void> {
	await _chmodInverse(inversePath, true);
	try {
		await fn();
	} finally {
		await _chmodInverse(inversePath, false);
	}
}

async function _chmodInverse(inversePath: string, unlock: boolean): Promise<void> {
	if (isWindows) {
		const flag = unlock ? '-r' : '+r';
		const cmd = `attrib ${flag} "${inversePath}\\*" /s`;
		await _exec(cmd);
	} else {
		const mode = unlock ? 'u+w' : 'a-w';
		const cmd = `chmod -R ${mode} "${inversePath}"`;
		await _exec(cmd);
	}
}

async function _exec(cmd: string): Promise<void> {
	try {
		const nodeRequire = (globalThis as any).require as NodeRequire | undefined;
		if (!nodeRequire) {
			// Not in Electron renderer — skip (no-op in web builds)
			return;
		}
		const { exec } = nodeRequire('child_process') as typeof import('child_process');
		await new Promise<void>((resolve, reject) => {
			exec(cmd, (err) => {
				if (err) {
					console.warn('[InverseFs] chmod command failed:', err.message);
					// Resolve anyway — best-effort, don't block the write attempt
					resolve();
				} else {
					resolve();
				}
			});
		});
	} catch (e) {
		// Best-effort — don't break callers if Node is unavailable
		console.warn('[InverseFs] Could not run chmod:', e);
	}
}
