/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Built-in Rules — The Default Framework
 *
 * These are the GRC rules that ship with the Neural Inverse IDE.
 * They serve as the **default framework** — a baseline of common safety
 * and quality checks that apply to any project, regardless of industry.
 *
 * ## Relationship to Imported Frameworks
 *
 * - This is just ONE framework among potentially many
 * - Enterprise-imported frameworks from `.inverse/frameworks/` are loaded alongside
 * - If an imported framework has a rule with the same ID as a built-in rule,
 *   the framework rule takes precedence
 * - Users can disable any built-in rule via `.inverse/grc-rules.json` but cannot delete them
 *
 * ## Rule Structure
 *
 * Each rule is exported both as:
 * 1. `BUILTIN_FRAMEWORK` — an IFrameworkDefinition for the framework registry
 * 2. `BUILTIN_RULES` — a flat IGRCRule[] array for backward compatibility with
 *    existing code that references rules directly
 *
 * ## Adding New Rules
 *
 * When adding built-in rules, add them to the `BUILTIN_FRAMEWORK.rules` array.
 * The `BUILTIN_RULES` export is derived from it automatically.
 */

import { IFrameworkDefinition } from '../framework/frameworkSchema.js';
import { IGRCRule } from '../types/grcTypes.js';


// ─── Default Framework Definition ────────────────────────────────────────────

/**
 * The built-in framework definition.
 *
 * This follows the exact same schema that enterprise-imported frameworks use.
 * The only difference is it ships with the IDE rather than being loaded from disk.
 */
export const BUILTIN_FRAMEWORK: IFrameworkDefinition = {
	framework: {
		id: 'neural-inverse-builtin',
		name: 'Neural Inverse Built-in Rules',
		version: '1.0.0',
		description: 'Default safety and quality checks that ship with the Neural Inverse IDE. These apply to all projects as a baseline. Enterprises can add their own frameworks for industry-specific compliance.',
		authority: 'Neural Inverse',
		appliesTo: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
	},

	rules: [
		// ─── Security Rules ──────────────────────────────────────────────
		{
			id: 'SEC-001',
			title: 'eval() is forbidden - use safe alternatives',
			description: 'eval() executes arbitrary code and is a major injection vector. Use JSON.parse() for data or pre-compiled functions.',
			severity: 'error',
			category: 'security',
			check: { type: 'regex', pattern: '\\beval\\s*\\(' },
			fix: 'Replace eval() with a safe parsing method',
			references: ['CWE-94', 'OWASP A03:2021'],
			tags: ['injection', 'dynamic-code'],
		},
		{
			id: 'SEC-002',
			title: 'Direct innerHTML assignment is a XSS risk',
			description: 'Setting innerHTML directly allows injection of arbitrary HTML and scripts.',
			severity: 'error',
			category: 'security',
			check: { type: 'regex', pattern: '\\.innerHTML\\s*=' },
			fix: 'Use element.textContent or a sanitization library',
			references: ['CWE-79', 'OWASP A03:2021'],
			tags: ['xss', 'dom'],
		},
		{
			id: 'SEC-003',
			title: 'Possible hardcoded credential detected',
			description: 'Hardcoded passwords, API keys, and tokens are a major security risk. They can be extracted from source code or version history.',
			severity: 'warning',
			category: 'security',
			check: { type: 'regex', pattern: '(password|secret|api[_-]?key|token|private[_-]?key)\\s*[:=]\\s*[\'"`][^\'"`]{4,}', flags: 'i' },
			fix: 'Move sensitive values to environment variables or a vault',
			references: ['CWE-798', 'OWASP A07:2021'],
			tags: ['credentials', 'secrets'],
		},
		{
			id: 'SEC-004',
			title: 'document.write() is forbidden',
			description: 'document.write() can overwrite the entire page and is an XSS vector.',
			severity: 'error',
			category: 'security',
			check: { type: 'regex', pattern: '\\bdocument\\.write\\s*\\(' },
			fix: 'Use document.createElement or element.textContent',
			references: ['CWE-79'],
			tags: ['xss', 'dom'],
		},
		{
			id: 'SEC-005',
			title: 'dangerouslySetInnerHTML bypasses React XSS protection',
			severity: 'warning',
			category: 'security',
			check: { type: 'regex', pattern: 'dangerouslySetInnerHTML' },
			fix: 'Use a sanitization library like DOMPurify before setting HTML',
			references: ['CWE-79'],
			tags: ['xss', 'react'],
		},
		{
			id: 'SEC-006',
			title: 'new Function() is equivalent to eval() and is forbidden',
			severity: 'error',
			category: 'security',
			check: { type: 'regex', pattern: 'new\\s+Function\\s*\\(' },
			fix: 'Use a safer alternative for dynamic code execution',
			references: ['CWE-94'],
			tags: ['injection', 'dynamic-code'],
		},
		{
			id: 'SEC-007',
			title: 'Insecure HTTP URL detected',
			description: 'Unencrypted HTTP connections expose data to interception.',
			severity: 'warning',
			category: 'security',
			check: { type: 'regex', pattern: '(http:\\/\\/)' },
			fix: 'Replace http:// with https://',
			references: ['CWE-319'],
			tags: ['transport', 'encryption'],
		},

		// ─── Compliance Rules ────────────────────────────────────────────
		{
			id: 'CMP-001',
			title: 'Console logging detected',
			description: 'Console.log statements should be removed from production builds. Use a structured logging framework.',
			severity: 'info',
			category: 'compliance',
			check: { type: 'regex', pattern: '\\bconsole\\.(log|debug|info)\\s*\\(' },
			fix: 'Use a structured logging framework instead of console.log',
			tags: ['logging', 'production'],
		},
		{
			id: 'CMP-002',
			title: 'TypeScript safety bypass detected',
			severity: 'warning',
			category: 'compliance',
			check: { type: 'regex', pattern: '(@ts-ignore|@ts-nocheck)' },
			fix: 'Fix the underlying type error instead of suppressing it',
			tags: ['typescript', 'type-safety'],
		},
		{
			id: 'CMP-003',
			title: 'Unresolved TODO/FIXME marker',
			description: 'Technical debt markers should be tracked in an issue tracker, not left in code indefinitely.',
			severity: 'info',
			category: 'compliance',
			check: { type: 'regex', pattern: '(TODO|FIXME|HACK|XXX|TEMP)\\b' },
			fix: 'Create a ticket and either resolve or remove the marker',
			tags: ['tech-debt', 'tracking'],
		},
		{
			id: 'CMP-004',
			title: 'Use of deprecated API or annotation',
			severity: 'warning',
			category: 'compliance',
			check: { type: 'regex', pattern: '\\b(deprecated|@deprecated)\\b' },
			fix: 'Check documentation for the recommended replacement',
			tags: ['deprecation', 'migration'],
		},

		// ─── Data Integrity Rules ────────────────────────────────────────
		{
			id: 'DI-001',
			title: 'Avoid using \'any\' type',
			description: 'The `any` type disables type checking, allowing runtime type errors and data corruption.',
			severity: 'warning',
			category: 'data-integrity',
			check: { type: 'regex', pattern: ':\\s*any\\b' },
			fix: 'Replace \'any\' with a specific type or generic',
			references: ['CWE-704'],
			tags: ['type-safety', 'typescript'],
		},
		{
			id: 'DI-002',
			title: 'Empty catch block swallows errors',
			description: 'Empty catch blocks silently discard errors, making bugs invisible and causing potential data loss.',
			severity: 'error',
			category: 'data-integrity',
			check: { type: 'regex', pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}' },
			fix: 'Log the error or handle it explicitly',
			references: ['CWE-390'],
			tags: ['error-handling'],
		},
		{
			id: 'DI-003',
			title: 'Unsafe type assertion to \'any\'',
			severity: 'warning',
			category: 'data-integrity',
			check: { type: 'regex', pattern: 'as\\s+any\\b' },
			fix: 'Use a specific type assertion or type guard',
			references: ['CWE-704'],
			tags: ['type-safety', 'typescript'],
		},
		{
			id: 'DI-004',
			title: 'Non-null assertion operator may hide bugs',
			severity: 'warning',
			category: 'data-integrity',
			check: { type: 'regex', pattern: '!\\.' },
			fix: 'Use optional chaining (?.) or explicit null checks',
			references: ['CWE-476'],
			tags: ['null-safety'],
		},

		// ─── Fail-Safe Defaults Rules ────────────────────────────────────
		{
			id: 'FS-001',
			title: 'Empty catch block violates fail-safe defaults',
			description: 'In safety-critical software, all errors must be handled or propagated. Silent failure creates undetectable failure modes.',
			severity: 'error',
			category: 'fail-safe',
			check: { type: 'regex', pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}' },
			fix: 'Add error logging or recovery logic in the catch block',
			references: ['CWE-390'],
			tags: ['error-handling', 'safety'],
		},
		{
			id: 'FS-002',
			title: 'Catch block returns null/undefined instead of safe default',
			severity: 'warning',
			category: 'fail-safe',
			check: { type: 'regex', pattern: 'catch\\s*\\([^)]*\\)\\s*\\{[^}]*(?:return\\s*;|return\\s+null|return\\s+undefined)' },
			fix: 'Return a meaningful default value or re-throw the error',
			tags: ['error-handling', 'defaults'],
		},
		{
			id: 'FS-003',
			title: 'Promise.all fails fast on any rejection',
			description: 'Promise.all rejects immediately when any promise rejects, potentially losing results from other promises.',
			severity: 'warning',
			category: 'fail-safe',
			check: { type: 'regex', pattern: '\\bPromise\\.all\\s*\\(' },
			fix: 'Use Promise.allSettled() to handle partial failures gracefully',
			tags: ['async', 'resilience'],
		},

		// ─── Architecture Rules ──────────────────────────────────────────
		{
			id: 'ARC-001',
			title: 'File exceeds 500 lines',
			description: 'Large files are harder to understand, test, and maintain. Consider decomposition.',
			severity: 'warning',
			category: 'architecture',
			check: { type: 'file-level', detect: 'max-lines', threshold: 500 },
			fix: 'Extract related functionality into separate files',
			tags: ['complexity', 'maintainability'],
		},
		{
			id: 'ARC-002',
			title: 'Relative parent import detected',
			description: 'Deep relative imports (../../) are fragile and hard to read. Path aliases improve maintainability.',
			severity: 'info',
			category: 'architecture',
			check: { type: 'regex', pattern: '^import\\s.*from\\s+[\'"]\\.\\./' },
			fix: 'Configure path aliases in tsconfig.json',
			tags: ['imports', 'organization'],
		},

		// ─── Policy Rules ────────────────────────────────────────────────
		{
			id: 'POL-001',
			title: 'alert() is forbidden by project policy',
			severity: 'error',
			category: 'policy',
			check: { type: 'regex', pattern: '\\balert\\s*\\(' },
			fix: 'Use a notification service or modal dialog',
			tags: ['ui', 'user-experience'],
		},
		{
			id: 'POL-002',
			title: 'var declarations are forbidden',
			description: 'var has function scope and hoisting behavior that causes bugs. const/let have block scope.',
			severity: 'error',
			category: 'policy',
			check: { type: 'regex', pattern: '\\bvar\\s+' },
			fix: 'Replace var with const (preferred) or let',
			tags: ['best-practices', 'javascript'],
		},
	],

	categories: {
		'security': { label: 'Security as Code', icon: 'shield', color: '#ff5252' },
		'compliance': { label: 'Compliance as Code', icon: 'verified', color: '#ffd740' },
		'data-integrity': { label: 'Data Integrity', icon: 'database', color: '#ab47bc' },
		'architecture': { label: 'Architecture as Code', icon: 'layers', color: '#42a5f5' },
		'fail-safe': { label: 'Fail-Safe Defaults', icon: 'error', color: '#ff7043' },
		'policy': { label: 'Code as Policy', icon: 'policy', color: '#66bb6a' },
	},
};


// ─── Backward Compatibility Export ───────────────────────────────────────────

/**
 * Flat array of built-in rules in IGRCRule format.
 *
 * This is the backward-compatible export used by existing code
 * (grcConfigLoader, grcEngineService, etc.) that expects IGRCRule[].
 *
 * Derived automatically from the BUILTIN_FRAMEWORK definition.
 */
export const BUILTIN_RULES: IGRCRule[] = BUILTIN_FRAMEWORK.rules.map(fwRule => {
	// Extract pattern for regex rules
	let pattern = '';
	if (fwRule.check.type === 'regex') {
		pattern = (fwRule.check as any).pattern || '';
	}

	return {
		id: fwRule.id,
		domain: fwRule.category,
		severity: fwRule.severity === 'error' ? 'error' : fwRule.severity === 'warning' ? 'warning' : 'info',
		pattern: pattern,
		message: fwRule.title + (fwRule.description ? ` — ${fwRule.description}` : ''),
		fix: fwRule.fix,
		enabled: fwRule.enabled !== false,
		builtin: true,
		type: (fwRule.check.type === 'file-level' ? 'file-level' : fwRule.check.type) as any,
		threshold: fwRule.check.type === 'file-level' ? (fwRule.check as any).threshold : undefined,
		check: fwRule.check,
		frameworkId: 'neural-inverse-builtin',
		references: fwRule.references,
		tags: fwRule.tags,
	} satisfies IGRCRule;
});
