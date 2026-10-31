import type { GraphEdge } from '@ctxo/cli/internal';
import type { BoundaryMode } from './domain-config.js';
import type { Ownership } from './ownership.js';
import type { DomainRegistry, Rung } from './registry.js';

/** One end of a cross-context edge. */
export interface ContextEnd {
  readonly symbolId: string;
  readonly file: string;
  readonly context: string;
}

export interface BoundaryViolationRecord {
  readonly from: ContextEnd;
  readonly to: ContextEnd;
  readonly edgeKind: string;
  readonly severity: 'error' | 'warning';
  /**
   * Set by `verify-domain` in `new-only` mode with a base: `new` when the base has no violation with the same
   * key (`violationKey`), `existing` when it has one (then the severity is a warning).
   */
  readonly baseline?: 'new' | 'existing';
}

/** Every edge from one context into another, by kind, split into allowed (through a contract) and violations. */
export interface CrossContextSummary {
  readonly from: string;
  readonly to: string;
  readonly byKind: Readonly<Record<string, number>>;
  readonly allowed: number;
  readonly violations: number;
}

export interface ContextEdgeCounts {
  readonly internal: number;
  readonly out: number;
  readonly in: number;
}

export interface BoundaryResult {
  readonly crossEdges: readonly CrossContextSummary[];
  readonly violations: readonly BoundaryViolationRecord[];
  /** Every registry context, in registry order, with its edge counts (zeros when it has none). */
  readonly perContext: ReadonlyMap<string, ContextEdgeCounts>;
}

export interface BoundaryInput {
  readonly registry: DomainRegistry;
  readonly ownership: Ownership;
  readonly isTestFile: (path: string) => boolean;
  readonly mode: BoundaryMode;
  readonly blockingRungs: readonly Rung[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareViolations(a: BoundaryViolationRecord, b: BoundaryViolationRecord): number {
  return (
    compare(a.from.context, b.from.context) ||
    compare(a.to.context, b.to.context) ||
    compare(a.from.symbolId, b.from.symbolId) ||
    compare(a.to.symbolId, b.to.symbolId) ||
    compare(a.edgeKind, b.edgeKind)
  );
}

/**
 * Cross-context edges and boundary violations (spec 10.7, K11, E4). Linear in edges; the computation is the
 * same in both modes, only the severity differs.
 *
 * - A file is the first part of a symbol id; a target with fewer than three parts (an unresolved name
 *   reference) is skipped, and so is every edge from a test file.
 * - An edge with an unowned (or multiply owned) end is skipped; both ends in one context count as internal.
 * - A cross edge is allowed when its target file is a contract of the source context into the target's context.
 *   Otherwise it is a violation: `report` gives a warning; `by-rung` and `new-only` give an error when either
 *   context's rung is blocking, else a warning (`new-only` keeps only the new errors later, in `verify-domain`).
 */
export function computeBoundaries(edges: readonly GraphEdge[], input: BoundaryInput): BoundaryResult {
  const { registry, ownership, isTestFile, mode, blockingRungs } = input;
  const rungOf = new Map<string, Rung>(registry.contexts.map((c) => [c.id, c.rung]));
  const blocking = new Set<string>(blockingRungs);

  const counts = new Map<string, { internal: number; out: number; in: number }>();
  for (const c of registry.contexts) counts.set(c.id, { internal: 0, out: 0, in: 0 });

  const ownerCache = new Map<string, string | undefined>();
  const ownerOf = (file: string): string | undefined => {
    if (ownerCache.has(file)) return ownerCache.get(file);
    const owner = ownership.ownerOf(file);
    ownerCache.set(file, owner);
    return owner;
  };
  const testCache = new Map<string, boolean>();
  const isTest = (file: string): boolean => {
    let t = testCache.get(file);
    if (t === undefined) {
      t = isTestFile(file);
      testCache.set(file, t);
    }
    return t;
  };

  const summaries = new Map<string, { from: string; to: string; byKind: Map<string, number>; allowed: number; violations: number }>();
  const violations: BoundaryViolationRecord[] = [];

  for (const edge of edges) {
    const toParts = edge.to.split('::');
    if (toParts.length < 3) continue;
    const fromFile = edge.from.split('::')[0]!;
    const toFile = toParts[0]!;
    if (isTest(fromFile)) continue;
    const fromContext = ownerOf(fromFile);
    const toContext = ownerOf(toFile);
    if (fromContext === undefined || toContext === undefined) continue;
    const fromCounts = counts.get(fromContext);
    const toCounts = counts.get(toContext);
    if (fromCounts === undefined || toCounts === undefined) continue;

    if (fromContext === toContext) {
      fromCounts.internal++;
      continue;
    }
    fromCounts.out++;
    toCounts.in++;

    const key = `${fromContext}\u0000${toContext}`;
    let summary = summaries.get(key);
    if (summary === undefined) {
      summary = { from: fromContext, to: toContext, byKind: new Map(), allowed: 0, violations: 0 };
      summaries.set(key, summary);
    }
    summary.byKind.set(edge.kind, (summary.byKind.get(edge.kind) ?? 0) + 1);

    if (ownership.isContract(fromContext, toFile)) {
      summary.allowed++;
      continue;
    }
    summary.violations++;
    const severity: BoundaryViolationRecord['severity'] =
      mode !== 'report' && (blocking.has(rungOf.get(fromContext)!) || blocking.has(rungOf.get(toContext)!)) ? 'error' : 'warning';
    violations.push({
      from: { symbolId: edge.from, file: fromFile, context: fromContext },
      to: { symbolId: edge.to, file: toFile, context: toContext },
      edgeKind: edge.kind,
      severity,
    });
  }

  const crossEdges: CrossContextSummary[] = [...summaries.values()]
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to))
    .map((s) => {
      const byKind: Record<string, number> = {};
      for (const kind of [...s.byKind.keys()].sort(compare)) byKind[kind] = s.byKind.get(kind)!;
      return { from: s.from, to: s.to, byKind, allowed: s.allowed, violations: s.violations };
    });
  violations.sort(compareViolations);

  const perContext = new Map<string, ContextEdgeCounts>();
  for (const [id, c] of counts) perContext.set(id, { internal: c.internal, out: c.out, in: c.in });
  return { crossEdges, violations, perContext };
}
