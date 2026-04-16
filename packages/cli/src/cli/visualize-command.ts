import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { ArchitectureArtifactsWriter } from '../adapters/storage/architecture-artifacts-writer.js';
import { CommunitySnapshotWriter } from '../adapters/storage/community-snapshot-writer.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { SymbolGraph } from '../core/graph/symbol-graph.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import { DeadCodeDetector } from '../core/dead-code/dead-code-detector.js';
import { ArchitecturalOverlay } from '../core/overlay/architectural-overlay.js';
import type {
  VisCommunityLegend,
  VisualizationPayload,
  VisNode,
  VisEdge,
  VisFileInfo,
} from '../core/graph/visualization-payload.js';
import type { BoundaryViolation, CommunityEntry } from '../core/types.js';

export interface VisualizeOptions {
  output?: string;
  maxNodes?: number;
  noBrowser?: boolean;
}

export class VisualizeCommand {
  private readonly ctxoRoot: string;

  constructor(private readonly projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(options: VisualizeOptions = {}): Promise<void> {
    // 1. Read index
    const reader = new JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();

    if (indices.length === 0) {
      console.error('[ctxo] No index found. Run "ctxo index" first.');
      process.exit(1);
      return;
    }

    console.error(`[ctxo] Building graph from ${indices.length} files...`);

    // 2. Build SymbolGraph
    const graph = new SymbolGraph();
    for (const fileIndex of indices) {
      for (const sym of fileIndex.symbols) {
        graph.addNode(sym);
      }
    }
    for (const fileIndex of indices) {
      for (const edge of fileIndex.edges) {
        graph.addEdge(edge);
      }
    }

    console.error(`[ctxo] Graph: ${graph.nodeCount} symbols, ${graph.edgeCount} edges`);

    // 3. Compute PageRank
    const pageRank = new PageRankCalculator();
    const prResult = pageRank.calculate(graph, { limit: 100_000 });
    const prMap = new Map<string, number>();
    for (const entry of prResult.rankings) {
      prMap.set(entry.symbolId, entry.score);
    }

    // 4. Detect dead code
    const deadDetector = new DeadCodeDetector();
    const deadResult = deadDetector.detect(graph);
    const deadMap = new Map<string, { confidence: number; reason: string }>();
    for (const d of deadResult.deadSymbols) {
      deadMap.set(d.symbolId, { confidence: d.confidence, reason: d.reason });
    }

    // 4b. Build complexity map from index data
    const complexityMap = new Map<string, number>();
    for (const fileIndex of indices) {
      if (fileIndex.complexity) {
        for (const c of fileIndex.complexity) {
          complexityMap.set(c.symbolId, c.cyclomatic);
        }
      }
    }

    // 4c. Build anti-pattern set (files with anti-patterns)
    const antiPatternFiles = new Set<string>();
    for (const fileIndex of indices) {
      if (fileIndex.antiPatterns.length > 0) {
        antiPatternFiles.add(fileIndex.file);
      }
    }

    // 5. Classify architectural layers
    const filePaths = [...new Set(indices.map(i => i.file))];
    const overlay = new ArchitecturalOverlay();
    const overlayResult = overlay.classify(filePaths);

    // Build file -> layer lookup
    const fileLayerMap = new Map<string, string>();
    for (const [layer, files] of Object.entries(overlayResult.layers)) {
      for (const file of files) {
        fileLayerMap.set(file, layer);
      }
    }

    // 5b. Load community snapshot + boundary violations produced by `ctxo index`.
    //     These are read-only here — the writer guards are opt-in.
    const communityWriter = new CommunitySnapshotWriter(this.ctxoRoot, {
      allowProductionPath: true,
    });
    const currentSnapshot = communityWriter.readCurrent();
    const communityByIdForSymbol = new Map<string, { id: number; label: string }>();
    if (currentSnapshot) {
      for (const entry of currentSnapshot.communities as readonly CommunityEntry[]) {
        communityByIdForSymbol.set(entry.symbolId, {
          id: entry.communityId,
          label: entry.communityLabel,
        });
      }
    }
    const architectureWriter = new ArchitectureArtifactsWriter(this.ctxoRoot, {
      allowProductionPath: true,
    });
    const violationsArtifact = architectureWriter.readBoundaryViolations();
    const violationEdgeSeverity = new Map<string, BoundaryViolation['severity']>();
    if (violationsArtifact) {
      for (const v of violationsArtifact.violations as readonly BoundaryViolation[]) {
        violationEdgeSeverity.set(
          `${v.from.symbolId}|${v.to.symbolId}`,
          v.severity,
        );
      }
    }

    // 6. Build payload
    const totalSymbols = graph.nodeCount;
    let nodes: VisNode[] = graph.allNodes().map(sym => {
      const file = sym.symbolId.split('::')[0] ?? '';
      const dead = deadMap.get(sym.symbolId);
      const community = communityByIdForSymbol.get(sym.symbolId);
      return {
        id: sym.symbolId,
        name: sym.name,
        kind: sym.kind,
        file,
        startLine: sym.startLine,
        layer: fileLayerMap.get(file) ?? 'Unknown',
        pageRank: prMap.get(sym.symbolId) ?? 0,
        isDead: dead !== undefined,
        ...(dead ? { deadConfidence: dead.confidence, deadReason: dead.reason } : {}),
        cyclomatic: complexityMap.get(sym.symbolId),
        hasAntiPattern: antiPatternFiles.has(file),
        inDegree: graph.getReverseEdges(sym.symbolId).length,
        outDegree: graph.getForwardEdges(sym.symbolId).length,
        communityId: community?.id ?? -1,
        communityLabel: community?.label ?? 'unassigned',
      };
    });

    // 7. Apply --max-nodes filtering
    if (options.maxNodes && nodes.length > options.maxNodes) {
      nodes.sort((a, b) => b.pageRank - a.pageRank);
      nodes = nodes.slice(0, options.maxNodes);
    }

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: VisEdge[] = graph.allEdges()
      .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map(e => {
        const severity = violationEdgeSeverity.get(`${e.from}|${e.to}`);
        return {
          source: e.from,
          target: e.to,
          kind: e.kind,
          ...(severity ? { violationSeverity: severity } : {}),
        };
      });

    // Build per-file info (intent + anti-patterns)
    const filesInfo: VisFileInfo[] = indices
      .filter(fi => nodeIds.has(fi.symbols[0]?.symbolId ?? '___') || fi.symbols.some(s => nodeIds.has(s.symbolId)))
      .map(fi => ({
        file: fi.file,
        intent: fi.intent.map(i => ({ hash: i.hash, message: i.message, date: i.date })),
        antiPatterns: fi.antiPatterns.map(a => ({ hash: a.hash, message: a.message, date: a.date })),
      }));

    // Build community legend restricted to communities with visible members.
    const legendCounts = new Map<number, { label: string; count: number }>();
    for (const node of nodes) {
      if (node.communityId < 0) continue;
      const entry = legendCounts.get(node.communityId);
      if (entry) {
        entry.count += 1;
      } else {
        legendCounts.set(node.communityId, { label: node.communityLabel, count: 1 });
      }
    }
    const communities: VisCommunityLegend[] = [...legendCounts.entries()]
      .map(([id, { label, count }]) => ({ id, label, memberCount: count }))
      .sort((a, b) => b.memberCount - a.memberCount);

    const payload: VisualizationPayload = {
      projectName: basename(this.projectRoot),
      generatedAt: new Date().toISOString().split('T')[0]!,
      totalSymbols,
      shownSymbols: nodes.length,
      nodes,
      edges,
      layers: overlayResult.layers,
      files: filesInfo,
      communities,
      modularity: currentSnapshot?.modularity ?? 0,
      violationCount: violationsArtifact?.violations.length ?? 0,
    };

    // 8. Inject into template
    const templatePath = this.getTemplatePath();
    const template = readFileSync(templatePath, 'utf-8');
    const html = template.replace('/*__CTXO_DATA__*/null', JSON.stringify(payload));

    // 9. Write output
    const outputPath = options.output ?? join(this.ctxoRoot, 'visualize.html');
    writeFileSync(outputPath, html, 'utf-8');
    console.error(`[ctxo] Wrote visualization to ${outputPath}`);
    console.error(`[ctxo] ${nodes.length} symbols, ${edges.length} edges, ${deadResult.deadSymbols.length} dead`);

    // 10. Open in browser
    if (!options.noBrowser) {
      this.openInBrowser(outputPath);
    }
  }

  private getTemplatePath(): string {
    let dir = import.meta.dirname;
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, 'pages', 'visualize-template.html');
      if (existsSync(candidate)) return candidate;
      const parent = join(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error('Could not find visualize-template.html. Ensure the pages/ directory exists.');
  }

  private openInBrowser(filePath: string): void {
    // Use execFile (not exec) for safety - no shell interpretation
    const onError = (err: Error | null) => {
      if (err) {
        console.error(`[ctxo] Could not open browser: ${err.message}`);
        console.error(`[ctxo] Open manually: ${filePath}`);
      }
    };

    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', filePath], onError);
    } else if (process.platform === 'darwin') {
      execFile('open', [filePath], onError);
    } else {
      execFile('xdg-open', [filePath], onError);
    }
  }
}
