/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const INeuralInverseUserProfileService = createDecorator<INeuralInverseUserProfileService>('neuralInverseUserProfileService');

export interface IUserProfile {
	sub: string;
	name: string;
	given_name: string;
	family_name: string;
	picture: string;
	email: string;
	email_verified: boolean;
	locale: string;
	nickname?: string;
}

export interface INeuralInverseUserProfileService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeUserProfile: Event<IUserProfile | undefined>;

	getUserProfile(): Promise<IUserProfile | undefined>;
	updateUserProfile(profile: Partial<IUserProfile>): Promise<void>;
}
