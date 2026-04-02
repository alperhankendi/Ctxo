import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../symbol-graph.js';
import type { SymbolNode, GraphEdge } from '../../types.js';

function makeNode(id: string, name?: string): SymbolNode {
  const parts = id.split('::');
  return {
    symbolId: id,
    name: name ?? parts[1] ?? 'unknown',
    kind: (parts[2] ?? 'function') as SymbolNode['kind'],
    startLine: 0,
    endLine: 10,
  };
}

function makeEdge(from: string, to: string, kind: GraphEdge['kind'] = 'imports'): GraphEdge {
  return { from, to, kind };
}

describe('SymbolGraph', () => {
  it('adds node and retrieves it by symbolId', () => {
    const graph = new SymbolGraph();
    const node = makeNode('src/a.ts::foo::function');
    graph.addNode(node);

    const retrieved = graph.getNode('src/a.ts::foo::function');
    expect(retrieved).toEqual(node);
  });

  it('returns undefined for non-existent symbolId', () => {
    const graph = new SymbolGraph();
    expect(graph.getNode('src/missing.ts::bar::function')).toBeUndefined();
  });

  it('adds edge and retrieves forward edges', () => {
    const graph = new SymbolGraph();
    const edge = makeEdge('src/a.ts::foo::function', 'src/b.ts::bar::class');
    graph.addEdge(edge);

    const forward = graph.getForwardEdges('src/a.ts::foo::function');
    expect(forward).toHaveLength(1);
    expect(forward[0]).toEqual(edge);
  });

  it('retrieves reverse edges (dependents)', () => {
    const graph = new SymbolGraph();
    const edge = makeEdge('src/a.ts::foo::function', 'src/b.ts::bar::class');
    graph.addEdge(edge);

    const reverse = graph.getReverseEdges('src/b.ts::bar::class');
    expect(reverse).toHaveLength(1);
    expect(reverse[0]?.from).toBe('src/a.ts::foo::function');
  });

  it('reports correct nodeCount and edgeCount', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::foo::function'));
    graph.addNode(makeNode('src/b.ts::bar::class'));
    graph.addEdge(makeEdge('src/a.ts::foo::function', 'src/b.ts::bar::class'));

    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });

  it('handles empty graph (zero nodes, zero edges)', () => {
    const graph = new SymbolGraph();
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
    expect(graph.allNodes()).toEqual([]);
    expect(graph.allEdges()).toEqual([]);
  });

  it('handles single node with no edges', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::foo::function'));

    expect(graph.nodeCount).toBe(1);
    expect(graph.edgeCount).toBe(0);
    expect(graph.getForwardEdges('src/a.ts::foo::function')).toEqual([]);
    expect(graph.getReverseEdges('src/a.ts::foo::function')).toEqual([]);
  });

  it('handles duplicate edge addition (no double-count)', () => {
    const graph = new SymbolGraph();
    const edge = makeEdge('src/a.ts::foo::function', 'src/b.ts::bar::class');
    graph.addEdge(edge);
    graph.addEdge(edge);

    expect(graph.edgeCount).toBe(1);
    expect(graph.getForwardEdges('src/a.ts::foo::function')).toHaveLength(1);
  });

  it('handles symbolId with special characters (::)', () => {
    const graph = new SymbolGraph();
    const node = makeNode('src/foo.ts::MyClass.method::method');
    graph.addNode(node);

    expect(graph.getNode('src/foo.ts::MyClass.method::method')).toEqual(node);
    expect(graph.hasNode('src/foo.ts::MyClass.method::method')).toBe(true);
  });

  it('distinguishes edges with different kinds between same nodes', () => {
    const graph = new SymbolGraph();
    graph.addEdge(makeEdge('src/a.ts::A::class', 'src/b.ts::B::class', 'extends'));
    graph.addEdge(makeEdge('src/a.ts::A::class', 'src/b.ts::B::class', 'imports'));

    expect(graph.edgeCount).toBe(2);
    expect(graph.getForwardEdges('src/a.ts::A::class')).toHaveLength(2);
  });

  it('hasNode resolves fuzzy match by file::name when kind differs (BUG-39 fix)', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/port.ts::IStoragePort::interface'));

    // Exact match
    expect(graph.hasNode('src/port.ts::IStoragePort::interface')).toBe(true);

    // Fuzzy match — wrong kind but same file::name
    expect(graph.hasNode('src/port.ts::IStoragePort::class')).toBe(true);

    // No match at all
    expect(graph.hasNode('src/port.ts::NonExistent::class')).toBe(false);
  });

  it('hasNode returns false for completely unknown symbol', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));

    expect(graph.hasNode('src/b.ts::B::function')).toBe(false);
  });

  it('resolves .js extension to .ts in edge targets (BUG-19)', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/ports/i-storage-port.ts::IStoragePort::interface'));
    graph.addNode(makeNode('src/adapters/storage/adapter.ts::MyAdapter::class'));

    graph.addEdge(makeEdge(
      'src/adapters/storage/adapter.ts::MyAdapter::class',
      'src/ports/i-storage-port.js::IStoragePort::interface',
      'implements',
    ));

    const forward = graph.getForwardEdges('src/adapters/storage/adapter.ts::MyAdapter::class');
    expect(forward).toHaveLength(1);
    expect(forward[0]?.to).toBe('src/ports/i-storage-port.ts::IStoragePort::interface');
  });

  it('getNode and hasNode resolve .js → .ts via fuzzy lookup (BUG-19)', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/ports/i-storage-port.ts::IStoragePort::interface'));

    // Direct lookup with .js should resolve via fuzzy
    expect(graph.hasNode('src/ports/i-storage-port.js::IStoragePort::interface')).toBe(true);
    expect(graph.getNode('src/ports/i-storage-port.js::IStoragePort::interface')?.symbolId)
      .toBe('src/ports/i-storage-port.ts::IStoragePort::interface');
  });
});
