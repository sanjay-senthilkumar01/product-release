/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Data Flow Analyzer
 *
 * Executes `type: "dataflow"` rules using taint tracking analysis.
 *
 * ## How It Works
 *
 * The analyzer tracks the flow of "tainted" data from sources to sinks.
 *
 * 1. **Sources**: Expressions that introduce untrusted data (e.g. `req.body`, `process.env`).
 *    When a source is assigned to a variable, that variable becomes tainted.
 *
 * 2. **Propagation**: Taint spreads through assignments.
 *    If `a` is tainted and `b = a`, then `b` becomes tainted.
 *    If `c = a + "foo"`, then `c` becomes tainted.
 *
 * 3. **Sanitization**: Functions that clean data.
 *    If `a` is tainted and `b = sanitize(a)`, then `b` is clean.
 *
 * 4. **Sinks**: Dangerous functions where tainted data must not go.
 *    If `sink(a)` is called and `a` is tainted, a violation is reported.
 *    If `sink(sanitize(a))` is called, no violation.
 *
 * ## Implementation Limitations (Beta)
 *
 * - **Intra-procedural only**: Tracks data flow within a single function scope.
 *   Does not track taint across function calls (inter-procedural).
 * - **Best-effort alias tracking**: Simple variable aliasing is tracked.
 *   Complex object property tracking (e.g. `obj.prop = tainted`) is partial.
 * - **Synchronous**: Runs on the UI thread (via `evaluateDocument`), so it must be fast.
 */

import { ITextModel } from '../../../../../../editor/common/model.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IGRCRule, ICheckResult, toDisplaySeverity } from '../types/grcTypes.js';
import { IDataFlowCheck } from '../framework/frameworkSchema.js';
import { IRuleAnalyzer } from '../services/grcEngineService.js';
import * as ts from './tsCompilerShim.js';


// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Represents the taint state of a variable within a scope.
 */
interface TaintState {
	/** Is this variable currently holding tainted data? */
	isTainted: boolean;

	/** The source expression that tainted it (for trace info) */
	source?: string;

	/** Line number where taint was introduced */
	sourceLine?: number;
}


// ─── Data Flow Analyzer ──────────────────────────────────────────────────────

export class DataFlowAnalyzer implements IRuleAnalyzer {
	readonly supportedTypes = ['dataflow'];

	/** Cached source file per model version (reuse from AST analyzer logic or new cache) */
	private _sourceFileCache = new Map<string, { version: number; sourceFile: ts.SourceFile }>();

	/**
	 * Evaluate a dataflow rule against a document.
	 */
	public evaluate(rule: IGRCRule, model: ITextModel, fileUri: URI, timestamp: number): ICheckResult[] {
		const check = rule.check as IDataFlowCheck | undefined;
		if (!check || !check.taint) {
			return [];
		}

		const sourceFile = this._getSourceFile(model);
		if (!sourceFile) {
			return [];
		}

		const results: ICheckResult[] = [];

		// Walk the AST looking for function scopes to analyze
		this._walkAst(sourceFile, (node) => {
			if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
				const violations = this._analyzeFunctionScope(node, check, rule, fileUri, timestamp, sourceFile);
				results.push(...violations);
			} else {
				// Analyze top-level code (script scope)
				if (ts.isCallExpression(node)) {
					// Check for direct sink calls at top level
					const violation = this._checkSinkCall(node, new Map(), check, rule, fileUri, timestamp, sourceFile);
					if (violation) {
						results.push(violation);
					}
				}
			}
		});

		return results;
	}

	/**
	 * Analyze a single function scope for taint flow.
	 */
	private _analyzeFunctionScope(
		scopeNode: ts.FunctionLikeDeclaration,
		check: IDataFlowCheck,
		rule: IGRCRule,
		fileUri: URI,
		timestamp: number,
		sourceFile: ts.SourceFile
	): ICheckResult[] {
		if (!scopeNode.body) {
			return [];
		}

		const results: ICheckResult[] = [];
		const taintMap = new Map<string, TaintState>();

		// Helper to visit statements in order
		const visitBody = (node: ts.Node) => {
			ts.forEachChild(node, (child) => {

				// 1. Check for assignments: var = source / var = tainted
				if (ts.isVariableDeclaration(child)) {
					this._handleVariableDeclaration(child as ts.VariableDeclaration, taintMap, check, sourceFile);
				} else if (ts.isBinaryExpression(child)) {
					// assignment expression: a = b
					const expr = child as ts.BinaryExpression;
					if (expr.operatorToken?.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expr.left)) {
						this._handleAssignment((expr.left as ts.Identifier).text, expr.right, taintMap, check, sourceFile);
					}
				}

				// 2. Check for sink calls: sink(tainted)
				if (ts.isCallExpression(child)) {
					const violation = this._checkSinkCall(child, taintMap, check, rule, fileUri, timestamp, sourceFile);
					if (violation) {
						results.push(violation);
					}
				}

				// Recurse into blocks (if/for/while) but keep same taint map (simplified scoping)
				// Note: this flattens scopes, which is a safe over-approximation for taint tracking
				if (!ts.isFunctionDeclaration(child as any) && !ts.isArrowFunction(child as any)) {
					visitBody(child);
				}
			});
		};

		visitBody(scopeNode.body);
		return results;
	}

	/**
	 * Handle `const x = ...` declarations.
	 */
	private _handleVariableDeclaration(
		node: ts.VariableDeclaration,
		taintMap: Map<string, TaintState>,
		check: IDataFlowCheck,
		sourceFile: ts.SourceFile
	): void {
		if (!ts.isIdentifier(node.name as ts.Node) || !node.initializer) {
			return;
		}

		const varName = (node.name as ts.Identifier).text;
		this._evaluateExpressionTaint(varName, node.initializer, taintMap, check, sourceFile);
	}

	/**
	 * Handle `x = ...` assignments.
	 */
	private _handleAssignment(
		varName: string,
		expression: ts.Node,
		taintMap: Map<string, TaintState>,
		check: IDataFlowCheck,
		sourceFile: ts.SourceFile
	): void {
		this._evaluateExpressionTaint(varName, expression, taintMap, check, sourceFile);
	}

	/**
	 * Determine if an expression is tainted and update the variable's state.
	 */
	private _evaluateExpressionTaint(
		targetVar: string,
		expression: ts.Node,
		taintMap: Map<string, TaintState>,
		check: IDataFlowCheck,
		sourceFile: ts.SourceFile
	): void {
		// 1. Is expression a direct source?
		// e.g. req.body
		if (this._isSource(expression, check.taint.sources, sourceFile)) {
			const { line } = sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile));
			taintMap.set(targetVar, {
				isTainted: true,
				source: expression.getText(sourceFile),
				sourceLine: line + 1
			});
			return;
		}

		// 2. Is expression a Sanitizer call?
		// e.g. sanitize(tainted)
		if (ts.isCallExpression(expression) && this._isSanitizer(expression, check.taint.sanitizers, sourceFile)) {
			taintMap.set(targetVar, { isTainted: false }); // Cleans taint
			return;
		}

		// 3. Is expression a reference to a tainted variable?
		// e.g. x = y (where y is tainted)
		if (ts.isIdentifier(expression)) {
			const sourceVar = expression.text;
			const sourceState = taintMap.get(sourceVar);
			if (sourceState?.isTainted) {
				taintMap.set(targetVar, { ...sourceState }); // Propagate taint
				return;
			}
		}

		// 4. Is expression a string concatenation with tainted variable?
		// e.g. "params: " + tainted
		if (ts.isBinaryExpression(expression)) {
			// Check left and right operands
			const expr = expression as any;
			let isTainted = false;
			let sourceState: TaintState | undefined;

			// Check left
			if (ts.isIdentifier(expr.left)) {
				const state = taintMap.get(expr.left.text);
				if (state?.isTainted) { isTainted = true; sourceState = state; }
			}
			// Check right
			if (ts.isIdentifier(expr.right)) {
				const state = taintMap.get(expr.right.text);
				if (state?.isTainted) { isTainted = true; sourceState = state; }
			}

			if (isTainted) {
				taintMap.set(targetVar, sourceState || { isTainted: true });
				return;
			}
		}

		// Otherwise, assume clean (unless we prove otherwise later)
		taintMap.set(targetVar, { isTainted: false });
	}

	/**
	 * Check if a call expression is a sink using tainted data.
	 */
	private _checkSinkCall(
		node: ts.CallExpression,
		taintMap: Map<string, TaintState>,
		check: IDataFlowCheck,
		rule: IGRCRule,
		fileUri: URI,
		timestamp: number,
		sourceFile: ts.SourceFile
	): ICheckResult | undefined {
		// 1. Is this a sink?
		if (!this._isSink(node, check.taint.sinks, sourceFile)) {
			return undefined;
		}

		// 2. Check arguments for taint
		for (const arg of node.arguments) {
			let isTainted = false;
			let taintSource: string | undefined;
			let taintLine: number | undefined;

			// Case A: Argument is a tainted variable
			if (ts.isIdentifier(arg)) {
				const state = taintMap.get(arg.text);
				if (state?.isTainted) {
					isTainted = true;
					taintSource = state.source;
					taintLine = state.sourceLine;
				}
			}
			// Case B: Argument is a direct source expression (e.g. sink(req.body))
			else if (this._isSource(arg, check.taint.sources, sourceFile)) {
				isTainted = true;
				taintSource = arg.getText(sourceFile);
				const pos = sourceFile.getLineAndCharacterOfPosition(arg.getStart(sourceFile));
				taintLine = pos.line + 1;
			}

			if (isTainted) {
				// VIOLATION FOUND
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
				const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

				const traceInfo = taintSource
					? `Flow: [Line ${taintLine}] ${taintSource} → [Line ${line + 1}] Sink`
					: undefined;

				return {
					ruleId: rule.id,
					domain: rule.domain,
					severity: toDisplaySeverity(rule.severity),
					message: `[${rule.id}] ${rule.message}`,
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
					traceInfo: traceInfo ? [{ line: taintLine ?? line + 1, label: traceInfo }] : undefined
				};
			}
		}

		return undefined;
	}

	// ─── Matchers ────────────────────────────────────────────────────────────

	private _isSource(node: ts.Node, sources: string[], sourceFile: ts.SourceFile): boolean {
		const text = node.getText(sourceFile);
		// Simple text matching for now (e.g. "req.body" matches "req.body")
		// Could be improved with AST structure matching
		return sources.some(s => text === s || text.startsWith(s + '.'));
	}

	private _isSink(node: ts.CallExpression, sinks: string[], sourceFile: ts.SourceFile): boolean {
		const callee = this._getCalleeName(node);
		return !!callee && sinks.includes(callee);
	}

	private _isSanitizer(node: ts.CallExpression, sanitizers: string[] | undefined, sourceFile: ts.SourceFile): boolean {
		if (!sanitizers) { return false; }
		const callee = this._getCalleeName(node);
		return !!callee && sanitizers.includes(callee);
	}

	/**
	 * Reuse logic from AstAnalyzer to get callee name.
	 */
	private _getCalleeName(node: ts.CallExpression): string | undefined {
		const expr = node.expression;
		if (ts.isIdentifier(expr)) {
			return expr.text;
		}
		if (ts.isPropertyAccessExpression(expr)) {
			const obj = ts.isIdentifier(expr.expression) ? expr.expression.text : undefined;
			if (obj) { return `${obj}.${expr.name.text}`; }
			return expr.name.text;
		}
		return undefined;
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

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

			// Evict old entries
			if (this._sourceFileCache.size > 20) {
				const firstKey = this._sourceFileCache.keys().next().value;
				if (firstKey) this._sourceFileCache.delete(firstKey);
			}

			return sourceFile;
		} catch (e) {
			console.error('[DataFlowAnalyzer] Failed to parse source file:', e);
			return undefined;
		}
	}

	private _walkAst(node: ts.Node, visitor: (node: ts.Node) => void): void {
		visitor(node);
		ts.forEachChild(node, (child: ts.Node) => this._walkAst(child, visitor));
	}
}
