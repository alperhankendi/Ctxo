import { relative, dirname, resolve } from 'node:path';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter, ReindexResult } from '@ctxo/plugin-api';
import { createLogger } from '../logger.js';
import { detectDotnetSdk, discoverSolution, findCtxoRoslynProject } from './solution-discovery.js';
import {
  runBatchIndex,
  RoslynKeepAlive,
  type RoslynBatchResult,
  type RoslynEdge,
  type RoslynFileResult,
  type RoslynSymbol,
} from './roslyn-process.js';

const log = createLogger('ctxo:roslyn');

/** A symbol ID with at least three non-empty `::` segments (`file::name::kind`). */
const VALID_SYMBOL_ID = /^.+::.+::.+$/;
/** Edge kinds whose target may be a 2-part SQL resource reference. */
const DATA_EDGE_KINDS: ReadonlySet<string> = new Set(['reads', 'writes', 'executes']);
/** Kinds of a 2-part SQL resource reference (`dbo.loans::table`), which core resolves to a SQL symbol. */
const DATA_TARGET_KINDS: ReadonlySet<string> = new Set(['table', 'view', 'procedure']);

/** True for a 2-part `<name>::table|view|procedure` reference with a non-empty name. */
function isDataTarget(id: string): boolean {
  const segments = id.split('::');
  return segments.length === 2 && segments[0] !== '' && DATA_TARGET_KINDS.has(segments[1]!);
}

/** True for a data edge (reads, writes, executes) whose target is a 2-part SQL resource reference. */
function hasDataTarget(edge: RoslynEdge): boolean {
  return DATA_EDGE_KINDS.has(edge.kind) && isDataTarget(edge.to);
}

/**
 * Maps helper edges to GraphEdges. Keeps an edge when `from` and `to` are 3-part symbol IDs,
 * and a reads, writes or executes edge whose `to` is a 2-part `<name>::table|view|procedure`
 * reference; drops every other edge (malformed IDs, 2-part targets on code edges).
 */
export function toGraphEdges(edges: readonly RoslynEdge[]): GraphEdge[] {
  const result: GraphEdge[] = [];
  for (const e of edges) {
    if (!VALID_SYMBOL_ID.test(e.from)) continue;
    if (!VALID_SYMBOL_ID.test(e.to) && !hasDataTarget(e)) continue;
    result.push({ from: e.from, to: e.to, kind: e.kind as GraphEdge['kind'] });
  }
  return result;
}

export interface RoslynAdapterOptions {
  /** Pass `--sql-call-sites` to the helper (batch and keep-alive): SQL text at known call sites becomes data edges. */
  readonly sqlCallSites?: boolean;
}

/** Maps a helper symbol to a SymbolNode; optional fields appear only when present. */
export function toSymbolNode(s: RoslynSymbol): SymbolNode {
  return {
    symbolId: s.symbolId,
    name: s.name,
    kind: s.kind as SymbolKind,
    startLine: s.startLine,
    endLine: s.endLine,
    ...(s.startOffset != null ? { startOffset: s.startOffset } : {}),
    ...(s.endOffset != null ? { endOffset: s.endOffset } : {}),
    ...(s.annotations && s.annotations.length > 0 ? { annotations: s.annotations } : {}),
  };
}

export class RoslynAdapter implements ILanguageAdapter {
  readonly extensions = ['.cs'] as const;
  readonly tier = 'full' as const;
  /** Whether the helper emits SQL call-site edges, as constructed. */
  readonly sqlCallSites: boolean;

  private roslynProjectDir: string | null = null;
  private solutionPath: string | null = null;
  private rootDir: string | null = null;
  private cache = new Map<string, RoslynFileResult>();
  private keepAlive: RoslynKeepAlive | null = null;
  /** The restart in progress, shared by the requests that find the keep-alive gone. */
  private restarting: Promise<boolean> | null = null;
  private initialized = false;
  private failure: string | null = null;

  constructor(options: RoslynAdapterOptions = {}) {
    this.sqlCallSites = options.sqlCallSites === true;
  }

  isSupported(filePath: string): boolean {
    return filePath.endsWith('.cs');
  }

  /** False before initialize() finds the SDK, the helper and a solution, and once the helper failed. */
  isReady(): boolean {
    return this.failure === null && this.initialized && this.roslynProjectDir !== null && this.solutionPath !== null;
  }

  /**
   * Why the helper failed, or null while it has not: set when batchIndex() gets a failed run
   * (restore, build, timeout), startKeepAlive() cannot start the keep-alive process, or
   * reindexFile() cannot bring back a keep-alive that stopped after `ready`.
   */
  getFailure(): string | null {
    return this.failure;
  }

  async initialize(rootDir: string): Promise<void> {
    // 1. Check dotnet SDK
    const sdk = detectDotnetSdk();
    if (!sdk.available) {
      log.info(`Roslyn adapter unavailable: .NET SDK ${sdk.version ? `${sdk.version} (< 8.0)` : 'not found'}`);
      return;
    }

    // 2. Find ctxo-roslyn project
    this.roslynProjectDir = findCtxoRoslynProject();
    if (!this.roslynProjectDir) {
      log.info('Roslyn adapter unavailable: ctxo-roslyn project not found');
      return;
    }

    // 3. Discover solution
    this.solutionPath = discoverSolution(rootDir);
    if (!this.solutionPath) {
      log.info('Roslyn adapter unavailable: no .sln or .csproj found');
      return;
    }

    this.rootDir = rootDir;
    log.info(`Roslyn adapter ready: SDK ${sdk.version}, solution ${this.solutionPath}`);
    this.initialized = true;
  }

  /**
   * Run batch analysis for all .cs files in the solution.
   * Call this once before extractSymbols/extractEdges for best performance.
   * A failed run (`ok: false`) records the reason in getFailure() and leaves the cache empty.
   */
  async batchIndex(): Promise<RoslynBatchResult | null> {
    if (!this.isReady()) return null;

    const result = await runBatchIndex(this.roslynProjectDir!, this.solutionPath!, { sqlCallSites: this.sqlCallSites });
    if (!result.ok) {
      this.failure = result.error || 'the batch run failed';
      this.cache.clear();
      return result;
    }

    // Build path mapping: solution-relative -> project-root-relative for ALL files
    // .NET outputs "CFTCoreService/Base.cs" (relative to solution dir)
    // IndexCommand expects "src/CFTCoreService/Base.cs" (relative to project root)
    const solutionDir = dirname(this.solutionPath!);
    const pathMap = new Map<string, string>();
    for (const file of result.files) {
      const absolutePath = resolve(solutionDir, file.file);
      const projectRelative = relative(this.rootDir!, absolutePath).replace(/\\/g, '/');
      pathMap.set(file.file, projectRelative);
    }

    // Rewrite all paths using the complete mapping
    this.cache.clear();
    for (const file of result.files) {
      const projectRelative = pathMap.get(file.file)!;
      const rewritten = rewriteAllPaths(file, projectRelative, pathMap);
      this.cache.set(projectRelative, rewritten);
    }

    log.info(`Roslyn batch index: ${result.totalFiles} files in ${result.elapsed}`);
    if (result.sql) {
      const { constant, nonConstant, unparsable } = result.sql;
      log.debug(`Roslyn SQL call sites: ${constant} constant, ${nonConstant} non-constant, ${unparsable} unparsable`);
    }
    return result;
  }

  async extractSymbols(filePath: string, _source: string): Promise<SymbolNode[]> {
    const cached = this.cache.get(filePath);
    if (!cached) return [];

    return cached.symbols.map(toSymbolNode);
  }

  async extractEdges(filePath: string, _source: string): Promise<GraphEdge[]> {
    const cached = this.cache.get(filePath);
    if (!cached) return [];

    return toGraphEdges(cached.edges);
  }

  async extractComplexity(filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    const cached = this.cache.get(filePath);
    if (!cached) return [];

    return cached.complexity.map(c => ({
      symbolId: c.symbolId,
      cyclomatic: c.cyclomatic,
    }));
  }

  /**
   * Start keep-alive process for watch mode.
   */
  async startKeepAlive(): Promise<boolean> {
    if (!this.isReady()) return false;

    this.keepAlive = new RoslynKeepAlive(this.roslynProjectDir!, this.solutionPath!, { sqlCallSites: this.sqlCallSites });
    const started = await this.keepAlive.start();
    if (!started) this.failure = 'the keep-alive helper did not start';
    return started;
  }

  /**
   * Incremental re-analysis of a single file (keep-alive mode).
   *
   * A keep-alive can stop after `ready`: it shuts itself down after its inactivity timeout, or it
   * exits. Such a keep-alive is restarted once per call, and a request it dropped by exiting is sent
   * again. When it cannot come back, getFailure() is set, so the composite falls back to tree-sitter
   * instead of answering from an empty or stale Roslyn cache. Null when there is no answer.
   */
  async reindexFile(relativePath: string): Promise<ReindexResult | null> {
    if (this.failure !== null) return null;

    let restarted = false;
    for (;;) {
      // Read each time: a restart replaces the keep-alive, and dispose() removes it.
      let keepAlive = this.keepAlive;
      if (!keepAlive) return null;
      if (!keepAlive.isAlive()) {
        if (restarted) {
          this.failure = 'the keep-alive helper exited again after a restart';
          return null;
        }
        if (!(await this.restartKeepAlive())) return null;
        restarted = true;
        keepAlive = this.keepAlive;
        if (!keepAlive) return null;
      }

      const result = await keepAlive.analyzeFile(relativePath);
      if (result) {
        this.cache.set(relativePath, result);
        return {
          symbols: result.symbols.map(toSymbolNode),
          edges: toGraphEdges(result.edges),
          complexity: result.complexity.map(c => ({
            symbolId: c.symbolId,
            cyclomatic: c.cyclomatic,
          })),
        };
      }
      // Still running but no answer (the per-request timeout): null, as before.
      if (keepAlive.isAlive()) return null;
      // It exited during the request: restart it (once per call) and ask again.
    }
  }

  /**
   * Starts a new keep-alive in place of one that stopped; concurrent callers share the attempt.
   * Resolves false and sets the failure when the helper does not reach `ready`.
   */
  private restartKeepAlive(): Promise<boolean> {
    this.restarting ??= (async () => {
      log.info('Roslyn keep-alive is not running (idle shutdown or exit); restarting it');
      const keepAlive = new RoslynKeepAlive(this.roslynProjectDir!, this.solutionPath!, { sqlCallSites: this.sqlCallSites });
      this.keepAlive = keepAlive;
      const started = await keepAlive.start();
      if (!started) this.failure = 'the keep-alive helper stopped and did not restart';
      return started;
    })().finally(() => {
      this.restarting = null;
    });
    return this.restarting;
  }

  async dispose(): Promise<void> {
    if (this.keepAlive) {
      await this.keepAlive.shutdown();
      this.keepAlive = null;
    }
    this.cache.clear();
    this.initialized = false;
  }
}

/**
 * Rewrite ALL file paths in symbols/edges using the complete path mapping.
 * Handles cross-file edge targets (e.g., ChatSync -> BaseSyncJob) correctly.
 */
function rewriteAllPaths(
  file: RoslynFileResult,
  newFilePath: string,
  pathMap: Map<string, string>,
): RoslynFileResult {
  // Rewrite a symbolId or path string: find any solution-relative path prefix and replace it
  const rewrite = (s: string): string => {
    for (const [oldPath, newPath] of pathMap) {
      if (s.includes(oldPath)) {
        return s.replaceAll(oldPath, newPath);
      }
    }
    return s;
  };

  return {
    ...file,
    file: newFilePath,
    symbols: file.symbols.map(s => ({
      ...s,
      symbolId: rewrite(s.symbolId),
    })),
    edges: file.edges.map(e => ({
      ...e,
      from: rewrite(e.from),
      // A 2-part SQL resource reference holds no file path.
      to: hasDataTarget(e) ? e.to : rewrite(e.to),
    })),
    complexity: file.complexity.map(c => ({
      ...c,
      symbolId: rewrite(c.symbolId),
    })),
  };
}
