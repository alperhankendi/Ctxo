import type { CanonicalCommit } from '../history/change-log.js';

/** A duration such as `12m`: the unit is days, weeks, calendar months or calendar years. */
export interface CoChangeSince {
  readonly amount: number;
  readonly unit: 'd' | 'w' | 'm' | 'y';
}

const SINCE_PATTERN = /^(\d+)([dwmy])$/;
const SECONDS_PER_DAY = 86_400;

/**
 * Parses a `cochange.since` duration: digits followed by `d`, `w`, `m` or `y` (for example `30d`,
 * `12m`). Returns `undefined` for anything else, and for an amount too large to be an exact integer.
 * A zero amount is valid; it keeps only the commits made at or after HEAD's committer date.
 */
export function parseCoChangeSince(value: string): CoChangeSince | undefined {
  const match = SINCE_PATTERN.exec(value);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1]!, 10);
  if (!Number.isSafeInteger(amount)) return undefined;
  return { amount, unit: match[2] as CoChangeSince['unit'] };
}

/**
 * The unix-second instant `since` before HEAD's committer date. Months and years are calendar
 * spans in UTC: the day of the month is kept when the target month has it and otherwise clamps to
 * the last day (31 March minus one month is 28 February, or 29 in a leap year), and the time of day
 * is kept. Days and weeks are fixed 24 hour spans. The wall clock and the local time zone play no
 * part, so one HEAD always gives one cutoff.
 *
 * Returns `-Infinity` (no restriction) when the span reaches beyond every date a JavaScript Date
 * can hold, or when `headCommittedAt` is not a finite number.
 */
export function sinceCutoff(headCommittedAt: number, since: CoChangeSince): number {
  const cutoff = subtractSince(headCommittedAt, since);
  return Number.isFinite(cutoff) ? cutoff : Number.NEGATIVE_INFINITY;
}

function subtractSince(headCommittedAt: number, since: CoChangeSince): number {
  switch (since.unit) {
    case 'd':
      return headCommittedAt - since.amount * SECONDS_PER_DAY;
    case 'w':
      return headCommittedAt - since.amount * 7 * SECONDS_PER_DAY;
    case 'm':
      return subtractUtcMonths(headCommittedAt, since.amount);
    case 'y':
      return subtractUtcMonths(headCommittedAt, since.amount * 12);
  }
}

function subtractUtcMonths(epochSeconds: number, months: number): number {
  const date = new Date(epochSeconds * 1000);
  const dayOfMonth = date.getUTCDate();
  // Park on the 1st so that moving the month cannot overflow into the one after it.
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  date.setUTCDate(Math.min(dayOfMonth, daysInUtcMonth(date)));
  return date.getTime() / 1000;
}

function daysInUtcMonth(date: Date): number {
  const lastDay = new Date(date.getTime());
  // Day 0 of the next month is the last day of this one.
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  return lastDay.getUTCDate();
}

/**
 * Picks the commits a co-change matrix is built from. `commits` must be newest first, as the change
 * log returns them.
 *
 * `maxCommits` applies first and takes the newest N in log order ('all' takes every commit). `cutoff`
 * (a unix second from `sinceCutoff`) then keeps the commits whose committer date is at or after it.
 * The cutoff is a plain filter: a commit with a skewed older date is dropped without hiding the
 * newer commits behind it.
 *
 * A `maxCommits` below 1 or NaN selects nothing and a fractional value rounds down, so a bad value
 * can only narrow the window, never widen it.
 */
export function selectWindow(
  commits: readonly CanonicalCommit[],
  maxCommits: number | 'all',
  cutoff?: number,
): CanonicalCommit[] {
  const newest = maxCommits === 'all' ? [...commits] : commits.slice(0, wholeCommitCount(maxCommits));
  return cutoff === undefined ? newest : newest.filter((commit) => commit.committedAt >= cutoff);
}

function wholeCommitCount(maxCommits: number): number {
  return maxCommits >= 1 ? Math.floor(maxCommits) : 0;
}
