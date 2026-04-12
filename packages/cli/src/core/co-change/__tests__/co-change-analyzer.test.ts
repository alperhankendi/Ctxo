import { describe, it, expect } from 'vitest';
import { aggregateCoChanges, loadCoChangeMap } from '../co-change-analyzer.js';
import type { FileIndex } from '../../types.js';

function makeIndex(file: string, hashes: string[]): FileIndex {
  return {
    file,
    lastModified: 1000,
    symbols: [],
    edges: [],
    intent: hashes.map(h => ({ hash: h, message: `commit ${h}`, date: '2026-01-01', kind: 'commit' as const })),
    antiPatterns: [],
  };
}

describe('aggregateCoChanges', () => {
  it('detects files that share commits', () => {
    const indices = [
      makeIndex('src/a.ts', ['c1', 'c2', 'c3']),
      makeIndex('src/b.ts', ['c1', 'c2']),
    ];
    const matrix = aggregateCoChanges(indices);

    expect(matrix.entries).toHaveLength(1);
    expect(matrix.entries[0]!.file1).toBe('src/a.ts');
    expect(matrix.entries[0]!.file2).toBe('src/b.ts');
    expect(matrix.entries[0]!.sharedCommits).toBe(2);
    // frequency = 2 / min(3, 2) = 2/2 = 1.0
    expect(matrix.entries[0]!.frequency).toBe(1);
  });

  it('filters out pairs with fewer than 2 shared commits', () => {
    const indices = [
      makeIndex('src/a.ts', ['c1', 'c2']),
      makeIndex('src/b.ts', ['c1']),       // only 1 shared
      makeIndex('src/c.ts', ['c1', 'c2']), // 2 shared with a
    ];
    const matrix = aggregateCoChanges(indices);

    const abPair = matrix.entries.find(e => e.file2 === 'src/b.ts' && e.file1 === 'src/a.ts');
    expect(abPair).toBeUndefined(); // only 1 shared commit

    const acPair = matrix.entries.find(e => e.file1 === 'src/a.ts' && e.file2 === 'src/c.ts');
    expect(acPair).toBeDefined();
    expect(acPair!.sharedCommits).toBe(2);
  });

  it('calculates frequency correctly', () => {
    const indices = [
      makeIndex('src/a.ts', ['c1', 'c2', 'c3', 'c4', 'c5']), // 5 commits
      makeIndex('src/b.ts', ['c1', 'c2']),                     // 2 commits, both shared
    ];
    const matrix = aggregateCoChanges(indices);

    expect(matrix.entries).toHaveLength(1);
    // frequency = 2 / min(5, 2) = 2/2 = 1.0
    expect(matrix.entries[0]!.frequency).toBe(1);
  });

  it('sorts by frequency descending', () => {
    const indices = [
      makeIndex('src/a.ts', ['c1', 'c2', 'c3', 'c4', 'c5']),
      makeIndex('src/b.ts', ['c1', 'c2']),                     // freq with a: 2/2 = 1.0
      makeIndex('src/c.ts', ['c1', 'c2', 'c3', 'c4', 'c5']),  // freq with a: 5/5 = 1.0
      makeIndex('src/d.ts', ['c1', 'c2', 'c6', 'c7', 'c8', 'c9']), // freq with a: 2/5 = 0.4
    ];
    const matrix = aggregateCoChanges(indices);

    // All pairs with freq >= 0.1 and >= 2 shared
    const freqs = matrix.entries.map(e => e.frequency);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeLessThanOrEqual(freqs[i - 1]!);
    }
  });

  it('returns empty entries when no files share commits', () => {
    const indices = [
      makeIndex('src/a.ts', ['c1']),
      makeIndex('src/b.ts', ['c2']),
    ];
    const matrix = aggregateCoChanges(indices);
    expect(matrix.entries).toHaveLength(0);
  });

  it('returns empty entries for files with no intent', () => {
    const indices = [
      makeIndex('src/a.ts', []),
      makeIndex('src/b.ts', []),
    ];
    const matrix = aggregateCoChanges(indices);
    expect(matrix.entries).toHaveLength(0);
  });

  it('handles 3+ files in a single commit', () => {
    const indices = [
      makeIndex('src/a.ts', ['c1', 'c2']),
      makeIndex('src/b.ts', ['c1', 'c2']),
      makeIndex('src/c.ts', ['c1', 'c2']),
    ];
    const matrix = aggregateCoChanges(indices);

    // 3 pairs: a-b, a-c, b-c
    expect(matrix.entries).toHaveLength(3);
    expect(matrix.entries.every(e => e.sharedCommits === 2)).toBe(true);
  });

  it('includes version and timestamp in matrix', () => {
    const matrix = aggregateCoChanges([makeIndex('src/a.ts', ['c1'])]);
    expect(matrix.version).toBe(1);
    expect(matrix.timestamp).toBeGreaterThan(0);
  });
});

describe('loadCoChangeMap', () => {
  it('builds bidirectional lookup map', () => {
    const matrix = aggregateCoChanges([
      makeIndex('src/a.ts', ['c1', 'c2']),
      makeIndex('src/b.ts', ['c1', 'c2']),
    ]);
    const map = loadCoChangeMap(matrix);

    expect(map.get('src/a.ts')).toHaveLength(1);
    expect(map.get('src/b.ts')).toHaveLength(1);
    expect(map.get('src/a.ts')![0]!.file2).toBe('src/b.ts');
  });

  it('returns empty map for empty matrix', () => {
    const map = loadCoChangeMap({ version: 1, timestamp: 0, entries: [] });
    expect(map.size).toBe(0);
  });
});
