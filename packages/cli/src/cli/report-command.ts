import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { CommunitySnapshotWriter } from '../adapters/storage/community-snapshot-writer.js';
import { DeadCodeDetector } from '../core/dead-code/dead-code-detector.js';
import { SymbolGraph } from '../core/graph/symbol-graph.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import { ArchitecturalOverlay } from '../core/overlay/architectural-overlay.js';
import { BoundaryViolationDetector } from '../core/overlay/boundary-violation-detector.js';
import { DriftDetector } from '../core/overlay/drift-detector.js';
import { ReportPayloadBuilder } from '../core/report/report-payload-builder.js';

const DEFAULT_MAX_NODES = 500;
const DEFAULT_MAX_DRIFT_EVENTS = 200;
const DEFAULT_MAX_VIOLATIONS = 200;
const DATA_PLACEHOLDER = '/*__CTXO_REPORT_DATA__*/null';

export interface ReportOptions {
  output?: string;
  maxNodes?: number;
  maxDriftEvents?: number;
  maxViolations?: number;
  noBrowser?: boolean;
}

export class ReportCommand {
  private readonly ctxoRoot: string;

  constructor(private readonly projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(options: ReportOptions = {}): Promise<void> {
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const maxDriftEvents = options.maxDriftEvents ?? DEFAULT_MAX_DRIFT_EVENTS;
    const maxViolations = options.maxViolations ?? DEFAULT_MAX_VIOLATIONS;

    // 1. Read index
    const reader = new JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();
    if (indices.length === 0) {
      console.error('[ctxo] No index found. Run "ctxo index" first.');
      process.exit(1);
      return;
    }

    // 2. Build graph
    console.error(`[ctxo] Building graph from ${indices.length} files...`);
    const graph = new SymbolGraph();
    for (const fileIndex of indices) {
      for (const sym of fileIndex.symbols) graph.addNode(sym);
    }
    for (const fileIndex of indices) {
      for (const edge of fileIndex.edges) graph.addEdge(edge);
    }
    console.error(`[ctxo] Graph: ${graph.nodeCount} symbols, ${graph.edgeCount} edges`);

    // 3. PageRank + dead code + layers
    const pageRankResult = new PageRankCalculator().calculate(graph, { limit: 100_000 });
    const pageRankMap = new Map<string, number>();
    for (const entry of pageRankResult.rankings) pageRankMap.set(entry.symbolId, entry.score);

    const deadResult = new DeadCodeDetector().detect(graph);
    const deadMap = new Map<string, { confidence: number; reason: string }>();
    for (const d of deadResult.deadSymbols) {
      deadMap.set(d.symbolId, { confidence: d.confidence, reason: d.reason });
    }

    const filePaths = [...new Set(indices.map((i) => i.file))];
    const overlayResult = new ArchitecturalOverlay().classify(filePaths);
    const fileLayerMap = new Map<string, string>();
    for (const [layer, files] of Object.entries(overlayResult.layers)) {
      for (const file of files) fileLayerMap.set(file, layer);
    }

    // 4. Load community snapshots (current + history). This command is
    // read-only on the snapshot store; the writer's production-path guard
    // still runs in the constructor, so opt in explicitly.
    const snapshotWriter = new CommunitySnapshotWriter(this.ctxoRoot, {
      allowProductionPath: true,
    });
    const currentSnapshot = snapshotWriter.readCurrent();
    if (!currentSnapshot) {
      console.error(
        '[ctxo] No community snapshot found (.ctxo/index/communities.json). Run "ctxo index" first.',
      );
      process.exit(1);
      return;
    }
    const historySnapshots = snapshotWriter.listHistory();

    // 5. Detectors (drift + violations) — pure, run here since they are not persisted
    const driftResult = new DriftDetector().detect(currentSnapshot, historySnapshots);
    const violationsResult = new BoundaryViolationDetector().detect(
      graph,
      currentSnapshot,
      historySnapshots,
    );
    console.error(
      `[ctxo] Architectural intelligence: ${currentSnapshot.communities.length} community assignments, ` +
        `${violationsResult.violations.length} violations, ${driftResult.events.length} drift events ` +
        `(confidence: ${driftResult.confidence})`,
    );

    // 6. Build payload
    const builder = new ReportPayloadBuilder();
    const payload = builder.build({
      projectName: basename(this.projectRoot),
      commitSha: this.safeHeadSha(),
      indices,
      graph,
      pageRank: pageRankMap,
      deadCode: deadMap,
      layers: overlayResult.layers,
      fileLayerMap,
      currentSnapshot,
      historySnapshots,
      violations: violationsResult.violations,
      driftEvents: driftResult.events,
      driftConfidence: driftResult.confidence,
      ...(driftResult.hint ? { driftHint: driftResult.hint } : {}),
      godNodes: currentSnapshot.godNodes,
      maxNodes,
      maxDriftEvents,
      maxViolations,
    });

    // 7. Inject into template
    const templatePath = this.getTemplatePath();
    const template = readFileSync(templatePath, 'utf-8');
    if (!template.includes(DATA_PLACEHOLDER)) {
      throw new Error(
        `report-template.html is missing the ${DATA_PLACEHOLDER} placeholder — template build may have failed.`,
      );
    }
    const html = template.replace(DATA_PLACEHOLDER, safeJsonForScriptTag(payload));

    // 8. Write
    const outputPath = options.output ?? join(this.ctxoRoot, 'report.html');
    writeFileSync(outputPath, html, 'utf-8');
    console.error(`[ctxo] Wrote report to ${outputPath}`);
    console.error(
      `[ctxo] ${payload.nodes.length} symbols shown, ${payload.edges.length} edges, ${payload.violations.length} violations, ${payload.driftEvents.length} drift events`,
    );

    // 9. Open browser
    if (!options.noBrowser) this.openInBrowser(outputPath);
  }

  private getTemplatePath(): string {
    let dir = import.meta.dirname;
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, 'pages', 'report-template.html');
      if (existsSync(candidate)) return candidate;
      const parent = join(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      'Could not find report-template.html. Run the package build to generate it (scripts/build-report-template.ts).',
    );
  }

  private safeHeadSha(): string {
    try {
      const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      });
      return out.trim();
    } catch {
      return 'nocommit';
    }
  }

  private openInBrowser(filePath: string): void {
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

/**
 * Escape a JSON payload for safe embedding inside a <script> tag.
 * Prevents `</script>` sequences inside strings from breaking the HTML,
 * and neutralizes HTML comment / JSON Unicode hazards.
 */
function safeJsonForScriptTag(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
