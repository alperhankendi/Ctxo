import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CommunityDetector } from '../community-detector.js';
import { buildMultiClusterGraph } from './fixtures/multi-cluster.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(__dirname, 'fixtures', 'golden-community-snapshot.json');

/**
 * Guards against silent drift in the community-detection pipeline.
 *
 * This test pins the EXACT output of `CommunityDetector.detect()` over a
 * fixed, reproducible fixture graph. If the detector is refactored, its
 * dependencies upgraded (graphology, graphology-communities-louvain), or the
 * labeling heuristic changes, this test fails and forces a conscious
 * re-generation of the golden file.
 *
 * Why it matters: drift detection compares snapshots written on different
 * machines / CI runners / git-hook-run shells. If the detector is not
 * deterministic byte-for-byte across those environments, users get phantom
 * drift events. This test is the canary.
 *
 * To regenerate (after a legitimate change): run with `CTXO_UPDATE_GOLDEN=1`.
 */
describe('CommunityDetector — golden snapshot', () => {
  it('produces byte-identical output for a fixed fixture graph', () => {
    const graph = buildMultiClusterGraph();

    // Uniform pagerank matches the shape used in real runs for small,
    // disconnected cliques — avoids injecting noise that varies by upstream
    // PageRank impl details.
    const pagerank = new Map<string, number>();
    const nodes = graph.allNodes();
    for (const node of nodes) pagerank.set(node.symbolId, 1 / nodes.length);

    const detector = new CommunityDetector({ godNodeMinBridged: 2 });
    const result = detector.detect(graph, pagerank, 'full');

    const serialized = JSON.stringify(
      {
        modularity: Number(result.modularity.toFixed(6)),
        crossClusterEdges: result.crossClusterEdges,
        edgeQuality: result.edgeQuality,
        communities: [...result.communities].sort((a, b) =>
          a.symbolId < b.symbolId ? -1 : a.symbolId > b.symbolId ? 1 : 0,
        ),
        godNodes: [...result.godNodes].map((g) => ({
          symbolId: g.symbolId,
          bridgedCommunities: [...g.bridgedCommunities],
          centralityScore: Number(g.centralityScore.toFixed(6)),
        })),
      },
      null,
      2,
    );

    if (process.env['CTXO_UPDATE_GOLDEN'] === '1') {
      writeFileSync(GOLDEN_PATH, serialized + '\n', 'utf-8');
      return;
    }

    if (!existsSync(GOLDEN_PATH)) {
      throw new Error(
        `Golden snapshot missing at ${GOLDEN_PATH}. Generate it with CTXO_UPDATE_GOLDEN=1.`,
      );
    }

    const golden = readFileSync(GOLDEN_PATH, 'utf-8').trimEnd();
    expect(serialized).toBe(golden);
  });

  it('rejects non-deterministic cluster id assignments across back-to-back runs', () => {
    const graph = buildMultiClusterGraph();
    const pagerank = new Map<string, number>();
    for (const node of graph.allNodes()) pagerank.set(node.symbolId, 1 / graph.nodeCount);

    const detector = new CommunityDetector({ godNodeMinBridged: 2 });
    const a = detector.detect(graph, pagerank, 'full');
    const b = detector.detect(graph, pagerank, 'full');

    const mapOf = (entries: typeof a.communities): Map<string, number> => {
      const m = new Map<string, number>();
      for (const e of entries) m.set(e.symbolId, e.communityId);
      return m;
    };

    expect(mapOf(a.communities)).toEqual(mapOf(b.communities));
    expect(a.modularity).toBe(b.modularity);
    expect(a.godNodes.map((g) => g.symbolId)).toEqual(b.godNodes.map((g) => g.symbolId));
  });
});
