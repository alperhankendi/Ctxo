import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateHookCommand, type HookPayload } from '../gate-hook-command.js';

/** Repo where A is called by B,C,D -> 3 confirmed dependents, highest PageRank. */
function fixture(edgeKinds: Record<string, string> = { B: 'calls', C: 'calls', D: 'calls' }): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-gh-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  writeFileSync(join(idxDir, 'a.ts.json'), JSON.stringify({
    file: 'src/a.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 5 }],
    edges: [], intent: [], antiPatterns: [],
  }));
  for (const [n, kind] of Object.entries(edgeKinds)) {
    writeFileSync(join(idxDir, `${n.toLowerCase()}.ts.json`), JSON.stringify({
      file: `src/${n.toLowerCase()}.ts`, lastModified: 0,
      symbols: [{ symbolId: `src/${n.toLowerCase()}.ts::${n}::function`, name: n, kind: 'function', startLine: 1, endLine: 3 }],
      edges: [{ from: `src/${n.toLowerCase()}.ts::${n}::function`, to: 'src/a.ts::A::function', kind }],
      intent: [], antiPatterns: [],
    }));
  }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export function A() {\n  return 1;\n}\n');
  return root;
}

describe('GateHookCommand.evaluate', () => {
  it('blocks an Edit to a high-impact symbol not yet checked', () => {
    const root = fixture();
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1',
      transcript_path: join(root, 'nonexistent.jsonl'),
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    });
    expect(res.block).toBe(true);
    expect(res.reason).toContain('high-impact');
    rmSync(root, { recursive: true, force: true });
  });

  it('does not block a non-Edit tool', () => {
    const root = fixture();
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1', transcript_path: '', tool_name: 'Read', tool_input: { file_path: 'x' },
    });
    expect(res.block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('fails open when the edited file is not indexed', () => {
    const root = fixture();
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1', transcript_path: '', tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'unknown.ts'), old_string: 'x', new_string: 'y' },
    });
    expect(res.block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('passes silently on the second edit of the same symbol (block once)', () => {
    const root = fixture();
    const cmd = new GateHookCommand(root);
    const payload = {
      session_id: 's1', transcript_path: join(root, 'none.jsonl'), tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    };
    expect(cmd.evaluate(payload).block).toBe(true);
    expect(cmd.evaluate(payload).block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('respects gate.enabled:false in config', () => {
    const root = fixture();
    writeFileSync(join(root, '.ctxo', 'config.yaml'), 'version: "1.0"\ngate:\n  enabled: false\n');
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1', transcript_path: '', tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    });
    expect(res.block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('GateHookCommand.evaluate with co-change', () => {
  /** A is called by B and C (2 confirmed) and only imported by D (potential): one short of minDependents (3). */
  const BORDERLINE = { B: 'calls', C: 'calls', D: 'imports' };
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function repo(edgeKinds?: Record<string, string>): string {
    const root = fixture(edgeKinds);
    roots.push(root);
    return root;
  }

  function editA(root: string): HookPayload {
    return {
      session_id: 's1',
      transcript_path: join(root, 'nonexistent.jsonl'),
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    };
  }

  function writeCoChanges(root: string, content: string): void {
    writeFileSync(join(root, '.ctxo', 'index', 'co-changes.json'), content);
  }

  const aWithD = (frequency: number) => JSON.stringify({
    version: 1, timestamp: 1,
    entries: [{ file1: 'src/a.ts', file2: 'src/d.ts', sharedCommits: 4, frequency }],
  });

  it('blocks a symbol that crosses minDependents only after co-change upgrades a dependent', () => {
    const root = repo(BORDERLINE);

    // Without co-change: two confirmed dependents, the imports edge stays potential.
    expect(new GateHookCommand(root).evaluate(editA(root)).block).toBe(false);

    // D's file co-changes with A's file: potential becomes likely, and the guard counts three.
    writeCoChanges(root, aWithD(0.8));
    const res = new GateHookCommand(root).evaluate(editA(root));
    expect(res.block).toBe(true);
    expect(res.reason).toContain('3 confirmed/likely');
    expect(res.reason).toContain('src/d.ts::D::function');
  });

  it('does not count a dependent whose file co-changes at only 0.5', () => {
    const root = repo(BORDERLINE);
    writeCoChanges(root, aWithD(0.5));

    expect(new GateHookCommand(root).evaluate(editA(root)).block).toBe(false);
  });

  it('still guards on the graph when co-changes.json is invalid', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = repo();
    writeCoChanges(root, '{ not json');

    expect(new GateHookCommand(root).evaluate(editA(root)).block).toBe(true);
  });

  it('proceeds without the upgrade when co-changes.json is invalid', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = repo(BORDERLINE);
    writeCoChanges(root, '{ not json');

    expect(new GateHookCommand(root).evaluate(editA(root)).block).toBe(false);
  });
});
