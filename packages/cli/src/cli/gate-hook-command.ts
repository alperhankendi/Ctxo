import { join, relative, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../core/config/load-config.js';
import { resolveGateThresholds } from '../core/gate/gate-config.js';
import { loadGraph } from './graph-loader.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { lineOfSnippet, locateSymbolAtLine } from '../core/gate/symbol-locator.js';
import { transcriptHasBlastCheck } from '../core/gate/transcript-scan.js';
import { GateSessionStore } from '../adapters/gate/gate-session-store.js';
import { BlastRadiusCalculator } from '../core/blast-radius/blast-radius-calculator.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import { percentileCutoff } from '../core/gate/percentile.js';
import { shouldBlock, formatBlockReason } from '../core/gate/gate-decision.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('ctxo:gate-hook');

export interface HookPayload {
  session_id: string;
  transcript_path: string;
  tool_name: string;
  tool_input: { file_path?: string; old_string?: string; new_string?: string };
}

export interface HookDecision { block: boolean; reason?: string; }

export class GateHookCommand {
  private readonly ctxoRoot: string;
  private readonly cacheDir: string;
  constructor(private readonly projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
    this.cacheDir = join(this.ctxoRoot, '.cache');
  }

  /** Pure-ish decision: never throws (fail-open). */
  evaluate(payload: HookPayload): HookDecision {
    try {
      if (payload.tool_name !== 'Edit') return { block: false };
      const filePath = payload.tool_input?.file_path;
      const oldString = payload.tool_input?.old_string;
      if (!filePath || !oldString) return { block: false };

      // loadConfig takes ctxoRoot (.ctxo directory) and returns LoadedConfig wrapper
      const loaded = loadConfig(this.ctxoRoot);
      const thresholds = resolveGateThresholds(loaded.config.gate);
      if (!thresholds.enabled) return { block: false };

      const relPath = relative(this.projectRoot, filePath).split(sep).join('/');
      const indexFile = join(this.ctxoRoot, 'index', `${relPath}.json`);
      if (!existsSync(indexFile)) return { block: false };

      const fileIndex = new JsonIndexReader(this.ctxoRoot).readSingle(indexFile);
      if (!fileIndex) return { block: false };

      if (!existsSync(filePath)) return { block: false };
      const source = readFileSync(filePath, 'utf-8');
      const line = lineOfSnippet(source, oldString);
      if (line === null) return { block: false };

      const symbolId = locateSymbolAtLine(fileIndex, line);
      if (!symbolId) return { block: false };

      const store = new GateSessionStore(this.cacheDir);
      if (store.hasWarned(payload.session_id, symbolId)) return { block: false };
      if (payload.transcript_path && existsSync(payload.transcript_path)) {
        const lines = readFileSync(payload.transcript_path, 'utf-8').split('\n').filter(Boolean);
        if (transcriptHasBlastCheck(lines, symbolId)) return { block: false };
      }

      const { graph } = loadGraph(this.ctxoRoot);
      if (!graph.hasNode(symbolId)) return { block: false };
      const blast = new BlastRadiusCalculator().calculate(graph, symbolId);
      const riskCount = blast.confirmedCount + blast.likelyCount;

      const pr = new PageRankCalculator().calculate(graph, { limit: 100_000 });
      const prMap = new Map(pr.rankings.map((r) => [r.symbolId, r.score]));
      const cutoff = percentileCutoff([...prMap.values()], thresholds.percentile);
      const importanceScore = prMap.get(symbolId) ?? 0;

      const block = shouldBlock({ riskCount, importanceScore, importanceCutoff: cutoff }, thresholds);
      if (!block) return { block: false };

      store.recordWarned(payload.session_id, symbolId);
      const name = symbolId.split('::')[1] ?? symbolId;
      const top = blast.impactedSymbols
        .filter((s) => s.confidence !== 'potential')
        .slice(0, 8)
        .map((s) => s.symbolId);
      return { block: true, reason: formatBlockReason(name, riskCount, top) };
    } catch (err) {
      log.error(`${(err as Error).message}`);
      return { block: false };
    }
  }

  async run(): Promise<void> {
    const payload = await this.readStdin();
    if (payload) {
      log.error('tool_input keys: ' + Object.keys(payload.tool_input ?? {}).join(','));
      const decision = this.evaluate(payload);
      if (decision.block) this.emitBlock(decision.reason ?? 'ctxo guard');
    }
    process.exit(0);
  }

  /** PreToolUse block contract (verified): exit 0 + stdout JSON deny. */
  private emitBlock(reason: string): void {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n');
    process.exit(0);
  }

  private readStdin(): Promise<HookPayload | null> {
    return new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => {
        try { resolve(JSON.parse(data) as HookPayload); } catch { resolve(null); }
      });
      process.stdin.on('error', () => resolve(null));
    });
  }
}
