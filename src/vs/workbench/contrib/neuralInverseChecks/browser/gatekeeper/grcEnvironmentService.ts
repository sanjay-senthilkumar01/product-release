/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';

export const IGRCEnvironmentService = createDecorator<IGRCEnvironmentService>('neuralInverseGRCEnvironmentService');

/**
 * GRC Enforcement Modes.
 *
 * - **DRAFT**: "Chaos Mode". No blocking. AI has full access. For rapid prototyping.
 * - **DEV**: "Standard". Blocks Critical security risks only. Standard AI tools.
 * - **PROD**: "Zero Trust". Blocks ALL violations. AI is restricted.
 */
export type GRCMode = 'draft' | 'dev' | 'prod';

export interface IGRCEnvironmentService {
	readonly _serviceBrand: undefined;

	/**
	 * The current enforcement mode.
	 */
	readonly mode: GRCMode;

	/**
	 * Fires when the mode changes.
	 */
	readonly onDidChangeMode: Event<GRCMode>;

	/**
	 * Set the current enforcement mode.
	 */
	setMode(mode: GRCMode): void;
}

const STORAGE_KEY = 'neuralInverse.grc.environmentMode';

export class GRCEnvironmentService extends Disposable implements IGRCEnvironmentService {
	declare readonly _serviceBrand: undefined;

	private _mode: GRCMode;

	private readonly _onDidChangeMode = this._register(new Emitter<GRCMode>());
	public readonly onDidChangeMode: Event<GRCMode> = this._onDidChangeMode.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		// Load from storage or default to 'dev'
		const storedMode = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE, 'dev');
		this._mode = this._isValidMode(storedMode) ? storedMode : 'dev';
	}

	public get mode(): GRCMode {
		return this._mode;
	}

	public setMode(mode: GRCMode): void {
		if (this._mode === mode) {
			return;
		}

		this._mode = mode;
		this.storageService.store(STORAGE_KEY, mode, StorageScope.WORKSPACE, StorageTarget.USER);
		this._onDidChangeMode.fire(mode);
		console.log(`[GRCEnvironmentService] Switched to ${mode.toUpperCase()} mode`);
	}

	private _isValidMode(mode: string): mode is GRCMode {
		return mode === 'draft' || mode === 'dev' || mode === 'prod';
	}
}

registerSingleton(IGRCEnvironmentService, GRCEnvironmentService, InstantiationType.Delayed);
