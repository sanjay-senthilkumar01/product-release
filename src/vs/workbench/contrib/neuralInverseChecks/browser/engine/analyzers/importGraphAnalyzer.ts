/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Import Graph Analyzer
 *
 * Executes `type: "import-graph"` rules for architectural compliance.
 *
 * ## Supported Checks
 *
 * - **Boundary Violations**: Enforces module boundaries.
 *   e.g. `src/ui/**` can only import from [`src/services/**`, `src/shared/**`].
 *   Any import outside the allowed list is a violation.
 *
 * - **Layer Violations**: Enforces unrelated layers don't communicate.
 *   Similar to boundaries, but often used for strict layering (UI -> Domain -> Data).
 *
 * - **Cycles**: (Stubbed/Future) Detection of circular dependencies.
 *
 * ## Logic
 *
 * 1. Matches the current file against the defined boundary keys (globs).
 * 2. If matched, scans all imports in the file.
 * 3. Resolves imports to relative paths from workspace root.
 * 4. Checks if the imported path matches any of the allowed patterns.
 * 5. If not allowed, reports a violation.
 */

import { ITextModel } from '../../../../../../editor/common/model.js';
import { URI } from '../../../../../../base/common/uri.js';
import { match as matchGlob } from '../../../../../../base/common/glob.js';
import { IGRCRule, ICheckResult, toDisplaySeverity } from '../types/grcTypes.js';
import { IImportGraphCheck } from '../framework/frameworkSchema.js';
import { IRuleAnalyzer } from '../services/grcEngineService.js';
import * as ts from './tsCompilerShim.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';


// ─── Import Graph Analyzer ───────────────────────────────────────────────────

export class ImportGraphAnalyzer implements IRuleAnalyzer {
	readonly supportedTypes = ['import-graph'];

	/** Cached source file per model version */
	private _sourceFileCache = new Map<string, { version: number; sourceFile: ts.SourceFile }>();

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) { }

	public evaluate(rule: IGRCRule, model: ITextModel, fileUri: URI, timestamp: number): ICheckResult[] {
		const check = rule.check as IImportGraphCheck | undefined;
		if (!check) {
			return [];
		}

		// Currently supporting boundary and layer violations
		if (check.detect === 'boundary-violation' || check.detect === 'layer-violation') {
			return this._checkBoundaries(check, rule, model, fileUri, timestamp);
		}

		// Cycles are expensive to compute per-file and require a full graph
		// Leaving as a placeholder for Phase 3/4
		if (check.detect === 'cycles') {
			return [];
		}

		return [];
	}

	/**
	 * Check import boundaries.
	 */
	private _checkBoundaries(
		check: IImportGraphCheck,
		rule: IGRCRule,
		model: ITextModel,
		fileUri: URI,
		timestamp: number
	): ICheckResult[] {
		if (!check.boundaries) {
			return [];
		}

		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(fileUri);
		if (!workspaceFolder) {
			return [];
		}

		// Get file path relative to workspace root
		const relativeFilePath = this._getRelativePath(fileUri, workspaceFolder.uri);
		if (!relativeFilePath) {
			return [];
		}

		// Find which boundary rule applies to this file
		// Iterate over keys (globs) in check.boundaries
		let allowedImports: string[] | undefined;
		for (const sourceGlob of Object.keys(check.boundaries)) {
			if (matchGlob(sourceGlob, relativeFilePath)) {
				allowedImports = check.boundaries[sourceGlob];
				break;
			}
		}

		// If this file is not restricted by any boundary rule, return
		if (!allowedImports) {
			return [];
		}

		const sourceFile = this._getSourceFile(model);
		if (!sourceFile) {
			return [];
		}

		const results: ICheckResult[] = [];

		// Walk AST to find imports
		this._walkAstImportDeclarations(sourceFile, (node) => {
			const importPath = this._extractImportPath(node);
			if (!importPath) {
				return;
			}

			// Resolve full import path logic is complex (alias, node resolution)
			// For this check, we focus on relative imports and simple absolute imports
			const resolvedRelativePath = this._resolveImportPath(importPath, fileUri, workspaceFolder.uri);

			// Check if the resolved path matches any allowed pattern
			const isAllowed = allowedImports!.some(pattern => matchGlob(pattern, resolvedRelativePath));

			if (!isAllowed) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
				const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

				results.push({
					ruleId: rule.id,
					domain: rule.domain,
					severity: toDisplaySeverity(rule.severity),
					message: `[${rule.id}] ${rule.message} (Import '${importPath}' violates boundary)`,
					fileUri: fileUri,
					line: line + 1,
					column: character + 1,
					endLine: endPos.line + 1,
					endColumn: endPos.character + 1,
					codeSnippet: node.getText(sourceFile),
					fix: rule.fix,
					timestamp: timestamp,
					frameworkId: rule.frameworkId,
					references: rule.references,
					blockingBehavior: rule.blockingBehavior,
				});
			}
		});

		return results;
	}


	// ─── Helper Methods ──────────────────────────────────────────────────────

	private _getRelativePath(fileUri: URI, rootUri: URI): string | undefined {
		if (fileUri.scheme !== rootUri.scheme || !fileUri.path.startsWith(rootUri.path)) {
			return undefined;
		}
		// Remove root path prefix + leading slash
		let rel = fileUri.path.substring(rootUri.path.length);
		if (rel.startsWith('/')) {
			rel = rel.substring(1);
		}
		return rel;
	}

	/**
	 * Resolves an import string (e.g. '../foo', 'src/bar') to a workspace-relative path.
	 *
	 * @param importPath The string in the import statement
	 * @param sourceFileUri The URI of the file containing the import
	 * @param rootUri The workspace root URI
	 */
	private _resolveImportPath(importPath: string, sourceFileUri: URI, rootUri: URI): string {
		// 1. Handle relative imports (start with ./ or ../)
		if (importPath.startsWith('./') || importPath.startsWith('../')) {
			const sourceDir = URI.joinPath(sourceFileUri, '..'); // Directory of current file
			const resolvedUri = URI.joinPath(sourceDir, importPath);
			return this._getRelativePath(resolvedUri, rootUri) || importPath;
		}

		// 2. Handle absolute/alias imports (assuming they are relative to src/ or root)
		// This is a simplification. Real resolution needs tsconfig.json parsing.
		// We assume standard 'src/...' imports if they don't start with .
		if (importPath.startsWith('src/') || !importPath.startsWith('.')) {
			// Check if it's likely an external package (no / or just @scope/pkg)
			if (!importPath.includes('/') || (importPath.startsWith('@') && importPath.split('/').length === 2)) {
				return `node_modules/${importPath}`; // Treat as external
			}
			return importPath;
		}

		return importPath;
	}

	private _extractImportPath(node: ts.ImportDeclaration): string | undefined {
		if (node.moduleSpecifier && ts.isIdentifier(node.moduleSpecifier as any)) {
			// Should be StringLiteral, but shim types might be loose
			const specifier = node.moduleSpecifier as any;
			return specifier.text; // Text of the string literal
		}
		return undefined;
	}

	private _getSourceFile(model: ITextModel): ts.SourceFile | undefined {
		// Same cache logic as other analyzers
		const key = model.uri.toString();
		const version = model.getVersionId();
		const cached = this._sourceFileCache.get(key);

		if (cached && cached.version === version) {
			return cached.sourceFile;
		}

		try {
			const sourceFile = ts.createSourceFile(
				model.uri.path,
				model.getValue(),
				ts.ScriptTarget.Latest,
				true
			);
			this._sourceFileCache.set(key, { version, sourceFile });
			return sourceFile;
		} catch (e) {
			console.error('[ImportGraphAnalyzer] Failed to parse:', e);
			return undefined;
		}
	}

	private _walkAstImportDeclarations(node: ts.Node, visitor: (node: ts.ImportDeclaration) => void): void {
		if (node.kind === ts.SyntaxKind.ImportDeclaration) {
			visitor(node as ts.ImportDeclaration);
		}
		ts.forEachChild(node, (child: ts.Node) => this._walkAstImportDeclarations(child, visitor));
	}
}
