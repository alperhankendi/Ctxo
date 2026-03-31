import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetClassHierarchy } from '../get-class-hierarchy.js';
import type { FileIndex } from '../../../core/types.js';

function buildIndices(): FileIndex[] {
  return [
    {
      file: 'src/animal.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/animal.ts::Animal::class', name: 'Animal', kind: 'class', startLine: 1, endLine: 20 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/dog.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/dog.ts::Dog::class', name: 'Dog', kind: 'class', startLine: 1, endLine: 30 }],
      edges: [{ from: 'src/dog.ts::Dog::class', to: 'src/animal.ts::Animal::class', kind: 'extends' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/golden.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/golden.ts::GoldenRetriever::class', name: 'GoldenRetriever', kind: 'class', startLine: 1, endLine: 15 }],
      edges: [{ from: 'src/golden.ts::GoldenRetriever::class', to: 'src/dog.ts::Dog::class', kind: 'extends' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/serializable.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/serializable.ts::Serializable::interface', name: 'Serializable', kind: 'interface', startLine: 1, endLine: 5 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/cat.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/cat.ts::Cat::class', name: 'Cat', kind: 'class', startLine: 1, endLine: 25 }],
      edges: [
        { from: 'src/cat.ts::Cat::class', to: 'src/animal.ts::Animal::class', kind: 'extends' },
        { from: 'src/cat.ts::Cat::class', to: 'src/serializable.ts::Serializable::interface', kind: 'implements' },
      ],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/unrelated.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/unrelated.ts::Util::function', name: 'Util', kind: 'function', startLine: 1, endLine: 5 }],
      edges: [{ from: 'src/unrelated.ts::Util::function', to: 'src/cat.ts::Cat::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('GetClassHierarchyHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-hierarchy-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns ancestors for a class that extends another', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/dog.ts::Dog::class', direction: 'ancestors' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.ancestors).toHaveLength(1);
    expect(payload.ancestors[0].name).toBe('Animal');
    expect(payload.ancestors[0].edgeKind).toBe('extends');
    expect(payload.ancestors[0].depth).toBe(1);
  });

  it('returns multi-level ancestors', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/golden.ts::GoldenRetriever::class', direction: 'ancestors' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.ancestors).toHaveLength(2);
    expect(payload.ancestors[0].name).toBe('Dog');
    expect(payload.ancestors[0].depth).toBe(1);
    expect(payload.ancestors[1].name).toBe('Animal');
    expect(payload.ancestors[1].depth).toBe(2);
  });

  it('returns descendants for a base class', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/animal.ts::Animal::class', direction: 'descendants' });
    const payload = JSON.parse(result.content[0]!.text);

    const names = payload.descendants.map((d: { name: string }) => d.name);
    expect(names).toContain('Dog');
    expect(names).toContain('Cat');
    expect(names).toContain('GoldenRetriever');
  });

  it('returns both ancestors and descendants with direction=both', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/dog.ts::Dog::class', direction: 'both' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.ancestors.length).toBeGreaterThan(0);
    expect(payload.descendants.length).toBeGreaterThan(0);
    expect(payload.ancestors[0].name).toBe('Animal');
    expect(payload.descendants[0].name).toBe('GoldenRetriever');
  });

  it('excludes non-hierarchy edges (imports)', () => {
    // Cat has an importer (Util via imports), but it should not appear in hierarchy
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/cat.ts::Cat::class', direction: 'descendants' });
    const payload = JSON.parse(result.content[0]!.text);

    const names = payload.descendants.map((d: { name: string }) => d.name);
    expect(names).not.toContain('Util');
  });

  it('returns empty hierarchy for symbol with no extends/implements', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/unrelated.ts::Util::function', direction: 'both' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.ancestors).toEqual([]);
    expect(payload.descendants).toEqual([]);
  });

  it('returns { found: false } for missing symbol', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/missing.ts::X::class' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.found).toBe(false);
  });

  it('returns full hierarchy when no symbolId provided', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.hierarchies.length).toBeGreaterThan(0);
    expect(payload.totalClasses).toBeGreaterThan(0);
    expect(payload.totalEdges).toBeGreaterThan(0);

    // Animal should be a root with Dog and Cat as children
    const animalTree = payload.hierarchies.find((h: { name: string }) => h.name === 'Animal');
    expect(animalTree).toBeDefined();
    const childNames = animalTree.children.map((c: { name: string }) => c.name);
    expect(childNames).toContain('Dog');
    expect(childNames).toContain('Cat');
  });

  it('includes implements edges in hierarchy', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/cat.ts::Cat::class', direction: 'ancestors' });
    const payload = JSON.parse(result.content[0]!.text);

    const edgeKinds = payload.ancestors.map((a: { edgeKind: string }) => a.edgeKind);
    expect(edgeKinds).toContain('extends');
    expect(edgeKinds).toContain('implements');
  });

  it('direction=descendants omits ancestors from result', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/dog.ts::Dog::class', direction: 'descendants' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.descendants).toBeDefined();
    expect(payload.ancestors).toBeUndefined();
  });

  it('direction=ancestors omits descendants from result', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/dog.ts::Dog::class', direction: 'ancestors' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.ancestors).toBeDefined();
    expect(payload.descendants).toBeUndefined();
  });

  it('prepends staleness warning when stale (rooted)', () => {
    const mockStaleness = { check: () => ({ message: 'Index stale' }) };
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({ symbolId: 'src/dog.ts::Dog::class' });

    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });

  it('prepends staleness warning when stale (full hierarchy)', () => {
    const mockStaleness = { check: () => ({ message: 'Index stale' }) };
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({});

    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });

  it('no staleness warning when index is fresh', () => {
    const mockStaleness = { check: () => undefined };
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({ symbolId: 'src/dog.ts::Dog::class' });

    expect(result.content).toHaveLength(1);
  });

  it('returns empty hierarchy for graph with no extends/implements edges', () => {
    // Create storage with only import edges
    const noHierarchyIndex: FileIndex = {
      file: 'src/plain.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/plain.ts::Plain::function', name: 'Plain', kind: 'function', startLine: 1, endLine: 5 }],
      edges: [{ from: 'src/plain.ts::Plain::function', to: 'src/animal.ts::Animal::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(noHierarchyIndex);

    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/plain.ts::Plain::function', direction: 'both' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.ancestors).toEqual([]);
    expect(payload.descendants).toEqual([]);
  });

  it('Serializable appears in full hierarchy as root or visited node', () => {
    const handler = handleGetClassHierarchy(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    // Serializable is a hierarchy root (extends/implements target, never source)
    // Cat may already be visited from Animal tree (shared visited set), so Serializable
    // could have 0 or 1 children depending on traversal order
    expect(payload.totalEdges).toBeGreaterThanOrEqual(3); // extends + extends + implements
    const rootNames = payload.hierarchies.map((h: { name: string }) => h.name);
    expect(rootNames).toContain('Animal');
    // Serializable must be a root since it's a target-only node
    expect(rootNames).toContain('Serializable');
  });
});
