import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { SymbolGraph } from '../core/graph/symbol-graph.js';
import type { FileIndex } from '../core/types.js';

export interface LoadedGraph {
  readonly graph: SymbolGraph;
  readonly indices: FileIndex[];
}

/** Build a SymbolGraph from the committed JSON index under `ctxoRoot`. */
export function loadGraph(ctxoRoot: string): LoadedGraph {
  const indices = new JsonIndexReader(ctxoRoot).readAll();
  const graph = new SymbolGraph();
  for (const fi of indices) for (const sym of fi.symbols) graph.addNode(sym);
  for (const fi of indices) for (const edge of fi.edges) graph.addEdge(edge);
  return { graph, indices };
}
