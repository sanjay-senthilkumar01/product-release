/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Invariant Analyzer
 *
 * Evaluates `type: "invariant"` rules defined in `.inverse/invariants.json`.
 *
 * Supports three invariant scopes:
 * - `always`: Variable must never violate the expression
 * - `before-call`: Guard condition must hold before target function calls
 * - `after-call`: Condition must hold after target function calls
 *
 * Uses TypeScript AST for static analysis and optionally delegates
 * complex cases to the Contract Reason Service (AI).
 */

import { ITextModel } from '../../../../../../editor/common/model.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IGRCRule, ICheckResult } from '../types/grcTypes.js';
import { IInvariantDefinition, parseInvariantExpression, IParsedExpression } from '../types/invariantTypes.js';
import { IRuleAnalyzer } from '../services/grcEngineService.js';
import { IContractReasonService } from '../services/contractReasonService.js';
import * as ts from './tsCompilerShim.js';

export class InvariantAnalyzer implements IRuleAnalyzer {
	readonly supportedTypes = ['invariant'];

	private _sourceFileCache = new Map<string, { version: number; sourceFile: ts.SourceFile }>();

	constructor(
		_contractReasonService: IContractReasonService
	) { }

	evaluate(rule: IGRCRule, model: ITextModel, fileUri: URI, timestamp: number): ICheckResult[] {
		const invariant = rule.check as unknown as IInvariantDefinition;
		if (!invariant || !invariant.expression) {
			return [];
		}

		const sourceFile = this._getSourceFile(model);
		if (!sourceFile) {
			return [];
		}

		const parsed = parseInvariantExpression(invariant.expression);
		if (!parsed) {
			return [];
		}

		switch (invariant.scope) {
			case 'always':
				return this._checkAlwaysInvariant(invariant, parsed, sourceFile, model, fileUri, rule, timestamp);
			case 'before-call':
				return this._checkBeforeCallInvariant(invariant, parsed, sourceFile, model, fileUri, rule, timestamp);
			case 'after-call':
				return this._checkAfterCallInvariant(invariant, parsed, sourceFile, model, fileUri, rule, timestamp);
			default:
				return [];
		}
	}

	evaluateContent(rule: IGRCRule, content: string, fileUri: URI, languageId: string, timestamp: number): ICheckResult[] {
		if (languageId !== 'typescript' && languageId !== 'javascript' && languageId !== 'typescriptreact' && languageId !== 'javascriptreact') {
			return [];
		}

		const invariant = rule.check as unknown as IInvariantDefinition;
		if (!invariant || !invariant.expression) {
			return [];
		}

		const parsed = parseInvariantExpression(invariant.expression);
		if (!parsed) {
			return [];
		}

		try {
			const sourceFile = ts.createSourceFile(fileUri.path, content, ts.ScriptTarget.Latest, true);

			switch (invariant.scope) {
				case 'always':
					return this._checkAlwaysFromSourceFile(invariant, parsed, sourceFile, fileUri, rule, timestamp);
				case 'before-call':
					return this._checkBeforeCallFromSourceFile(invariant, parsed, sourceFile, fileUri, rule, timestamp);
				case 'after-call':
					return this._checkAfterCallFromSourceFile(invariant, parsed, sourceFile, fileUri, rule, timestamp);
				default:
					return [];
			}
		} catch {
			return [];
		}
	}

	// ─── Always Scope ─────────────────────────────────────────────────

	private _checkAlwaysInvariant(
		invariant: IInvariantDefinition, parsed: IParsedExpression,
		sourceFile: ts.SourceFile, model: ITextModel,
		fileUri: URI, rule: IGRCRule, timestamp: number
	): ICheckResult[] {
		return this._checkAlwaysFromSourceFile(invariant, parsed, sourceFile, fileUri, rule, timestamp);
	}

	private _checkAlwaysFromSourceFile(
		invariant: IInvariantDefinition, parsed: IParsedExpression,
		sourceFile: ts.SourceFile, fileUri: URI,
		rule: IGRCRule, timestamp: number
	): ICheckResult[] {
		const results: ICheckResult[] = [];
		const trackedVars = new Set(invariant.variables ?? [parsed.variable]);

		const visit = (node: ts.Node): void => {
			// Check variable declarations: let x = <value>
			if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && trackedVars.has(node.name.text)) {
				if (node.initializer) {
					const violation = this._checkAssignmentViolation(
						parsed, node.initializer, sourceFile, fileUri, rule, timestamp, invariant,
						`${node.name.text} initialized`
					);
					if (violation) {
						results.push(violation);
					}
				}
			}

			// Check assignments: x = <value>
			if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
				const leftText = this._getIdentifierName(node.left);
				if (leftText && trackedVars.has(leftText)) {
					const violation = this._checkAssignmentViolation(
						parsed, node.right, sourceFile, fileUri, rule, timestamp, invariant,
						`${leftText} assigned`
					);
					if (violation) {
						results.push(violation);
					}
				}
			}

			// Check compound assignments: x -= N, x += N
			if (ts.isBinaryExpression(node) && this._isCompoundAssignment(node.operatorToken.kind)) {
				const leftText = this._getIdentifierName(node.left);
				if (leftText && trackedVars.has(leftText)) {
					const violation = this._checkCompoundAssignmentViolation(
						parsed, node, sourceFile, fileUri, rule, timestamp, invariant
					);
					if (violation) {
						results.push(violation);
					}
				}
			}

			// Check unary: x-- (prefix/postfix decrement for >= 0 checks)
			if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))) {
				const unary = node as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
				if (unary.operator === ts.SyntaxKind.MinusMinusToken || unary.operator === ts.SyntaxKind.PlusPlusToken) {
					const operandText = this._getIdentifierName(unary.operand);
					if (operandText && trackedVars.has(operandText)) {
						if (this._unaryCouldViolate(parsed, unary.operator)) {
							const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
							results.push(this._makeResult(
								rule, fileUri, line + 1, character + 1, node, sourceFile, timestamp, invariant,
								[{ line: line + 1, label: `${operandText} modified by ${unary.operator === ts.SyntaxKind.MinusMinusToken ? '--' : '++'} — may violate ${invariant.expression}` }]
							));
						}
					}
				}
			}

			ts.forEachChild(node, visit);
		};

		ts.forEachChild(sourceFile, visit);
		return results;
	}

	// ─── Before-Call Scope ────────────────────────────────────────────

	private _checkBeforeCallInvariant(
		invariant: IInvariantDefinition, parsed: IParsedExpression,
		sourceFile: ts.SourceFile, _model: ITextModel,
		fileUri: URI, rule: IGRCRule, timestamp: number
	): ICheckResult[] {
		return this._checkBeforeCallFromSourceFile(invariant, parsed, sourceFile, fileUri, rule, timestamp);
	}

	private _checkBeforeCallFromSourceFile(
		invariant: IInvariantDefinition, parsed: IParsedExpression,
		sourceFile: ts.SourceFile, fileUri: URI,
		rule: IGRCRule, timestamp: number
	): ICheckResult[] {
		const results: ICheckResult[] = [];
		const targetCalls = new Set(invariant.targetCalls ?? []);
		if (targetCalls.size === 0) {
			return [];
		}

		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const calleeName = this._getCalleeName(node);
				if (calleeName && targetCalls.has(calleeName)) {
					// Walk backward to check if guard is set
					const guardFound = this._findGuardBefore(node, parsed, sourceFile);
					if (!guardFound) {
						const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
						results.push(this._makeResult(
							rule, fileUri, line + 1, character + 1, node, sourceFile, timestamp, invariant,
							[
								{ line: line + 1, label: `Call to ${calleeName}()` },
								{ line: line + 1, label: `Guard "${invariant.expression}" not verified before call` }
							]
						));
					}
				}
			}
			ts.forEachChild(node, visit);
		};

		ts.forEachChild(sourceFile, visit);
		return results;
	}

	// ─── After-Call Scope ─────────────────────────────────────────────

	private _checkAfterCallInvariant(
		invariant: IInvariantDefinition, parsed: IParsedExpression,
		sourceFile: ts.SourceFile, _model: ITextModel,
		fileUri: URI, rule: IGRCRule, timestamp: number
	): ICheckResult[] {
		return this._checkAfterCallFromSourceFile(invariant, parsed, sourceFile, fileUri, rule, timestamp);
	}

	private _checkAfterCallFromSourceFile(
		invariant: IInvariantDefinition, parsed: IParsedExpression,
		sourceFile: ts.SourceFile, fileUri: URI,
		rule: IGRCRule, timestamp: number
	): ICheckResult[] {
		const results: ICheckResult[] = [];
		const targetCalls = new Set(invariant.targetCalls ?? []);
		if (targetCalls.size === 0) {
			return [];
		}

		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const calleeName = this._getCalleeName(node);
				if (calleeName && targetCalls.has(calleeName)) {
					// Check if the invariant condition is verified after this call
					const checkFound = this._findCheckAfter(node, parsed, sourceFile);
					if (!checkFound) {
						const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
						results.push(this._makeResult(
							rule, fileUri, line + 1, character + 1, node, sourceFile, timestamp, invariant,
							[
								{ line: line + 1, label: `Call to ${calleeName}()` },
								{ line: line + 1, label: `Condition "${invariant.expression}" not verified after call` }
							]
						));
					}
				}
			}
			ts.forEachChild(node, visit);
		};

		ts.forEachChild(sourceFile, visit);
		return results;
	}

	// ─── Assignment Violation Checking ────────────────────────────────

	private _checkAssignmentViolation(
		parsed: IParsedExpression, rhs: ts.Node,
		sourceFile: ts.SourceFile, fileUri: URI,
		rule: IGRCRule, timestamp: number, invariant: IInvariantDefinition,
		action: string
	): ICheckResult | undefined {
		// Try to evaluate the RHS as a literal
		const literalValue = this._evaluateLiteral(rhs);

		if (literalValue !== undefined) {
			// We can statically determine the value
			if (this._violatesExpression(parsed, literalValue)) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(rhs.getStart(sourceFile));
				return this._makeResult(
					rule, fileUri, line + 1, character + 1, rhs, sourceFile, timestamp, invariant,
					[{ line: line + 1, label: `${action} to ${literalValue} — violates ${invariant.expression}` }]
				);
			}
			return undefined;
		}

		// For subtraction expressions like `x - y`, flag if the invariant is >= 0
		if (ts.isBinaryExpression(rhs) && rhs.operatorToken.kind === ts.SyntaxKind.MinusToken) {
			if (parsed.operator === '>=' && parsed.value === 0) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(rhs.getStart(sourceFile));
				return this._makeResult(
					rule, fileUri, line + 1, character + 1, rhs, sourceFile, timestamp, invariant,
					[{ line: line + 1, label: `${action} via subtraction — may violate ${invariant.expression}` }],
					'medium'
				);
			}
		}

		return undefined;
	}

	private _checkCompoundAssignmentViolation(
		parsed: IParsedExpression, node: ts.BinaryExpression,
		sourceFile: ts.SourceFile, fileUri: URI,
		rule: IGRCRule, timestamp: number, invariant: IInvariantDefinition
	): ICheckResult | undefined {
		const opKind = node.operatorToken.kind;
		const varName = this._getIdentifierName(node.left) ?? '?';

		// For >= 0 invariants, -= operations are suspicious
		if (parsed.operator === '>=' && parsed.value === 0 && opKind === ts.SyntaxKind.MinusEqualsToken) {
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			return this._makeResult(
				rule, fileUri, line + 1, character + 1, node, sourceFile, timestamp, invariant,
				[{ line: line + 1, label: `${varName} -= ... — may violate ${invariant.expression}` }],
				'medium'
			);
		}

		// For <= N invariants, += operations are suspicious
		if (parsed.operator === '<=' && typeof parsed.value === 'number' && opKind === ts.SyntaxKind.PlusEqualsToken) {
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			return this._makeResult(
				rule, fileUri, line + 1, character + 1, node, sourceFile, timestamp, invariant,
				[{ line: line + 1, label: `${varName} += ... — may violate ${invariant.expression}` }],
				'medium'
			);
		}

		return undefined;
	}

	// ─── Guard / Check Finding ────────────────────────────────────────

	private _findGuardBefore(callNode: ts.Node, parsed: IParsedExpression, sourceFile: ts.SourceFile): boolean {
		// Walk up to find the containing block/function
		const parent = this._findContainingBlock(callNode);
		if (!parent) {
			return false;
		}

		const callStart = callNode.getStart(sourceFile);
		let guardFound = false;

		const checkStatements = (node: ts.Node): void => {
			// Only look at statements before the call
			if (node.getEnd() >= callStart) {
				return;
			}

			// Look for if-statements checking the guard variable
			if (ts.isIfStatement(node)) {
				if (this._conditionChecksVariable(node.expression, parsed.variable)) {
					guardFound = true;
				}
			}

			// Look for assignments that set the guard to true
			if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
				const leftName = this._getIdentifierName(node.expression.left);
				if (leftName === parsed.variable && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
					const val = this._evaluateLiteral(node.expression.right);
					if (val === true || val === parsed.value) {
						guardFound = true;
					}
				}
			}

			ts.forEachChild(node, checkStatements);
		};

		ts.forEachChild(parent, checkStatements);
		return guardFound;
	}

	private _findCheckAfter(callNode: ts.Node, parsed: IParsedExpression, sourceFile: ts.SourceFile): boolean {
		const parent = this._findContainingBlock(callNode);
		if (!parent) {
			return false;
		}

		const callEnd = callNode.getEnd();
		let checkFound = false;

		const checkStatements = (node: ts.Node): void => {
			if (node.getStart(sourceFile) <= callEnd) {
				return;
			}

			if (ts.isIfStatement(node)) {
				if (this._conditionChecksVariable(node.expression, parsed.variable)) {
					checkFound = true;
				}
			}

			ts.forEachChild(node, checkStatements);
		};

		ts.forEachChild(parent, checkStatements);
		return checkFound;
	}

	// ─── Helpers ──────────────────────────────────────────────────────

	private _getSourceFile(model: ITextModel): ts.SourceFile | undefined {
		const key = model.uri.toString();
		const version = model.getVersionId();
		const cached = this._sourceFileCache.get(key);
		if (cached && cached.version === version) {
			return cached.sourceFile;
		}

		try {
			const content = model.getValue();
			const sourceFile = ts.createSourceFile(model.uri.path, content, ts.ScriptTarget.Latest, true);
			this._sourceFileCache.set(key, { version, sourceFile });

			// Evict old entries
			if (this._sourceFileCache.size > 20) {
				const firstKey = this._sourceFileCache.keys().next().value;
				if (firstKey) {
					this._sourceFileCache.delete(firstKey);
				}
			}

			return sourceFile;
		} catch {
			return undefined;
		}
	}

	private _getIdentifierName(node: ts.Node): string | undefined {
		if (ts.isIdentifier(node)) {
			return node.text;
		}
		if (ts.isPropertyAccessExpression(node)) {
			return node.getText();
		}
		return undefined;
	}

	private _getCalleeName(node: ts.CallExpression): string | undefined {
		if (ts.isIdentifier(node.expression)) {
			return node.expression.text;
		}
		if (ts.isPropertyAccessExpression(node.expression)) {
			return node.expression.name.text;
		}
		return undefined;
	}

	private _evaluateLiteral(node: ts.Node): number | string | boolean | null | undefined {
		if (ts.isNumericLiteral(node)) {
			return Number(node.text);
		}
		if (ts.isStringLiteral(node)) {
			return node.text;
		}
		if (node.kind === ts.SyntaxKind.TrueKeyword) {
			return true;
		}
		if (node.kind === ts.SyntaxKind.FalseKeyword) {
			return false;
		}
		if (node.kind === ts.SyntaxKind.NullKeyword) {
			return null;
		}
		// Negative numeric literal: -N
		if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
			return -Number(node.operand.text);
		}
		return undefined;
	}

	private _violatesExpression(parsed: IParsedExpression, actual: number | string | boolean | null): boolean {
		const expected = parsed.value;
		switch (parsed.operator) {
			case '>=': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
			case '<=': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
			case '>': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
			case '<': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
			case '==': return actual !== expected;
			case '!=': return actual === expected;
			default: return false;
		}
	}

	private _isCompoundAssignment(kind: ts.SyntaxKind): boolean {
		return kind === ts.SyntaxKind.PlusEqualsToken ||
			kind === ts.SyntaxKind.MinusEqualsToken ||
			kind === ts.SyntaxKind.AsteriskEqualsToken ||
			kind === ts.SyntaxKind.SlashEqualsToken;
	}

	private _unaryCouldViolate(parsed: IParsedExpression, operator: ts.SyntaxKind): boolean {
		if (parsed.operator === '>=' && parsed.value === 0 && operator === ts.SyntaxKind.MinusMinusToken) {
			return true; // x-- could make x negative
		}
		if (parsed.operator === '<=' && typeof parsed.value === 'number' && operator === ts.SyntaxKind.PlusPlusToken) {
			return true; // x++ could exceed limit
		}
		return false;
	}

	private _conditionChecksVariable(expr: ts.Node, variableName: string): boolean {
		const exprText = expr.getText();
		return exprText.includes(variableName);
	}

	private _findContainingBlock(node: ts.Node): ts.Node | undefined {
		let current: ts.Node | undefined = node.parent;
		while (current) {
			if (ts.isBlock(current) || ts.isSourceFile(current) ||
				ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) ||
				ts.isArrowFunction(current)) {
				return current;
			}
			current = (current as ts.Node).parent;
		}
		return undefined;
	}

	private _makeResult(
		rule: IGRCRule, fileUri: URI, line: number, column: number,
		node: ts.Node, sourceFile: ts.SourceFile,
		timestamp: number, invariant: IInvariantDefinition,
		traceInfo: Array<{ line: number; column?: number; label: string }>,
		confidence: 'high' | 'medium' | 'low' = 'high'
	): ICheckResult {
		const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
		const snippet = node.getText(sourceFile);

		return {
			ruleId: rule.id,
			domain: rule.domain,
			severity: rule.severity,
			message: `Invariant "${invariant.name}" (${invariant.expression}) may be violated`,
			fileUri,
			line,
			column,
			endLine: endPos.line + 1,
			endColumn: endPos.character + 1,
			codeSnippet: snippet.length > 200 ? snippet.substring(0, 200) + '...' : snippet,
			fix: `Ensure ${invariant.expression} holds at this point`,
			timestamp,
			traceInfo,
			aiConfidence: confidence,
			checkSource: 'static',
		};
	}
}
