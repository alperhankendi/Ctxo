import type { SymbolGraph } from '../graph/symbol-graph.js';
import type {
  VisEdge,
  VisFileInfo,
  VisNode,
} from '../graph/visualization-payload.js';
import type {
  BoundaryViolation,
  CommunitySnapshot,
  DriftEvent,
  FileIndex,
  GodNode,
} from '../types.js';
import {
  toHistorySnapshot,
  type ReportKpi,
  type ReportPayload,
} from './report-payload.js';

export interface ReportPayloadInput {
  readonly projectName: string;
  readonly commitSha: string;
  readonly indices: readonly FileIndex[];
  readonly graph: SymbolGraph;
  readonly pageRank: ReadonlyMap<string, number>;
  readonly deadCode: ReadonlyMap<string, { confidence: number; reason: string }>;
  readonly layers: Record<string, readonly string[]>;
  readonly fileLayerMap: ReadonlyMap<string, string>;
  readonly currentSnapshot: CommunitySnapshot;
  readonly historySnapshots: readonly CommunitySnapshot[];
  readonly violations: readonly BoundaryViolation[];
  readonly driftEvents: readonly DriftEvent[];
  readonly driftConfidence: 'high' | 'medium' | 'low';
  readonly driftHint?: string;
  readonly godNodes: readonly GodNode[];
  readonly maxNodes: number;
  readonly maxDriftEvents: number;
  readonly maxViolations: number;
}

export class ReportPayloadBuilder {
  build(input: ReportPayloadInput): ReportPayload {
    const complexityMap = this.buildComplexityMap(input.indices);
    const antiPatternFiles = this.buildAntiPatternFiles(input.indices);

    const allNodes = this.buildNodes(input, complexityMap, antiPatternFiles);
    const selectedNodes = this.selectTopNodes(allNodes, input.maxNodes);
    const selectedIds = new Set(selectedNodes.map((n) => n.id));

    const edges = this.buildEdges(input.graph, selectedIds);
    const files = this.buildFiles(input.indices, selectedIds);
    const violationsTrimmed = input.violations.slice(0, input.maxViolations);
    const driftEventsTrimmed = input.driftEvents.slice(0, input.maxDriftEvents);

    const modularityTrend = this.buildModularityTrend(
      input.historySnapshots,
      input.currentSnapshot,
    );

    const kpi: ReportKpi = {
      modularity: input.currentSnapshot.modularity,
      modularityTrend,
      violationCount: input.violations.length,
      violationHighCount: input.violations.filter((v) => v.severity === 'high').length,
      violationMediumCount: input.violations.filter((v) => v.severity === 'medium').length,
      driftEventCount: input.driftEvents.length,
      driftConfidence: input.driftConfidence,
      deadCodeCount: input.deadCode.size,
      totalSymbols: input.graph.nodeCount,
      totalEdges: input.graph.edgeCount,
    };

    const hints: string[] = [];
    if (input.driftHint) hints.push(input.driftHint);
    if (allNodes.length > input.maxNodes) {
      hints.push(
        `Graph truncated to top ${input.maxNodes} symbols by PageRank (full graph has ${allNodes.length}). Raise --max-nodes to see more.`,
      );
    }

    return {
      projectName: input.projectName,
      generatedAt: new Date().toISOString(),
      commitSha: input.commitSha,
      kpi,
      godNodes: input.godNodes,
      nodes: selectedNodes,
      edges,
      layers: input.layers,
      files,
      communities: input.currentSnapshot.communities,
      modularity: input.currentSnapshot.modularity,
      crossClusterEdges: input.currentSnapshot.crossClusterEdges,
      violations: violationsTrimmed,
      violationsTotal: input.violations.length,
      driftEvents: driftEventsTrimmed,
      driftConfidence: input.driftConfidence,
      ...(input.driftHint ? { driftHint: input.driftHint } : {}),
      history: input.historySnapshots.map(toHistorySnapshot),
      hints,
    };
  }

  private buildComplexityMap(indices: readonly FileIndex[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const fileIndex of indices) {
      if (!fileIndex.complexity) continue;
      for (const c of fileIndex.complexity) {
        map.set(c.symbolId, c.cyclomatic);
      }
    }
    return map;
  }

  private buildAntiPatternFiles(indices: readonly FileIndex[]): Set<string> {
    const set = new Set<string>();
    for (const fileIndex of indices) {
      if (fileIndex.antiPatterns.length > 0) set.add(fileIndex.file);
    }
    return set;
  }

  private buildNodes(
    input: ReportPayloadInput,
    complexityMap: ReadonlyMap<string, number>,
    antiPatternFiles: ReadonlySet<string>,
  ): VisNode[] {
    return input.graph.allNodes().map((sym) => {
      const file = sym.symbolId.split('::')[0] ?? '';
      const dead = input.deadCode.get(sym.symbolId);
      return {
        id: sym.symbolId,
        name: sym.name,
        kind: sym.kind,
        file,
        startLine: sym.startLine,
        layer: input.fileLayerMap.get(file) ?? 'Unknown',
        pageRank: input.pageRank.get(sym.symbolId) ?? 0,
        isDead: dead !== undefined,
        ...(dead ? { deadConfidence: dead.confidence, deadReason: dead.reason } : {}),
        cyclomatic: complexityMap.get(sym.symbolId),
        hasAntiPattern: antiPatternFiles.has(file),
        inDegree: input.graph.getReverseEdges(sym.symbolId).length,
        outDegree: input.graph.getForwardEdges(sym.symbolId).length,
      };
    });
  }

  private selectTopNodes(nodes: VisNode[], maxNodes: number): VisNode[] {
    if (nodes.length <= maxNodes) return nodes;
    return [...nodes].sort((a, b) => b.pageRank - a.pageRank).slice(0, maxNodes);
  }

  private buildEdges(graph: SymbolGraph, selectedIds: ReadonlySet<string>): VisEdge[] {
    return graph
      .allEdges()
      .filter((e) => selectedIds.has(e.from) && selectedIds.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, kind: e.kind }));
  }

  private buildFiles(
    indices: readonly FileIndex[],
    selectedIds: ReadonlySet<string>,
  ): VisFileInfo[] {
    return indices
      .filter((fi) => fi.symbols.some((s) => selectedIds.has(s.symbolId)))
      .map((fi) => ({
        file: fi.file,
        intent: fi.intent.map((i) => ({ hash: i.hash, message: i.message, date: i.date })),
        antiPatterns: fi.antiPatterns.map((a) => ({
          hash: a.hash,
          message: a.message,
          date: a.date,
        })),
      }));
  }

  private buildModularityTrend(
    history: readonly CommunitySnapshot[],
    current: CommunitySnapshot,
  ): number[] {
    // History is returned newest-first; reverse so trend reads oldest -> current
    // and append current as the last point.
    const trend = [...history].reverse().map((s) => s.modularity);
    trend.push(current.modularity);
    return trend;
  }
}
