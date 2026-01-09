/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INeuralInverseUserProfileService, IUserProfile } from '../common/neuralInverseUserProfile.js';
import { INeuralInverseAuthService } from '../../../services/neuralInverseAuth/common/neuralInverseAuth.js';

export class NeuralInverseUserProfileService extends Disposable implements INeuralInverseUserProfileService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeUserProfile = this._register(new Emitter<IUserProfile | undefined>());
	readonly onDidChangeUserProfile = this._onDidChangeUserProfile.event;

	private _userProfile: IUserProfile | undefined;
	private readonly STORAGE_KEY = 'neuralInverse.userProfile';

	constructor(
		@INeuralInverseAuthService private readonly authService: INeuralInverseAuthService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this._register(this.authService.onDidChangeAuthStatus(isAuthenticated => this.onAuthStatusChanged(isAuthenticated)));
		// Initial check if already authenticated
		this.checkInitialAuth();
	}

	private async checkInitialAuth(): Promise<void> {
		if (await this.authService.isAuthenticated()) {
			await this.getUserProfile();
		}
	}

	private async onAuthStatusChanged(isAuthenticated: boolean): Promise<void> {
		if (isAuthenticated) {
			await this.getUserProfile();
		} else {
			this._userProfile = undefined;
			this._onDidChangeUserProfile.fire(undefined);
		}
	}

	async getUserProfile(): Promise<IUserProfile | undefined> {
		console.log('NeuralInverseUserProfileService: getUserProfile called');

		// Load from storage first (local overrides)
		const storedProfileStr = this.storageService.get(this.STORAGE_KEY, StorageScope.PROFILE);
		const storedProfile = storedProfileStr ? JSON.parse(storedProfileStr) : {};

		if (this._userProfile) {
			console.log('NeuralInverseUserProfileService: Returning cached profile');
			return { ...this._userProfile, ...storedProfile };
		}

		if (!(await this.authService.isAuthenticated())) {
			console.log('NeuralInverseUserProfileService: Not authenticated');
			// Even if not authenticated, return stored local data if available (user might want to edit it offline)
			if (Object.keys(storedProfile).length > 0) {
				return storedProfile as IUserProfile;
			}
			return undefined;
		}

		const token = await this.authService.getToken();
		if (!token) {
			console.log('NeuralInverseUserProfileService: No token found');
			return undefined;
		}

		try {
			// DOMAIN should ideally be shared or passed in, but hardcoding for now as in auth service
			const DOMAIN = 'auth.neuralinverse.com';
			console.log(`NeuralInverseUserProfileService: Requesting profile from ${DOMAIN}`);
			const response = await this.nativeHostService.request(
				`https://${DOMAIN}/userinfo`,
				{
					type: 'GET',
					headers: {
						'Authorization': `Bearer ${token}`
					}
				}
			);

			console.log(`NeuralInverseUserProfileService: Response status: ${response.statusCode}`);

			if (response.statusCode === 200) {
				const apiProfile = JSON.parse(response.body);
				this._userProfile = apiProfile;

				// Merge API profile with local stored profile (local wins for overrides)
				const mergedProfile = { ...apiProfile, ...storedProfile };

				this._onDidChangeUserProfile.fire(mergedProfile);
				return mergedProfile;
			} else {
				this.logService.error(`NeuralInverseUserProfile: Failed to fetch profile. Status: ${response.statusCode}`);
				// Return stored profile if API fails
				if (Object.keys(storedProfile).length > 0) {
					return storedProfile as IUserProfile;
				}
				return undefined;
			}
		} catch (e) {
			this.logService.error('NeuralInverseUserProfile: Error fetching profile', e);
			console.error('NeuralInverseUserProfile: Error fetching profile', e);
			// Return stored profile if API error
			if (Object.keys(storedProfile).length > 0) {
				return storedProfile as IUserProfile;
			}
			return undefined;
		}
	}

	async updateUserProfile(profile: Partial<IUserProfile>): Promise<void> {
		// Get existing stored profile
		const storedProfileStr = this.storageService.get(this.STORAGE_KEY, StorageScope.PROFILE);
		const storedProfile = storedProfileStr ? JSON.parse(storedProfileStr) : {};

		// Merge updates
		const updatedStoredProfile = { ...storedProfile, ...profile };

		// Save back to storage
		this.storageService.store(this.STORAGE_KEY, JSON.stringify(updatedStoredProfile), StorageScope.PROFILE, StorageTarget.USER);

		// Update in-memory cache and fire event
		if (this._userProfile) {
			const mergedProfile = { ...this._userProfile, ...updatedStoredProfile };
			this._onDidChangeUserProfile.fire(mergedProfile);
		} else {
			// If we only have local data
			this._onDidChangeUserProfile.fire(updatedStoredProfile as IUserProfile);
		}
	}
}

registerSingleton(INeuralInverseUserProfileService, NeuralInverseUserProfileService, InstantiationType.Delayed);
