import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeGlobMatcher, type ResolvedCoChangeConfig } from '../core/config/load-config.js';
import { buildCoChangeMatrix } from '../core/co-change/co-change-analyzer.js';
import { parseCoChangeSince, selectWindow, sinceCutoff } from '../core/co-change/co-change-window.js';
import type { CanonicalCommit } from '../core/history/change-log.js';
import type { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';

/**
 * How many commits to read from git. The co-change window needs `windowCommits` of them; `intent[]`
 * needs enough to find `maxHistory` commits for every file, which the old batch read approximated as
 * `maxHistory * 50`. The larger of the two serves both, and an unbounded window reads everything.
 */
export function changeLogSize(windowCommits: number | 'all', maxHistory: number): number | 'all' {
  return windowCommits === 'all' ? 'all' : Math.max(windowCommits, maxHistory * 50);
}

export interface WriteCoChangeMatrixOptions {
  readonly writer: JsonIndexWriter;
  readonly projectRoot: string;
  /** The whole canonical change log, newest first. The window is cut from it here. */
  readonly commits: readonly CanonicalCommit[];
  /** Short SHA of HEAD and its committer date in unix seconds, as the change log reports them. */
  readonly head: string;
  readonly headCommittedAt: number;
  readonly coChange: ResolvedCoChangeConfig;
  /**
   * The files that take part: those indexed in this run plus every file the committed index holds that
   * the project configuration does not exclude, so the matrix does not depend on which language plugins
   * this machine has loaded. One that is gone from the working tree drops out here: the committed index
   * can still hold the entry of a file deleted since.
   */
  readonly indexedFiles: readonly string[];
}

/**
 * Phase 2b. Builds the co-change matrix from the commits of the change log and writes
 * `co-changes.json`.
 *
 * The window is cut from `commits` with the same `coChange` object that is recorded in the matrix,
 * so the stored window always equals the applied one. The cutoff for `since` is counted back from
 * HEAD's committer date, never from the clock.
 *
 * Nothing is written when the tracked files that `cochange.include` asks for cannot be listed: a
 * matrix built without them would replace a good file with a poorer one.
 */
export function writeCoChangeMatrix(options: WriteCoChangeMatrixOptions): void {
  const { writer, projectRoot, commits, head, headCommittedAt, coChange, indexedFiles } = options;

  const isIncluded = coChangeFileFilter(projectRoot, indexedFiles, coChange);
  if (isIncluded === undefined) return;

  const since = coChange.since !== undefined ? parseCoChangeSince(coChange.since) : undefined;
  const cutoff = since !== undefined ? sinceCutoff(headCommittedAt, since) : undefined;
  const windowed = selectWindow(commits, coChange.maxCommits, cutoff);

  const matrix = buildCoChangeMatrix(windowed, {
    isIncluded,
    maxCommits: coChange.maxCommits,
    since: coChange.since,
    head,
    maxFilesPerCommit: coChange.maxFilesPerCommit,
    minShared: coChange.minShared,
    timestamp: Math.floor(Date.now() / 1000),
  });
  writer.writeCoChanges(matrix);

  if (matrix.window) {
    console.error(
      `[ctxo] Co-change: ${matrix.entries.length} pairs from ${matrix.window.commitsUsed} commits ` +
        `(${matrix.window.massSkipped} mass commits skipped, window ${describeCoChangeWindow(coChange, matrix.window.commitsScanned)})`,
    );
  }
}

/**
 * The files that take part in the co-change matrix: the indexed files and the tracked files that
 * match `cochange.include` (files no language plugin indexes, such as SQL scripts), minus the files
 * that match `cochange.exclude`. Exclusion wins, so it can also remove a file that `include` added.
 *
 * A file takes part only while its source is still in the working tree. This is the one place that
 * rule lives, for indexed and for included files alike.
 *
 * Returns `undefined` when `cochange.include` is set but git cannot list the tracked files.
 */
function coChangeFileFilter(
  projectRoot: string,
  indexedFiles: readonly string[],
  coChange: ResolvedCoChangeConfig,
): ((path: string) => boolean) | undefined {
  const candidates = new Set<string>(indexedFiles);

  if (coChange.include.length > 0) {
    const tracked = listTrackedFiles(projectRoot);
    if (tracked === undefined) return undefined;
    const matchesInclude = makeGlobMatcher([...coChange.include]);
    for (const path of tracked) {
      if (matchesInclude(path)) candidates.add(path);
    }
  }

  const isExcluded = makeGlobMatcher([...coChange.exclude]);
  const present = new Set<string>();
  for (const path of candidates) {
    if (!isExcluded(path) && existsSync(join(projectRoot, path))) present.add(path);
  }
  return (path) => present.has(path);
}

/**
 * Every file git tracks, repo-relative with forward slashes (`-z` keeps unusual names verbatim).
 * Returns `undefined` after saying why when git fails, so the caller can skip the write.
 */
function listTrackedFiles(projectRoot: string): string[] | undefined {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      // stderr is captured: a failure reports git's message once, in the error below.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\0').filter((path) => path.length > 0);
  } catch (err) {
    // A failed child process reports "Command failed: ..." and git's own message on separate lines.
    const reason = (err as Error).message.replace(/\s+/g, ' ').trim();
    console.error(`[ctxo] git ls-files failed: ${reason}; co-changes.json not updated`);
    return undefined;
  }
}

/** The configured window in words, for the log line: "last 2000 commits within 12m of HEAD, 87 scanned". */
function describeCoChangeWindow(coChange: ResolvedCoChangeConfig, commitsScanned: number): string {
  const size = coChange.maxCommits === 'all' ? 'all commits' : `last ${coChange.maxCommits} commits`;
  const age = coChange.since !== undefined ? ` within ${coChange.since} of HEAD` : '';
  return `${size}${age}, ${commitsScanned} scanned`;
}
