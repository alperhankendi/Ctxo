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
