import { expect, it } from 'vitest';
import { findCoChangedFiles, findCoChangedFilesForBlastRadius } from '../co-changed-files.js';
import { loadCoChangeMap } from '../../co-change/co-change-analyzer.js';
import type { CoChangeEntry } from '../../types.js';

function entry(file1: string, file2: string, frequency: number, sharedCommits: number): CoChangeEntry {
  return { file1, file2, sharedCommits, frequency };
}

function mapOf(entries: CoChangeEntry[]): Map<string, CoChangeEntry[]> {
  return loadCoChangeMap({ version: 1, timestamp: 0, entries });
}

it('findCoChangedFiles excludes files already impacted and applies limit and minFrequency', () => {
  const map = mapOf([
    entry('src/a.ts', 'src/b.ts', 0.9, 9), // b.ts is impacted: it has a graph path to the root
    entry('src/a.ts', 'src/c.ts', 0.8, 8),
    entry('src/d.ts', 'src/a.ts', 0.6, 6), // the root can be either side of the pair
    entry('src/a.ts', 'src/e.ts', 0.5, 5), // exactly the default minimum: kept
    entry('src/a.ts', 'src/f.ts', 0.4, 4), // below the default minimum
    entry('src/g.ts', 'src/h.ts', 0.9, 9), // does not involve the root
  ]);
  const impacted = new Set(['src/a.ts', 'src/b.ts']);

  expect(findCoChangedFiles(map, 'src/a.ts', impacted)).toEqual([
    { file: 'src/c.ts', frequency: 0.8, sharedCommits: 8 },
    { file: 'src/d.ts', frequency: 0.6, sharedCommits: 6 },
    { file: 'src/e.ts', frequency: 0.5, sharedCommits: 5 },
  ]);

  const files = (options: { limit?: number; minFrequency?: number }) =>
    findCoChangedFiles(map, 'src/a.ts', impacted, options).map((f) => f.file);
  expect(files({ limit: 2 })).toEqual(['src/c.ts', 'src/d.ts']);
  expect(files({ limit: 0 })).toEqual([]);
  expect(files({ limit: -1 })).toEqual([]); // not "all but the last"
  expect(files({ minFrequency: 0.7 })).toEqual(['src/c.ts']);
  expect(files({ minFrequency: 0.4 })).toEqual(['src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']);
  expect(files({ minFrequency: 0.95 })).toEqual([]);
});

it('findCoChangedFiles returns ten files by default', () => {
  const partners = Array.from({ length: 12 }, (_, i) => `src/p${String(i).padStart(2, '0')}.ts`);
  const map = mapOf(partners.map((file, i) => entry('src/a.ts', file, 0.9 - i * 0.01, 5)));

  const result = findCoChangedFiles(map, 'src/a.ts', new Set(['src/a.ts']));

  expect(result.map((f) => f.file)).toEqual(partners.slice(0, 10));
});

it('findCoChangedFiles sorts by frequency, then shared commits, then file name in code point order', () => {
  const map = mapOf([
    entry('src/a.ts', 'src/m.ts', 0.7, 3),
    entry('src/a.ts', 'src/k.ts', 0.7, 5),
    // Uppercase sorts before lowercase in code point order; a locale-aware comparison would reverse these two.
    entry('src/a.ts', 'src/b.ts', 0.7, 3),
    entry('src/a.ts', 'src/B.ts', 0.7, 3),
    entry('src/a.ts', 'src/z.ts', 0.9, 2),
  ]);

  const result = findCoChangedFiles(map, 'src/a.ts', new Set(['src/a.ts']));

  expect(result.map((f) => f.file)).toEqual(['src/z.ts', 'src/k.ts', 'src/B.ts', 'src/b.ts', 'src/m.ts']);
});

it('findCoChangedFiles returns nothing for a root without co-change entries', () => {
  const map = mapOf([entry('src/x.ts', 'src/y.ts', 0.9, 9)]);

  expect(findCoChangedFiles(map, 'src/a.ts', new Set(['src/a.ts']))).toEqual([]);
  expect(findCoChangedFiles(new Map(), 'src/a.ts', new Set())).toEqual([]);
});

it('findCoChangedFiles lists a partner once, with the stronger entry, and never the root itself', () => {
  const map = mapOf([
    entry('src/a.ts', 'src/b.ts', 0.6, 3),
    entry('src/b.ts', 'src/a.ts', 0.8, 4), // the same pair written the other way round
    entry('src/a.ts', 'src/a.ts', 0.9, 9), // a file paired with itself
  ]);

  expect(findCoChangedFiles(map, 'src/a.ts', new Set())).toEqual([
    { file: 'src/b.ts', frequency: 0.8, sharedCommits: 4 },
  ]);
});

it('findCoChangedFiles leaves its inputs as they were', () => {
  const entries = Object.freeze([
    Object.freeze(entry('src/a.ts', 'src/b.ts', 0.6, 3)),
    Object.freeze(entry('src/a.ts', 'src/c.ts', 0.9, 4)),
  ]);
  const map: ReadonlyMap<string, readonly CoChangeEntry[]> = new Map([['src/a.ts', entries]]);
  const impacted: ReadonlySet<string> = new Set(['src/a.ts']);

  // A cached map is shared between callers: sorting its lists in place would throw on these frozen ones.
  expect(findCoChangedFiles(map, 'src/a.ts', impacted).map((f) => f.file)).toEqual(['src/c.ts', 'src/b.ts']);
  expect(entries.map((e) => e.file2)).toEqual(['src/b.ts', 'src/c.ts']);
});

it('findCoChangedFilesForBlastRadius leaves out the root file and the file of every impacted symbol, in any tier', () => {
  const map = mapOf([
    entry('src/a.ts', 'src/b.ts', 0.9, 9), // b.ts holds a confirmed dependent
    entry('src/a.ts', 'src/c.ts', 0.8, 8), // c.ts a likely one
    entry('src/a.ts', 'src/d.ts', 0.7, 7), // d.ts a potential one
    entry('src/a.ts', 'src/e.ts', 0.6, 6), // nothing in e.ts depends on the root
  ]);
  const impacted = [
    { symbolId: 'src/b.ts::B::function' },
    { symbolId: 'src/b.ts::B2::function' }, // a second symbol in a file that is already counted
    { symbolId: 'src/c.ts::C::class' },
    { symbolId: 'src/d.ts::D.run::method' },
  ];

  expect(findCoChangedFilesForBlastRadius(map, 'src/a.ts::A::function', impacted)).toEqual([
    { file: 'src/e.ts', frequency: 0.6, sharedCommits: 6 },
  ]);
});

it('findCoChangedFilesForBlastRadius takes the root file from the symbol id and ignores dependents inside that file', () => {
  const map = mapOf([entry('src/a.ts', 'src/e.ts', 0.6, 6)]);

  expect(
    findCoChangedFilesForBlastRadius(map, 'src/a.ts::A::function', [{ symbolId: 'src/a.ts::Helper::function' }]),
  ).toEqual([{ file: 'src/e.ts', frequency: 0.6, sharedCommits: 6 }]);
  // The same entry seen from the other file: e.ts is the root now, and a.ts the co-changing file.
  expect(findCoChangedFilesForBlastRadius(map, 'src/e.ts::E::function', [])).toEqual([
    { file: 'src/a.ts', frequency: 0.6, sharedCommits: 6 },
  ]);
});

it('findCoChangedFilesForBlastRadius returns nothing without a matrix or without partners', () => {
  const impacted = [{ symbolId: 'src/b.ts::B::function' }];

  expect(findCoChangedFilesForBlastRadius(undefined, 'src/a.ts::A::function', impacted)).toEqual([]);
  expect(findCoChangedFilesForBlastRadius(new Map(), 'src/a.ts::A::function', impacted)).toEqual([]);
  expect(findCoChangedFilesForBlastRadius(mapOf([entry('src/x.ts', 'src/y.ts', 0.9, 9)]), 'src/a.ts::A::function', [])).toEqual([]);
});
