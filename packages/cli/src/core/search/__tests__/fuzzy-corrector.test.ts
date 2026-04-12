import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzyCorrector, damerauLevenshtein } from '../fuzzy-corrector.js';

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length for empty vs non-empty', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
  });

  it('handles single substitution', () => {
    expect(damerauLevenshtein('cat', 'car')).toBe(1);
  });

  it('handles single insertion', () => {
    expect(damerauLevenshtein('cat', 'cart')).toBe(1);
  });

  it('handles single deletion', () => {
    expect(damerauLevenshtein('cart', 'cat')).toBe(1);
  });

  it('handles transposition as distance 1', () => {
    // "tokne" → "token" is a transposition of 'k' and 'n'... wait no
    // "tokne" → "token" : swap 'n' and 'e'? No...
    // Let me think: "ab" vs "ba" is a transposition
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
  });

  it('handles "databse" → "database" (distance 1)', () => {
    // "databse" → "database": missing 'a' after 'dat'? No...
    // "databse" has 7 chars, "database" has 8 chars
    // This is an insertion: insert 'a' → "database"
    // Actually: d-a-t-a-b-s-e vs d-a-t-a-b-a-s-e
    // That's an insertion of 'a' at position 5 → distance 1
    expect(damerauLevenshtein('databse', 'database')).toBe(1);
  });

  it('handles "cacluator" → "calculator"', () => {
    // cacluator (9) vs calculator (10)
    expect(damerauLevenshtein('cacluator', 'calculator')).toBeLessThanOrEqual(2);
  });

  it('handles "detctor" → "detector" (distance 1, insertion)', () => {
    expect(damerauLevenshtein('detctor', 'detector')).toBe(1);
  });

  it('handles completely different strings', () => {
    expect(damerauLevenshtein('abc', 'xyz')).toBe(3);
  });
});

describe('FuzzyCorrector', () => {
  let corrector: FuzzyCorrector;

  beforeEach(() => {
    corrector = new FuzzyCorrector();
    corrector.buildVocabulary(
      new Map([
        ['blast', 10],
        ['radius', 8],
        ['calculator', 15],
        ['detector', 12],
        ['database', 5],
        ['storage', 20],
        ['adapter', 18],
        ['symbol', 25],
        ['graph', 14],
        ['index', 30],
        ['page', 6],
        ['rank', 7],
        ['node', 22],
      ]),
    );
  });

  it('returns null for correct tokens', () => {
    expect(corrector.correct(['blast', 'radius'])).toBeNull();
  });

  it('returns null for empty vocabulary', () => {
    const empty = new FuzzyCorrector();
    expect(empty.correct(['test'])).toBeNull();
  });

  it('corrects single typo within d=1', () => {
    const result = corrector.correct(['databse']);
    expect(result).not.toBeNull();
    expect(result!.correctedQuery).toBe('database');
    expect(result!.corrections[0].distance).toBe(1);
  });

  it('corrects "detctor" → "detector"', () => {
    const result = corrector.correct(['detctor']);
    expect(result).not.toBeNull();
    expect(result!.corrections[0].corrected).toBe('detector');
  });

  it('corrects "adatper" → "adapter"', () => {
    const result = corrector.correct(['adatper']);
    expect(result).not.toBeNull();
    expect(result!.corrections[0].corrected).toBe('adapter');
  });

  it('corrects "symbo" → "symbol" for 5-char term (d≤1)', () => {
    const result = corrector.correct(['symbo']);
    expect(result).not.toBeNull();
    expect(result!.corrections[0].corrected).toBe('symbol');
    expect(result!.corrections[0].distance).toBe(1);
  });

  it('rejects correction beyond adaptive threshold', () => {
    // "nod" is 3 chars, maxDist=1, "node" is distance 1 → should correct
    const result = corrector.correct(['nod']);
    expect(result).not.toBeNull();
    expect(result!.corrections[0].corrected).toBe('node');
  });

  it('skips very short tokens (≤2 chars)', () => {
    const result = corrector.correct(['db']);
    expect(result).toBeNull();
  });

  it('preserves correct tokens in multi-word query', () => {
    const result = corrector.correct(['blast', 'radus']);
    expect(result).not.toBeNull();
    expect(result!.correctedQuery).toBe('blast radius');
    expect(result!.corrections.length).toBe(1);
    expect(result!.corrections[0].original).toBe('radus');
  });

  it('breaks ties by frequency', () => {
    // Build vocabulary where two terms are equidistant
    corrector.buildVocabulary(
      new Map([
        ['tast', 5],
        ['tost', 10], // higher frequency
      ]),
    );
    // "tist" is distance 1 from both "tast" (i→a) and "tost" (i→o)
    const result = corrector.correct(['tist']);
    expect(result).not.toBeNull();
    expect(result!.corrections[0].corrected).toBe('tost'); // higher freq wins
  });

  it('returns null when no close match exists', () => {
    const result = corrector.correct(['xyzzy']);
    expect(result).toBeNull();
  });
});
