/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Cross-Project Pairer
 *
 * Matches source project units to target project units to identify partially
 * migrated code. This answers the key question: "Which target unit corresponds
 * to which source unit, and how confident are we?"
 *
 * ## Matching Strategy
 *
 * Pairings are scored 0–1 using a cascade of match strategies, highest
 * confidence first. The first strategy that exceeds its threshold wins:
 *
 * | Strategy              | Threshold | Description                                                  |
 * |-----------------------|-----------|--------------------------------------------------------------|
 * | exact-name            | 1.00      | Identical unit names (after normalisation)                    |
 * | normalized-name       | 0.85      | Names match after case fold + separator removal              |
 * | token-overlap         | 0.60–0.80 | Jaccard similarity on camelCase / snake_case tokens ≥ 0.60   |
 * | file-path-structure   | 0.40–0.65 | Matching path segments (e.g. /service/Account → AccountSvc)  |
 * | complexity-match      | 0.25–0.45 | Same CC ± 15%, same LOC ± 20%, same param count              |
 * | heuristic             | 0.15–0.35 | Language-specific naming convention mapping                   |
 *
 * Only the highest-confidence match per source unit is returned.
 * Confidence < 0.20 pairings are suppressed.
 *
 * ## COBOL → Java / TypeScript Name Mapping
 *
 * COBOL paragraphs like `CALC-INTEREST-RATE` are mapped to camelCase candidates
 * `calcInterestRate`, `calculateInterestRate`, `calcInterest` via:
 *  1. Remove `PROGRAM-ID$` prefix
 *  2. Strip common COBOL suffixes: -RTN, -PROC, -PARA, -SUB
 *  3. Convert `HYPHEN-CASE` → `camelCase`
 *
 * ## Duplicate Resolution
 *
 * If multiple source units match the same target unit, only the highest-scoring
 * pairing is kept for each target unit (no two sources can claim the same target).
 */

import { ICrossProjectPairing, IProjectScanResult, IMigrationUnit, PairingMatchReason } from './discoveryTypes.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute cross-project pairings between all source and target scan results.
 * Returns a flat list of the best-confidence pairings.
 */
export function pairProjects(
	sources: IProjectScanResult[],
	targets: IProjectScanResult[],
): ICrossProjectPairing[] {
	const all: ICrossProjectPairing[] = [];

	for (const src of sources) {
		for (const tgt of targets) {
			const pairs = pairProjectPair(src, tgt);
			all.push(...pairs);
		}
	}

	return all;
}

/**
 * Pair units from a single source project with a single target project.
 */
export function pairProjectPair(
	source: IProjectScanResult,
	target: IProjectScanResult,
): ICrossProjectPairing[] {
	const pairings: ICrossProjectPairing[] = [];

	// Build target lookup structures
	const targetIndex = buildTargetIndex(target.units);

	// Track which target units have already been claimed (highest score wins)
	const claimed = new Map<string, { score: number; pairing: ICrossProjectPairing }>();

	for (const srcUnit of source.units) {
		const match = findBestMatch(srcUnit, source, targetIndex, target);
		if (!match || match.confidenceScore < 0.20) { continue; }

		const existing = claimed.get(match.targetUnitId);
		if (!existing || match.confidenceScore > existing.score) {
			claimed.set(match.targetUnitId, { score: match.confidenceScore, pairing: match });
		}
	}

	for (const { pairing } of claimed.values()) {
		pairings.push(pairing);
	}

	return pairings;
}


// ─── Index Building ───────────────────────────────────────────────────────────

interface ITargetIndex {
	byExact:      Map<string, IMigrationUnit>;   // exact name → unit
	byNorm:       Map<string, IMigrationUnit>;   // normalised name → unit
	byTokenSet:   Map<string, IMigrationUnit[]>; // each token → units containing it
	byPathSeg:    Map<string, IMigrationUnit[]>; // path segment → units
	units:        IMigrationUnit[];
}

function buildTargetIndex(units: IMigrationUnit[]): ITargetIndex {
	const byExact   = new Map<string, IMigrationUnit>();
	const byNorm    = new Map<string, IMigrationUnit>();
	const byTokenSet = new Map<string, IMigrationUnit[]>();
	const byPathSeg  = new Map<string, IMigrationUnit[]>();

	for (const unit of units) {
		const name = unit.unitName;
		byExact.set(name, unit);
		byNorm.set(normaliseName(name), unit);

		for (const token of tokenise(name)) {
			const list = byTokenSet.get(token) ?? [];
			list.push(unit);
			byTokenSet.set(token, list);
		}

		for (const seg of pathSegments(unit.legacyFilePath)) {
			const list = byPathSeg.get(seg) ?? [];
			list.push(unit);
			byPathSeg.set(seg, list);
		}
	}

	return { byExact, byNorm, byTokenSet, byPathSeg, units };
}


// ─── Matching ─────────────────────────────────────────────────────────────────

function findBestMatch(
	srcUnit: IMigrationUnit,
	source: IProjectScanResult,
	index: ITargetIndex,
	target: IProjectScanResult,
): ICrossProjectPairing | null {
	const srcName = srcUnit.unitName;

	// ── 1. Exact name ──────────────────────────────────────────────────────
	const exact = index.byExact.get(srcName);
	if (exact) {
		return makePairing(source, target, srcUnit, exact, 1.0, 'exact-name');
	}

	// ── 2. COBOL → camelCase/PascalCase candidates ─────────────────────────
	if (source.dominantLanguage === 'cobol') {
		for (const candidate of cobolToCandidates(srcName)) {
			const e2 = index.byExact.get(candidate) ?? index.byNorm.get(normaliseName(candidate));
			if (e2) {
				return makePairing(source, target, srcUnit, e2, 0.90, 'normalized-name');
			}
		}
	}

	// ── 3. Normalised name ─────────────────────────────────────────────────
	const normSrc = normaliseName(srcName);
	const normed  = index.byNorm.get(normSrc);
	if (normed && normed.id !== srcUnit.id) {
		return makePairing(source, target, srcUnit, normed, 0.85, 'normalized-name');
	}

	// ── 4. Token overlap ───────────────────────────────────────────────────
	const srcTokens = new Set(tokenise(srcName));
	// Collect candidate units via token index
	const candidates = new Map<string, { unit: IMigrationUnit; sharedTokens: number }>();
	for (const tok of srcTokens) {
		for (const tgtUnit of (index.byTokenSet.get(tok) ?? [])) {
			const entry = candidates.get(tgtUnit.id) ?? { unit: tgtUnit, sharedTokens: 0 };
			entry.sharedTokens++;
			candidates.set(tgtUnit.id, entry);
		}
	}

	let bestToken: { unit: IMigrationUnit; score: number } | null = null;
	for (const { unit, sharedTokens } of candidates.values()) {
		const tgtTokens = new Set(tokenise(unit.unitName));
		const jaccard = sharedTokens / (srcTokens.size + tgtTokens.size - sharedTokens);
		if (jaccard >= 0.60 && (!bestToken || jaccard > bestToken.score)) {
			bestToken = { unit, score: jaccard };
		}
	}
	if (bestToken) {
		const reason: PairingMatchReason = 'token-overlap';
		return makePairing(source, target, srcUnit, bestToken.unit, 0.60 + bestToken.score * 0.20, reason);
	}

	// ── 5. File path structure ─────────────────────────────────────────────
	const srcSegs = new Set(pathSegments(srcUnit.legacyFilePath));
	let bestPath: { unit: IMigrationUnit; score: number } | null = null;
	for (const seg of srcSegs) {
		for (const tgtUnit of (index.byPathSeg.get(seg) ?? [])) {
			const tgtSegs = new Set(pathSegments(tgtUnit.legacyFilePath));
			const union = new Set([...srcSegs, ...tgtSegs]);
			const inter = [...srcSegs].filter(s => tgtSegs.has(s)).length;
			const jaccard = inter / union.size;
			if (jaccard >= 0.40 && (!bestPath || jaccard > bestPath.score)) {
				bestPath = { unit: tgtUnit, score: jaccard };
			}
		}
	}
	if (bestPath) {
		return makePairing(source, target, srcUnit, bestPath.unit, 0.40 + bestPath.score * 0.25, 'file-path-structure');
	}

	// ── 6. Complexity match ────────────────────────────────────────────────
	if (srcUnit.legacyFingerprint) {
		const complexityMatch = findComplexityMatch(srcUnit, index.units);
		if (complexityMatch) {
			return makePairing(source, target, srcUnit, complexityMatch, 0.30, 'complexity-match');
		}
	}

	return null;
}

function findComplexityMatch(srcUnit: IMigrationUnit, targets: IMigrationUnit[]): IMigrationUnit | null {
	// We don't have CC here directly, so use regulated fields count as a proxy
	const srcFields = srcUnit.legacyFingerprint?.regulatedFields.length ?? 0;
	let best: IMigrationUnit | null = null;
	let bestDiff = Infinity;

	for (const tgt of targets) {
		const tgtFields = tgt.legacyFingerprint?.regulatedFields.length ?? 0;
		const diff = Math.abs(tgtFields - srcFields);
		if (diff < bestDiff && diff <= 2) {
			bestDiff = diff;
			best = tgt;
		}
	}
	return best;
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePairing(
	source: IProjectScanResult,
	target: IProjectScanResult,
	srcUnit: IMigrationUnit,
	tgtUnit: IMigrationUnit,
	confidenceScore: number,
	matchReason: PairingMatchReason,
): ICrossProjectPairing {
	return {
		sourceProjectId:  source.projectId,
		targetProjectId:  target.projectId,
		sourceUnitId:     srcUnit.id,
		targetUnitId:     tgtUnit.id,
		confidenceScore:  Math.min(1, Math.round(confidenceScore * 100) / 100),
		matchReason,
		targetHasFingerprint: !!tgtUnit.legacyFingerprint,
	};
}

/** Normalise a name: lowercase, strip separators, remove common suffixes. */
function normaliseName(name: string): string {
	return name
		.replace(/\$[^$]*$/, '')                        // Strip file-level suffix (e.g. $PROCEDURE_DIVISION)
		.replace(/[-_$.]|([A-Z])/g, (_, u) => u ? `_${u.toLowerCase()}` : '') // camelCase → snake
		.toLowerCase()
		.replace(/[_\s]+/g, '')                         // strip separators
		.replace(/(service|handler|controller|processor|manager|helper|util|utils|impl|bean|repository|repo|dao|svc|cmp|component|bo|entity|mapper|converter)$/i, '');
}

/** Tokenise a name into meaningful words. */
function tokenise(name: string): string[] {
	// Split on camelCase, PascalCase, snake_case, COBOL-CASE, $ (unit ID separator)
	return name
		.replace(/\$[^$]*$/, '')  // remove file-level suffix
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[-_$.\s]+/)
		.map(t => t.toLowerCase())
		.filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/** Extract meaningful path segments from a file URI. */
function pathSegments(filePath: string): string[] {
	return filePath
		.replace(/\\/g, '/')
		.split('/')
		.filter(s => s.length > 0)
		.map(s => s.replace(/\.[^.]+$/, '').toLowerCase())
		.filter(s => s.length >= 2 && !PATH_STOP_SEGMENTS.has(s));
}

/** Convert a COBOL name to likely target-language name candidates. */
function cobolToCandidates(cobolName: string): string[] {
	// Strip leading program-id prefix: PROG$PARA-NAME → PARA-NAME
	const stripped = cobolName.includes('$') ? cobolName.split('$').slice(1).join('$') : cobolName;
	// Remove common COBOL suffixes
	const withoutSuffix = stripped.replace(/-(?:RTN|ROUTINE|PROC|PARA|SUB|SECT|SECTION|PROCESS|PROCESSING|CALC|CALCULATE)$/i, '');

	const toCamel = (s: string): string =>
		s.toLowerCase().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	const toPascal = (s: string): string => {
		const c = toCamel(s);
		return c.charAt(0).toUpperCase() + c.slice(1);
	};

	const candidates = [
		toCamel(stripped),
		toPascal(stripped),
		toCamel(withoutSuffix),
		toPascal(withoutSuffix),
	];

	// Also try with 'calculate' prefix expansion
	const expanded = withoutSuffix.replace(/^CALC-/, 'CALCULATE-');
	if (expanded !== withoutSuffix) {
		candidates.push(toCamel(expanded), toPascal(expanded));
	}

	return [...new Set(candidates)];
}


// ─── Stop Word Sets ───────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
	'the', 'and', 'or', 'in', 'of', 'to', 'is', 'it', 'for', 'at', 'by',
	'an', 'do', 'be', 'on', 'up', 'as', 'if', 'no', 'so', 'we', 'us',
	'get', 'set', 'run', 'new', 'add', 'use', 'put', 'end', 'out',
]);

const PATH_STOP_SEGMENTS = new Set([
	'src', 'main', 'java', 'kotlin', 'scala', 'python', 'resources',
	'com', 'org', 'net', 'io', 'app', 'api', 'lib', 'util', 'utils',
	'test', 'tests', 'spec', 'specs', 'browser', 'server', 'client',
	'service', 'services', 'controller', 'controllers', 'model', 'models',
	'view', 'views', 'handler', 'handlers', 'repository', 'repositories',
	'module', 'modules', 'component', 'components', 'domain', 'domains',
	'infrastructure', 'application', 'presentation', 'interfaces',
]);
