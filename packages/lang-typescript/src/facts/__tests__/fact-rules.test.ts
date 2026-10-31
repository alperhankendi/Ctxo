import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LiteralKind, TrivialLiteral } from '../fact-types.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';
import { decodeTypescriptStringLiteral } from '../typescript-string-literal.js';
import {
  canonicalNumber,
  capFactValue,
  feedsNormalization,
  hasRetryTimeoutFragment,
  isDisplayCall,
  isMessageSink,
  isTechnicalNormalization,
  isTrivialLiteral,
  joinRoute,
  matchesNormalizationPattern,
  normalizeFactText,
} from '../fact-rules.js';

// The shared conformance vectors; every plugin copy of the rules runs all of them.
const VECTORS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugin-api/conformance/fact-vectors.json');

interface Vector<I, E> { readonly input: I; readonly expected: E }
type Repeat = { readonly repeat: string; readonly count: number };
type Segments = readonly (string | Repeat)[];

interface Vectors {
  readonly $comment: string;
  readonly defaults: { trivialLiterals: TrivialLiteral[]; normalizationMethods: string[] };
  readonly canonicalNumber: Vector<string, string | null>[];
  readonly isTrivialLiteral: Vector<{ literal: string; kind: LiteralKind }, boolean>[];
  readonly isTrivialLiteralCustom: Vector<{ literal: string; kind: LiteralKind; trivialLiterals: TrivialLiteral[] }, boolean>[];
  readonly hasRetryTimeoutFragment: Vector<string, boolean>[];
  readonly matchesNormalizationPattern: Vector<{ method: string; qualifier?: string }, boolean>[];
  readonly matchesNormalizationPatternCustom: Vector<{ method: string; qualifier?: string; patterns: string[] }, boolean>[];
  readonly isMessageSink: Vector<{ callee: string; consumerTypes?: string[] }, boolean>[];
  readonly isDisplayCall: Vector<{ callee: string; consumerTypes?: string[] }, boolean>[];
  readonly isTechnicalNormalization: Vector<{ method: string; qualifier?: string; text: string }, boolean>[];
  readonly feedsNormalization: Vector<{ inner: string; outer: string; outerMethod: string }, boolean>[];
  readonly normalizeFactText: Vector<Segments, Segments>[];
  readonly capFactValue: Vector<Segments, Segments>[];
  readonly joinRoute: Vector<string[], string>[];
  readonly languageSpecific: Readonly<Record<string, {
    readonly isTrivialLiteral: Vector<{ literal: string; kind: LiteralKind; trivialLiterals: TrivialLiteral[] }, boolean>[];
  }>>;
}

const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as Vectors;

function expand(segments: Segments): string {
  return segments.map(segment => (typeof segment === 'string' ? segment : segment.repeat.repeat(segment.count))).join('');
}

describe('fact conformance vectors', () => {
  it('the vectors file has every category', () => {
    expect(Object.keys(vectors).sort()).toEqual([
      '$comment',
      'canonicalNumber',
      'capFactValue',
      'defaults',
      'detailLiteral',
      'feedsNormalization',
      'hasRetryTimeoutFragment',
      'isDisplayCall',
      'isMessageSink',
      'isTechnicalNormalization',
      'isTrivialLiteral',
      'isTrivialLiteralCustom',
      'joinRoute',
      'languageSpecific',
      'matchesNormalizationPattern',
      'matchesNormalizationPatternCustom',
      'normalizeFactText',
    ]);
  });

  it('every category is an array, except languageSpecific, which is keyed by language', () => {
    for (const [key, value] of Object.entries(vectors)) {
      if (key.startsWith('$') || key === 'defaults') continue;
      if (key === 'languageSpecific') {
        expect(Object.keys(value as object)).toContain('typescript');
        for (const [language, block] of Object.entries(vectors.languageSpecific)) {
          if (language.startsWith('$')) continue;
          for (const [category, entries] of Object.entries(block)) {
            if (category.startsWith('$')) continue;
            expect(Array.isArray(entries) && entries.length > 0, `${language}.${category}`).toBe(true);
          }
        }
      } else {
        expect(Array.isArray(value), key).toBe(true);
      }
    }
    expect(vectors.$comment).toContain('Every category is an array of { input, expected }, except languageSpecific, which is keyed by language');
  });

  it('the TypeScript decoder notes live in the typescript block, not in the top-level comment', () => {
    const block = vectors.languageSpecific['typescript'] as unknown as Record<string, unknown>;
    expect(block['$comment']).toContain('decodeTypescriptStringLiteral');
    expect(vectors.$comment).not.toContain('decodeTypescriptStringLiteral');
  });

  it('the vectors defaults block equals DEFAULT_FACT_OPTIONS', () => {
    expect(vectors.defaults).toEqual(DEFAULT_FACT_OPTIONS);
  });

  it('every normalizeFactText and capFactValue vector is a segment array', () => {
    for (const { input, expected } of [...vectors.normalizeFactText, ...vectors.capFactValue]) {
      expect(Array.isArray(input) && Array.isArray(expected)).toBe(true);
    }
  });

  it.each(vectors.canonicalNumber)('canonicalNumber($input) is $expected', ({ input, expected }) => {
    expect(canonicalNumber(input)).toBe(expected ?? undefined);
  });

  it.each(vectors.isTrivialLiteral)('isTrivialLiteral($input.literal, $input.kind) with defaults is $expected', ({ input, expected }) => {
    expect(isTrivialLiteral(input.literal, input.kind, DEFAULT_FACT_OPTIONS.trivialLiterals)).toBe(expected);
  });

  it.each(vectors.isTrivialLiteralCustom)('isTrivialLiteral($input.literal, $input.kind) with a custom list is $expected', ({ input, expected }) => {
    expect(isTrivialLiteral(input.literal, input.kind, input.trivialLiterals)).toBe(expected);
  });

  it.each(vectors.hasRetryTimeoutFragment)('hasRetryTimeoutFragment($input) is $expected', ({ input, expected }) => {
    expect(hasRetryTimeoutFragment(input)).toBe(expected);
  });

  it.each(vectors.matchesNormalizationPattern)('matchesNormalizationPattern($input.method, $input.qualifier) with defaults is $expected', ({ input, expected }) => {
    expect(matchesNormalizationPattern(input.method, input.qualifier, DEFAULT_FACT_OPTIONS.normalizationMethods)).toBe(expected);
  });

  it.each(vectors.matchesNormalizationPatternCustom)('matchesNormalizationPattern($input.method, $input.qualifier) with a custom list is $expected', ({ input, expected }) => {
    expect(matchesNormalizationPattern(input.method, input.qualifier, input.patterns)).toBe(expected);
  });

  it.each(vectors.isMessageSink)('isMessageSink($input.callee, $input.consumerTypes) is $expected', ({ input, expected }) => {
    expect(isMessageSink(input.callee, input.consumerTypes)).toBe(expected);
  });

  it.each(vectors.isDisplayCall)('isDisplayCall($input.callee, $input.consumerTypes) is $expected', ({ input, expected }) => {
    expect(isDisplayCall(input.callee, input.consumerTypes)).toBe(expected);
  });

  it.each(vectors.isTechnicalNormalization)('isTechnicalNormalization($input.text) is $expected', ({ input, expected }) => {
    expect(isTechnicalNormalization(input.method, input.qualifier, input.text)).toBe(expected);
  });

  it.each(vectors.feedsNormalization)('feedsNormalization($input.inner, $input.outer) is $expected', ({ input, expected }) => {
    expect(feedsNormalization(input.inner, input.outer, input.outerMethod)).toBe(expected);
  });

  it.each(vectors.normalizeFactText.map((v, i) => ({ ...v, i })))('normalizeFactText vector $i', ({ input, expected }) => {
    expect(normalizeFactText(expand(input))).toBe(expand(expected));
  });

  it.each(vectors.capFactValue.map((v, i) => ({ ...v, i })))('capFactValue vector $i', ({ input, expected }) => {
    expect(capFactValue(expand(input))).toBe(expand(expected));
  });

  it.each(vectors.languageSpecific['typescript']!.isTrivialLiteral)('TypeScript isTrivialLiteral($input.literal) with $input.trivialLiterals is $expected', ({ input, expected }) => {
    expect(isTrivialLiteral(input.literal, input.kind, input.trivialLiterals, decodeTypescriptStringLiteral)).toBe(expected);
  });

  it('without a string literal decoder only plain quoted literals are decoded', () => {
    expect(isTrivialLiteral("''", 'string', [''])).toBe(false);
    expect(isTrivialLiteral("''", 'string', [''], decodeTypescriptStringLiteral)).toBe(true);
    expect(isTrivialLiteral('``', 'string', [''])).toBe(false);
    expect(isTrivialLiteral('``', 'string', [''], decodeTypescriptStringLiteral)).toBe(true);
    expect(isTrivialLiteral('`${x}`', 'string', ['', '${x}'], decodeTypescriptStringLiteral)).toBe(false);
  });

  it('the decoder is asked only for literals that are not plain quoted ones', () => {
    const seen: string[] = [];
    const decoder = (literal: string): string | undefined => {
      seen.push(literal);
      return 'decoded';
    };
    expect(isTrivialLiteral(' "x" ', 'string', ['x'], decoder)).toBe(true);
    expect(isTrivialLiteral("'x'", 'char', ['x'], decoder)).toBe(true);
    expect(isTrivialLiteral('"\\u0041"', 'string', ['decoded'], decoder)).toBe(false);
    expect(isTrivialLiteral(' @"x" ', 'string', ['decoded'], decoder)).toBe(true);
    expect(seen).toEqual(['@"x"']);
  });

  it.each(vectors.joinRoute)('joinRoute($input) is $expected', ({ input, expected }) => {
    expect(joinRoute(...input)).toBe(expected);
  });
});
