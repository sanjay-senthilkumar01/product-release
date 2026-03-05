/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Types for the lightweight formal verification (invariant checking) system.
 *
 * Invariants are defined in `.inverse/invariants.json` and checked by the
 * InvariantAnalyzer, which is registered as a standard GRC rule analyzer.
 */

/**
 * A single invariant definition.
 *
 * Invariants express properties that must hold in the code:
 * - `always`: A variable must never violate the expression (e.g., `balance >= 0`)
 * - `before-call`: A guard condition must be true before calling target functions
 * - `after-call`: A condition must hold after calling target functions
 */
export interface IInvariantDefinition {
	/** Unique identifier, e.g. "INV-001" */
	id: string;

	/** Human-readable name, e.g. "Non-negative balance" */
	name: string;

	/**
	 * The invariant expression to verify.
	 *
	 * Supported operators: `>=`, `<=`, `==`, `!=`, `>`, `<`
	 * Left side: variable name. Right side: literal value.
	 *
	 * Examples:
	 * - "balance >= 0"
	 * - "isAuthenticated == true"
	 * - "retryCount <= 3"
	 */
	expression: string;

	/**
	 * When the invariant must hold:
	 * - `always`: Every assignment to tracked variables must preserve the invariant
	 * - `before-call`: Guard must be true before calling any of `targetCalls`
	 * - `after-call`: Condition must hold after calling any of `targetCalls`
	 */
	scope: 'always' | 'before-call' | 'after-call';

	/** Variables to track for `always` scope */
	variables?: string[];

	/** Target function names for `before-call` / `after-call` scope */
	targetCalls?: string[];

	/** Severity of violations */
	severity: string;

	/** Domain for this invariant (defaults to "formal-verification") */
	domain?: string;

	/** Whether this invariant is active (defaults to true) */
	enabled?: boolean;
}

/**
 * Shape of `.inverse/invariants.json`.
 */
export interface IInvariantConfig {
	version: string;
	invariants: IInvariantDefinition[];
}

/**
 * Default invariant config for new workspaces.
 */
export const DEFAULT_INVARIANT_CONFIG: IInvariantConfig = {
	version: '1.0',
	invariants: []
};

/**
 * Parsed invariant expression.
 * Extracted from the expression string for evaluation.
 */
export interface IParsedExpression {
	variable: string;
	operator: '>=' | '<=' | '==' | '!=' | '>' | '<';
	value: string | number | boolean;
}

/**
 * Parse a simple invariant expression string into its components.
 * Returns undefined for expressions that can't be parsed.
 */
export function parseInvariantExpression(expression: string): IParsedExpression | undefined {
	const match = expression.trim().match(/^(\w+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
	if (!match) {
		return undefined;
	}

	const [, variable, operator, rawValue] = match;
	let value: string | number | boolean;

	// Parse value
	const trimmedValue = rawValue.trim();
	if (trimmedValue === 'true') {
		value = true;
	} else if (trimmedValue === 'false') {
		value = false;
	} else if (trimmedValue === 'null' || trimmedValue === 'undefined') {
		value = trimmedValue;
	} else if (!isNaN(Number(trimmedValue))) {
		value = Number(trimmedValue);
	} else {
		// String value (strip quotes if present)
		value = trimmedValue.replace(/^['"]|['"]$/g, '');
	}

	return {
		variable,
		operator: operator as IParsedExpression['operator'],
		value
	};
}
