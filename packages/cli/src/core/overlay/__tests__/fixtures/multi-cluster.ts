import { SymbolGraph } from '../../../graph/symbol-graph.js';
import type { SymbolNode, EdgeKind } from '../../../types.js';

function makeNode(id: string): SymbolNode {
  const parts = id.split('::');
  return {
    symbolId: id,
    name: parts[1] ?? 'x',
    kind: (parts[2] ?? 'function') as SymbolNode['kind'],
    startLine: 0,
    endLine: 10,
  };
}

export function buildMultiClusterGraph(): SymbolGraph {
  const graph = new SymbolGraph();

  const authCluster = [
    'auth/login.ts::login::function',
    'auth/session.ts::Session::class',
    'auth/token.ts::verifyToken::function',
    'auth/user.ts::User::class',
  ];
  const billingCluster = [
    'billing/invoice.ts::Invoice::class',
    'billing/charge.ts::charge::function',
    'billing/refund.ts::refund::function',
    'billing/tax.ts::calcTax::function',
  ];
  const reportingCluster = [
    'reporting/monthly.ts::monthlyReport::function',
    'reporting/export.ts::exportCsv::function',
    'reporting/chart.ts::Chart::class',
    'reporting/aggregate.ts::aggregate::function',
  ];

  for (const id of [...authCluster, ...billingCluster, ...reportingCluster]) {
    graph.addNode(makeNode(id));
  }

  const connect = (from: string, to: string, kind: EdgeKind = 'imports'): void => {
    graph.addEdge({ from, to, kind });
  };

  // Intra-cluster dense edges.
  for (let i = 0; i < authCluster.length; i++) {
    for (let j = 0; j < authCluster.length; j++) {
      if (i !== j) connect(authCluster[i]!, authCluster[j]!, 'calls');
    }
  }
  for (let i = 0; i < billingCluster.length; i++) {
    for (let j = 0; j < billingCluster.length; j++) {
      if (i !== j) connect(billingCluster[i]!, billingCluster[j]!, 'calls');
    }
  }
  for (let i = 0; i < reportingCluster.length; i++) {
    for (let j = 0; j < reportingCluster.length; j++) {
      if (i !== j) connect(reportingCluster[i]!, reportingCluster[j]!, 'calls');
    }
  }

  return graph;
}

export function buildGraphWithGodNode(): SymbolGraph {
  const graph = buildMultiClusterGraph();
  graph.addNode(makeNode('shared/logger.ts::Logger::class'));
  const bridge = 'shared/logger.ts::Logger::class';
  const touches = [
    'auth/login.ts::login::function',
    'billing/invoice.ts::Invoice::class',
    'reporting/monthly.ts::monthlyReport::function',
  ];
  for (const target of touches) {
    graph.addEdge({ from: target, to: bridge, kind: 'calls' });
  }
  return graph;
}

export function buildIsolatedGraph(): SymbolGraph {
  const graph = new SymbolGraph();
  graph.addNode(makeNode('lonely/file.ts::lonely::function'));
  return graph;
}

export function buildDisconnectedClusterGraph(): SymbolGraph {
  const graph = new SymbolGraph();
  // Two fully-disconnected cliques in the same cluster-space.
  for (const id of [
    'mod/a.ts::A::function',
    'mod/b.ts::B::function',
    'mod/c.ts::C::function',
  ]) {
    graph.addNode(makeNode(id));
  }
  for (const id of [
    'mod/d.ts::D::function',
    'mod/e.ts::E::function',
    'mod/f.ts::F::function',
  ]) {
    graph.addNode(makeNode(id));
  }
  graph.addEdge({ from: 'mod/a.ts::A::function', to: 'mod/b.ts::B::function', kind: 'calls' });
  graph.addEdge({ from: 'mod/b.ts::B::function', to: 'mod/c.ts::C::function', kind: 'calls' });
  graph.addEdge({ from: 'mod/d.ts::D::function', to: 'mod/e.ts::E::function', kind: 'calls' });
  graph.addEdge({ from: 'mod/e.ts::E::function', to: 'mod/f.ts::F::function', kind: 'calls' });
  return graph;
}
