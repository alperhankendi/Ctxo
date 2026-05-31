import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGraph } from '../graph-loader.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-gl-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  writeFileSync(join(idxDir, 'a.ts.json'), JSON.stringify({
    file: 'src/a.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 3 }],
    edges: [], intent: [], antiPatterns: [],
  }));
  return root;
}

describe('loadGraph', () => {
  it('builds a graph and returns indices', () => {
    const root = fixture();
    const { graph, indices } = loadGraph(join(root, '.ctxo'));
    expect(graph.hasNode('src/a.ts::A::function')).toBe(true);
    expect(indices.length).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
});
