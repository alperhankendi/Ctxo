import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '../../../core/types.js';
import type { ILanguageAdapter } from '../../../ports/i-language-adapter.js';
import { createLogger } from '../../../core/logger.js';
import { detectDotnetSdk, discoverSolution, findCtxoRoslynProject } from './solution-discovery.js';
import { runBatchIndex, RoslynKeepAlive, type RoslynBatchResult, type RoslynFileResult } from './roslyn-process.js';

const log = createLogger('ctxo:roslyn');

export class RoslynAdapter implements ILanguageAdapter {
  readonly extensions = ['.cs'] as const;
  readonly tier = 'full' as const;

  private roslynProjectDir: string | null = null;
  private solutionPath: string | null = null;
  private cache = new Map<string, RoslynFileResult>();
  private keepAlive: RoslynKeepAlive | null = null;
  private initialized = false;

  isSupported(filePath: string): boolean {
    return filePath.endsWith('.cs');
  }

  isReady(): boolean {
    return this.initialized && this.roslynProjectDir !== null && this.solutionPath !== null;
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

    log.info(`Roslyn adapter ready: SDK ${sdk.version}, solution ${this.solutionPath}`);
    this.initialized = true;
  }

  /**
   * Run batch analysis for all .cs files in the solution.
   * Call this once before extractSymbols/extractEdges for best performance.
   */
  async batchIndex(): Promise<RoslynBatchResult | null> {
    if (!this.isReady()) return null;

    const result = await runBatchIndex(this.roslynProjectDir!, this.solutionPath!);

    // Cache results by file path
    this.cache.clear();
    for (const file of result.files) {
      this.cache.set(file.file, file);
    }

    log.info(`Roslyn batch index: ${result.totalFiles} files in ${result.elapsed}`);
    return result;
  }

  async extractSymbols(filePath: string, _source: string): Promise<SymbolNode[]> {
    const cached = this.cache.get(filePath);
    if (!cached) return [];

    return cached.symbols.map(s => ({
      symbolId: s.symbolId,
      name: s.name,
      kind: s.kind as SymbolKind,
      startLine: s.startLine,
      endLine: s.endLine,
    }));
  }

  async extractEdges(filePath: string, _source: string): Promise<GraphEdge[]> {
    const cached = this.cache.get(filePath);
    if (!cached) return [];

    return cached.edges.map(e => ({
        from: e.from,
        to: e.to,
        kind: e.kind as GraphEdge['kind'],
      }));
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

    this.keepAlive = new RoslynKeepAlive(this.roslynProjectDir!, this.solutionPath!);
    return await this.keepAlive.start();
  }

  /**
   * Incremental re-analysis of a single file (keep-alive mode).
   */
  async reindexFile(relativePath: string): Promise<RoslynFileResult | null> {
    if (!this.keepAlive?.isAlive()) return null;

    const result = await this.keepAlive.analyzeFile(relativePath);
    if (result) {
      this.cache.set(relativePath, result);
    }
    return result;
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
