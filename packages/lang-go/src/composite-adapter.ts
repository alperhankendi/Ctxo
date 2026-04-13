import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { GoAnalyzerAdapter } from './analyzer/analyzer-adapter.js';
import { GoAdapter } from './go-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-go');

/**
 * Picks between the full-tier ctxo-go-analyzer and the syntax-tier
 * tree-sitter adapter at initialize() time. Symbols and edges come from
 * whichever delegate is active; complexity is ALWAYS sourced from
 * tree-sitter because the binary intentionally emits empty complexity.
 */
export class GoCompositeAdapter implements ILanguageAdapter {
  private analyzer: GoAnalyzerAdapter | null = null;
  private treeSitter: GoAdapter;

  constructor() {
    this.treeSitter = new GoAdapter();
  }

  async initialize(rootDir: string): Promise<void> {
    try {
      const analyzer = new GoAnalyzerAdapter();
      await analyzer.initialize(rootDir);
      if (analyzer.isReady()) {
        this.analyzer = analyzer;
        log.info('Go plugin: ctxo-go-analyzer full-tier active');
        return;
      }
      await analyzer.dispose();
    } catch (err) {
      log.warn(`Go analyzer unavailable: ${(err as Error).message}`);
    }
    log.info('Go plugin: tree-sitter syntax-tier active (install Go 1.22+ for full tier)');
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
    // Always tree-sitter — analyzer emits empty complexity by design.
    return this.treeSitter.extractComplexity(filePath, source);
  }

  isSupported(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.go');
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.treeSitter.setSymbolRegistry?.(registry);
  }

  /** Exposed for cli optimizations. Null when running in syntax tier. */
  getAnalyzerDelegate(): GoAnalyzerAdapter | null {
    return this.analyzer;
  }

  getTier(): 'full' | 'syntax' | 'unavailable' {
    if (this.analyzer) return 'full';
    if (this.treeSitter) return 'syntax';
    return 'unavailable';
  }
}
