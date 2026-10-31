import { describe, expect, it } from 'vitest';
import { createModuleHost, type FileIndex, type SymbolNode } from '@ctxo/cli/internal';
import type { TestConvention } from '../domain-config.js';
import type { GlobMatcherFactory } from '../ownership.js';
import type { TestTitle } from '../rule-id-scan.js';
import {
  annotationMatches,
  classifyTests,
  parseAnnotationMatcher,
  type AnnotationMatcher,
  type ClassifyTestsInput,
  type TestClassification,
} from '../test-conventions.js';

/**
 * The O(n log n) `classifyTests` against the quadratic version it replaced (roadmap row "Linear test-case
 * classification"): the same output on randomized inputs, and a cost that grows linearly-ish with the cases of a file.
 */

const host = createModuleHost({ cliVersion: '0.0.0', mode: 'cli', projectRoot: process.cwd() });
const makeMatcher: GlobMatcherFactory = host.services.makeGlobMatcher;

// ---------------------------------------------------------------------------------------------------------------
// Reference: the quadratic implementation before the change, kept verbatim (only the helpers it needs).

type Annotation = NonNullable<SymbolNode['annotations']>[number];
interface CompiledConvention {
  readonly matchers: readonly AnnotationMatcher[];
  readonly path: (path: string) => boolean;
  readonly names: readonly string[];
}
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const norm = (path: string): string => path.replace(/\\/g, '/');
const lowerAscii = (text: string): string => text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
function compile(convention: TestConvention, factory: GlobMatcherFactory): CompiledConvention {
  const matchers: AnnotationMatcher[] = [];
  for (const spec of convention.annotations) {
    const matcher = parseAnnotationMatcher(spec);
    if (matcher !== undefined) matchers.push(matcher);
  }
  const path = convention.paths.length === 0 ? () => false : factory([...convention.paths]);
  const names = convention.names.map(lowerAscii).filter((n) => n.length > 0);
  return { matchers, path, names };
}
function spans(outer: SymbolNode, inner: SymbolNode): boolean {
  return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
}
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

function classifyTestsReference(input: ClassifyTestsInput): TestClassification {
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
    const callables = index.symbols.filter(isCallable);
    for (const symbol of callables) {
      if (callables.some((other) => strictlyContains(symbol, other))) continue;
      cases.push(symbol.symbolId);
      const annotations: Annotation[] = [];
      for (const holder of index.symbols) if (spans(holder, symbol)) annotations.push(...(holder.annotations ?? []));
      const texts = [symbol.name, ...titles.filter((t) => t.line >= symbol.startLine + 1 && t.line <= symbol.endLine + 1).map((t) => t.title)].map(
        lowerAscii,
      );
      const matches = (convention: CompiledConvention): boolean =>
        convention.path(file) ||
        annotations.some((a) => convention.matchers.some((m) => annotationMatches(m, a))) ||
        convention.names.some((marker) => texts.some((text) => text.includes(marker)));
      if (matches(characterization)) isCharacterization.add(symbol.symbolId);
      if (matches(contract)) isContract.add(symbol.symbolId);
    }
  }
  const testCases = [...new Set(cases)].sort(compare);
  return {
    testCases,
    characterization: new Set(testCases.filter((id) => isCharacterization.has(id))),
    contract: new Set(testCases.filter((id) => isContract.has(id))),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Randomized inputs.

/** mulberry32: a small seeded generator, so a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const characterization: TestConvention = {
  annotations: ['Trait:Kind=Characterization', 'Tag:characterization', 'Pinned'],
  paths: ['tests/**/Characterization/**'],
  names: ['[characterization]', 'Golden'],
};
const contract: TestConvention = {
  annotations: ['Trait:Kind=Contract', 'Category:contract'],
  paths: ['tests/**/Contracts/**'],
  names: ['[contract]', ''],
};
const ANNOTATIONS: readonly Annotation[] = [
  { name: 'Fact' },
  { name: 'Trait', args: ['Kind', 'Characterization'] },
  { name: 'Trait', args: ['kind', 'CONTRACT'] },
  { name: 'Tag', args: ['Characterization'] },
  { name: 'Pinned' },
  { name: 'Category', named: { value: 'Contract' } },
  { name: 'Trait', args: ['Kind', 'Other'] },
];
const TITLES = ['[characterization] borrow', '[CONTRACT] store', 'plain title', 'golden master', 'GOLDEN', 'nothing'];
const NAMES = ['Borrow', 'GoldenFlow', 'Store', 'Renew', 'Return', 'contractish'];
const KINDS: readonly SymbolNode['kind'][] = ['function', 'method', 'method', 'function', 'class', 'variable', 'interface'];
const FILES = [
  'tests/Lending.Tests/LoanTests.cs',
  'tests/Lending.Tests/Characterization/FeeTests.cs',
  'tests\\Storage.Tests\\Contracts\\BlobTests.cs',
  'src/Lending/Loan.cs',
];

/** `offsets`: consistent (offsets follow lines, as every plugin writes them), random (contradicting lines) or mixed. */
function randomInput(seed: number, offsets: 'consistent' | 'random'): ClassifyTestsInput {
  const r = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const int = (n: number): number => Math.floor(r() * n);
  const maxLine = 2 + int(14);
  const indices: FileIndex[] = [];
  const titles: TestTitle[] = [];
  const fileCount = 1 + int(3);
  for (let f = 0; f < fileCount; f++) {
    const file = pick(FILES);
    const symbols: SymbolNode[] = [];
    const count = int(14);
    for (let i = 0; i < count; i++) {
      const kind = pick(KINDS);
      const name = pick(NAMES);
      let startLine = int(maxLine);
      let endLine = startLine + int(5) - (r() < 0.05 ? 3 : 0);
      if (r() < 0.1) endLine = startLine;
      if (r() < 0.05) [startLine, endLine] = [endLine, startLine];
      const node: { -readonly [K in keyof SymbolNode]: SymbolNode[K] } = {
        symbolId: `${norm(file)}::${r() < 0.2 ? 'Dup' : `${name}${i}`}::${kind}`,
        name,
        kind,
        startLine,
        endLine,
      };
      const mode = r();
      if (mode < 0.6) {
        if (offsets === 'consistent') {
          node.startOffset = startLine * 10 + int(r() < 0.3 ? 2 : 10);
          node.endOffset = endLine * 10 + int(r() < 0.3 ? 2 : 10);
        } else {
          node.startOffset = int(maxLine * 10);
          node.endOffset = int(maxLine * 10);
        }
      } else if (mode < 0.7) {
        node.startOffset = startLine * 10;
      } else if (mode < 0.75) {
        node.endOffset = endLine * 10;
      }
      if (r() < 0.4) node.annotations = Array.from({ length: 1 + int(2) }, () => pick(ANNOTATIONS));
      symbols.push(node);
      // An identical copy: equal spans never contain each other.
      if (r() < 0.05) symbols.push({ ...node });
    }
    indices.push({ file, lastModified: 1, symbols, edges: [], intent: [], antiPatterns: [] });
    const titleCount = int(8);
    for (let t = 0; t < titleCount; t++) titles.push({ file: r() < 0.5 ? file : norm(file), line: int(maxLine + 3), title: pick(TITLES) });
  }
  return { indices, isTestFile: (p) => norm(p).startsWith('tests/'), titles, characterization, contract, makeMatcher };
}

const view = (c: TestClassification) => ({ testCases: c.testCases, characterization: [...c.characterization], contract: [...c.contract] });

describe('classifyTests: the O(n log n) version against the quadratic reference', () => {
  it.each(['consistent', 'random'] as const)('gives the same output on 3,000 randomized inputs (offsets %s)', (offsets) => {
    let cases = 0;
    let marked = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const input = randomInput(seed * 7919 + (offsets === 'random' ? 1 : 0), offsets);
      const expected = view(classifyTestsReference(input));
      expect(view(classifyTests(input)), `seed ${seed}`).toEqual(expected);
      cases += expected.testCases.length;
      marked += expected.characterization.length + expected.contract.length;
    }
    // The generator exercises the interesting paths: many cases and many of them of a kind.
    expect(cases).toBeGreaterThan(5000);
    expect(marked).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Cost: property reads of the symbols and titles, counted through proxies (robust under CI load, unlike a clock).

/**
 * A generated test file with `n` cases: a class spanning the file, `n` methods (with offsets or not), every third
 * one annotated, plus `n` titles. With `nested`, the cases sit in groups of 50 inside `describe`-like functions.
 */
function syntheticFile(n: number, withOffsets: boolean, nested: boolean, counter: { reads: number }): ClassifyTestsInput {
  const file = 'tests/Generated.Tests/GeneratedTests.cs';
  const count = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, key, receiver) {
        counter.reads++;
        return Reflect.get(obj, key, receiver) as unknown;
      },
    });
  const symbols: SymbolNode[] = [count({ symbolId: `${file}::Generated::class`, name: 'Generated', kind: 'class', startLine: 0, endLine: 3 * n + 2 })];
  const titles: TestTitle[] = [];
  for (let i = 0; i < n; i++) {
    const startLine = 3 * i + 1;
    if (nested && i % 50 === 0) {
      const last = Math.min(i + 49, n - 1);
      symbols.push(
        count({
          symbolId: `${file}::group${i}::function`,
          name: `group${i}`,
          kind: 'function',
          startLine,
          endLine: 3 * last + 2,
          ...(withOffsets ? { startOffset: startLine * 100, endOffset: (3 * last + 2) * 100 + 90 } : {}),
        }),
      );
    }
    symbols.push(
      count({
        symbolId: `${file}::Generated.Case${i}::method`,
        name: `Case${i}`,
        kind: 'method',
        startLine,
        endLine: startLine + 1,
        ...(withOffsets ? { startOffset: startLine * 100 + 10, endOffset: (startLine + 1) * 100 + 50 } : {}),
        ...(i % 3 === 0 ? { annotations: [{ name: 'Trait', args: ['Kind', 'Contract'] }] } : {}),
      }),
    );
    titles.push(count({ file, line: startLine + 1, title: i % 5 === 0 ? `[characterization] case ${i}` : `case ${i}` }));
  }
  return {
    indices: [{ file, lastModified: 1, symbols, edges: [], intent: [], antiPatterns: [] }],
    isTestFile: () => true,
    titles,
    characterization,
    contract,
    makeMatcher,
  };
}

function reads(classify: (input: ClassifyTestsInput) => TestClassification, n: number, withOffsets: boolean, nested: boolean): number {
  const counter = { reads: 0 };
  const input = syntheticFile(n, withOffsets, nested, counter);
  counter.reads = 0;
  classify(input);
  return counter.reads;
}

describe('classifyTests: cost on a generated test file', () => {
  it.each([
    { withOffsets: true, nested: false },
    { withOffsets: false, nested: false },
    { withOffsets: true, nested: true },
    { withOffsets: false, nested: true },
  ])('grows about linearly from 1,250 to 5,000 cases (offsets $withOffsets, nested $nested)', ({ withOffsets, nested }) => {
    const small = reads(classifyTests, 1250, withOffsets, nested);
    const large = reads(classifyTests, 5000, withOffsets, nested);
    // Four times the cases: linear work reads about four times as much; the quadratic version read about sixteen times.
    expect(large / small).toBeLessThan(5);
    // And per case only a handful of reads, where the quadratic version made thousands.
    expect(large / 5000).toBeLessThan(50);

    const result = classifyTests(syntheticFile(5000, withOffsets, nested, { reads: 0 }));
    expect(result.testCases).toHaveLength(5000);
    expect(result.contract.size).toBe(1667);
    expect(result.characterization.size).toBe(1000);
  });

  it('the counter tells the two apart: the reference grows quadratically on the same file', () => {
    const small = reads(classifyTestsReference, 250, true, false);
    const large = reads(classifyTestsReference, 1000, true, false);
    expect(large / small).toBeGreaterThan(12);
    expect(reads(classifyTests, 1000, true, false)).toBeLessThan(large / 50);
  });
});
