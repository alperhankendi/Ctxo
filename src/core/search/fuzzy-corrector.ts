/**
 * Fuzzy Corrector — Damerau-Levenshtein based typo correction.
 *
 * Uses adaptive thresholds: d≤1 for terms ≤5 chars, d≤2 for longer terms.
 * Vocabulary is built from tokenized symbol names during index build.
 */

import type { FuzzyCorrection } from '../types.js';

export class FuzzyCorrector {
  /** term → frequency (for tie-breaking) */
  private vocabulary: Map<string, number> = new Map();

  buildVocabulary(termFrequencies: Map<string, number>): void {
    this.vocabulary = new Map(termFrequencies);
  }

  /**
   * Attempt to correct query tokens.
   * Returns null if no correction found or no improvement possible.
   */
  correct(queryTokens: string[]): FuzzyCorrection | null {
    if (this.vocabulary.size === 0) return null;

    const corrections: FuzzyCorrection['corrections'] = [];
    const correctedTokens: string[] = [];
    let anyChanged = false;

    for (const token of queryTokens) {
      // Skip very short tokens (1-2 chars) — too many false matches
      if (token.length <= 2) {
        correctedTokens.push(token);
        continue;
      }

      // Check if token exists in vocabulary (exact match)
      if (this.vocabulary.has(token)) {
        correctedTokens.push(token);
        continue;
      }

      const maxDist = token.length <= 5 ? 1 : 2;
      const best = this.findClosest(token, maxDist);

      if (best) {
        corrections.push({
          original: token,
          corrected: best.term,
          distance: best.distance,
        });
        correctedTokens.push(best.term);
        anyChanged = true;
      } else {
        correctedTokens.push(token);
      }
    }

    if (!anyChanged) return null;

    return {
      originalQuery: queryTokens.join(' '),
      correctedQuery: correctedTokens.join(' '),
      corrections,
    };
  }

  /**
   * Find the closest vocabulary term within maxDistance.
   * Tie-breaks by frequency (higher = preferred).
   */
  private findClosest(
    token: string,
    maxDistance: number,
  ): { term: string; distance: number } | null {
    let bestTerm: string | null = null;
    let bestDist = maxDistance + 1;
    let bestFreq = -1;

    for (const [vocabTerm, freq] of this.vocabulary) {
      // Quick length filter: Damerau-Levenshtein ≥ |len difference|
      if (Math.abs(vocabTerm.length - token.length) > maxDistance) continue;

      const dist = damerauLevenshtein(token, vocabTerm);
      if (dist <= maxDistance) {
        if (dist < bestDist || (dist === bestDist && freq > bestFreq)) {
          bestTerm = vocabTerm;
          bestDist = dist;
          bestFreq = freq;
        }
      }
    }

    return bestTerm !== null ? { term: bestTerm, distance: bestDist } : null;
  }
}

/**
 * Damerau-Levenshtein distance.
 * Includes transpositions as a single edit operation.
 * "tokne" → "token" = distance 1 (transposition), not 2 (delete + insert).
 */
export function damerauLevenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;

  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  // Optimal string alignment distance (restricted edit distance)
  const d: number[][] = Array.from({ length: lenA + 1 }, () => new Array<number>(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i++) d[i]![0] = i;
  for (let j = 0; j <= lenB; j++) d[0]![j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1, // deletion
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );

      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + cost);
      }
    }
  }

  return d[lenA]![lenB]!;
}
