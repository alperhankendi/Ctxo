import type { ComplexityMetrics, GraphEdge, ILanguageAdapter, SymbolKind, SymbolNode } from '@ctxo/plugin-api';
import { createLogger } from '../logger.js';
import { resolveAnalyzerJar, analyzerPackageVersion, baseVersionMismatch, PLUGIN_VERSION } from './jar-resolve.js';
import { runBatchIndex, JdtKeepAlive, type JdtFileResult } from './jdt-process.js';
import { detectJavaRuntime } from './toolchain-detect.js';

const log = createLogger('ctxo:lang-java');
const FULL_SYMBOL_ID = /^.+::.+::.+$/;

export class JdtAnalyzerAdapter implements ILanguageAdapter {
  readonly extensions = ['.java'] as const;
  readonly tier = 'full' as const;

  private root: string | null = null;
  private javaBin = 'java';
  private jarPath: string | null = null;
  private cache = new Map<string, JdtFileResult>();
  private batchPromise: Promise<void> | null = null;
  private initialized = false;
  private keepAlive: JdtKeepAlive | null = null;

  isSupported(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.java');
  }

  isReady(): boolean {
    return this.initialized && this.jarPath !== null && this.root !== null;
  }

  async initialize(rootDir: string): Promise<void> {
    const java = detectJavaRuntime();
    if (!java.available) {
      log.info(`Java full tier unavailable: JRE ${java.version ?? 'not found'} (>= 17 required)`);
      return;
    }
    const jar = resolveAnalyzerJar();
    if (!jar) {
      log.info('Java full tier unavailable: @ctxo/lang-java-analyzer not installed (run: ctxo install java --full-tier)');
      return;
    }
    const analyzerVer = analyzerPackageVersion();
    if (analyzerVer && baseVersionMismatch(analyzerVer, PLUGIN_VERSION)) {
      log.warn(`Analyzer package version ${analyzerVer} != plugin ${PLUGIN_VERSION}; using it anyway. Re-run "ctxo install java --full-tier" to align.`);
    }
    this.root = rootDir;
    this.javaBin = java.javaBin;
    this.jarPath = jar;
    this.initialized = true;
    log.info(`Java analyzer ready: JRE ${java.version}, jar ${jar}`);
  }

  async extractSymbols(filePath: string, _source: string): Promise<SymbolNode[]> {
    if (!this.isReady()) return [];
    await this.ensureBatch();
    const file = this.cache.get(this.norm(filePath));
    if (!file) return [];
    return file.symbols
      .filter((s) => FULL_SYMBOL_ID.test(s.symbolId))
      .map((s) => ({
        symbolId: s.symbolId,
        name: s.name,
        kind: s.kind as SymbolKind,
        startLine: s.startLine,
        endLine: s.endLine,
        ...(s.startOffset != null ? { startOffset: s.startOffset } : {}),
        ...(s.endOffset != null ? { endOffset: s.endOffset } : {}),
      }));
  }

  async extractEdges(filePath: string, _source: string): Promise<GraphEdge[]> {
    if (!this.isReady()) return [];
    await this.ensureBatch();
    const file = this.cache.get(this.norm(filePath));
    if (!file) return [];
    return file.edges
      .filter((e) => FULL_SYMBOL_ID.test(e.from) && e.to.length > 0)
      .map((e) => ({ from: e.from, to: e.to, kind: e.kind as GraphEdge['kind'] }));
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    return [];
  }

  async startKeepAlive(): Promise<boolean> {
    if (!this.isReady() || !this.jarPath || !this.root) return false;
    this.keepAlive = new JdtKeepAlive(this.javaBin, this.jarPath, this.root);
    const ok = await this.keepAlive.start();
    if (!ok) this.keepAlive = null;
    return ok;
  }

  async reindexFileRaw(relativePath: string): Promise<JdtFileResult | null> {
    if (!this.keepAlive?.isAlive()) return null;
    return this.keepAlive.analyzeFile(relativePath);
  }

  async dispose(): Promise<void> {
    if (this.keepAlive) { await this.keepAlive.shutdown(); this.keepAlive = null; }
    this.cache.clear();
    this.batchPromise = null;
    this.initialized = false;
  }

  private norm(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  private ensureBatch(): Promise<void> {
    if (this.batchPromise) return this.batchPromise;
    this.batchPromise = this.runBatch();
    return this.batchPromise;
  }

  private async runBatch(): Promise<void> {
    if (!this.jarPath || !this.root) return;
    const result = await runBatchIndex(this.javaBin, this.jarPath, this.root);
    this.cache.clear();
    for (const file of result.files) this.cache.set(this.norm(file.file), file);
    log.info(`Java analyzer batch: ${result.files.length} files in ${result.elapsed}`);
  }
}
