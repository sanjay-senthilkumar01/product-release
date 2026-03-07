/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Built-in Agent & Workflow Library
 *
 * Pre-built agent definitions and workflow templates that are auto-provisioned
 * into .inverse/ on first workspace open.
 *
 * These replace common internal dev tools:
 *   code-reviewer      → manual PR review process
 *   test-generator     → manual test writing
 *   dependency-auditor → running npm audit / outdated manually
 *   release-manager    → manual changelog + version bump process
 *   docs-generator     → manual JSDoc / README authoring
 */

import { IAgentDefinition } from '../common/workflowTypes.js';
import { IWorkflowDefinition } from '../common/workflowTypes.js';

// ─── Built-in Agents ──────────────────────────────────────────────────────────

export const BUILTIN_AGENTS: IAgentDefinition[] = [
	{
		id: 'code-reviewer',
		name: 'Code Reviewer',
		description: 'Reviews staged diffs and changed files for bugs, security issues, code quality, and adherence to project conventions.',
		model: { providerName: 'anthropic', modelName: 'claude-sonnet-4-6' },
		systemInstructions: `You are an expert code reviewer with deep knowledge of software engineering best practices, security vulnerabilities, and clean code principles.

Your responsibilities:
1. Read the git diff or specified files carefully
2. Identify: bugs, security vulnerabilities, performance issues, code smells, missing error handling
3. Check for: naming consistency, code duplication, unnecessary complexity
4. Verify: tests exist for new logic, documentation is updated
5. Output a structured review with severity levels: CRITICAL, WARNING, SUGGESTION

Format your output as:
## Summary
<one paragraph overall assessment>

## Issues
### [SEVERITY] File:Line — Issue title
Description and recommended fix.

## Approved Changes
List things done well.

Be specific, actionable, and reference line numbers when possible.`,
		allowedTools: ['gitStatus', 'gitDiff', 'readFile', 'searchCode'],
		maxIterations: 8,
		tags: ['code-quality', 'git', 'review'],
		isBuiltin: true,
		createdAt: 1700000000000,
	},
	{
		id: 'test-generator',
		name: 'Test Generator',
		description: 'Generates comprehensive unit and integration tests for specified source files, following the project\'s existing test patterns.',
		model: { providerName: 'anthropic', modelName: 'claude-sonnet-4-6' },
		systemInstructions: `You are an expert software engineer specializing in test-driven development.

Your responsibilities:
1. Read the target source file(s) thoroughly
2. Discover existing test patterns by reading nearby test files
3. Generate tests that cover: happy paths, edge cases, error conditions, boundary values
4. Match the project's testing framework (Jest, Mocha, Vitest, etc.) and conventions
5. Write tests that are clear, isolated, and don't rely on implementation details

Rules:
- Never overwrite existing test files — create new ones or append to existing ones
- Keep test descriptions human-readable
- Use descriptive variable names in tests
- Mock external dependencies appropriately

Output the full test file content, then write it using the writeFile tool.`,
		allowedTools: ['readFile', 'writeFile', 'listDirectory', 'searchCode'],
		maxIterations: 12,
		tags: ['testing', 'code-quality'],
		isBuiltin: true,
		createdAt: 1700000001000,
	},
	{
		id: 'dependency-auditor',
		name: 'Dependency Auditor',
		description: 'Audits project dependencies for known vulnerabilities, outdated packages, and licensing issues.',
		model: { providerName: 'anthropic', modelName: 'claude-sonnet-4-6' },
		systemInstructions: `You are a security-focused dependency auditor for software projects.

Your responsibilities:
1. Read package.json (and lock files if available)
2. Run npm audit / yarn audit / pip check as appropriate
3. Check for critically outdated packages with breaking changes
4. Identify packages with GPL/AGPL licenses if the project is proprietary
5. Suggest specific upgrade paths and migration notes

Format your output as:
## Security Vulnerabilities
<table: package | severity | CVE | fix>

## Outdated Packages
<table: package | current | latest | breaking changes>

## License Issues
<list if any>

## Recommended Actions
Prioritized action list.`,
		allowedTools: ['readFile', 'listDirectory', 'runCommand'],
		maxIterations: 6,
		tags: ['security', 'dependencies'],
		isBuiltin: true,
		createdAt: 1700000002000,
	},
	{
		id: 'release-manager',
		name: 'Release Manager',
		description: 'Automates the release process: generates changelog from git log, bumps version, creates a release commit and tag.',
		model: { providerName: 'anthropic', modelName: 'claude-sonnet-4-6' },
		systemInstructions: `You are a release automation engineer. You handle the end-to-end process of cutting a software release.

Your responsibilities:
1. Read the current version from package.json
2. Get the git log since the last tag to understand what changed
3. Categorize commits by type: feat, fix, chore, docs, breaking
4. Determine the next version using semver: MAJOR (breaking), MINOR (feat), PATCH (fix)
5. Generate a CHANGELOG.md entry in Keep a Changelog format
6. Update package.json version
7. Stage all changes (gitAdd)
8. Create a commit: "chore(release): v<new_version>"

IMPORTANT:
- Never create a git tag (that requires a push decision)
- Always confirm the version bump decision with reasoning before writing files
- Preserve existing CHANGELOG.md content — only prepend the new entry`,
		allowedTools: ['readFile', 'writeFile', 'gitLog', 'gitStatus', 'gitDiff', 'gitAdd', 'gitCommit'],
		maxIterations: 10,
		tags: ['release', 'git'],
		isBuiltin: true,
		createdAt: 1700000003000,
	},
	{
		id: 'docs-generator',
		name: 'Docs Generator',
		description: 'Generates or updates inline documentation (JSDoc/TSDoc) and README sections for specified modules.',
		model: { providerName: 'anthropic', modelName: 'claude-sonnet-4-6' },
		systemInstructions: `You are a technical writer and documentation engineer.

Your responsibilities:
1. Read the specified source files thoroughly
2. Understand the public API: exported functions, classes, interfaces, constants
3. Generate JSDoc/TSDoc comments for all public exports
4. Update or create README.md sections: Usage, API Reference, Examples
5. Write clear, accurate, concise documentation — no filler

Rules:
- Do NOT document private/internal functions unless they are complex enough to warrant it
- Use @param, @returns, @throws, @example tags correctly
- Preserve existing documentation that is already accurate
- For README: only add/update sections you have knowledge about

Write the updated files using writeFile.`,
		allowedTools: ['readFile', 'writeFile', 'listDirectory', 'searchCode'],
		maxIterations: 10,
		tags: ['documentation'],
		isBuiltin: true,
		createdAt: 1700000004000,
	},
];

// ─── Built-in Workflow Templates ──────────────────────────────────────────────

export const BUILTIN_WORKFLOWS: IWorkflowDefinition[] = [
	{
		id: 'code-review-pipeline',
		name: 'Code Review Pipeline',
		description: 'Runs the Code Reviewer agent on staged changes before commit.',
		trigger: 'manual',
		enabled: true,
		replaces: 'Manual PR review / Linter gate',
		steps: [
			{
				id: 'review',
				agentId: 'code-reviewer',
				role: 'reviewer',
				allowedTools: ['gitStatus', 'gitDiff', 'readFile', 'searchCode'],
				maxIterations: 8,
			},
		],
	},
	{
		id: 'dependency-audit-pipeline',
		name: 'Dependency Audit',
		description: 'Audits all project dependencies for vulnerabilities and outdated packages.',
		trigger: 'manual',
		enabled: true,
		replaces: 'Manual npm audit runs',
		steps: [
			{
				id: 'audit',
				agentId: 'dependency-auditor',
				role: 'executor',
				allowedTools: ['readFile', 'listDirectory', 'runCommand'],
				maxIterations: 6,
			},
		],
	},
	{
		id: 'release-pipeline',
		name: 'Release Pipeline',
		description: 'Full release workflow: review open changes, generate changelog, bump version, create release commit.',
		trigger: 'manual',
		enabled: true,
		replaces: 'Manual release process',
		steps: [
			{
				id: 'review',
				agentId: 'code-reviewer',
				role: 'reviewer',
				allowedTools: ['gitStatus', 'gitDiff', 'readFile'],
				maxIterations: 6,
			},
			{
				id: 'release',
				agentId: 'release-manager',
				role: 'executor',
				dependsOn: ['review'],
				allowedTools: ['readFile', 'writeFile', 'gitLog', 'gitStatus', 'gitAdd', 'gitCommit'],
				maxIterations: 10,
			},
		],
	},
	{
		id: 'test-generation-pipeline',
		name: 'Test Generation',
		description: 'Generates unit tests for specified source files following existing project patterns.',
		trigger: 'manual',
		enabled: true,
		replaces: 'Manual test writing',
		steps: [
			{
				id: 'generate',
				agentId: 'test-generator',
				role: 'executor',
				allowedTools: ['readFile', 'writeFile', 'listDirectory', 'searchCode'],
				maxIterations: 12,
			},
		],
	},
];
