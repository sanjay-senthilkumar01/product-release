/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGRCRule } from './grcTypes.js';

/**
 * Built-in GRC rules that ship with the Neural Inverse IDE.
 * Users can override severity or disable these via .inverse/grc-rules.json.
 * They cannot be deleted by the user config.
 */
export const BUILTIN_RULES: IGRCRule[] = [

	// ─── Security Rules ──────────────────────────────────────────────
	{
		id: 'SEC-001',
		domain: 'security',
		severity: 'error',
		pattern: '\\beval\\s*\\(',
		message: 'eval() is forbidden - use safe alternatives (Function constructor, JSON.parse, etc.)',
		fix: 'Replace eval() with a safe parsing method',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'SEC-002',
		domain: 'security',
		severity: 'error',
		pattern: '\\.innerHTML\\s*=',
		message: 'Direct innerHTML assignment is a XSS risk - use textContent or safe DOM APIs',
		fix: 'Use element.textContent or a sanitization library',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'SEC-003',
		domain: 'security',
		severity: 'warning',
		pattern: '(password|secret|api[_-]?key|token|private[_-]?key)\\s*[:=]\\s*[\'"`][^\'"`]{4,}',
		message: 'Possible hardcoded credential detected - use environment variables or a secrets manager',
		fix: 'Move sensitive values to environment variables or a vault',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'SEC-004',
		domain: 'security',
		severity: 'error',
		pattern: '\\bdocument\\.write\\s*\\(',
		message: 'document.write() is forbidden - use safe DOM manipulation',
		fix: 'Use document.createElement or element.textContent',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'SEC-005',
		domain: 'security',
		severity: 'warning',
		pattern: 'dangerouslySetInnerHTML',
		message: 'dangerouslySetInnerHTML bypasses React XSS protection',
		fix: 'Use a sanitization library like DOMPurify before setting HTML',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'SEC-006',
		domain: 'security',
		severity: 'error',
		pattern: 'new\\s+Function\\s*\\(',
		message: 'new Function() is equivalent to eval() and is forbidden',
		fix: 'Use a safer alternative for dynamic code execution',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'SEC-007',
		domain: 'security',
		severity: 'warning',
		pattern: '(http:\\/\\/)',
		message: 'Insecure HTTP URL detected - use HTTPS',
		fix: 'Replace http:// with https://',
		enabled: true,
		builtin: true,
		type: 'regex'
	},

	// ─── Compliance Rules ────────────────────────────────────────────
	{
		id: 'CMP-001',
		domain: 'compliance',
		severity: 'info',
		pattern: '\\bconsole\\.(log|debug|info)\\s*\\(',
		message: 'Console logging detected - ensure this is removed in production builds',
		fix: 'Use a structured logging framework instead of console.log',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'CMP-002',
		domain: 'compliance',
		severity: 'warning',
		pattern: '(@ts-ignore|@ts-nocheck)',
		message: 'TypeScript safety bypass detected - document the reason or fix the type error',
		fix: 'Fix the underlying type error instead of suppressing it',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'CMP-003',
		domain: 'compliance',
		severity: 'info',
		pattern: '(TODO|FIXME|HACK|XXX|TEMP)\\b',
		message: 'Unresolved TODO/FIXME marker - track these in your issue tracker',
		fix: 'Create a ticket and either resolve or remove the marker',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'CMP-004',
		domain: 'compliance',
		severity: 'warning',
		pattern: '\\b(deprecated|@deprecated)\\b',
		message: 'Use of deprecated API or annotation - migrate to the recommended alternative',
		fix: 'Check documentation for the recommended replacement',
		enabled: true,
		builtin: true,
		type: 'regex'
	},

	// ─── Data Integrity Rules ────────────────────────────────────────
	{
		id: 'DI-001',
		domain: 'data-integrity',
		severity: 'warning',
		pattern: ':\\s*any\\b',
		message: 'Avoid using \'any\' type - use explicit types for data integrity',
		fix: 'Replace \'any\' with a specific type or generic',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'DI-002',
		domain: 'data-integrity',
		severity: 'error',
		pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
		message: 'Empty catch block - errors are silently swallowed, causing data loss risk',
		fix: 'Log the error or handle it explicitly',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'DI-003',
		domain: 'data-integrity',
		severity: 'warning',
		pattern: 'as\\s+any\\b',
		message: 'Unsafe type assertion to \'any\' - bypasses type safety',
		fix: 'Use a specific type assertion or type guard',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'DI-004',
		domain: 'data-integrity',
		severity: 'warning',
		pattern: '!\\.',
		message: 'Non-null assertion operator - may hide null/undefined bugs',
		fix: 'Use optional chaining (?.) or explicit null checks',
		enabled: true,
		builtin: true,
		type: 'regex'
	},

	// ─── Fail-Safe Defaults Rules ────────────────────────────────────
	{
		id: 'FS-001',
		domain: 'fail-safe',
		severity: 'error',
		pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
		message: 'Empty catch block violates fail-safe defaults - errors must be handled',
		fix: 'Add error logging or recovery logic in the catch block',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'FS-002',
		domain: 'fail-safe',
		severity: 'warning',
		pattern: 'catch\\s*\\([^)]*\\)\\s*\\{[^}]*(?:return\\s*;|return\\s+null|return\\s+undefined)',
		message: 'Catch block returns null/undefined - use a safe default value',
		fix: 'Return a meaningful default value or re-throw the error',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'FS-003',
		domain: 'fail-safe',
		severity: 'warning',
		pattern: '\\bPromise\\.all\\s*\\(',
		message: 'Promise.all fails fast on any rejection - consider Promise.allSettled for resilience',
		fix: 'Use Promise.allSettled() to handle partial failures gracefully',
		enabled: true,
		builtin: true,
		type: 'regex'
	},

	// ─── Architecture Rules ──────────────────────────────────────────
	{
		id: 'ARC-001',
		domain: 'architecture',
		severity: 'warning',
		pattern: '',
		message: 'File exceeds 500 lines - consider splitting into smaller modules',
		fix: 'Extract related functionality into separate files',
		enabled: true,
		builtin: true,
		type: 'file-level',
		threshold: 500
	},
	{
		id: 'ARC-002',
		domain: 'architecture',
		severity: 'info',
		pattern: '^import\\s.*from\\s+[\'"]\\.\\./',
		message: 'Relative parent import detected - consider using path aliases for cleaner imports',
		fix: 'Configure path aliases in tsconfig.json',
		enabled: true,
		builtin: true,
		type: 'regex'
	},

	// ─── Policy Rules (extend existing PolicyService) ────────────────
	{
		id: 'POL-001',
		domain: 'policy',
		severity: 'error',
		pattern: '\\balert\\s*\\(',
		message: 'alert() is forbidden by project policy',
		fix: 'Use a notification service or modal dialog',
		enabled: true,
		builtin: true,
		type: 'regex'
	},
	{
		id: 'POL-002',
		domain: 'policy',
		severity: 'error',
		pattern: '\\bvar\\s+',
		message: 'var declarations are forbidden - use const or let',
		fix: 'Replace var with const (preferred) or let',
		enabled: true,
		builtin: true,
		type: 'regex'
	}
];
