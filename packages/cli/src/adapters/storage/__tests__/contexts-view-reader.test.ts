import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextsViewReader } from '../contexts-view-reader.js';
import { ArchitectureArtifactsWriter } from '../architecture-artifacts-writer.js';
import { resolveContextsViewConfig } from '../../../core/config/load-config.js';
import type { ContextsView } from '../../../core/contexts-view/contexts-view-builder.js';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

let ctxoRoot: string;
let viewPath: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-contexts-view-reader-'));
  roots.push(root);
  ctxoRoot = join(root, '.ctxo');
  mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
  viewPath = join(ctxoRoot, 'index', 'contexts-view.json');
});

function sampleView(): ContextsView {
  return {
    version: 1,
    commitSha: 'abc1234',
    settings: resolveContextsViewConfig({ version: '1.0' }),
    coverage: { files: 4, covered: 3, ratio: 0.75 },
    candidates: [
      {
        id: 1,
        label: 'src/billing',
        fingerprint: '0123456789abcdef',
        fileCount: 3,
        files: ['src/billing/a.ts', 'src/billing/b.ts', 'src/billing/c.ts'],
        cohesion: 1,
        topTerms: [{ term: 'invoice', files: 2 }],
        crossEdges: [{ candidate: 2, total: 2, byKind: { calls: 1, imports: 1 } }],
        coChangePairs: [
          { file: 'src/billing/a.ts', otherFile: 'src/x.ts', otherCandidate: 2, frequency: 0.5, sharedCommits: 2 },
        ],
        sharedTables: [
          {
            name: 'dbo.loans',
            kind: 'table',
            external: false,
            accesses: [
              { candidate: 1, modes: ['reads', 'writes'] },
              { candidate: 2, modes: ['reads'] },
            ],
            owner: 1,
          },
        ],
      },
    ],
    hubs: [{ file: 'src/types.ts', reasons: ['fan-in'], dependents: 12, damping: 0.267, candidate: 1 }],
    unclustered: { count: 1, files: ['src/lonely.ts'] },
    collisions: [
      {
        name: 'Invoice',
        minJaccard: 0.5,
        occurrences: [{ candidate: 1, file: 'src/billing/a.ts', symbolId: 'src/billing/a.ts::Invoice::class', members: ['total'] }],
      },
    ],
    dataResources: [
      { name: 'dbo.audit_log', external: true, accesses: [{ candidate: 1, modes: ['writes'] }], writers: [1], owner: 1 },
      {
        name: 'dbo.loans',
        kind: 'table',
        external: false,
        accesses: [
          { candidate: 1, modes: ['reads', 'writes'] },
          { candidate: 2, modes: ['reads'] },
        ],
        writers: [1],
        owner: 1,
      },
    ],
  };
}

function setMtime(path: string, seconds: number): void {
  utimesSync(path, seconds, seconds);
}

it('returns the view for a valid file and undefined for a missing one', () => {
  const reader = new ContextsViewReader(ctxoRoot);
  expect(reader.readContextsView()).toBeUndefined();

  const view = sampleView();
  new ArchitectureArtifactsWriter(ctxoRoot).writeContextsView(view);

  expect(reader.readContextsView()).toEqual(view);
});

it('a contexts-view.json without sharedTables or dataResources still validates, with empty lists', () => {
  // A PR 1A artifact: no data fields, and settings.weights without data.
  const { dataResources: _dataResources, ...rest } = sampleView();
  const older = {
    ...rest,
    settings: { ...rest.settings, weights: { dependency: 1, coChange: 1 } },
    candidates: rest.candidates.map(({ sharedTables: _sharedTables, ...candidate }) => candidate),
  };
  writeFileSync(viewPath, JSON.stringify(older, null, 2), 'utf-8');

  const view = new ContextsViewReader(ctxoRoot).readContextsView();

  expect(view).toBeDefined();
  expect(view!.dataResources).toEqual([]);
  expect(view!.candidates[0]!.sharedTables).toEqual([]);
  expect(view!.settings.weights).toEqual({ dependency: 1, coChange: 1, data: 0 });
  expect(view!.candidates[0]!.files).toEqual(older.candidates[0]!.files);
});

it('returns undefined and warns once for an invalid or conflict-marked file, then reads the repaired file after it changes', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const reader = new ContextsViewReader(ctxoRoot);
  const view = sampleView();

  writeFileSync(viewPath, `<<<<<<< HEAD\n${JSON.stringify(view, null, 2)}\n=======\n{}\n>>>>>>> branch\n`, 'utf-8');
  setMtime(viewPath, 1_700_000_000);
  expect(reader.readContextsView()).toBeUndefined();
  expect(reader.readContextsView()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('contexts-view.json');

  // Valid JSON of the wrong shape is a different file version: one more warning, not one per call.
  writeFileSync(viewPath, JSON.stringify({ ...view, coverage: { files: 'many' } }), 'utf-8');
  setMtime(viewPath, 1_700_000_100);
  expect(reader.readContextsView()).toBeUndefined();
  expect(reader.readContextsView()).toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(2);

  writeFileSync(viewPath, JSON.stringify(view, null, 2), 'utf-8');
  setMtime(viewPath, 1_700_000_200);
  expect(reader.readContextsView()).toEqual(view);
  expect(warn).toHaveBeenCalledTimes(2);
});

it('hands out a deeply frozen view, so an in-place edit throws instead of corrupting the cache', () => {
  const reader = new ContextsViewReader(ctxoRoot);
  writeFileSync(viewPath, JSON.stringify(sampleView(), null, 2), 'utf-8');

  const view = reader.readContextsView()!;

  expect(Object.isFrozen(view)).toBe(true);
  expect(Object.isFrozen(view.candidates[0]!.files)).toBe(true);
  expect(() => (view.candidates[0]!.files as string[]).sort()).toThrow(TypeError);
  expect(() => (view.settings.weights as { dependency: number }).dependency = 9).toThrow(TypeError);
});

it('picks up a rewrite whose size changed while the mtime stayed equal', () => {
  const reader = new ContextsViewReader(ctxoRoot);
  const view = sampleView();
  writeFileSync(viewPath, JSON.stringify(view, null, 2), 'utf-8');
  setMtime(viewPath, 1_700_000_000);
  expect(reader.readContextsView()?.commitSha).toBe('abc1234');

  writeFileSync(viewPath, JSON.stringify({ ...view, commitSha: 'abc1234def5678' }, null, 2), 'utf-8');
  setMtime(viewPath, 1_700_000_000);
  expect(reader.readContextsView()?.commitSha).toBe('abc1234def5678');
});

it('picks up a same-size rewrite in the same mtime tick when the file was replaced by a rename', () => {
  const reader = new ContextsViewReader(ctxoRoot);
  const view = sampleView();
  writeFileSync(viewPath, JSON.stringify(view, null, 2), 'utf-8');
  setMtime(viewPath, 1_700_000_000);
  expect(reader.readContextsView()?.commitSha).toBe('abc1234');

  // What atomicWrite does: a fresh file renamed over the old one.
  const tmpPath = `${viewPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ ...view, commitSha: 'xyz9876' }, null, 2), 'utf-8');
  setMtime(tmpPath, 1_700_000_000);
  renameSync(tmpPath, viewPath);
  expect(reader.readContextsView()?.commitSha).toBe('xyz9876');
});

it('picks up a rewritten file by its mtime', () => {
  const reader = new ContextsViewReader(ctxoRoot);
  const view = sampleView();
  writeFileSync(viewPath, JSON.stringify(view, null, 2), 'utf-8');
  setMtime(viewPath, 1_700_000_000);
  expect(reader.readContextsView()?.commitSha).toBe('abc1234');

  writeFileSync(viewPath, JSON.stringify({ ...view, commitSha: 'def5678' }, null, 2), 'utf-8');
  setMtime(viewPath, 1_700_000_300);
  expect(reader.readContextsView()?.commitSha).toBe('def5678');
});
