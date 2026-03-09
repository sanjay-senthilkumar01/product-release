/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ITrackedDependency {
	name: string;
	versionConstraint: string;
	resolvedVersion?: string;
	isDev: boolean;
	ecosystem: DependencyEcosystem;
	sourceFile: string;
	status: DependencyStatus;
	reason?: string;
}

export type DependencyEcosystem = 'npm' | 'pip' | 'go' | 'cargo' | 'maven' | 'nuget' | 'unknown';
export type DependencyStatus = 'allowed' | 'blocked' | 'flagged' | 'unknown';

export interface IDependencyPolicyRule {
	pattern: string;
	action: 'block' | 'flag' | 'allow';
	reason: string;
	ecosystems?: DependencyEcosystem[];
}

export interface IDependencyStats {
	totalDependencies: number;
	devDependencies: number;
	prodDependencies: number;
	blocked: number;
	flagged: number;
	byEcosystem: Partial<Record<DependencyEcosystem, number>>;
	lastScanTimestamp: number;
}

export interface IDependencyChangeEvent {
	type: 'added' | 'removed' | 'updated';
	dependency: ITrackedDependency;
	sourceFile: string;
}
