import type { SymbolNode, GraphEdge } from '../types.js';

export class SymbolGraph {
  private readonly nodes = new Map<string, SymbolNode>();
  private readonly nodesByFileAndName = new Map<string, SymbolNode>();
  private readonly nodesByNameAndKind = new Map<string, SymbolNode[]>();
  private readonly forwardEdges = new Map<string, GraphEdge[]>();
  private readonly reverseEdges = new Map<string, GraphEdge[]>();
  private edgeSet = new Set<string>();

  addNode(node: SymbolNode): void {
    this.nodes.set(node.symbolId, node);
    // Index by file::name (ignoring kind) for fuzzy edge resolution
    const parts = node.symbolId.split('::');
    const [p0, p1] = parts;
    if (p0 !== undefined && p1 !== undefined) {
      this.nodesByFileAndName.set(`${p0}::${p1}`, node);
    }
    // Index by name::kind for name-reference targets (e.g. Java "Bar::class",
    // "fixture.Bar::helper::method") that carry name+kind but not the file path.
    if (parts.length === 3) {
      const nk = `${parts[1]}::${parts[2]}`;
      const list = this.nodesByNameAndKind.get(nk);
      if (list) list.push(node); else this.nodesByNameAndKind.set(nk, [node]);
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
    const segs = id.split('::');
    const [p0, p1] = segs;
    if (p0 !== undefined && p1 !== undefined) {
      const fuzzyKey = `${p0}::${p1}`;
      const match = this.nodesByFileAndName.get(fuzzyKey);
      if (match) return match.symbolId;

      // Try .js → .ts extension swap (handles unresolved module specifiers)
      const jsToTs = p0.replace(/\.js$/, '.ts');
      if (jsToTs !== p0) {
        const altKey = `${jsToTs}::${p1}`;
        const altMatch = this.nodesByFileAndName.get(altKey);
        if (altMatch) return altMatch.symbolId;
      }
    }

    // Final fallback: name-reference targets (e.g. Java "Bar::class" or
    // "pkg.Bar::helper::method") carry name+kind but not the file path. Resolve
    // by name+kind ONLY when unambiguous (exactly one node matches).
    const nameKind = this.extractNameKind(segs);
    if (nameKind) {
      const candidates = this.nodesByNameAndKind.get(nameKind);
      if (candidates && candidates.length === 1) return candidates[0]!.symbolId;
    }

    return id;
  }

  private resolveNodeFuzzy(id: string): SymbolNode | undefined {
    const segs = id.split('::');
    const [p0, p1] = segs;
    if (p0 !== undefined && p1 !== undefined) {
      const match = this.nodesByFileAndName.get(`${p0}::${p1}`);
      if (match) return match;

      // Try .js → .ts extension swap (consistent with resolveNodeId)
      const jsToTs = p0.replace(/\.js$/, '.ts');
      if (jsToTs !== p0) {
        const tsMatch = this.nodesByFileAndName.get(`${jsToTs}::${p1}`);
        if (tsMatch) return tsMatch;
      }
    }

    // Final fallback: name-reference targets — resolve by name+kind only when unambiguous.
    const nameKind = this.extractNameKind(segs);
    if (nameKind) {
      const candidates = this.nodesByNameAndKind.get(nameKind);
      if (candidates && candidates.length === 1) return candidates[0];
    }

    return undefined;
  }

  /**
   * Extracts a `name::kind` key from the segments of a reference ID, supporting:
   *   - 2-part: `Bar::class`                  → `Bar::class`
   *   - 3-part: `pkg.Bar::helper::method`      → `helper::method`
   * Returns undefined for 1-part IDs (no kind information available).
   */
  private extractNameKind(segs: string[]): string | undefined {
    if (segs.length === 3) return `${segs[1]}::${segs[2]}`; // pkg.Type::member::kind → member::kind
    if (segs.length === 2) return `${segs[0]}::${segs[1]}`; // Type::kind
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
