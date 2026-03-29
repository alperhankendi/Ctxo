import type { SymbolNode, GraphEdge } from '../types.js';

export class SymbolGraph {
  private readonly nodes = new Map<string, SymbolNode>();
  private readonly forwardEdges = new Map<string, GraphEdge[]>();
  private readonly reverseEdges = new Map<string, GraphEdge[]>();
  private edgeSet = new Set<string>();

  addNode(node: SymbolNode): void {
    this.nodes.set(node.symbolId, node);
  }

  addEdge(edge: GraphEdge): void {
    const edgeKey = `${edge.from}|${edge.to}|${edge.kind}`;
    if (this.edgeSet.has(edgeKey)) return;
    this.edgeSet.add(edgeKey);

    const forward = this.forwardEdges.get(edge.from) ?? [];
    forward.push(edge);
    this.forwardEdges.set(edge.from, forward);

    const reverse = this.reverseEdges.get(edge.to) ?? [];
    reverse.push(edge);
    this.reverseEdges.set(edge.to, reverse);
  }

  getNode(symbolId: string): SymbolNode | undefined {
    return this.nodes.get(symbolId);
  }

  getForwardEdges(symbolId: string): GraphEdge[] {
    return this.forwardEdges.get(symbolId) ?? [];
  }

  getReverseEdges(symbolId: string): GraphEdge[] {
    return this.reverseEdges.get(symbolId) ?? [];
  }

  hasNode(symbolId: string): boolean {
    return this.nodes.has(symbolId);
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edgeSet.size;
  }

  allNodes(): SymbolNode[] {
    return [...this.nodes.values()];
  }

  allEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const list of this.forwardEdges.values()) {
      edges.push(...list);
    }
    return edges;
  }
}
