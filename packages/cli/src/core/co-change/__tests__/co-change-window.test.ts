import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCoChangeSince, selectWindow, sinceCutoff } from '../co-change-window.js';
import type { CanonicalCommit } from '../../history/change-log.js';

/** Unix seconds of an ISO instant. */
function unix(iso: string): number {
  return Date.parse(iso) / 1000;
}

function commit(hash: string, committedAt: number): CanonicalCommit {
  return {
    hash,
    message: `commit ${hash}`,
    date: new Date(committedAt * 1000).toISOString(),
    author: 'Dev',
    committedAt,
    files: ['a.ts'],
  };
}

function hashes(commits: readonly CanonicalCommit[]): string[] {
  return commits.map((c) => c.hash);
}

describe('parseCoChangeSince', () => {
  it('parseCoChangeSince accepts 30d, 2w, 12m, 1y and rejects 12, 12h, -3m', () => {
    expect(parseCoChangeSince('30d')).toEqual({ amount: 30, unit: 'd' });
    expect(parseCoChangeSince('2w')).toEqual({ amount: 2, unit: 'w' });
    expect(parseCoChangeSince('12m')).toEqual({ amount: 12, unit: 'm' });
    expect(parseCoChangeSince('1y')).toEqual({ amount: 1, unit: 'y' });

    expect(parseCoChangeSince('12')).toBeUndefined();
    expect(parseCoChangeSince('12h')).toBeUndefined();
    expect(parseCoChangeSince('-3m')).toBeUndefined();
  });

  it.each(['', 'm', 'd5', ' 12m', '12m ', '12m\n', '12M', '1.5y', '1 m', '12mm', '+3m', '3 months'])(
    'rejects %j',
    (value) => {
      expect(parseCoChangeSince(value)).toBeUndefined();
    },
  );

  it('reads the amount as a decimal integer, zero and leading zeros included', () => {
    expect(parseCoChangeSince('0d')).toEqual({ amount: 0, unit: 'd' });
    expect(parseCoChangeSince('012m')).toEqual({ amount: 12, unit: 'm' });
  });

  it('rejects an amount too large to be an exact integer', () => {
    expect(parseCoChangeSince(`${'9'.repeat(30)}y`)).toBeUndefined();
    expect(parseCoChangeSince(`${'9'.repeat(400)}d`)).toBeUndefined();
  });
});

describe('sinceCutoff', () => {
  it('sinceCutoff subtracts calendar months from the HEAD date in UTC', () => {
    const head = unix('2026-03-31T10:00:00Z');
    expect(sinceCutoff(head, { amount: 1, unit: 'm' })).toBe(unix('2026-02-28T10:00:00Z'));
  });

  it.each([
    ['months across a year boundary', '2026-01-15T08:30:00Z', '2m', '2025-11-15T08:30:00Z'],
    ['a month ending in a leap February', '2024-03-31T23:59:59Z', '1m', '2024-02-29T23:59:59Z'],
    ['a month ending in a 30-day month', '2026-05-31T00:00:00Z', '1m', '2026-04-30T00:00:00Z'],
    ['a month with room for the same day', '2026-03-28T05:00:00Z', '1m', '2026-02-28T05:00:00Z'],
    ['12 months are one year', '2026-07-04T12:00:00Z', '12m', '2025-07-04T12:00:00Z'],
    ['a year from 29 February clamps to 28 February', '2024-02-29T10:00:00Z', '1y', '2023-02-28T10:00:00Z'],
    ['four years from 29 February keep 29 February', '2024-02-29T10:00:00Z', '4y', '2020-02-29T10:00:00Z'],
    ['days are fixed 24 hour spans', '2026-03-01T00:00:00Z', '30d', '2026-01-30T00:00:00Z'],
    ['weeks are seven days', '2026-03-15T06:00:00Z', '2w', '2026-03-01T06:00:00Z'],
    // Already the next day in zones east of UTC: a local-time implementation lands on another instant.
    ['an evening time of day in UTC', '2026-03-30T22:00:00Z', '1m', '2026-02-28T22:00:00Z'],
  ])('%s', (_name, headIso, since, expectedIso) => {
    const parsed = parseCoChangeSince(since);
    expect(parsed).toBeDefined();
    expect(sinceCutoff(unix(headIso), parsed!)).toBe(unix(expectedIso));
  });

  describe('time zone independence', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('uses UTC accessors only, so the process time zone cannot matter', () => {
      // On a machine running in UTC a local-time implementation would still pass, so make every
      // local-time accessor fail instead of relying on the test machine's zone.
      const localTimeAccessors = [
        'getFullYear',
        'getMonth',
        'getDate',
        'getDay',
        'getHours',
        'getMinutes',
        'getSeconds',
        'getMilliseconds',
        'setFullYear',
        'setMonth',
        'setDate',
        'setHours',
        'setMinutes',
        'setSeconds',
        'setMilliseconds',
      ] as const;
      for (const name of localTimeAccessors) {
        vi.spyOn(Date.prototype, name as 'getMonth').mockImplementation(() => {
          throw new Error(`Date.prototype.${name} reads local time`);
        });
      }

      expect(sinceCutoff(unix('2026-03-31T10:00:00Z'), { amount: 1, unit: 'm' })).toBe(unix('2026-02-28T10:00:00Z'));
      expect(sinceCutoff(unix('2024-02-29T10:00:00Z'), { amount: 1, unit: 'y' })).toBe(unix('2023-02-28T10:00:00Z'));
      expect(sinceCutoff(unix('2026-03-15T06:00:00Z'), { amount: 2, unit: 'w' })).toBe(unix('2026-03-01T06:00:00Z'));
    });
  });

  it('returns the HEAD date itself for a zero amount', () => {
    const head = unix('2026-03-31T10:00:00Z');
    for (const unit of ['d', 'w', 'm', 'y'] as const) {
      expect(sinceCutoff(head, { amount: 0, unit })).toBe(head);
    }
  });

  it('returns -Infinity (no cutoff) when the span reaches beyond every representable date', () => {
    const head = unix('2026-03-31T10:00:00Z');
    expect(sinceCutoff(head, { amount: 1e20, unit: 'y' })).toBe(Number.NEGATIVE_INFINITY);
    expect(sinceCutoff(head, { amount: 1e20, unit: 'm' })).toBe(Number.NEGATIVE_INFINITY);
    expect(sinceCutoff(head, { amount: Number.POSITIVE_INFINITY, unit: 'd' })).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns -Infinity (no cutoff) when the HEAD date is not a finite number', () => {
    expect(sinceCutoff(Number.NaN, { amount: 1, unit: 'm' })).toBe(Number.NEGATIVE_INFINITY);
    expect(sinceCutoff(Number.NaN, { amount: 1, unit: 'd' })).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('selectWindow', () => {
  // Newest first, like the change log.
  const log = [commit('c5', 500), commit('c4', 400), commit('c3', 300), commit('c2', 200), commit('c1', 100)];

  it('selectWindow applies maxCommits first, then the since cutoff', () => {
    // The cutoff drops c2 from the newest four; maxCommits alone is the tighter limit for two.
    expect(hashes(selectWindow(log, 4, 250))).toEqual(['c5', 'c4', 'c3']);
    expect(hashes(selectWindow(log, 2, 150))).toEqual(['c5', 'c4']);

    // A skewed committer date shows the order: the newest three are taken first and the cutoff then
    // drops c4. Filtering by date before counting would have returned ['c5', 'c3', 'c2'].
    const skewed = [commit('c5', 500), commit('c4', 100), commit('c3', 400), commit('c2', 300), commit('c1', 200)];
    expect(hashes(selectWindow(skewed, 3, 250))).toEqual(['c5', 'c3']);
  });

  it("keeps every commit in order for 'all' and returns a new array", () => {
    const result = selectWindow(log, 'all');
    expect(hashes(result)).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
    expect(result).not.toBe(log);
  });

  it('returns every commit when maxCommits exceeds the log length', () => {
    expect(hashes(selectWindow(log, 2000))).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
    expect(hashes(selectWindow(log, Number.POSITIVE_INFINITY))).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
  });

  it('keeps commits made exactly at the cutoff', () => {
    expect(hashes(selectWindow(log, 'all', 300))).toEqual(['c5', 'c4', 'c3']);
    expect(hashes(selectWindow(log, 'all', 301))).toEqual(['c5', 'c4']);
  });

  it('selects nothing when every commit predates the cutoff', () => {
    expect(selectWindow(log, 'all', 501)).toEqual([]);
  });

  it('treats a cutoff of -Infinity as no cutoff', () => {
    expect(hashes(selectWindow(log, 3, Number.NEGATIVE_INFINITY))).toEqual(['c5', 'c4', 'c3']);
  });

  it('never widens the window for a maxCommits below 1 or NaN', () => {
    for (const bad of [0, -1, -50, Number.NaN]) {
      expect(selectWindow(log, bad)).toEqual([]);
    }
  });

  it('rounds a fractional maxCommits down', () => {
    expect(hashes(selectWindow(log, 2.9))).toEqual(['c5', 'c4']);
  });

  it('returns an empty list for an empty log', () => {
    expect(selectWindow([], 'all')).toEqual([]);
    expect(selectWindow([], 10, 0)).toEqual([]);
  });

  it('does not modify its input', () => {
    const frozen = Object.freeze(log.map((c) => Object.freeze({ ...c })));
    expect(() => selectWindow(frozen, 3, 250)).not.toThrow();
    expect(hashes(frozen)).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
  });
});
