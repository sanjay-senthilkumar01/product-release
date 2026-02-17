/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

/**
 * GRC Domain categories mapping to each check view in the Checks Manager.
 */
export type GRCDomain = 'security' | 'compliance' | 'data-integrity' | 'architecture' | 'fail-safe' | 'policy';

/**
 * Severity levels for GRC rules.
 * - error: Blocks / hard violation. Shown as red squiggle.
 * - warning: Should fix. Shown as yellow squiggle.
 * - info: Informational. Shown as blue hint.
 */
export type GRCSeverity = 'error' | 'warning' | 'info';

/**
 * A single GRC rule definition.
 * Rules can be built-in (shipped with IDE) or user-defined (from .inverse/grc-rules.json).
 */
export interface IGRCRule {
	/** Unique identifier, e.g. "SEC-001" */
	id: string;

	/** Which domain this rule belongs to */
	domain: GRCDomain;

	/** Severity of a violation */
	severity: GRCSeverity;

	/** Regex pattern string to match violations. Applied per-line. */
	pattern: string;

	/** Human-readable description shown in diagnostics and dashboard */
	message: string;

	/** Optional suggested fix text */
	fix?: string;

	/** Whether this rule is active */
	enabled: boolean;

	/** Whether this is a built-in rule (cannot be deleted, only disabled) */
	builtin?: boolean;

	/**
	 * Optional: rule type for non-regex rules.
	 * - 'regex' (default): match pattern against each line
	 * - 'file-level': evaluate at file level (e.g. max lines, missing header)
	 */
	type?: 'regex' | 'file-level';

	/**
	 * For file-level rules, a threshold value (e.g. max line count).
	 */
	threshold?: number;
}

/**
 * Result of evaluating a single rule against code.
 */
export interface ICheckResult {
	/** The rule that was violated */
	ruleId: string;

	/** Domain of the rule */
	domain: GRCDomain;

	/** Severity */
	severity: GRCSeverity;

	/** Human-readable violation message */
	message: string;

	/** File where the violation was found */
	fileUri: URI;

	/** 1-based line number */
	line: number;

	/** 1-based column (start of match) */
	column: number;

	/** 1-based end line */
	endLine: number;

	/** 1-based end column */
	endColumn: number;

	/** The matched code snippet */
	codeSnippet?: string;

	/** Suggested fix (from rule definition) */
	fix?: string;

	/** Timestamp of when this check was performed */
	timestamp: number;
}

/**
 * Summary counts for a single domain.
 */
export interface IDomainSummary {
	domain: GRCDomain;
	errorCount: number;
	warningCount: number;
	infoCount: number;
	totalRules: number;
	enabledRules: number;
}

/**
 * Shape of the user's .inverse/grc-rules.json file.
 */
export interface IGRCConfig {
	version: string;
	rules: IGRCRule[];
	settings: {
		showDiagnostics: boolean;
		auditEnabled: boolean;
		/** File glob patterns to exclude from scanning */
		excludePatterns?: string[];
	};
}

/**
 * Default GRC config created for new workspaces.
 */
export const DEFAULT_GRC_CONFIG: IGRCConfig = {
	version: '1.0',
	rules: [],
	settings: {
		showDiagnostics: true,
		auditEnabled: true,
		excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.inverse/**']
	}
};
