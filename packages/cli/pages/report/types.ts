// Mirrors ReportPayload from src/core/report/report-payload.ts.
// Kept as a separate file (not re-imported) so the browser bundle
// remains decoupled from the CLI source tree and has no Node dependencies.

export type Severity = 'high' | 'medium';
export type Confidence = 'high' | 'medium' | 'low';

export interface GodNode {
  readonly symbolId: string;
  readonly bridgedCommunities: readonly number[];
  readonly centralityScore: number;
}

export interface CommunityEntry {
  readonly symbolId: string;
  readonly communityId: number;
  readonly communityLabel: string;
}

export interface BoundaryViolation {
  readonly from: { readonly symbolId: string; readonly communityId: number; readonly label: string };
  readonly to: { readonly symbolId: string; readonly communityId: number; readonly label: string };
  readonly edgeKind: string;
  readonly historicalEdgesBetweenClusters: number;
  readonly severity: Severity;
}

export interface DriftEvent {
  readonly symbolId: string;
  readonly movedFrom: { readonly id: number; readonly label: string };
  readonly movedTo: { readonly id: number; readonly label: string };
  readonly firstSeenInNewCluster: string;
}

export interface ReportHistorySnapshot {
  readonly computedAt: string;
  readonly commitSha: string;
  readonly modularity: number;
  readonly crossClusterEdges: number;
  readonly assignments: Readonly<Record<string, number>>;
  readonly labels: Readonly<Record<number, string>>;
}

export interface ReportKpi {
  readonly modularity: number;
  readonly modularityTrend: readonly number[];
  readonly violationCount: number;
  readonly violationHighCount: number;
  readonly violationMediumCount: number;
  readonly driftEventCount: number;
  readonly driftConfidence: Confidence;
  readonly deadCodeCount: number;
  readonly totalSymbols: number;
  readonly totalEdges: number;
}

export interface VisNode {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly file: string;
  readonly startLine: number;
  readonly layer: string;
  readonly pageRank: number;
  readonly isDead: boolean;
  readonly deadConfidence?: number;
  readonly deadReason?: string;
  readonly cyclomatic?: number;
  readonly hasAntiPattern: boolean;
  readonly inDegree: number;
  readonly outDegree: number;
}

export interface VisEdge {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
}

export interface VisFileInfo {
  readonly file: string;
  readonly intent: readonly { hash: string; message: string; date: string }[];
  readonly antiPatterns: readonly { hash: string; message: string; date: string }[];
}

export interface ReportPayload {
  readonly projectName: string;
  readonly generatedAt: string;
  readonly commitSha: string;
  readonly kpi: ReportKpi;
  readonly godNodes: readonly GodNode[];
  readonly nodes: readonly VisNode[];
  readonly edges: readonly VisEdge[];
  readonly layers: Readonly<Record<string, readonly string[]>>;
  readonly files: readonly VisFileInfo[];
  readonly communities: readonly CommunityEntry[];
  readonly modularity: number;
  readonly crossClusterEdges: number;
  readonly violations: readonly BoundaryViolation[];
  readonly violationsTotal: number;
  readonly driftEvents: readonly DriftEvent[];
  readonly driftConfidence: Confidence;
  readonly driftHint?: string;
  readonly history: readonly ReportHistorySnapshot[];
  readonly hints: readonly string[];
}

declare global {
  interface Window {
    CTXO_REPORT_DATA: ReportPayload;
  }
}
