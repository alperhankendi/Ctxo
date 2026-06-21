import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { JavaAdapter } from './java-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-java');

/**
 * Picks between the full-tier JDT analyzer and the syntax-tier tree-sitter
 * adapter at initialize() time. This foundation ships syntax-only: the JDT
 * branch is added in a later plan. Complexity is ALWAYS sourced from tree-sitter.
 */
export class JavaCompositeAdapter implements ILanguageAdapter {
  private treeSitter: JavaAdapter;
  // private analyzer: JdtAdapter | null = null;  // wired in the full-tier plan

  constructor() {
    this.treeSitter = new JavaAdapter();
  }

  async initialize(_rootDir: string): Promise<void> {
    // The full-tier plan will probe the Java runtime + verified JAR here and activate full tier.
    log.info('Java plugin: tree-sitter syntax-tier active (full tier arrives in a later plan)');
  }

  async dispose(): Promise<void> {
    // Full-tier plan: dispose the analyzer process if active.
  }

  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    return this.treeSitter.extractSymbols(filePath, source);
  }

  extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    return this.treeSitter.extractEdges(filePath, source);
  }

  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    // Always tree-sitter — JDT does not emit cyclomatic complexity.
    return this.treeSitter.extractComplexity(filePath, source);
  }

  isSupported(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.java');
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.treeSitter.setSymbolRegistry?.(registry);
  }

  getTier(): 'full' | 'syntax' | 'unavailable' {
    return 'syntax';
  }
}
