import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FactOptions, LiteralKind, TrivialLiteral } from '../fact-types.js';
import { DEFAULT_DOMAIN_CONFIG } from '../../domain-config.js';
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

// The shared conformance vectors; the domain copy of the rules runs every shared category. The languageSpecific
// block is skipped here: its decoders are per language, and the text scan's decoder has its own cases (W4, W5).
const VECTORS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../../../plugin-api/conformance/fact-vectors.json');

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
}

const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as Vectors;

/** The domain's default fact lists (pinned to the vectors' defaults block by the domain-config test, W6). */
const DEFAULT_OPTIONS: FactOptions = {
  trivialLiterals: DEFAULT_DOMAIN_CONFIG.facts.trivialLiterals,
  normalizationMethods: DEFAULT_DOMAIN_CONFIG.facts.normalizationMethods,
};

function expand(segments: Segments): string {
  return segments.map(segment => (typeof segment === 'string' ? segment : segment.repeat.repeat(segment.count))).join('');
}

describe('fact conformance vectors in the domain copy', () => {
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

  it('the vectors defaults block equals the domain defaults', () => {
    expect(vectors.defaults).toEqual(DEFAULT_OPTIONS);
  });

  it.each(vectors.canonicalNumber)('canonicalNumber($input) is $expected', ({ input, expected }) => {
    expect(canonicalNumber(input)).toBe(expected ?? undefined);
  });

  it.each(vectors.isTrivialLiteral)('isTrivialLiteral($input.literal, $input.kind) with defaults is $expected', ({ input, expected }) => {
    expect(isTrivialLiteral(input.literal, input.kind, DEFAULT_OPTIONS.trivialLiterals)).toBe(expected);
  });

  it.each(vectors.isTrivialLiteralCustom)('isTrivialLiteral($input.literal, $input.kind) with a custom list is $expected', ({ input, expected }) => {
    expect(isTrivialLiteral(input.literal, input.kind, input.trivialLiterals)).toBe(expected);
  });

  it.each(vectors.hasRetryTimeoutFragment)('hasRetryTimeoutFragment($input) is $expected', ({ input, expected }) => {
    expect(hasRetryTimeoutFragment(input)).toBe(expected);
  });

  it.each(vectors.matchesNormalizationPattern)('matchesNormalizationPattern($input.method, $input.qualifier) with defaults is $expected', ({ input, expected }) => {
    expect(matchesNormalizationPattern(input.method, input.qualifier, DEFAULT_OPTIONS.normalizationMethods)).toBe(expected);
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

  it('the decoder is asked only for literals that are not plain quoted ones', () => {
    const seen: string[] = [];
    const decoder = (literal: string): string | undefined => {
      seen.push(literal);
      return 'decoded';
    };
    expect(isTrivialLiteral(' "x" ', 'string', ['x'], decoder)).toBe(true);
    expect(isTrivialLiteral("'x'", 'char', ['x'], decoder)).toBe(true);
    expect(isTrivialLiteral('"\\u0041"', 'string', ['decoded'], decoder)).toBe(false);
    expect(isTrivialLiteral(" 'x' ", 'string', ['decoded'], decoder)).toBe(true);
    expect(seen).toEqual(["'x'"]);
  });

  it.each(vectors.joinRoute)('joinRoute($input) is $expected', ({ input, expected }) => {
    expect(joinRoute(...input)).toBe(expected);
  });
});
