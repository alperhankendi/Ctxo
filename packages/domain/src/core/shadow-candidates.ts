/**
 * Shadow-spec candidates (spec 12.2, H3 to H5): the code facts, data objects and untested rules of each context
 * that no card states yet, each with a line-independent fingerprint. Automatic resolutions (rule links, `Untested:`
 * lines) are applied here; `shadow-specs.yaml` entries are applied at query time. Pure: the caller does every read.
 */

import type { CodeFact, FileIndex, TestFileCheck } from '@ctxo/cli/internal';
import { rulesForSymbols, rulesWithoutTests, type GraphIndex } from './domain-graph-query.js';
import { fingerprint, fingerprintSymbolPart, segmentDots } from './fingerprint.js';
import type { Ownership } from './ownership.js';
import type { DomainRegistry } from './registry.js';

export const CANDIDATE_KINDS = [
  'literal-comparison',
  'normalization',
  'retry-timeout',
  'endpoint',
  'data-resource',
  'procedure',
  'rule-without-tests',
] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
export type CandidateSource = 'native' | 'text' | 'index' | 'card';

export type CandidateResolution =
  | { readonly by: 'rule-link'; readonly rules: readonly string[] }
  | { readonly by: 'untested'; readonly reason: string }
  | { readonly by: 'shadow-specs'; readonly rule: string }
  | { readonly by: 'shadow-specs'; readonly notARule: string };

export interface ShadowCandidate {
  readonly fingerprint: string;
  readonly kind: CandidateKind;
  readonly context: string;
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  readonly symbolId?: string;
  readonly ruleId?: string;
  readonly text: string;
  readonly detail?: Readonly<Record<string, string>>;
  readonly source: CandidateSource;
  readonly resolution?: CandidateResolution;
}

/** `.ctxo/index/domain/shadow-candidates.json` (H1; W9: declared in core, stored by the artifact store). */
export interface ShadowCandidatesArtifact {
  readonly ctxoArtifact: 'domain-shadow-candidates';
  readonly version: 1;
  readonly registryHash: string;
  readonly cardsHash: string;
  readonly candidates: readonly ShadowCandidate[];
}

export interface CandidateInput {
  readonly registry: DomainRegistry;
  readonly ownership: Ownership;
  readonly isTestFile: TestFileCheck;
  readonly indices: readonly FileIndex[];
  /** Text-scan facts per repo path (`readTextFacts`): used for files whose index has no `facts` key, and unindexed files. */
  readonly textFacts: ReadonlyMap<string, readonly CodeFact[]>;
  readonly graph: GraphIndex;
  /** The host's `dataResourceKinds` (W3). */
  readonly dataResourceKinds: readonly string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const norm = (path: string): string => path.replace(/\\/g, '/');

const KIND_RANK = new Map<string, number>(CANDIDATE_KINDS.map((kind, i) => [kind, i]));
const TYPE_KINDS = new Set<string>(['class', 'interface', 'type']);
const NO_TYPES: ReadonlySet<string> = new Set();
const FACT_CANDIDATE_KINDS = new Set<string>(['literal-comparison', 'normalization', 'retry-timeout', 'endpoint']);

/**
 * The detail with its keys in codepoint order. Facts reach the pass in plugin order from a fresh `ctxo index` and in
 * sorted order from the JSON index (an incremental run, `ctxo watch`); the artifact must not depend on which.
 */
function canonicalDetail(detail: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(detail).sort(compare)) out[key] = detail[key]!;
  return out;
}

function detailKey(detail: Readonly<Record<string, string>> | undefined): string {
  if (detail === undefined) return '';
  return JSON.stringify(Object.keys(detail).sort(compare).map((key) => [key, detail[key]]));
}

/**
 * Context, file, line, `CANDIDATE_KINDS` order, fingerprint; then symbol, rule, text, source and detail, so equal
 * keys never depend on input order.
 */
export function compareCandidates(a: ShadowCandidate, b: ShadowCandidate): number {
  return (
    compare(a.context, b.context) ||
    compare(a.file, b.file) ||
    a.line - b.line ||
    (KIND_RANK.get(a.kind) ?? CANDIDATE_KINDS.length) - (KIND_RANK.get(b.kind) ?? CANDIDATE_KINDS.length) ||
    compare(a.fingerprint, b.fingerprint) ||
    compare(a.symbolId ?? '', b.symbolId ?? '') ||
    compare(a.ruleId ?? '', b.ruleId ?? '') ||
    compare(a.text, b.text) ||
    compare(a.source, b.source) ||
    compare(detailKey(a.detail), detailKey(b.detail))
  );
}

/** The candidates of one context, in the order of `all`; `kinds` undefined or empty keeps every kind. */
export function candidatesOf(all: readonly ShadowCandidate[], context: string, kinds?: readonly CandidateKind[]): ShadowCandidate[] {
  const wanted = kinds === undefined || kinds.length === 0 ? undefined : new Set<string>(kinds);
  return all.filter((candidate) => candidate.context === context && (wanted === undefined || wanted.has(candidate.kind)));
}

/**
 * Every context's candidates in `compareCandidates` order (H3 to H5):
 * - facts of non-test files with exactly one owner: the index `facts` when the key exists (`native`), else the text
 *   facts (`text`); unindexed files in `textFacts` count for their owner;
 * - tables and views (`dataResourceKinds`) and procedures of those files (`index`);
 * - rules without tests (`card`), resolved by an `Untested:` line;
 * - a candidate with a symbol is resolved by the rules whose code links (card `Code:` lines, `rule:` comments, file
 *   links included) reach it.
 * Exact duplicates are dropped; candidates sharing only a fingerprint are all kept (one resolution entry resolves
 * each of them). Linear in facts and symbols, plus the sort.
 */
export function buildShadowCandidates(input: CandidateInput): ShadowCandidate[] {
  const out: ShadowCandidate[] = [];
  const symbolParts = new Map<string, string>();
  /** `types`: the names of the file's class, interface and type symbols, for the containing type (M3). */
  const symbolPart = (symbolId: string, types: ReadonlySet<string>): string => {
    let part = symbolParts.get(symbolId);
    if (part === undefined) {
      part = fingerprintSymbolPart(symbolId, containerOf(symbolId, types));
      symbolParts.set(symbolId, part);
    }
    return part;
  };
  const linkedRules = new Map<string, readonly string[]>();
  const rulesOf = (symbolId: string): readonly string[] => {
    let rules = linkedRules.get(symbolId);
    if (rules === undefined) {
      const ids = new Set<string>();
      for (const match of rulesForSymbols(input.graph, [symbolId])) {
        if (match.via.some((via) => via.link === 'code')) ids.add(match.ruleId);
      }
      rules = [...ids].sort(compare);
      linkedRules.set(symbolId, rules);
    }
    return rules;
  };
  const withLinks = (candidate: ShadowCandidate): ShadowCandidate => {
    if (candidate.symbolId === undefined || candidate.resolution !== undefined) return candidate;
    const rules = rulesOf(candidate.symbolId);
    return rules.length === 0 ? candidate : { ...candidate, resolution: { by: 'rule-link', rules } };
  };

  const dataKinds = new Set(input.dataResourceKinds);
  const ownerOf = (file: string): string | undefined => (input.isTestFile(file) ? undefined : input.ownership.ownerOf(file));

  const pushFacts = (
    file: string,
    context: string,
    facts: readonly CodeFact[],
    source: 'native' | 'text',
    types: ReadonlySet<string>,
  ): void => {
    for (const fact of facts) {
      if (!FACT_CANDIDATE_KINDS.has(fact.kind)) continue;
      out.push(
        withLinks({
          fingerprint: fingerprint(fact.kind, symbolPart(fact.symbolId, types), fact.text),
          kind: fact.kind as CandidateKind,
          context,
          file,
          line: fact.line + 1,
          symbolId: fact.symbolId,
          text: fact.text,
          ...(fact.detail === undefined ? {} : { detail: canonicalDetail(fact.detail) }),
          source,
        }),
      );
    }
  };

  const textFacts = new Map<string, readonly CodeFact[]>();
  for (const [file, facts] of input.textFacts) textFacts.set(norm(file), facts);

  const indexed = new Set<string>();
  for (const index of input.indices) {
    const file = norm(index.file);
    indexed.add(file);
    const context = ownerOf(file);
    if (context === undefined) continue;
    const types = new Set<string>();
    for (const symbol of index.symbols) if (TYPE_KINDS.has(symbol.kind)) types.add(symbol.name);
    if (index.facts !== undefined) pushFacts(file, context, index.facts, 'native', types);
    else pushFacts(file, context, textFacts.get(file) ?? [], 'text', types);
    for (const symbol of index.symbols) {
      const kind: CandidateKind | undefined =
        symbol.kind === 'procedure' ? 'procedure' : dataKinds.has(symbol.kind) ? 'data-resource' : undefined;
      if (kind === undefined) continue;
      const text = `${symbol.kind} ${middleSegment(symbol.symbolId)}`;
      out.push(
        withLinks({
          fingerprint: fingerprint(kind, symbolPart(symbol.symbolId, types), text),
          kind,
          context,
          file,
          line: symbol.startLine + 1,
          symbolId: symbol.symbolId,
          text,
          source: 'index',
        }),
      );
    }
  }
  for (const [file, facts] of textFacts) {
    if (indexed.has(file)) continue;
    const context = ownerOf(file);
    if (context !== undefined) pushFacts(file, context, facts, 'text', NO_TYPES);
  }

  const contexts = input.registry.contexts.map((context) => context.id).sort(compare);
  for (const context of contexts) {
    for (const rule of rulesWithoutTests(input.graph, [context])) {
      const title = rule.title.trim();
      out.push({
        // N2: a heading without a title (`### LEND-03`) uses the rule ID, so the text part is never empty.
        fingerprint: fingerprint('rule-without-tests', rule.ruleId, title === '' ? rule.ruleId : title),
        kind: 'rule-without-tests',
        context: rule.context,
        file: rule.card,
        line: rule.line,
        ruleId: rule.ruleId,
        text: title === '' ? rule.ruleId : `${rule.ruleId} ${title}`,
        source: 'card',
        ...(rule.untested === undefined ? {} : { resolution: { by: 'untested' as const, reason: rule.untested } }),
      });
    }
  }

  // M1: an exact duplicate (every field equal) sorts next to its twin; equal fingerprints alone are kept.
  out.sort(compareCandidates);
  return out.filter((candidate, i) => i === 0 || compareCandidates(out[i - 1]!, candidate) !== 0);
}

/**
 * The containing type of a symbol: the longest name in `types` (the file's class, interface and type symbols) that
 * is a proper prefix of the symbol's name ending at a separating `.` (`segmentDots`: never inside brackets or a
 * quoted segment). The symbol's own name never counts. `fingerprintSymbolPart` keeps this type when the rest of the
 * name has more than one segment (the amended H4).
 */
function containerOf(symbolId: string, types: ReadonlySet<string>): string | undefined {
  if (types.size === 0) return undefined;
  const name = middleSegment(symbolId);
  let best: string | undefined;
  for (const dot of segmentDots(name)) {
    const prefix = name.slice(0, dot);
    if (types.has(prefix)) best = prefix;
  }
  return best;
}

/** The name part of `<file>::<name>::<kind>` (everything between the first and the last `::`). */
function middleSegment(symbolId: string): string {
  const first = symbolId.indexOf('::');
  const last = symbolId.lastIndexOf('::');
  return first < 0 || first === last ? symbolId.slice(0, first < 0 ? symbolId.length : first) : symbolId.slice(first + 2, last);
}
