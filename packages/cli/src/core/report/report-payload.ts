import type {
  VisNode,
  VisEdge,
  VisFileInfo,
} from '../graph/visualization-payload.js';
import type {
  BoundaryViolation,
  CommunityEntry,
  CommunitySnapshot,
  DriftEvent,
  GodNode,
} from '../types.js';

/**
 * Trimmed-down history entry carried into the HTML payload.
 * Full snapshots can be large, so we keep only what the Drift view needs.
 */
export interface ReportHistorySnapshot {
  readonly computedAt: string;
  readonly commitSha: string;
  readonly modularity: number;
  readonly crossClusterEdges: number;
  /** Symbol -> communityId map for this snapshot (the alluvial flow data). */
  readonly assignments: Readonly<Record<string, number>>;
  /** communityId -> label for this snapshot. */
  readonly labels: Readonly<Record<number, string>>;
}

export interface ReportKpi {
  readonly modularity: number;
  readonly modularityTrend: readonly number[];
  readonly violationCount: number;
  readonly violationHighCount: number;
  readonly violationMediumCount: number;
  readonly driftEventCount: number;
  readonly driftConfidence: 'high' | 'medium' | 'low';
  readonly deadCodeCount: number;
  readonly totalSymbols: number;
  readonly totalEdges: number;
}

export interface ReportPayload {
  readonly projectName: string;
  readonly generatedAt: string;
  readonly commitSha: string;
  /** KPIs for the Overview tab. */
  readonly kpi: ReportKpi;
  /** Top god-nodes list for the Overview tab. */
  readonly godNodes: readonly GodNode[];
  /** Graph shown in the Structure tab. */
  readonly nodes: readonly VisNode[];
  readonly edges: readonly VisEdge[];
  readonly layers: Readonly<Record<string, readonly string[]>>;
  readonly files: readonly VisFileInfo[];
  /** Current community assignments (communityId + label per symbol). */
  readonly communities: readonly CommunityEntry[];
  readonly modularity: number;
  readonly crossClusterEdges: number;
  /** Boundary violations for the Violations tab. */
  readonly violations: readonly BoundaryViolation[];
  readonly violationsTotal: number;
  /** Drift events for the Drift tab. */
  readonly driftEvents: readonly DriftEvent[];
  readonly driftConfidence: 'high' | 'medium' | 'low';
  readonly driftHint?: string;
  /** History snapshots (oldest first) used to build the alluvial diagram. */
  readonly history: readonly ReportHistorySnapshot[];
  /** Optional CTA shown when some capability is disabled (e.g. no history). */
  readonly hints: readonly string[];
}

/**
 * Reduces a full CommunitySnapshot to the minimum shape carried into
 * the payload. Drops godNodes + full edge metadata (kept only for current).
 */
export function toHistorySnapshot(snapshot: CommunitySnapshot): ReportHistorySnapshot {
  const assignments: Record<string, number> = {};
  const labels: Record<number, string> = {};
  for (const entry of snapshot.communities) {
    assignments[entry.symbolId] = entry.communityId;
    labels[entry.communityId] = entry.communityLabel;
  }
  return {
    computedAt: snapshot.computedAt,
    commitSha: snapshot.commitSha,
    modularity: snapshot.modularity,
    crossClusterEdges: snapshot.crossClusterEdges,
    assignments,
    labels,
  };
}
