import { compareCodepoint } from '../compare-codepoint.js';
import { dataReferenceKinds } from '../data-coupling/data-kinds.js';
import { createTestFileClassifier } from '../test-files/test-file-classifier.js';
import type { SymbolNode, GraphEdge } from '../types.js';

/**
 * Test files by `DEFAULT_TEST_GLOBS` only. The graph has no config, so `index.tests` extras do not count
 * here: a copy in a test folder that only those extras name ranks as production.
 */
const isDefaultTestFile = createTestFileClassifier();

const DOCUMENTATION_FOLDERS: ReadonlySet<string> = new Set(['docs', 'doc', 'documentation']);

/** ASCII A-Z lowercased, with no locale or Unicode folding. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** True when a folder of the path is `docs`, `doc` or `documentation`, compared after ASCII lowercasing. */
function isUnderDocumentationFolder(file: string): boolean {
  const folders = file.replace(/\\/g, '/').split('/').slice(0, -1);
  return folders.some((folder) => DOCUMENTATION_FOLDERS.has(asciiLower(folder)));
}

/**
 * The rank of a data definition among several of the same name, smaller first: not in a test file comes
 * first, then not under a documentation folder. A definition is never dropped; the rank only orders them.
 */
function definitionRank(symbolId: string): number {
  const at = symbolId.indexOf('::');
  const file = at < 0 ? symbolId : symbolId.slice(0, at);
  return (isDefaultTestFile(file) ? 2 : 0) + (isUnderDocumentationFolder(file) ? 1 : 0);
}

/** A table, view or procedure as one resource across every definition of its canonical name. */
export interface DataResourceIdentity {
  /** `<name>::<kind>` with the winner's kind, for example `dbo.loans::table`. */
  readonly canonicalId: string;
  /** The definition every data reference to the name resolves to (the `definitionRank` tie-break). */
  readonly winner: SymbolNode;
  /** Every definition of the name, once each, in tie-break order: the winner comes first. */
  readonly definitions: readonly SymbolNode[];
  /**
   * The definitions in neither a test file nor a documentation folder (the best `definitionRank`), in
   * tie-break order. Empty when every definition is a docs or test copy.
   */
  readonly production: readonly SymbolNode[];
}

/**
 * The symbol graph of an index.
 *
 * Add all nodes before any edge: `addEdge` resolves each endpoint against the nodes present at that moment,
 * and an endpoint it cannot resolve keeps its raw id for good.
 *
 * A table, view or procedure is one resource per canonical name, whatever the number of files that define
 * it (`dataResourceIdentity`). Every data reference resolves to the same definition, the winner, so only the
 * winner has incoming edges. The impact tools read dependents through `getDependentEdges`, which gives every
 * definition those edges, and forward edges stay on each definition: a procedure body in a later migration
 * keeps its own accesses.
 */
export class SymbolGraph {
  private readonly nodes = new Map<string, SymbolNode>();
  private readonly nodesByFileAndName = new Map<string, SymbolNode>();
  private readonly nodesByNameAndKind = new Map<string, SymbolNode[]>();
  private readonly forwardEdges = new Map<string, GraphEdge[]>();
  private readonly reverseEdges = new Map<string, GraphEdge[]>();
  private readonly definitionRanks = new Map<string, number>();
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

    // Final fallback: name-reference targets (e.g. Java "Bar::class", "pkg.Bar::helper::method" or SQL
    // "dbo.loans::table") carry name+kind but not the file path. A data reference resolves even when
    // several definitions share the name, by the tie-break in resolveDataReference; any other reference
    // resolves by name+kind ONLY when unambiguous (exactly one node matches).
    const dataMatch = this.resolveDataReference(segs);
    if (dataMatch) return dataMatch.symbolId;
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

    // Final fallback, as in resolveNodeId: a data reference by its tie-break, anything else by name+kind
    // only when unambiguous.
    const dataMatch = this.resolveDataReference(segs);
    if (dataMatch) return dataMatch;
    const nameKind = this.extractNameKind(segs);
    if (nameKind) {
      const candidates = this.nodesByNameAndKind.get(nameKind);
      if (candidates && candidates.length === 1) return candidates[0];
    }

    return undefined;
  }

  /**
   * Resolves a 2-part data reference (`dbo.loans::table`). A table or view reference is kind-agnostic
   * across data resource kinds, a procedure reference matches procedures only. Several definitions
   * resolve by `definitionRank` (a production copy before a documentation copy before a test copy), then
   * to the codepoint-smallest symbolId, which is the first file in sorted path order. The result does
   * not depend on insertion order.
   */
  private resolveDataReference(segs: string[]): SymbolNode | undefined {
    if (segs.length !== 2) return undefined;
    const [name, kind] = segs as [string, string];
    const kinds = dataReferenceKinds(kind);
    if (!kinds) return undefined;
    let best: SymbolNode | undefined;
    for (const k of kinds) {
      for (const node of this.nodesByNameAndKind.get(`${name}::${k}`) ?? []) {
        if (!best || this.compareDefinitions(node, best) < 0) best = node;
      }
    }
    return best;
  }

  /** The tie-break order of same-name definitions: `definitionRank`, then the codepoint-smaller symbolId. */
  private readonly compareDefinitions = (a: SymbolNode, b: SymbolNode): number =>
    this.definitionRankOf(a.symbolId) - this.definitionRankOf(b.symbolId) || compareCodepoint(a.symbolId, b.symbolId);

  /**
   * The identity of the table, view or procedure that `id` names: a full id of any of its definitions, or a
   * 2-part reference such as `dbo.loans::table`. Undefined when `id` names no node, or a node of another
   * kind. A table or view identity spans both kinds, as a 2-part `::table` reference does.
   */
  dataResourceIdentity(id: string): DataResourceIdentity | undefined {
    const node = this.getNode(id);
    return node ? this.identityOf(node) : undefined;
  }

  private identityOf(node: SymbolNode): DataResourceIdentity | undefined {
    const segs = node.symbolId.split('::');
    if (segs.length !== 3) return undefined;
    const [, name, kind] = segs as [string, string, string];
    const kinds = dataReferenceKinds(kind);
    if (!kinds) return undefined;
    const byId = new Map<string, SymbolNode>();
    for (const k of kinds) {
      for (const definition of this.nodesByNameAndKind.get(`${name}::${k}`) ?? []) {
        byId.set(definition.symbolId, this.nodes.get(definition.symbolId) ?? definition);
      }
    }
    const definitions = [...byId.values()].sort(this.compareDefinitions);
    const winner = definitions[0] ?? node;
    const production = definitions.filter((definition) => this.definitionRankOf(definition.symbolId) === 0);
    return { canonicalId: `${name}::${winner.kind}`, winner, definitions, production };
  }

  /** `definitionRank`, cached per symbolId (the glob match runs once per definition). */
  private definitionRankOf(symbolId: string): number {
    let rank = this.definitionRanks.get(symbolId);
    if (rank === undefined) {
      rank = definitionRank(symbolId);
      this.definitionRanks.set(symbolId, rank);
    }
    return rank;
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

  /**
   * The dependents of a resolved symbolId, as the impact tools read them. For a definition of a table, view
   * or procedure these are the incoming edges of every same-name definition, which in practice are the
   * winner's: any copy then reports the dependents of the resource. For every other id they are its own
   * incoming edges, as `getReverseEdges` gives them.
   */
  getDependentEdges(symbolId: string): GraphEdge[] {
    const node = this.nodes.get(symbolId);
    const definitions = node ? this.identityOf(node)?.definitions : undefined;
    if (!definitions || definitions.length < 2) return this.getReverseEdges(symbolId);
    return definitions.flatMap((definition) => this.getReverseEdges(definition.symbolId));
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
