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

  describe('Java name-reference edge resolution (BUG: cross-file edges dangle)', () => {
    it('resolves 2-part name-ref "Bar::class" to unambiguous node by name+kind', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('a/Foo.java::Foo::class'));
      graph.addNode(makeNode('b/Bar.java::Bar::class'));
      graph.addNode(makeNode('b/Bar.java::helper::method'));

      // 2-part implements target resolves by name+kind (unambiguous)
      graph.addEdge({ from: 'a/Foo.java::Foo::class', to: 'Bar::class', kind: 'implements' });
      expect(
        graph.getReverseEdges('b/Bar.java::Bar::class').some(e => e.from === 'a/Foo.java::Foo::class'),
      ).toBe(true);
    });

    it('resolves 3-part package-qualified call target "fixture.Bar::helper::method" by name+kind', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('a/Foo.java::Foo::class'));
      graph.addNode(makeNode('b/Bar.java::Bar::class'));
      graph.addNode(makeNode('b/Bar.java::helper::method'));

      // 3-part package-qualified call target resolves by member name+kind
      graph.addEdge({ from: 'a/Foo.java::Foo::class', to: 'fixture.Bar::helper::method', kind: 'calls' });
      expect(
        graph.getReverseEdges('b/Bar.java::helper::method').some(e => e.kind === 'calls'),
      ).toBe(true);
    });

    it('does NOT resolve ambiguous 2-part ref when multiple nodes share the same name+kind', () => {
      const g2 = new SymbolGraph();
      g2.addNode(makeNode('x/Bar.java::Bar::class'));
      g2.addNode(makeNode('y/Bar.java::Bar::class'));
      g2.addNode(makeNode('z/Use.java::Use::class'));

      g2.addEdge({ from: 'z/Use.java::Use::class', to: 'Bar::class', kind: 'implements' });

      // Neither real Bar gets the reverse edge — left keyed by unresolved 'Bar::class'
      expect(g2.getReverseEdges('x/Bar.java::Bar::class').length).toBe(0);
      expect(g2.getReverseEdges('y/Bar.java::Bar::class').length).toBe(0);
    });
  });

  describe('data references', () => {
    it('a 2-part table reference resolves to a view of that name', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/a.ts::run::function'));
      graph.addNode(makeNode('db/v.sql::dbo.loans::view'));
      graph.addEdge(makeEdge('src/a.ts::run::function', 'dbo.loans::table', 'reads'));
      expect(graph.getForwardEdges('src/a.ts::run::function')[0]!.to).toBe('db/v.sql::dbo.loans::view');
    });

    it('a data reference defined in several files resolves to the first file in sorted path order whatever the insertion order', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/a.ts::run::function'));
      graph.addNode(makeNode('db/b.sql::dbo.loans::table'));
      graph.addNode(makeNode('db/a.sql::dbo.loans::table'));
      graph.addEdge(makeEdge('src/a.ts::run::function', 'dbo.loans::table', 'reads'));
      expect(graph.getForwardEdges('src/a.ts::run::function')[0]!.to).toBe('db/a.sql::dbo.loans::table');
    });

    it('a procedure reference defined in two files resolves to the first file', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/a.ts::run::function'));
      graph.addNode(makeNode('db/z.sql::dbo.sp::procedure'));
      graph.addNode(makeNode('db/m.sql::dbo.sp::procedure'));
      graph.addEdge(makeEdge('src/a.ts::run::function', 'dbo.sp::procedure', 'executes'));
      expect(graph.getForwardEdges('src/a.ts::run::function')[0]!.to).toBe('db/m.sql::dbo.sp::procedure');
    });

    it('an undefined data reference stays unresolved', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/a.ts::run::function'));
      graph.addEdge(makeEdge('src/a.ts::run::function', 'dbo.audit::table', 'writes'));
      expect(graph.getForwardEdges('src/a.ts::run::function')[0]!.to).toBe('dbo.audit::table');
    });

    it('getNode resolves a 2-part data reference', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('db/b.sql::dbo.loans::table'));
      graph.addNode(makeNode('db/a.sql::dbo.loans::view'));
      expect(graph.getNode('dbo.loans::table')?.symbolId).toBe('db/a.sql::dbo.loans::view');
      expect(graph.hasNode('dbo.loans::table')).toBe(true);
    });

    it('an ambiguous class name reference stays unresolved as before', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/a.ts::run::function'));
      graph.addNode(makeNode('src/x/Bar.java::Bar::class'));
      graph.addNode(makeNode('src/y/Bar.java::Bar::class'));
      graph.addEdge(makeEdge('src/a.ts::run::function', 'Bar::class', 'uses'));
      expect(graph.getForwardEdges('src/a.ts::run::function')[0]!.to).toBe('Bar::class');
    });

    /** Resolves `reference` from a graph holding the nodes in the given order, through an edge and through getNode. */
    function resolveData(nodeIds: readonly string[], reference: string, kind: GraphEdge['kind'] = 'reads') {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/a.ts::run::function'));
      for (const id of nodeIds) graph.addNode(makeNode(id));
      graph.addEdge(makeEdge('src/a.ts::run::function', reference, kind));
      return {
        edge: graph.getForwardEdges('src/a.ts::run::function')[0]!.to,
        node: graph.getNode(reference)?.symbolId,
        has: graph.hasNode(reference),
      };
    }

    it('a data reference prefers a production definition over a test-project copy', () => {
      const ids = ['src/Lending.Tests/schema.sql::dbo.loans::table', 'src/Lending/db/schema.sql::dbo.loans::table'];
      const expected = { edge: ids[1], node: ids[1], has: true };
      expect(resolveData(ids, 'dbo.loans::table')).toEqual(expected);
      expect(resolveData([...ids].reverse(), 'dbo.loans::table')).toEqual(expected);
    });

    it('a data reference prefers a production definition over a docs copy', () => {
      const ids = ['docs/db/schema.sql::dbo.loans::table', 'src/db/schema.sql::dbo.loans::table'];
      const expected = { edge: ids[1], node: ids[1], has: true };
      expect(resolveData(ids, 'dbo.loans::table')).toEqual(expected);
      expect(resolveData([...ids].reverse(), 'dbo.loans::table')).toEqual(expected);
    });

    it('a procedure defined only in a docs file still resolves', () => {
      const id = 'docs/db/procs.sql::dbo.usp_renew::procedure';
      expect(resolveData([id], 'dbo.usp_renew::procedure', 'executes')).toEqual({ edge: id, node: id, has: true });
    });

    it('the codepoint-smallest production path still wins among production copies', () => {
      const ids = [
        'Docs/a.sql::dbo.loans::table',
        'src/db/b.sql::dbo.loans::table',
        'src/Lending.Tests/a.sql::dbo.loans::table',
        'src/db/a.sql::dbo.loans::view',
        'documentation/a.sql::dbo.loans::table',
      ];
      const expected = { edge: 'src/db/a.sql::dbo.loans::view', node: 'src/db/a.sql::dbo.loans::view', has: true };
      expect(resolveData(ids, 'dbo.loans::table')).toEqual(expected);
      expect(resolveData([...ids].reverse(), 'dbo.loans::table')).toEqual(expected);
    });

    it('a docs copy wins over a test-project copy when no production copy exists', () => {
      const ids = ['src/doc/procs.sql::dbo.sp::procedure', 'src/Lending.Tests/procs.sql::dbo.sp::procedure'];
      const expected = { edge: ids[0], node: ids[0], has: true };
      expect(resolveData(ids, 'dbo.sp::procedure', 'executes')).toEqual(expected);
      expect(resolveData([...ids].reverse(), 'dbo.sp::procedure', 'executes')).toEqual(expected);
    });
  });

  describe('data resource identity', () => {
    const V1 = 'db/migrations/V1__init.sql::dbo.usp_close::procedure';
    const V7 = 'db/migrations/V7__close_fix.sql::dbo.usp_close::procedure';
    const DOCS = 'docs/db/procs.sql::dbo.usp_close::procedure';
    const CLOSE = 'src/LoanService.cs::Lending.LoanService.Close::method';

    function migrationGraph(order: readonly string[] = [DOCS, V7, V1]): SymbolGraph {
      const graph = new SymbolGraph();
      graph.addNode(makeNode(CLOSE));
      for (const id of order) graph.addNode(makeNode(id));
      graph.addEdge(makeEdge(CLOSE, 'dbo.usp_close::procedure', 'executes'));
      return graph;
    }

    it('any id of a procedure gives its canonical id, the winner and every definition', () => {
      const graph = migrationGraph();
      for (const id of [V1, V7, DOCS, 'dbo.usp_close::procedure']) {
        const identity = graph.dataResourceIdentity(id)!;
        expect(identity.canonicalId).toBe('dbo.usp_close::procedure');
        expect(identity.winner.symbolId).toBe(V1);
        expect(identity.definitions.map((node) => node.symbolId)).toEqual([V1, V7, DOCS]);
        expect(identity.production.map((node) => node.symbolId)).toEqual([V1, V7]);
      }
      expect(migrationGraph([V1, V7, DOCS]).dataResourceIdentity(V7)).toEqual(graph.dataResourceIdentity(V7));
    });

    it('a table identity spans the views of its name, and the canonical kind is the winner\'s', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('docs/db/schema.sql::dbo.loans::table'));
      graph.addNode(makeNode('src/db/schema.sql::dbo.loans::view'));
      graph.addNode(makeNode('src/db/schema.sql::dbo.usp_loans::procedure'));
      const identity = graph.dataResourceIdentity('docs/db/schema.sql::dbo.loans::table')!;
      expect(identity.canonicalId).toBe('dbo.loans::view');
      expect(identity.definitions.map((node) => node.symbolId)).toEqual([
        'src/db/schema.sql::dbo.loans::view',
        'docs/db/schema.sql::dbo.loans::table',
      ]);
      expect(graph.dataResourceIdentity('dbo.loans::table')).toEqual(identity);
    });

    it('an identity with only docs and test copies has no production definition', () => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('src/Lending.Tests/procs.sql::dbo.usp_renew::procedure'));
      graph.addNode(makeNode('docs/db/procs.sql::dbo.usp_renew::procedure'));
      const identity = graph.dataResourceIdentity('dbo.usp_renew::procedure')!;
      expect(identity.winner.symbolId).toBe('docs/db/procs.sql::dbo.usp_renew::procedure');
      expect(identity.production).toEqual([]);
    });

    it('code symbols and unknown ids have no data resource identity', () => {
      const graph = migrationGraph();
      expect(graph.dataResourceIdentity(CLOSE)).toBeUndefined();
      expect(graph.dataResourceIdentity('dbo.usp_missing::procedure')).toBeUndefined();
      expect(graph.dataResourceIdentity('db/none.sql::dbo.loans::table')).toBeUndefined();
    });

    it('every copy has the incoming edges of every definition as its dependents, and forward edges stay per copy', () => {
      const graph = migrationGraph();
      graph.addEdge(makeEdge(V7, 'dbo.audit::table', 'writes'));
      const executes = [{ from: CLOSE, to: V1, kind: 'executes' }];
      expect(graph.getDependentEdges(V1)).toEqual(executes);
      expect(graph.getDependentEdges(V7)).toEqual(executes);
      expect(graph.getDependentEdges(DOCS)).toEqual(executes);
      // Raw lookups are unchanged: the edge points at the winner only, and the body edge stays on its copy.
      expect(graph.getReverseEdges(V7)).toEqual([]);
      expect(graph.getForwardEdges(V7).map((edge) => edge.to)).toEqual(['dbo.audit::table']);
      expect(graph.getForwardEdges(V1)).toEqual([]);
      expect(graph.getDependentEdges(CLOSE)).toEqual([]);
    });
  });
});
