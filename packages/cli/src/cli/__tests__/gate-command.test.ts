import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateCommand } from '../gate-command.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-gp-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  writeFileSync(join(idxDir, 'a.ts.json'), JSON.stringify({
    file: 'src/a.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 5 }],
    edges: [], intent: [], antiPatterns: [],
  }));
  for (const n of ['B', 'C', 'D']) {
    writeFileSync(join(idxDir, `${n.toLowerCase()}.ts.json`), JSON.stringify({
      file: `src/${n.toLowerCase()}.ts`, lastModified: 0,
      symbols: [{ symbolId: `src/${n.toLowerCase()}.ts::${n}::function`, name: n, kind: 'function', startLine: 1, endLine: 3 }],
      edges: [{ from: `src/${n.toLowerCase()}.ts::${n}::function`, to: 'src/a.ts::A::function', kind: 'calls' }],
      intent: [], antiPatterns: [],
    }));
  }
  return root;
}

describe('GateCommand --preview', () => {
  it('reports symbols that would fire as JSON', () => {
    const root = fixture();
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new GateCommand(root).preview({ json: true });
    const printed = JSON.parse(out.mock.calls.map(c => c[0]).join(''));
    expect(printed.wouldFireCount).toBeGreaterThanOrEqual(1);
    expect(printed.symbols.some((s: { symbolId: string }) => s.symbolId === 'src/a.ts::A::function')).toBe(true);
    out.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });
});
