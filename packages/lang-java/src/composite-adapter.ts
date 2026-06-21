import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter, IIncrementalReindex, ReindexResult } from '@ctxo/plugin-api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JavaAdapter } from './java-adapter.js';
import { JdtAnalyzerAdapter } from './analyzer/jdt-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-java');

/**
 * Picks between the full-tier JDT analyzer and the syntax-tier tree-sitter
 * adapter at initialize() time. Symbols/edges come from whichever is active;
 * complexity is ALWAYS tree-sitter (JDT emits none).
 */
export class JavaCompositeAdapter implements ILanguageAdapter {
  private treeSitter: JavaAdapter;
  private analyzer: JdtAnalyzerAdapter | null = null;
  private rootDir = '';

  constructor() { this.treeSitter = new JavaAdapter(); }

  async initialize(rootDir: string): Promise<void> {
    this.rootDir = rootDir;
    try {
      const analyzer = new JdtAnalyzerAdapter();
      await analyzer.initialize(rootDir);
      if (analyzer.isReady()) {
        this.analyzer = analyzer;
        log.info('Java plugin: JDT full-tier active');
        return;
      }
      await analyzer.dispose();
    } catch (err) {
      log.warn(`Java analyzer unavailable: ${(err as Error).message}`);
    }
    log.info('Java plugin: tree-sitter syntax-tier active (install full tier for resolved call/use edges)');
  }

  async dispose(): Promise<void> {
    if (this.analyzer) await this.analyzer.dispose();
  }

  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    return (this.analyzer ?? this.treeSitter).extractSymbols(filePath, source);
  }

  extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    return (this.analyzer ?? this.treeSitter).extractEdges(filePath, source);
  }

  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    return this.treeSitter.extractComplexity(filePath, source);
  }

  isSupported(filePath: string): boolean { return filePath.toLowerCase().endsWith('.java'); }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.treeSitter.setSymbolRegistry?.(registry);
  }

  getIncrementalReindex(): IIncrementalReindex | null {
    if (!this.analyzer) return null;
    const analyzer = this.analyzer;
    const treeSitter = this.treeSitter;
    const rootDir = this.rootDir;
    const FULL = /^.+::.+::.+$/;
    return {
      isReady: () => analyzer.isReady(),
      startKeepAlive: () => analyzer.startKeepAlive(),
      dispose: () => analyzer.dispose(),
      async reindexFile(relativePath: string): Promise<ReindexResult | null> {
        const raw = await analyzer.reindexFileRaw(relativePath);
        if (!raw) return null;
        let complexity: ReindexResult['complexity'] = [];
        try {
          const source = readFileSync(join(rootDir, relativePath), 'utf-8');
          complexity = await treeSitter.extractComplexity(relativePath, source);
        } catch { /* unreadable mid-edit - empty complexity */ }
        return {
          symbols: raw.symbols.filter((s) => FULL.test(s.symbolId)).map((s) => ({
            symbolId: s.symbolId, name: s.name, kind: s.kind as ReindexResult['symbols'][0]['kind'],
            startLine: s.startLine, endLine: s.endLine,
            ...(s.startOffset != null ? { startOffset: s.startOffset } : {}),
            ...(s.endOffset != null ? { endOffset: s.endOffset } : {}),
          })),
          edges: raw.edges.filter((e) => FULL.test(e.from) && e.to.length > 0).map((e) => ({
            from: e.from, to: e.to, kind: e.kind as ReindexResult['edges'][0]['kind'],
          })),
          complexity,
        };
      },
    };
  }

  getAnalyzerDelegate(): JdtAnalyzerAdapter | null { return this.analyzer; }

  getTier(): 'full' | 'syntax' | 'unavailable' {
    if (this.analyzer) return 'full';
    if (this.treeSitter) return 'syntax';
    return 'unavailable';
  }
}
