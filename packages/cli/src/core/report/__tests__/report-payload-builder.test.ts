import { describe, expect, it } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import type {
  BoundaryViolation,
  CommunitySnapshot,
  DriftEvent,
  FileIndex,
  GodNode,
  SymbolNode,
} from '../../types.js';
import { ReportPayloadBuilder } from '../report-payload-builder.js';

function sym(file: string, name: string): SymbolNode {
  return {
    symbolId: `${file}::${name}::function`,
    name,
    kind: 'function',
    startLine: 1,
    endLine: 10,
  };
}

function snapshot(
  commitSha: string,
  modularity: number,
  assignments: Array<[string, number, string]>,
): CommunitySnapshot {
  return {
    version: 1,
    computedAt: `2025-01-01T00:00:00.000Z`,
    commitSha,
    modularity,
    communities: assignments.map(([symbolId, communityId, communityLabel]) => ({
      symbolId,
      communityId,
      communityLabel,
    })),
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
  };
}

function baseInput(overrides: Partial<Parameters<ReportPayloadBuilder['build']>[0]> = {}) {
  const a = sym('src/a.ts', 'alpha');
  const b = sym('src/b.ts', 'beta');
  const graph = new SymbolGraph();
  graph.addNode(a);
  graph.addNode(b);
  graph.addEdge({ from: a.symbolId, to: b.symbolId, kind: 'imports' });

  const index: FileIndex = {
    file: 'src/a.ts',
    lastModified: 1,
    symbols: [a],
    edges: [{ from: a.symbolId, to: b.symbolId, kind: 'imports' }],
    intent: [],
    antiPatterns: [],
  };
  const indexB: FileIndex = {
    file: 'src/b.ts',
    lastModified: 1,
    symbols: [b],
    edges: [],
    intent: [],
    antiPatterns: [],
  };

  return {
    projectName: 'demo',
    commitSha: 'abc1234',
    indices: [index, indexB],
    graph,
    pageRank: new Map([
      [a.symbolId, 0.6],
      [b.symbolId, 0.4],
    ]),
    deadCode: new Map<string, { confidence: number; reason: string }>(),
    layers: { Domain: ['src/a.ts'], Adapter: ['src/b.ts'] },
    fileLayerMap: new Map([
      ['src/a.ts', 'Domain'],
      ['src/b.ts', 'Adapter'],
    ]),
    currentSnapshot: snapshot('abc1234', 0.42, [
      [a.symbolId, 0, 'core'],
      [b.symbolId, 1, 'infra'],
    ]),
    historySnapshots: [] as readonly CommunitySnapshot[],
    violations: [] as readonly BoundaryViolation[],
    driftEvents: [] as readonly DriftEvent[],
    driftConfidence: 'low' as const,
    godNodes: [] as readonly GodNode[],
    maxNodes: 500,
    maxDriftEvents: 200,
    maxViolations: 200,
    ...overrides,
  };
}

describe('ReportPayloadBuilder', () => {
  it('builds a payload with KPIs and graph', () => {
    const builder = new ReportPayloadBuilder();
    const payload = builder.build(baseInput());

    expect(payload.projectName).toBe('demo');
    expect(payload.commitSha).toBe('abc1234');
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toHaveLength(1);
    expect(payload.kpi.modularity).toBe(0.42);
    expect(payload.kpi.totalSymbols).toBe(2);
    expect(payload.kpi.totalEdges).toBe(1);
    expect(payload.kpi.deadCodeCount).toBe(0);
    expect(payload.kpi.driftConfidence).toBe('low');
  });

  it('marks drift confidence and passes hint through', () => {
    const builder = new ReportPayloadBuilder();
    const payload = builder.build(
      baseInput({ driftHint: 'no prior snapshots', driftConfidence: 'low' }),
    );
    expect(payload.driftHint).toBe('no prior snapshots');
    expect(payload.hints).toContain('no prior snapshots');
  });

  it('counts violation severity tiers', () => {
    const violations: BoundaryViolation[] = [
      {
        from: { symbolId: 'src/a.ts::alpha::function', communityId: 0, label: 'core' },
        to: { symbolId: 'src/b.ts::beta::function', communityId: 1, label: 'infra' },
        edgeKind: 'imports',
        historicalEdgesBetweenClusters: 0,
        severity: 'high',
      },
      {
        from: { symbolId: 'src/a.ts::alpha::function', communityId: 0, label: 'core' },
        to: { symbolId: 'src/b.ts::beta::function', communityId: 1, label: 'infra' },
        edgeKind: 'calls',
        historicalEdgesBetweenClusters: 1,
        severity: 'medium',
      },
    ];
    const builder = new ReportPayloadBuilder();
    const payload = builder.build(baseInput({ violations }));
    expect(payload.kpi.violationCount).toBe(2);
    expect(payload.kpi.violationHighCount).toBe(1);
    expect(payload.kpi.violationMediumCount).toBe(1);
  });

  it('truncates graph nodes at maxNodes and surfaces a hint', () => {
    const graph = new SymbolGraph();
    const pr = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      const node = sym('src/x.ts', `n${i}`);
      graph.addNode(node);
      pr.set(node.symbolId, i / 10);
    }
    const builder = new ReportPayloadBuilder();
    const payload = builder.build(
      baseInput({
        graph,
        pageRank: pr,
        maxNodes: 3,
        currentSnapshot: snapshot('abc1234', 0.5, []),
      }),
    );
    expect(payload.nodes).toHaveLength(3);
    // top-by-pagerank: n9, n8, n7
    expect(payload.nodes.map((n) => n.name)).toEqual(['n9', 'n8', 'n7']);
    expect(payload.hints.some((h) => h.includes('truncated'))).toBe(true);
  });

  it('builds modularity trend from history plus current', () => {
    const history = [
      snapshot('aaaa', 0.3, []),
      snapshot('bbbb', 0.35, []),
    ];
    const builder = new ReportPayloadBuilder();
    const payload = builder.build(
      baseInput({
        historySnapshots: history,
        currentSnapshot: snapshot('abc1234', 0.42, [
          ['src/a.ts::alpha::function', 0, 'core'],
          ['src/b.ts::beta::function', 1, 'infra'],
        ]),
      }),
    );
    // history is listed newest-first (listHistory); builder reverses to oldest-first then appends current
    expect(payload.kpi.modularityTrend).toEqual([0.35, 0.3, 0.42]);
    expect(payload.history).toHaveLength(2);
    expect(payload.history[0]!.commitSha).toBe('aaaa');
  });

  it('reduces history snapshots to assignments + labels', () => {
    const history = [
      snapshot('aaaa', 0.3, [
        ['src/a.ts::alpha::function', 5, 'legacy'],
      ]),
    ];
    const builder = new ReportPayloadBuilder();
    const payload = builder.build(baseInput({ historySnapshots: history }));
    expect(payload.history[0]!.assignments['src/a.ts::alpha::function']).toBe(5);
    expect(payload.history[0]!.labels[5]).toBe('legacy');
  });
});
