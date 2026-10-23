import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoChangeReader } from '../co-change-reader.js';
import type { CoChangeEntry, CoChangeMatrix } from '../../../core/types.js';

/**
 * Faults for the reader's file system calls on co-changes.json, for what a real file system cannot do on
 * demand: a stat error that is not "missing", and reads that fail for a moment and then work. Everything
 * else passes straight through to the real `node:fs`. `matrixReads` counts the reads of the matrix.
 */
const faults = vi.hoisted(() => ({
  statError: undefined as Error | undefined,
  failingReads: 0,
  matrixReads: 0,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const isMatrix = (path: unknown) => String(path).endsWith('co-changes.json');
  return {
    ...actual,
    statSync: ((path: unknown, ...rest: unknown[]) => {
      if (faults.statError && isMatrix(path)) throw faults.statError;
      return (actual.statSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.statSync,
    readFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (isMatrix(path)) {
        faults.matrixReads++;
        if (faults.failingReads > 0) {
          faults.failingReads--;
          throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });
        }
      }
      return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readFileSync,
  };
});

const roots: string[] = [];

beforeEach(() => {
  faults.statError = undefined;
  faults.failingReads = 0;
  faults.matrixReads = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-co-change-reader-'));
  roots.push(root);
  return root;
}

function entry(file1: string, file2: string, frequency: number, sharedCommits: number): CoChangeEntry {
  return { file1, file2, sharedCommits, frequency };
}

function matrix(entries: CoChangeEntry[]): CoChangeMatrix {
  return { version: 1, timestamp: 1_000, entries };
}

function matrixPath(root: string): string {
  return join(root, 'index', 'co-changes.json');
}

/**
 * Writes the matrix file and sets its mtime to `minute` past a fixed date. Two writes inside one timer
 * tick would otherwise get the same mtime, and the tests below are about what the reader does when the
 * mtime does or does not change.
 */
function writeMatrixFile(root: string, content: unknown, minute: number): void {
  mkdirSync(join(root, 'index'), { recursive: true });
  const path = matrixPath(root);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf-8');
  const when = new Date(Date.UTC(2026, 0, 1, 0, minute));
  utimesSync(path, when, when);
}

it('CoChangeReader returns a map for a valid file, undefined for missing or invalid files, and re-reads after mtime changes', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = tempRoot();
  const reader = new CoChangeReader(root);

  // No file yet: nothing to read.
  expect(reader.readCoChangeMap()).toBeUndefined();

  // A valid matrix: every entry is reachable from both of its files.
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 1);
  const first = reader.readCoChangeMap();
  expect(first?.get('src/a.ts')).toEqual([entry('src/a.ts', 'src/b.ts', 0.8, 4)]);
  expect(first?.get('src/b.ts')).toEqual([entry('src/a.ts', 'src/b.ts', 0.8, 4)]);

  // Rewritten with a newer mtime: the reader reads it again.
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/c.ts', 0.6, 3)]), 2);
  const second = reader.readCoChangeMap();
  expect(second?.get('src/a.ts')).toEqual([entry('src/a.ts', 'src/c.ts', 0.6, 3)]);
  expect(second?.has('src/b.ts')).toBe(false);

  // Invalid content: not JSON, then JSON that is not a matrix.
  writeMatrixFile(root, '{ not json', 3);
  expect(reader.readCoChangeMap()).toBeUndefined();
  writeMatrixFile(root, { version: 1, timestamp: 1 }, 4);
  expect(reader.readCoChangeMap()).toBeUndefined();

  // Repaired: valid again.
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 5);
  expect(reader.readCoChangeMap()?.size).toBe(2);

  // Gone again: nothing to read.
  rmSync(matrixPath(root));
  expect(reader.readCoChangeMap()).toBeUndefined();
});

it('CoChangeReader keeps serving the parsed map while mtime and size are unchanged', () => {
  const root = tempRoot();
  const reader = new CoChangeReader(root);
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 1);

  const first = reader.readCoChangeMap();
  expect(reader.readCoChangeMap()).toBe(first);

  // Same byte length and same mtime: only the cache can still answer with the old frequency.
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.7, 4)]), 1);
  expect(reader.readCoChangeMap()).toBe(first);
  expect(first?.get('src/a.ts')?.[0]?.frequency).toBe(0.8);
  expect(faults.matrixReads).toBe(1);
});

it('CoChangeReader forgets the cached map when the file is deleted', () => {
  const root = tempRoot();
  const reader = new CoChangeReader(root);
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 1);
  expect(reader.readCoChangeMap()?.get('src/a.ts')?.[0]?.frequency).toBe(0.8);

  rmSync(matrixPath(root));
  expect(reader.readCoChangeMap()).toBeUndefined();

  // Recreated with the same size and mtime but other content: nothing cached may answer for it.
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.7, 4)]), 1);
  expect(reader.readCoChangeMap()?.get('src/a.ts')?.[0]?.frequency).toBe(0.7);
});

it('CoChangeReader re-reads when the size changed although the mtime did not', () => {
  const root = tempRoot();
  const reader = new CoChangeReader(root);
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 1);
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toHaveLength(1);

  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4), entry('src/a.ts', 'src/c.ts', 0.6, 3)]), 1);
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toHaveLength(2);
});

it('CoChangeReader warns once per invalid file version and says nothing about a missing file', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = tempRoot();
  const reader = new CoChangeReader(root);

  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).not.toHaveBeenCalled();

  writeMatrixFile(root, '{ not json', 1);
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('co-changes.json');
  expect(String(warn.mock.calls[0]?.[0])).toContain('is not valid JSON');
  // Unusable content is a fact about that version of the file, so it is read once, not on every call.
  expect(faults.matrixReads).toBe(1);

  // A new version of the file that is invalid again is news, so it warns again.
  writeMatrixFile(root, { version: 2, timestamp: 1, entries: [] }, 2);
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(2);
  expect(String(warn.mock.calls[1]?.[0])).toContain('is not a valid co-change matrix (version:');
  expect(faults.matrixReads).toBe(2);
});

it('CoChangeReader returns undefined and warns when the file cannot be read', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = tempRoot();
  // A folder where the file should be: it exists, but reading it fails.
  mkdirSync(matrixPath(root), { recursive: true });

  const reader = new CoChangeReader(root);
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('cannot be read');
  // A failed read is not an answer about the content: every call tries again.
  expect(faults.matrixReads).toBe(2);
});

it('CoChangeReader does not cache a failed read: the next call reads again and the warning is not repeated', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = tempRoot();
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 1);
  const reader = new CoChangeReader(root);

  // The next two reads fail with an I/O error although the file itself is fine and unchanged.
  faults.failingReads = 2;
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(faults.matrixReads).toBe(2);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('EIO');

  // A newer version of the file that cannot be read either is a different problem: reported again.
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4), entry('src/a.ts', 'src/c.ts', 0.6, 3)]), 2);
  faults.failingReads = 1;
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(2);

  // Then the read works: the data is served, and cached from here on.
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toHaveLength(2);
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toHaveLength(2);
  expect(faults.matrixReads).toBe(4);
  expect(warn).toHaveBeenCalledTimes(2);
});

it('CoChangeReader is silent only for a missing file: any other stat error warns once, is never cached, and is retried', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = tempRoot();
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.8, 4)]), 1);
  const reader = new CoChangeReader(root);
  expect(reader.readCoChangeMap()?.size).toBe(2);

  // The file is there, but it cannot be inspected right now.
  faults.statError = Object.assign(new Error('EACCES: permission denied, stat'), { code: 'EACCES' });
  expect(reader.readCoChangeMap()).toBeUndefined(); // not the map cached before: it may be out of date
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('EACCES');

  // Once the error is gone the next call works again (the file was not seen meanwhile, so it is read again)
  // and the earlier warning is not repeated.
  const eacces = faults.statError;
  faults.statError = undefined;
  expect(reader.readCoChangeMap()?.size).toBe(2);
  expect(faults.matrixReads).toBe(2);
  expect(warn).toHaveBeenCalledTimes(1);

  // The same problem coming back after a healthy period is a new episode and is reported again.
  faults.statError = eacces;
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(2);

  // ENOENT is the one error that means "no file": silent.
  faults.statError = Object.assign(new Error('ENOENT: no such file or directory, stat'), { code: 'ENOENT' });
  expect(reader.readCoChangeMap()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(2);
});

it('CoChangeReader freezes the lists and entries it hands out, so the shared map cannot be edited in place', () => {
  const root = tempRoot();
  writeMatrixFile(root, matrix([entry('src/a.ts', 'src/b.ts', 0.3, 2), entry('src/a.ts', 'src/c.ts', 0.9, 5)]), 1);
  const map = new CoChangeReader(root).readCoChangeMap()!;

  for (const list of map.values()) {
    expect(Object.isFrozen(list)).toBe(true);
    for (const item of list) expect(Object.isFrozen(item)).toBe(true);
  }
  const list = map.get('src/a.ts')!;
  expect(() => list.sort((x, y) => y.frequency - x.frequency)).toThrow(TypeError);
  expect(() => list.push(entry('src/a.ts', 'src/d.ts', 0.5, 2))).toThrow(TypeError);
  expect(() => { (list[0] as { frequency: number }).frequency = 0.1; }).toThrow(TypeError);
  expect(list.map((e) => e.file2)).toEqual(['src/b.ts', 'src/c.ts']);
});

it.each<[string, unknown]>([
  ['an array', []],
  ['null', null],
  ['a wrong version', { version: 2, timestamp: 1, entries: [] }],
  ['a missing timestamp', { version: 1, entries: [] }],
  ['a missing entries list', { version: 1, timestamp: 1 }],
  ['a frequency above 1', matrix([entry('src/a.ts', 'src/b.ts', 1.5, 2)])],
  ['a negative frequency', matrix([entry('src/a.ts', 'src/b.ts', -0.1, 2)])],
  ['a shared count of zero', matrix([entry('src/a.ts', 'src/b.ts', 0.8, 0)])],
  ['an empty file name', matrix([entry('', 'src/b.ts', 0.8, 2)])],
  ['a malformed window', { ...matrix([]), window: { maxCommits: 0 } }],
])('CoChangeReader rejects a file with %s', (_label, content) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = tempRoot();
  writeMatrixFile(root, content, 1);

  expect(new CoChangeReader(root).readCoChangeMap()).toBeUndefined();
});

it('CoChangeReader accepts a matrix without window metadata, one with it, one with unknown keys, and an empty one', () => {
  const root = tempRoot();
  const reader = new CoChangeReader(root);
  const entries = [entry('src/a.ts', 'src/b.ts', 0.8, 4)];
  const window = {
    maxCommits: 2000, head: 'abc1234', commitsScanned: 10, commitsUsed: 9, massSkipped: 1, maxFilesPerCommit: 30, minShared: 2,
  };

  // Written before the window was recorded.
  writeMatrixFile(root, { version: 1, timestamp: 1, entries }, 1);
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toEqual(entries);

  writeMatrixFile(root, { version: 1, timestamp: 1, window, entries }, 2);
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toEqual(entries);

  // A newer Ctxo may add keys: they are dropped, not rejected.
  writeMatrixFile(root, { version: 1, timestamp: 1, window, entries, extra: { future: true } }, 3);
  expect(reader.readCoChangeMap()?.get('src/a.ts')).toEqual(entries);

  // A matrix without pairs is a matrix: an empty map, not "no matrix".
  writeMatrixFile(root, { version: 1, timestamp: 1, window, entries: [] }, 4);
  const empty = reader.readCoChangeMap();
  expect(empty).toBeDefined();
  expect(empty?.size).toBe(0);
});
