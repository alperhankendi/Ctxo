import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { RoslynAdapter } from './roslyn/roslyn-adapter.js';
import { CSharpAdapter } from './csharp-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-csharp');

/**
 * Chooses between the full-tier Roslyn launcher and the syntax-tier tree-sitter
 * adapter at initialize() time. Forwards extract*() calls to the active delegate
 * and exposes the Roslyn delegate (when active) for cli optimizations such as
 * watch-mode keep-alive and batch index pre-warm.
 */
export class CSharpCompositeAdapter implements ILanguageAdapter {
  private delegate: ILanguageAdapter | null = null;
  private roslyn: RoslynAdapter | null = null;
  private treeSitter: CSharpAdapter | null = null;

  async initialize(rootDir: string): Promise<void> {
    try {
      const roslyn = new RoslynAdapter();
      await roslyn.initialize(rootDir);
      if (roslyn.isReady()) {
        this.roslyn = roslyn;
        this.delegate = roslyn;
        log.info('C# plugin: Roslyn full-tier active');
        return;
      }
      // Roslyn constructed but not ready — dispose and fall through
      await roslyn.dispose();
    } catch (err) {
      log.warn(`Roslyn unavailable: ${(err as Error).message}`);
    }

    try {
      this.treeSitter = new CSharpAdapter();
      this.delegate = this.treeSitter;
      log.info('C# plugin: tree-sitter syntax-tier active (install .NET 8+ SDK for full tier)');
    } catch (err) {
      log.warn(`tree-sitter fallback unavailable: ${(err as Error).message}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.roslyn) await this.roslyn.dispose();
  }

  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    return this.delegate ? this.delegate.extractSymbols(filePath, source) : Promise.resolve([]);
  }

  extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    return this.delegate ? this.delegate.extractEdges(filePath, source) : Promise.resolve([]);
  }

  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    return this.delegate ? this.delegate.extractComplexity(filePath, source) : Promise.resolve([]);
  }

  isSupported(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.cs');
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.delegate?.setSymbolRegistry?.(registry);
  }

  /** Exposed for cli watch/index optimizations. Null when running in syntax tier. */
  getRoslynDelegate(): RoslynAdapter | null {
    return this.roslyn;
  }

  /** Current active tier after initialize() resolves. */
  getTier(): 'full' | 'syntax' | 'unavailable' {
    if (this.roslyn) return 'full';
    if (this.treeSitter) return 'syntax';
    return 'unavailable';
  }
}
