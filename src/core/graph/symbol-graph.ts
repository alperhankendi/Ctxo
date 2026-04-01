import type { SymbolNode, GraphEdge } from '../types.js';

export class SymbolGraph {
  private readonly nodes = new Map<string, SymbolNode>();
  private readonly nodesByFileAndName = new Map<string, SymbolNode>();
  private readonly forwardEdges = new Map<string, GraphEdge[]>();
  private readonly reverseEdges = new Map<string, GraphEdge[]>();
  private edgeSet = new Set<string>();

  addNode(node: SymbolNode): void {
    this.nodes.set(node.symbolId, node);
    // Index by file::name (ignoring kind) for fuzzy edge resolution
    const parts = node.symbolId.split('::');
    if (parts.length >= 2) {
      this.nodesByFileAndName.set(`${parts[0]}::${parts[1]}`, node);
    }
  }

  addEdge(edge: GraphEdge): void {
    // Resolve edge endpoints: if exact ID not found, try fuzzy match by file::name
    const resolvedFrom = this.resolveNodeId(edge.from);
    const resolvedTo = this.resolveNodeId(edge.to);
    const resolvedEdge: GraphEdge = { from: resolvedFrom, to: resolvedTo, kind: edge.kind };

    const edgeKey = `${resolvedEdge.from}|${resolvedEdge.to}|${resolvedEdge.kind}`;
    if (this.edgeSet.has(edgeKey)) return;
    this.edgeSet.add(edgeKey);

    const forward = this.forwardEdges.get(resolvedEdge.from) ?? [];
    forward.push(resolvedEdge);
    this.forwardEdges.set(resolvedEdge.from, forward);

    const reverse = this.reverseEdges.get(resolvedEdge.to) ?? [];
    reverse.push(resolvedEdge);
    this.reverseEdges.set(resolvedEdge.to, reverse);
  }

  getNode(symbolId: string): SymbolNode | undefined {
    return this.nodes.get(symbolId) ?? this.resolveNodeFuzzy(symbolId);
  }

  private resolveNodeId(id: string): string {
    if (this.nodes.has(id)) return id;
    const parts = id.split('::');
    if (parts.length >= 2) {
      const fuzzyKey = `${parts[0]}::${parts[1]}`;
      const match = this.nodesByFileAndName.get(fuzzyKey);
      if (match) return match.symbolId;
    }
    return id;
  }

  private resolveNodeFuzzy(id: string): SymbolNode | undefined {
    const parts = id.split('::');
    if (parts.length >= 2) {
      return this.nodesByFileAndName.get(`${parts[0]}::${parts[1]}`);
    }
    return undefined;
  }

  getForwardEdges(symbolId: string): GraphEdge[] {
    return this.forwardEdges.get(symbolId) ?? [];
  }

  getReverseEdges(symbolId: string): GraphEdge[] {
    return this.reverseEdges.get(symbolId) ?? [];
  }

  hasNode(symbolId: string): boolean {
    return this.nodes.has(symbolId) || this.resolveNodeFuzzy(symbolId) !== undefined;
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
