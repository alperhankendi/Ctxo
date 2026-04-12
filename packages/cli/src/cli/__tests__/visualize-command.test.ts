import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { VisualizeCommand } from '../visualize-command.js';
import type { FileIndex } from '../../core/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function buildIndex(file: string, deps: string[] = []): FileIndex {
  return {
    file,
    lastModified: 1711620000,
    symbols: [
      { symbolId: `${file}::MyClass::class`, name: 'MyClass', kind: 'class', startLine: 1, endLine: 20 },
      { symbolId: `${file}::helper::function`, name: 'helper', kind: 'function', startLine: 22, endLine: 30 },
    ],
    edges: deps.map(dep => ({
      from: `${file}::MyClass::class`,
      to: `${dep}::MyClass::class`,
      kind: 'imports' as const,
    })),
    intent: [],
    antiPatterns: [],
  };
}

describe('VisualizeCommand', () => {
  it('generates HTML with embedded graph data', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-vis-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/core/a.ts'));
    writer.write(buildIndex('src/adapters/b.ts', ['src/core/a.ts']));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new VisualizeCommand(tempDir).run({ noBrowser: true });
    spy.mockRestore();

    const outputPath = join(ctxoRoot, 'visualize.html');
    expect(existsSync(outputPath)).toBe(true);

    const html = readFileSync(outputPath, 'utf-8');
    expect(html).toContain('Ctxo Dependency Graph');
    expect(html).toContain('vis-network');

    // Verify CTXO_DATA is embedded (not the null placeholder)
    expect(html).not.toContain('/*__CTXO_DATA__*/null');
    expect(html).toContain('"totalSymbols":4');
    expect(html).toContain('"shownSymbols":4');
  });

  it('includes all scoring dimensions in payload', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-vis2-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/core/a.ts'));
    writer.write(buildIndex('src/adapters/b.ts', ['src/core/a.ts']));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new VisualizeCommand(tempDir).run({ noBrowser: true });
    spy.mockRestore();

    const html = readFileSync(join(ctxoRoot, 'visualize.html'), 'utf-8');
    // Extract payload from HTML
    const match = html.match(/(?:var|const)\s+CTXO_DATA\s*=\s*(.+?);[\s\n]*(?:\/\/|var|const)/s)
      ?? html.match(/(?:var|const)\s+CTXO_DATA\s*=\s*({.+?});/s);

    expect(match).toBeTruthy();
    const payload = JSON.parse(match![1]!);

    // Check nodes have all required fields
    expect(payload.nodes.length).toBe(4);
    const node = payload.nodes[0];
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('name');
    expect(node).toHaveProperty('kind');
    expect(node).toHaveProperty('file');
    expect(node).toHaveProperty('layer');
    expect(node).toHaveProperty('pageRank');
    expect(node).toHaveProperty('isDead');
    expect(node).toHaveProperty('inDegree');
    expect(node).toHaveProperty('outDegree');

    // Check edges
    expect(payload.edges.length).toBeGreaterThan(0);
    const edge = payload.edges[0];
    expect(edge).toHaveProperty('source');
    expect(edge).toHaveProperty('target');
    expect(edge).toHaveProperty('kind');

    // Check layers
    expect(payload.layers).toBeDefined();
    expect(Object.keys(payload.layers).length).toBeGreaterThan(0);
  });

  it('respects --max-nodes filter', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-vis3-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/core/a.ts'));
    writer.write(buildIndex('src/core/b.ts'));
    writer.write(buildIndex('src/core/c.ts'));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new VisualizeCommand(tempDir).run({ noBrowser: true, maxNodes: 2 });
    spy.mockRestore();

    const html = readFileSync(join(ctxoRoot, 'visualize.html'), 'utf-8');
    expect(html).toContain('"shownSymbols":2');
    expect(html).toContain('"totalSymbols":6');
  });

  it('writes to custom output path', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-vis4-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/a.ts'));

    const customOutput = join(tempDir, 'custom-graph.html');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new VisualizeCommand(tempDir).run({ noBrowser: true, output: customOutput });
    spy.mockRestore();

    expect(existsSync(customOutput)).toBe(true);
    const html = readFileSync(customOutput, 'utf-8');
    expect(html).toContain('vis-network');
  });

  it('edges reference valid node IDs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-vis5-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/a.ts'));
    writer.write(buildIndex('src/b.ts', ['src/a.ts']));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new VisualizeCommand(tempDir).run({ noBrowser: true });
    spy.mockRestore();

    const html = readFileSync(join(ctxoRoot, 'visualize.html'), 'utf-8');
    const match = html.match(/(?:var|const)\s+CTXO_DATA\s*=\s*(.+?);[\s\n]*(?:\/\/|var|const)/s)
      ?? html.match(/(?:var|const)\s+CTXO_DATA\s*=\s*({.+?});/s);
    const payload = JSON.parse(match![1]!);

    const nodeIds = new Set(payload.nodes.map((n: { id: string }) => n.id));
    for (const edge of payload.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
