import { compareCodepoint } from '../compare-codepoint.js';
import type { CanonicalCommit } from '../history/change-log.js';
import type { CoChangeEntry, CoChangeMatrix, CoChangeWindowMeta } from '../types.js';

const MIN_FREQUENCY = 0.1;

export interface CoChangeBuildOptions {
  /**
   * True for the files that take part: the currently indexed files and the tracked files matched by
   * `cochange.include`, minus those matched by `cochange.exclude`. Deleted files are not included, so
   * they drop out of the matrix.
   */
  readonly isIncluded: (path: string) => boolean;
  /** Recorded in the window metadata only; `selectWindow` has already applied it. */
  readonly maxCommits: number | 'all';
  /** Recorded in the window metadata only; the caller turned it into a cutoff for `selectWindow`. */
  readonly since?: string;
  /** Short SHA of HEAD, recorded in the window metadata. */
  readonly head: string;
  readonly maxFilesPerCommit: number;
  readonly minShared: number;
  /** Stored as is: the builder reads no clock. */
  readonly timestamp: number;
}

/**
 * Builds the co-change matrix of one window of commits: how often pairs of files changed in the same
 * commit.
 *
 * `windowed` is the output of `selectWindow`, so `window.commitsScanned` is its length. Per commit:
 * the files are filtered with `isIncluded` first; a commit left with no file is ignored; a commit
 * left with more than `maxFilesPerCommit` files is skipped and counted in `massSkipped` (the excluded
 * files never count toward that limit); every other commit counts as used and adds one to the history
 * of each of its files and one to the shared count of each pair of them. A pair becomes an entry when
 * it was shared at least `minShared` times and `frequency` (shared over the smaller of the two file
 * histories, rounded to three decimals) is at least 0.1.
 *
 * Entries are sorted by frequency, then shared count (both descending), then file names in code point
 * order. The result depends only on the inputs: the same window gives byte-identical JSON.
 */
export function buildCoChangeMatrix(
  windowed: readonly CanonicalCommit[],
  options: CoChangeBuildOptions,
): CoChangeMatrix {
  const commitsPerFile = new Map<string, number>();
  const sharedPerPair = new Map<string, Map<string, number>>();
  let commitsUsed = 0;
  let massSkipped = 0;

  for (const commit of windowed) {
    const files = includedFiles(commit, options.isIncluded);
    if (files.length === 0) continue;
    if (files.length > options.maxFilesPerCommit) {
      massSkipped++;
      continue;
    }

    commitsUsed++;
    for (const file of files) {
      commitsPerFile.set(file, (commitsPerFile.get(file) ?? 0) + 1);
    }
    // `files` is sorted, so every pair is visited once with the smaller name first.
    for (let i = 0; i < files.length - 1; i++) {
      const file1 = files[i]!;
      let partners = sharedPerPair.get(file1);
      if (!partners) {
        partners = new Map();
        sharedPerPair.set(file1, partners);
      }
      for (let j = i + 1; j < files.length; j++) {
        const file2 = files[j]!;
        partners.set(file2, (partners.get(file2) ?? 0) + 1);
      }
    }
  }

  const entries: CoChangeEntry[] = [];
  for (const [file1, partners] of sharedPerPair) {
    for (const [file2, sharedCommits] of partners) {
      if (sharedCommits < options.minShared) continue;

      // Both files were counted in every commit that counted toward the pair.
      const smallerHistory = Math.min(commitsPerFile.get(file1)!, commitsPerFile.get(file2)!);
      const frequency = Math.round((sharedCommits / smallerHistory) * 1000) / 1000;
      if (frequency < MIN_FREQUENCY) continue;

      entries.push({ file1, file2, sharedCommits, frequency });
    }
  }
  entries.sort(compareEntries);

  const window: CoChangeWindowMeta = {
    maxCommits: options.maxCommits,
    ...(options.since !== undefined ? { since: options.since } : {}),
    head: options.head,
    commitsScanned: windowed.length,
    commitsUsed,
    massSkipped,
    maxFilesPerCommit: options.maxFilesPerCommit,
    minShared: options.minShared,
  };

  return { version: 1, timestamp: options.timestamp, window, entries };
}

/**
 * The included files of a commit, de-duplicated and in code point order. A canonical commit already
 * arrives that way; normalising again keeps the pair order independent of the caller.
 */
function includedFiles(commit: CanonicalCommit, isIncluded: (path: string) => boolean): string[] {
  const included = new Set<string>();
  for (const file of commit.files) {
    if (isIncluded(file)) included.add(file);
  }
  return [...included].sort(compareCodepoint);
}

function compareEntries(a: CoChangeEntry, b: CoChangeEntry): number {
  return (
    b.frequency - a.frequency ||
    b.sharedCommits - a.sharedCommits ||
    compareCodepoint(a.file1, b.file1) ||
    compareCodepoint(a.file2, b.file2)
  );
}

export function loadCoChangeMap(matrix: CoChangeMatrix): Map<string, CoChangeEntry[]> {
  const map = new Map<string, CoChangeEntry[]>();
  for (const entry of matrix.entries) {
    let list1 = map.get(entry.file1);
    if (!list1) { list1 = []; map.set(entry.file1, list1); }
    list1.push(entry);

    let list2 = map.get(entry.file2);
    if (!list2) { list2 = []; map.set(entry.file2, list2); }
    list2.push(entry);
  }
  return map;
}
