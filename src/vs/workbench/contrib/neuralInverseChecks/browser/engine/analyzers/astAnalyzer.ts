/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # AST Analyzer
 *
 * Executes `type: "ast"` rules using TypeScript's compiler API to walk
 * the syntax tree and detect structural patterns.
 *
 * ## Why AST Over Regex
 *
 * Regex can find `eval(` in text, but:
 * - Can't detect `const e = eval; e(...)` (aliased eval)
 * - Can't distinguish `eval` in a comment vs code (we skip comments, but crudely)
 * - Can't check structural constraints like "async function without try/catch"
 *
 * The AST analyzer understands code structure and can enforce rules that
 * require semantic understanding.
 *
 * ## Supported Constraints
 *
 * Framework rules define constraints as predicate strings:
 * - `isAsync` — function is marked async
 * - `hasTryCatch` — function body contains try/catch
 * - `hasReturnType` — function has explicit return type annotation
 * - `paramCount > N` — function has more than N parameters
 *
 * Constraints can be combined with `&&` and `||`.
 *
 * ## Registration
 *
 * This analyzer registers itself with the GRC engine on construction:
 * ```typescript
 * engineService.registerAnalyzer(astAnalyzer);
 * ```
 *
 * ## Performance
 *
 * AST parsing is more expensive than regex. The analyzer uses the
 * TypeScript compiler API's `createSourceFile()` which parses the
 * document into a syntax tree. Parsing is cached per document version
 * to avoid re-parsing on constraint-only rule changes.
 */

import { ITextModel } from '../../../../../../editor/common/model.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IGRCRule, ICheckResult, toDisplaySeverity } from '../types/grcTypes.js';
import { IAstCheck } from '../framework/frameworkSchema.js';
import { IRuleAnalyzer } from '../services/grcEngineService.js';
import * as ts from './tsCompilerShim.js';


// ─── AST Analyzer ────────────────────────────────────────────────────────────

/**
 * Analyzer that handles `type: "ast"` rules.
 *
 * Parses TypeScript/JavaScript source into an AST and walks it to find
 * nodes matching the rule's check definition.
 */
export class AstAnalyzer implements IRuleAnalyzer {
	readonly supportedTypes = ['ast'];

	/** Cached source file per model version to avoid re-parsing */
	private _sourceFileCache = new Map<string, { version: number; sourceFile: ts.SourceFile }>();

	/** Runtime reverse map from SyntaxKind number → name string */
	private readonly _syntaxKindNames: Map<number, string> = new Map([
		[ts.SyntaxKind.FunctionDeclaration, 'FunctionDeclaration'],
		[ts.SyntaxKind.MethodDeclaration, 'MethodDeclaration'],
		[ts.SyntaxKind.ArrowFunction, 'ArrowFunction'],
		[ts.SyntaxKind.ClassDeclaration, 'ClassDeclaration'],
		[ts.SyntaxKind.VariableDeclaration, 'VariableDeclaration'],
		[ts.SyntaxKind.ImportDeclaration, 'ImportDeclaration'],
		[ts.SyntaxKind.CallExpression, 'CallExpression'],
		[ts.SyntaxKind.NewExpression, 'NewExpression'],
		[ts.SyntaxKind.PropertyAccessExpression, 'PropertyAccessExpression'],
		[ts.SyntaxKind.BinaryExpression, 'BinaryExpression'],
		[ts.SyntaxKind.Identifier, 'Identifier'],
		[ts.SyntaxKind.TryStatement, 'TryStatement'],
		[ts.SyntaxKind.Block, 'Block'],
	]);

	/**
	 * Evaluate an AST rule against a document.
	 *
	 * 1. Parse the document into a TypeScript AST (cached)
	 * 2. Walk the AST looking for nodes matching the rule's nodeType
	 * 3. For each match, evaluate the constraint expression
	 * 4. Return violations for nodes that match type + constraint
	 */
	public evaluate(rule: IGRCRule, model: ITextModel, fileUri: URI, timestamp: number): ICheckResult[] {
		const check = rule.check as IAstCheck | undefined;
		if (!check?.match?.nodeType) {
			return [];
		}

		const sourceFile = this._getSourceFile(model);
		if (!sourceFile) {
			return [];
		}

		const results: ICheckResult[] = [];
		const targetNodeTypes = check.match.nodeType.split('|').map(t => t.trim());

		// Walk the AST
		this._walkAst(sourceFile, (node) => {
			const nodeKindName = this._syntaxKindNames.get(node.kind) || '';

			// Check if this node type matches the rule
			if (!targetNodeTypes.some(t => nodeKindName === t || nodeKindName.includes(t))) {
				return;
			}

			// For CallExpression: check callee name
			if (check.match.callee && ts.isCallExpression(node)) {
				const calleeName = this._getCalleeName(node);
				if (!calleeName || !check.match.callee.includes(calleeName)) {
					return;
				}
			}

			// Evaluate constraint
			if (check.match.constraint) {
				if (!this._evaluateConstraint(check.match.constraint, node, sourceFile)) {
					return; // Constraint not satisfied — no violation
				}
			}

			// Node matches — create a violation
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

			results.push({
				ruleId: rule.id,
				domain: rule.domain,
				severity: toDisplaySeverity(rule.severity),
				message: `[${rule.id}] ${rule.message}`,
				fileUri: fileUri,
				line: line + 1,           // 1-based
				column: character + 1,     // 1-based
				endLine: endPos.line + 1,
				endColumn: endPos.character + 1,
				codeSnippet: node.getText(sourceFile).substring(0, 100),
				fix: rule.fix,
				timestamp: timestamp,
				frameworkId: rule.frameworkId,
				references: rule.references,
				blockingBehavior: rule.blockingBehavior,
			});
		});

		return results;
	}


	// ─── AST Parsing ─────────────────────────────────────────────────

	/**
	 * Parses the model into a TypeScript source file.
	 * Results are cached per model version to avoid re-parsing.
	 */
	private _getSourceFile(model: ITextModel): ts.SourceFile | undefined {
		const key = model.uri.toString();
		const version = model.getVersionId();
		const cached = this._sourceFileCache.get(key);

		if (cached && cached.version === version) {
			return cached.sourceFile;
		}

		try {
			const content = model.getValue();
			const fileName = model.uri.path;
			const isJsx = fileName.endsWith('.tsx') || fileName.endsWith('.jsx');

			const sourceFile = ts.createSourceFile(
				fileName,
				content,
				ts.ScriptTarget.Latest,
				/* setParentNodes */ true,
				isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
			);

			this._sourceFileCache.set(key, { version, sourceFile });

			// Evict old entries to prevent memory leaks
			if (this._sourceFileCache.size > 20) {
				const firstKey = this._sourceFileCache.keys().next().value;
				if (firstKey) {
					this._sourceFileCache.delete(firstKey);
				}
			}

			return sourceFile;
		} catch (e) {
			console.error('[AstAnalyzer] Failed to parse source file:', e);
			return undefined;
		}
	}


	// ─── AST Walking ─────────────────────────────────────────────────

	/**
	 * Recursively walks all nodes in the AST.
	 */
	private _walkAst(node: ts.Node, visitor: (node: ts.Node) => void): void {
		visitor(node);
		ts.forEachChild(node, (child: ts.Node) => this._walkAst(child, visitor));
	}


	// ─── Callee Name Extraction ──────────────────────────────────────

	/**
	 * Extracts the callee name from a CallExpression.
	 *
	 * Handles:
	 * - Simple call: `eval(...)` → "eval"
	 * - Method call: `document.write(...)` → "document.write"
	 * - new expression: `new Function(...)` → "Function"
	 */
	private _getCalleeName(node: ts.CallExpression): string | undefined {
		const expr = node.expression;

		if (ts.isIdentifier(expr)) {
			return expr.text;
		}

		if (ts.isPropertyAccessExpression(expr)) {
			const obj = ts.isIdentifier(expr.expression)
				? expr.expression.text
				: undefined;
			if (obj) {
				return `${obj}.${expr.name.text}`;
			}
			return expr.name.text;
		}

		if (ts.isNewExpression(node as any)) {
			const newExpr = node as any as ts.NewExpression;
			if (ts.isIdentifier(newExpr.expression)) {
				return newExpr.expression.text;
			}
		}

		return undefined;
	}


	// ─── Constraint Evaluation ───────────────────────────────────────

	/**
	 * Evaluates a constraint expression against an AST node.
	 *
	 * Supports:
	 * - `isAsync` — function is async
	 * - `!hasTryCatch` — function does NOT have try/catch
	 * - `hasReturnType` — function has explicit return type
	 * - `paramCount > N` — function has more than N parameters
	 * - `&&` / `||` — logical AND/OR combinations
	 *
	 * Returns true if the constraint is satisfied (meaning violation applies).
	 */
	private _evaluateConstraint(constraint: string, node: ts.Node, sourceFile: ts.SourceFile): boolean {
		// Handle AND
		if (constraint.includes('&&')) {
			const parts = constraint.split('&&').map(s => s.trim());
			return parts.every(part => this._evaluateConstraint(part, node, sourceFile));
		}

		// Handle OR
		if (constraint.includes('||')) {
			const parts = constraint.split('||').map(s => s.trim());
			return parts.some(part => this._evaluateConstraint(part, node, sourceFile));
		}

		// Handle NOT
		if (constraint.startsWith('!')) {
			return !this._evaluateConstraint(constraint.substring(1).trim(), node, sourceFile);
		}

		// Atomic constraints
		switch (constraint) {
			case 'isAsync':
				return this._isAsyncFunction(node);

			case 'hasTryCatch':
				return this._hasTryCatch(node);

			case 'hasReturnType':
				return this._hasReturnType(node);

			default: {
				// Check for paramCount comparison
				const paramMatch = constraint.match(/paramCount\s*(>|<|>=|<=|==)\s*(\d+)/);
				if (paramMatch) {
					const count = this._getParamCount(node);
					const threshold = parseInt(paramMatch[2]);
					switch (paramMatch[1]) {
						case '>': return count > threshold;
						case '<': return count < threshold;
						case '>=': return count >= threshold;
						case '<=': return count <= threshold;
						case '==': return count === threshold;
					}
				}

				console.warn(`[AstAnalyzer] Unknown constraint: "${constraint}"`);
				return false;
			}
		}
	}


	// ─── Constraint Helpers ──────────────────────────────────────────

	private _isAsyncFunction(node: ts.Node): boolean {
		if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
			return node.modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
		}
		return false;
	}

	private _hasTryCatch(node: ts.Node): boolean {
		let found = false;
		const walk = (n: ts.Node) => {
			if (found) return;
			if (ts.isTryStatement(n)) {
				found = true;
				return;
			}
			ts.forEachChild(n, walk);
		};

		// Check the function body
		if (ts.isFunctionDeclaration(node) && node.body) {
			walk(node.body);
		} else if (ts.isArrowFunction(node) && node.body) {
			walk(node.body);
		} else if (ts.isMethodDeclaration(node) && node.body) {
			walk(node.body);
		}

		return found;
	}

	private _hasReturnType(node: ts.Node): boolean {
		if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
			return node.type !== undefined;
		}
		return false;
	}

	private _getParamCount(node: ts.Node): number {
		if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
			return node.parameters.length;
		}
		return 0;
	}
}
