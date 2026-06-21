import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
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

  constructor() { this.treeSitter = new JavaAdapter(); }

  async initialize(rootDir: string): Promise<void> {
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

  getAnalyzerDelegate(): JdtAnalyzerAdapter | null { return this.analyzer; }

  getTier(): 'full' | 'syntax' | 'unavailable' {
    if (this.analyzer) return 'full';
    if (this.treeSitter) return 'syntax';
    return 'unavailable';
  }
}
