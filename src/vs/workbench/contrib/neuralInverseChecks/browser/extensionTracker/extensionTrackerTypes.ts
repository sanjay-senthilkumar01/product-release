/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ITrackedExtension {
	id: string;
	displayName: string;
	version: string;
	publisher: string;
	isEnabled: boolean;
	status: ExtensionPolicyStatus;
	reason?: string;
	firstSeenTimestamp: number;
	categories?: string[];
	dependencyCount: number;
}

export type ExtensionPolicyStatus = 'allowed' | 'blocked' | 'flagged' | 'required' | 'unknown';

export interface IExtensionPolicyRule {
	pattern: string;
	action: 'block' | 'flag' | 'allow' | 'require';
	reason: string;
}

export interface IExtensionStats {
	totalInstalled: number;
	enabled: number;
	disabled: number;
	blocked: number;
	flagged: number;
	required: number;
	missingRequired: number;
	lastScanTimestamp: number;
}

export interface IExtensionChangeEvent {
	type: 'installed' | 'uninstalled' | 'enabled' | 'disabled' | 'blocked' | 'flagged';
	extensionId: string;
	displayName?: string;
	reason?: string;
}
