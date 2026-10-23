import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlastRadiusCommand } from '../blast-radius-command.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-br-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  writeFileSync(join(idxDir, 'a.ts.json'), JSON.stringify({
    file: 'src/a.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 3 }],
    edges: [], intent: [], antiPatterns: [],
  }));
  writeFileSync(join(idxDir, 'b.ts.json'), JSON.stringify({
    file: 'src/b.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/b.ts::B::function', name: 'B', kind: 'function', startLine: 1, endLine: 3 }],
    edges: [{ from: 'src/b.ts::B::function', to: 'src/a.ts::A::function', kind: 'calls' }],
    intent: [], antiPatterns: [],
  }));
  return root;
}

/** b.ts imports a.ts (a potential dependent of A); c.ts has no edge to either. co-changes.json is optional. */
function coChangeFixture(coChanges?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-br-cochange-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  const fileIndex = (name: string, edges: unknown[] = []) => JSON.stringify({
    file: `src/${name.toLowerCase()}.ts`, lastModified: 0,
    symbols: [{ symbolId: `src/${name.toLowerCase()}.ts::${name}::function`, name, kind: 'function', startLine: 1, endLine: 3 }],
    edges, intent: [], antiPatterns: [],
  });
  writeFileSync(join(idxDir, 'a.ts.json'), fileIndex('A'));
  writeFileSync(join(idxDir, 'b.ts.json'), fileIndex('B', [
    { from: 'src/b.ts::B::function', to: 'src/a.ts::A::function', kind: 'imports' },
  ]));
  writeFileSync(join(idxDir, 'c.ts.json'), fileIndex('C'));
  if (coChanges !== undefined) {
    writeFileSync(join(root, '.ctxo', 'index', 'co-changes.json'), JSON.stringify(coChanges));
  }
  return root;
}

function runCoChangeFixture(root: string) {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  new BlastRadiusCommand(root).run({ symbolId: 'src/a.ts::A::function', json: true });
  const printed = JSON.parse(out.mock.calls.map(c => c[0]).join(''));
  rmSync(root, { recursive: true, force: true });
  return printed;
}

afterEach(() => vi.restoreAllMocks());

describe('BlastRadiusCommand', () => {
  it('prints JSON with dependent counts to stdout', () => {
    const root = fixture();
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new BlastRadiusCommand(root).run({ symbolId: 'src/a.ts::A::function', json: true });
    const printed = JSON.parse(out.mock.calls.map(c => c[0]).join(''));
    expect(printed.found).toBe(true);
    expect(printed.confirmedCount).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  it('prints found:false for an unknown symbol', () => {
    const root = fixture();
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new BlastRadiusCommand(root).run({ symbolId: 'src/x.ts::X::function', json: true });
    expect(JSON.parse(out.mock.calls.map(c => c[0]).join('')).found).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('BlastRadiusCommand co-change', () => {
  const matrix = (entries: unknown[]) => ({ version: 1, timestamp: 1, entries });

  it('counts a co-changing potential dependent as likely and lists co-changed files without a graph path', () => {
    const printed = runCoChangeFixture(coChangeFixture(matrix([
      { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 4, frequency: 0.8 },
      { file1: 'src/a.ts', file2: 'src/c.ts', sharedCommits: 3, frequency: 0.6 },
    ])));

    expect(printed.likelyCount).toBe(1);
    expect(printed.potentialCount).toBe(0);
    expect(printed.impactedSymbols).toEqual([{ symbolId: 'src/b.ts::B::function', confidence: 'likely', depth: 1 }]);
    expect(printed.coChangedFiles).toEqual([{ file: 'src/c.ts', frequency: 0.6, sharedCommits: 3 }]);
  });

  it('leaves the dependent potential and omits coChangedFiles without a co-changes.json', () => {
    const printed = runCoChangeFixture(coChangeFixture());

    expect(printed.likelyCount).toBe(0);
    expect(printed.potentialCount).toBe(1);
    expect(printed).not.toHaveProperty('coChangedFiles');
  });

  it('omits coChangedFiles when every co-changing file has a graph path', () => {
    const printed = runCoChangeFixture(coChangeFixture(matrix([
      { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 4, frequency: 0.8 },
    ])));

    expect(printed.likelyCount).toBe(1);
    expect(printed).not.toHaveProperty('coChangedFiles');
  });

  it('carries on without co-change when co-changes.json is invalid', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const printed = runCoChangeFixture(coChangeFixture({ version: 1, timestamp: 1, entries: 'nope' }));

    expect(printed.found).toBe(true);
    expect(printed.potentialCount).toBe(1);
    expect(printed).not.toHaveProperty('coChangedFiles');
  });
});
