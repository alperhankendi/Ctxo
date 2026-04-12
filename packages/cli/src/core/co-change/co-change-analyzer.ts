import type { CoChangeEntry, CoChangeMatrix, FileIndex } from '../types.js';

const MIN_SHARED_COMMITS = 2;
const MIN_FREQUENCY = 0.1;

export function aggregateCoChanges(indices: readonly FileIndex[]): CoChangeMatrix {
  // Step 1: Build commit → files map
  const commitToFiles = new Map<string, Set<string>>();
  const fileCommitCounts = new Map<string, number>();

  for (const idx of indices) {
    const file = idx.file;
    let count = 0;
    for (const intent of idx.intent) {
      count++;
      let files = commitToFiles.get(intent.hash);
      if (!files) {
        files = new Set();
        commitToFiles.set(intent.hash, files);
      }
      files.add(file);
    }
    if (count > 0) {
      fileCommitCounts.set(file, count);
    }
  }

  // Step 2: Count shared commits per file pair
  const pairCounts = new Map<string, number>();
  for (const files of commitToFiles.values()) {
    if (files.size < 2) continue;
    const sorted = [...files].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // Step 3: Calculate frequency and filter
  const entries: CoChangeEntry[] = [];
  for (const [key, sharedCommits] of pairCounts) {
    if (sharedCommits < MIN_SHARED_COMMITS) continue;

    const [file1, file2] = key.split('|') as [string, string];
    const count1 = fileCommitCounts.get(file1) ?? 0;
    const count2 = fileCommitCounts.get(file2) ?? 0;
    const minCount = Math.min(count1, count2);
    if (minCount === 0) continue;

    const frequency = Math.round((sharedCommits / minCount) * 1000) / 1000;
    if (frequency < MIN_FREQUENCY) continue;

    entries.push({ file1, file2, sharedCommits, frequency });
  }

  entries.sort((a, b) => b.frequency - a.frequency || b.sharedCommits - a.sharedCommits);

  return {
    version: 1,
    timestamp: Math.floor(Date.now() / 1000),
    entries,
  };
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
