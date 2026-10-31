/**
 * Test conventions (spec 12.3, K13a): how a test is recognised as a characterization or a contract test,
 * by annotation, by path or by a marker in its name. This module reads the annotation matchers and
 * classifies the test cases of the test files (H7).
 */

import type { FileIndex, SymbolNode, TestFileCheck } from '@ctxo/cli/internal';
import type { TestConvention } from './domain-config.js';
import type { GlobMatcherFactory } from './ownership.js';
import type { TestTitle } from './rule-id-scan.js';

/** One `annotations` entry: `Name`, `Name:value` (any argument equals `value`) or `Name:key=value`. */
export interface AnnotationMatcher {
  readonly name: string;
  readonly key?: string;
  readonly value?: string;
}

/** An annotation name, optionally qualified (`NUnit.Framework.Category`). */
const ANNOTATION_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Parses a matcher spec; undefined when it is malformed (empty parts, a second `=`, a bad name). */
export function parseAnnotationMatcher(spec: string): AnnotationMatcher | undefined {
  const text = spec.trim();
  const colon = text.indexOf(':');
  const name = colon < 0 ? text : text.slice(0, colon);
  if (!ANNOTATION_NAME.test(name)) return undefined;
  if (colon < 0) return { name };

  const rest = text.slice(colon + 1);
  const eq = rest.indexOf('=');
  if (eq < 0) {
    const value = rest.trim();
    return value.length > 0 ? { name, value } : undefined;
  }
  const key = rest.slice(0, eq).trim();
  const value = rest.slice(eq + 1).trim();
  if (key.length === 0 || value.length === 0 || value.includes('=')) return undefined;
  return { name, key, value };
}

/** Test cases and the two kinds among them (H7). Every list and set is in codepoint order of symbol IDs. */
export interface TestClassification {
  /** `function` and `method` symbols of test files that contain no other `function` or `method` of the file. */
  readonly testCases: readonly string[];
  readonly characterization: ReadonlySet<string>;
  readonly contract: ReadonlySet<string>;
}

export interface ClassifyTestsInput {
  readonly indices: readonly FileIndex[];
  readonly isTestFile: TestFileCheck;
  /** Declared titles of the test files (`scanTestTitles`), 1-based lines. */
  readonly titles: readonly TestTitle[];
  readonly characterization: TestConvention;
  readonly contract: TestConvention;
  readonly makeMatcher: GlobMatcherFactory;
}

type Annotation = NonNullable<SymbolNode['annotations']>[number];

interface CompiledConvention {
  readonly matchers: readonly AnnotationMatcher[];
  readonly path: (path: string) => boolean;
  readonly names: readonly string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const norm = (path: string): string => path.replace(/\\/g, '/');

/** ASCII-only lower case: keys, values and name markers compare without ASCII case, nothing else is folded. */
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

const sameAscii = (a: string, b: string): boolean => lowerAscii(a) === lowerAscii(b);

/** True when an annotation satisfies a matcher: the name exactly, then the value or the key and value (H7). */
export function annotationMatches(matcher: AnnotationMatcher, annotation: Annotation): boolean {
  if (annotation.name !== matcher.name) return false;
  if (matcher.value === undefined) return true;
  const args = annotation.args ?? [];
  const named = Object.entries(annotation.named ?? {});
  const value = matcher.value;
  if (matcher.key === undefined) {
    return args.some((a) => sameAscii(a, value)) || named.some(([, v]) => sameAscii(v, value));
  }
  const key = matcher.key;
  if (args[0] !== undefined && args[1] !== undefined && sameAscii(args[0], key) && sameAscii(args[1], value)) return true;
  return named.some(([k, v]) => sameAscii(k, key) && sameAscii(v, value));
}

function compile(convention: TestConvention, makeMatcher: GlobMatcherFactory): CompiledConvention {
  const matchers: AnnotationMatcher[] = [];
  for (const spec of convention.annotations) {
    const matcher = parseAnnotationMatcher(spec);
    if (matcher !== undefined) matchers.push(matcher);
  }
  // The host matcher takes a mutable string[] (PF26).
  const path = convention.paths.length === 0 ? () => false : makeMatcher([...convention.paths]);
  const names = convention.names.map(lowerAscii).filter((n) => n.length > 0);
  return { matchers, path, names };
}

/** Line span of `outer` includes the one of `inner` (both ends inclusive). */
function spans(outer: SymbolNode, inner: SymbolNode): boolean {
  return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
}

/** `outer` contains `inner` and is not the same span (offsets decide when both symbols carry them). */
function strictlyContains(outer: SymbolNode, inner: SymbolNode): boolean {
  if (outer === inner || !spans(outer, inner)) return false;
  const { startOffset: os, endOffset: oe } = outer;
  const { startOffset: is, endOffset: ie } = inner;
  if (os !== undefined && oe !== undefined && is !== undefined && ie !== undefined) {
    if (os > is || oe < ie) return false;
    return os !== is || oe !== ie;
  }
  return outer.startLine !== inner.startLine || outer.endLine !== inner.endLine;
}

const isCallable = (symbol: SymbolNode): boolean => symbol.kind === 'function' || symbol.kind === 'method';
const hasOffsets = (symbol: SymbolNode): boolean => symbol.startOffset !== undefined && symbol.endOffset !== undefined;

/** First index of a sorted list whose value is at least (`strict`: above) `x`. */
function lowerBound(sorted: readonly number[], x: number, strict: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (strict ? sorted[mid]! <= x : sorted[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type Span = readonly [number, number];

/**
 * Answers "is some span inside `(a, b)` and not equal to it" (`a2 >= a`, `b2 <= b`, `(a2, b2) != (a, b)`) in
 * O(log n): the spans sorted by start, with the suffix minimum of their ends.
 */
class InnerSpanIndex {
  private readonly starts: number[];
  private readonly minEnd: number[];

  constructor(spans: readonly Span[]) {
    const sorted = [...spans].sort((x, y) => x[0] - y[0]);
    this.starts = sorted.map((s) => s[0]);
    this.minEnd = new Array<number>(sorted.length + 1).fill(Infinity);
    for (let i = sorted.length - 1; i >= 0; i--) this.minEnd[i] = Math.min(sorted[i]![1], this.minEnd[i + 1]!);
  }

  /** A span with `a2 > a, b2 <= b`, or one with `a2 >= a, b2 < b`. */
  hasInner(a: number, b: number): boolean {
    return this.minEnd[lowerBound(this.starts, a, true)]! <= b || this.minEnd[lowerBound(this.starts, a, false)]! < b;
  }
}

/**
 * Answers "does a span include `(start, end)`" (`start2 <= start`, `end2 >= end`) in O(log n): the spans sorted by
 * start, with the prefix maximum of their ends.
 */
class OuterSpanIndex {
  private readonly starts: number[];
  private readonly maxEnd: number[] = [];

  constructor(spans: readonly Span[]) {
    const sorted = [...spans].sort((x, y) => x[0] - y[0]);
    this.starts = sorted.map((s) => s[0]);
    let max = -Infinity;
    for (const s of sorted) {
      max = Math.max(max, s[1]);
      this.maxEnd.push(max);
    }
  }

  includes(start: number, end: number): boolean {
    const count = lowerBound(this.starts, start, true);
    return count > 0 && this.maxEnd[count - 1]! >= end;
  }
}

/**
 * True when no smaller offset of these symbols sits on a later line (and equal offsets sit on one line): then offset
 * containment implies line containment, and the offset rule of `strictlyContains` compares offsets alone.
 */
function offsetsFollowLines(symbols: readonly SymbolNode[]): boolean {
  const points: [number, number][] = [];
  for (const s of symbols) points.push([s.startOffset!, s.startLine], [s.endOffset!, s.endLine]);
  points.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  for (let i = 1; i < points.length; i++) {
    const [prevOffset, prevLine] = points[i - 1]!;
    const [offset, line] = points[i]!;
    if (line < prevLine || (offset === prevOffset && line !== prevLine)) return false;
  }
  return true;
}

/**
 * The callables of one file that strictly contain no other callable (`strictlyContains`), in input order, in
 * O(n log n). Line spans decide unless both symbols carry offsets. A file whose offsets contradict its lines (no
 * plugin writes one) takes the pairwise check, so the result is the same on any input.
 */
function leafCallables(callables: readonly SymbolNode[]): SymbolNode[] {
  const withOffsets = callables.filter(hasOffsets);
  if (!offsetsFollowLines(withOffsets)) return callables.filter((s) => !callables.some((other) => strictlyContains(s, other)));
  const lineIndex = (list: readonly SymbolNode[]): InnerSpanIndex => new InnerSpanIndex(list.map((s): Span => [s.startLine, s.endLine]));
  const anyLines = lineIndex(callables);
  const plainLines = lineIndex(callables.filter((s) => !hasOffsets(s)));
  const offsets = new InnerSpanIndex(withOffsets.map((s): Span => [s.startOffset!, s.endOffset!]));
  return callables.filter((s) =>
    hasOffsets(s)
      ? !plainLines.hasInner(s.startLine, s.endLine) && !offsets.hasInner(s.startOffset!, s.endOffset!)
      : !anyLines.hasInner(s.startLine, s.endLine),
  );
}

/** The 1-based lines of the titles holding a marker, sorted, and whether one lies in a 0-based line span (W16). */
function titleLinesIn(sortedLines: readonly number[], symbol: SymbolNode): boolean {
  const first = sortedLines[lowerBound(sortedLines, symbol.startLine + 1, false)];
  return first !== undefined && first <= symbol.endLine + 1;
}

/**
 * H7: the test cases of the test files and which of them are characterization and contract tests. A case is of a
 * kind when its file matches a `paths` glob, when it or a symbol of its file spanning it carries an annotation a
 * matcher accepts, or when a `names` marker occurs in its name or in a declared title on a line it spans.
 * O(n log n) in the symbols and titles of a file: leaves by `leafCallables`, annotation holders by an
 * `OuterSpanIndex` of the holders a matcher accepts, titles by a binary search over the lines of the marked titles.
 */
export function classifyTests(input: ClassifyTestsInput): TestClassification {
  const characterization = compile(input.characterization, input.makeMatcher);
  const contract = compile(input.contract, input.makeMatcher);

  const titlesByFile = new Map<string, TestTitle[]>();
  for (const title of input.titles) {
    const file = norm(title.file);
    const list = titlesByFile.get(file);
    if (list === undefined) titlesByFile.set(file, [title]);
    else list.push(title);
  }

  const cases: string[] = [];
  const isCharacterization = new Set<string>();
  const isContract = new Set<string>();

  for (const index of input.indices) {
    if (!input.isTestFile(index.file)) continue;
    const file = norm(index.file);
    const titles = titlesByFile.get(file) ?? [];
    const leaves = leafCallables(index.symbols.filter(isCallable));
    if (leaves.length === 0) continue;
    const prepare = (convention: CompiledConvention): ((symbol: SymbolNode) => boolean) => {
      const byPath = convention.path(file);
      const accepted = (h: SymbolNode): boolean => (h.annotations ?? []).some((a) => convention.matchers.some((m) => annotationMatches(m, a)));
      const holders = new OuterSpanIndex(index.symbols.filter(accepted).map((h): Span => [h.startLine, h.endLine]));
      const marked = (text: string): boolean => {
        const lower = lowerAscii(text);
        return convention.names.some((marker) => lower.includes(marker));
      };
      const lines = titles.filter((t) => marked(t.title)).map((t) => t.line).sort((a, b) => a - b);
      return (symbol) => byPath || holders.includes(symbol.startLine, symbol.endLine) || marked(symbol.name) || titleLinesIn(lines, symbol);
    };
    const matchesCharacterization = prepare(characterization);
    const matchesContract = prepare(contract);
    for (const symbol of leaves) {
      cases.push(symbol.symbolId);
      if (matchesCharacterization(symbol)) isCharacterization.add(symbol.symbolId);
      if (matchesContract(symbol)) isContract.add(symbol.symbolId);
    }
  }

  const testCases = [...new Set(cases)].sort(compare);
  return {
    testCases,
    characterization: new Set(testCases.filter((id) => isCharacterization.has(id))),
    contract: new Set(testCases.filter((id) => isContract.has(id))),
  };
}
