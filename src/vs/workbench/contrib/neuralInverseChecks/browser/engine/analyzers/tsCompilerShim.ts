/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # TypeScript Compiler API Shim
 *
 * Re-exports the TypeScript compiler API types and functions
 * needed by the AST analyzer.
 *
 * VS Code bundles the TypeScript compiler, so we don't need an
 * additional dependency. This shim provides a clean import path
 * for the AST analyzer to use.
 *
 * ## Usage
 *
 * ```typescript
 * import * as ts from './tsCompilerShim.js';
 * const sourceFile = ts.createSourceFile(...);
 * ```
 *
 * ## Note
 *
 * This uses dynamic import to avoid bundling issues. The TypeScript
 * compiler is available at runtime in VS Code's environment.
 */

// Re-export TypeScript compiler namespace
// VS Code ships with TypeScript built-in, available via the global require
// For the browser bundle, we use the types directly

declare const globalThis: any;

// TypeScript compiler API types needed by the AST analyzer
// We define these as interfaces to avoid a hard dependency on the TS compiler package

export const enum SyntaxKind {
	// Tokens
	AsyncKeyword = 134,
	EqualsToken = 63,
	// Declarations
	FunctionDeclaration = 262,
	MethodDeclaration = 174,
	ArrowFunction = 219,
	ClassDeclaration = 263,
	VariableDeclaration = 260,
	ImportDeclaration = 272,
	// Expressions
	CallExpression = 213,
	NewExpression = 214,
	PropertyAccessExpression = 211,
	BinaryExpression = 226,
	Identifier = 80,
	// Statements
	TryStatement = 258,
	Block = 241,
	SourceFile = 312,
}

export const enum ScriptTarget {
	Latest = 99,
	ES2022 = 9,
	ESNext = 99,
}

export const enum ScriptKind {
	TS = 3,
	TSX = 4,
	JS = 1,
	JSX = 2,
}

export interface Node {
	kind: SyntaxKind | number;
	parent: Node;
	getStart(sourceFile?: SourceFile): number;
	getEnd(): number;
	getText(sourceFile?: SourceFile): string;
	modifiers?: readonly Modifier[];
	forEachChild(cbNode: (node: Node) => void): void;
}

export interface Modifier extends Node { }

export interface SourceFile extends Node {
	fileName: string;
	text: string;
	getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}

export interface Identifier extends Node {
	text: string;
}

export interface CallExpression extends Node {
	expression: Node;
	arguments: readonly Node[];
}

export interface NewExpression extends Node {
	expression: Node;
	arguments?: readonly Node[];
}

export interface PropertyAccessExpression extends Node {
	expression: Node;
	name: Identifier;
}

export interface VariableDeclaration extends Node {
	name: Node;
	initializer?: Node;
}

export interface BinaryExpression extends Node {
	left: Node;
	operatorToken: Node;
	right: Node;
}

export interface ImportDeclaration extends Node {
	moduleSpecifier: Node;
}

export interface FunctionLikeDeclaration extends Node {
	parameters: readonly Node[];
	body?: Node;
	type?: Node;
}

export interface TryStatement extends Node {
	tryBlock: Node;
	catchClause?: Node;
}

// Type guard functions
export function isIdentifier(node: Node): node is Identifier {
	return node.kind === SyntaxKind.Identifier;
}

export function isCallExpression(node: Node): node is CallExpression {
	return node.kind === SyntaxKind.CallExpression;
}

export function isNewExpression(node: Node): node is NewExpression {
	return node.kind === SyntaxKind.NewExpression;
}

export function isPropertyAccessExpression(node: Node): node is PropertyAccessExpression {
	return node.kind === SyntaxKind.PropertyAccessExpression;
}

export function isFunctionDeclaration(node: Node): node is FunctionLikeDeclaration {
	return node.kind === SyntaxKind.FunctionDeclaration;
}

export function isMethodDeclaration(node: Node): node is FunctionLikeDeclaration {
	return node.kind === SyntaxKind.MethodDeclaration;
}

export function isArrowFunction(node: Node): node is FunctionLikeDeclaration {
	return node.kind === SyntaxKind.ArrowFunction;
}

export function isTryStatement(node: Node): node is TryStatement {
	return node.kind === SyntaxKind.TryStatement;
}

export function isVariableDeclaration(node: Node): node is VariableDeclaration {
	return node.kind === SyntaxKind.VariableDeclaration;
}

export function isBinaryExpression(node: Node): node is BinaryExpression {
	return node.kind === SyntaxKind.BinaryExpression;
}

export function isImportDeclaration(node: Node): node is ImportDeclaration {
	return node.kind === SyntaxKind.ImportDeclaration;
}

export function forEachChild(node: Node, cbNode: (node: Node) => void): void {
	node.forEachChild(cbNode);
}

/**
 * Creates a SourceFile from source text.
 *
 * This wraps TypeScript's `ts.createSourceFile()`. In VS Code's runtime
 * environment, we access the TypeScript compiler through the global
 * `require`. If TypeScript is not available (unlikely in VS Code),
 * we fall back to a no-op.
 */
export function createSourceFile(
	fileName: string,
	sourceText: string,
	languageVersion: ScriptTarget,
	setParentNodes?: boolean,
	scriptKind?: ScriptKind
): SourceFile {
	// Access TypeScript from VS Code's runtime
	try {
		const tsLib = _getTypeScriptLib();
		if (tsLib) {
			return tsLib.createSourceFile(fileName, sourceText, languageVersion, setParentNodes, scriptKind);
		}
	} catch (e) {
		console.error('[tsCompilerShim] Failed to access TypeScript compiler:', e);
	}

	// Fallback: return a minimal source file that won't match anything
	return {
		kind: SyntaxKind.SourceFile,
		fileName: fileName,
		text: sourceText,
		parent: null as any,
		modifiers: undefined,
		getStart: () => 0,
		getEnd: () => sourceText.length,
		getText: () => sourceText,
		getLineAndCharacterOfPosition: (pos: number) => {
			let line = 0;
			let character = 0;
			for (let i = 0; i < pos && i < sourceText.length; i++) {
				if (sourceText[i] === '\n') {
					line++;
					character = 0;
				} else {
					character++;
				}
			}
			return { line, character };
		},
		forEachChild: () => { },
	};
}

/**
 * Gets the TypeScript library from the environment.
 * In VS Code, TypeScript is available through the global module system.
 */
function _getTypeScriptLib(): any {
	// Try globalThis (Node.js / VS Code desktop)
	if (typeof globalThis !== 'undefined' && globalThis.require) {
		try {
			return globalThis.require('typescript');
		} catch { /* Not available via global require */ }
	}

	// Try AMD define (VS Code browser)
	if (typeof (globalThis as any).define !== 'undefined') {
		try {
			// VS Code uses AMD modules in some contexts
			const tsModule = (globalThis as any).require?.('vs/language/typescript/tsMode');
			if (tsModule?.typescript) {
				return tsModule.typescript;
			}
		} catch { /* Not available via AMD */ }
	}

	return undefined;
}
