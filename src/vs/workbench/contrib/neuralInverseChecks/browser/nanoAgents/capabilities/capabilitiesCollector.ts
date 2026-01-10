
import { ITextModel } from '../../../../../../editor/common/model.js';
import { DocumentSymbol, SymbolKind } from '../../../../../../editor/common/languages.js';

export class CapabilitiesCollector {
	public async collect(model: ITextModel, symbols?: DocumentSymbol[]): Promise<any> {
		const content = model.getValue();

		// Heuristics based on text content
		const hasAsync = /\basync\s+/.test(content);
		const hasAwait = /\bawait\s+/.test(content);
		const isTestFile = /test|spec/.test(model.uri.path.toLowerCase()) ||
			/\b(describe|it|test)\s*\(/.test(content); // simplistic JS/TS check

		// Extended Capabilities Detection (Mission Critical Pillars)
		const hasNetwork = /\b(fetch|http|https|axios|XMLHttpRequest|Request|Response)\b/i.test(content);
		const hasFileSystem = /\b(fs|readFile|writeFile|open|close|createReadStream)\b/.test(content);
		const hasCrypto = /\b(crypto|tls|ssl|hash|cipher|encrypt|decrypt)\b/i.test(content);
		const hasAuth = /\b(password|token|auth|login|credential|secret|jwt)\b/i.test(content);
		const hasDatabase = /\b(sql|mongo|dynamo|db|query|connect|schema)\b/i.test(content);
		const hasEnv = /\b(process\.env|getenv|config)\b/i.test(content);

		// Heuristics based on symbols
		let hasClasses = false;
		let hasFunctions = false;
		let hasInterfaces = false;

		if (symbols) {
			const traverse = (items: DocumentSymbol[]) => {
				for (const item of items) {
					if (item.kind === SymbolKind.Class) hasClasses = true;
					if (item.kind === SymbolKind.Function || item.kind === SymbolKind.Method) hasFunctions = true;
					if (item.kind === SymbolKind.Interface) hasInterfaces = true;

					if (item.children) {
						traverse(item.children as DocumentSymbol[]);
					}
				}
			};
			traverse(symbols);
		}

		return {
			hasAsync,
			hasAwait,
			isTestFile,
			hasClasses,
			hasFunctions,
			hasInterfaces,
			hasNetwork,
			hasFileSystem,
			hasCrypto,
			hasAuth,
			hasDatabase,
			hasEnv
		};
	}
}
