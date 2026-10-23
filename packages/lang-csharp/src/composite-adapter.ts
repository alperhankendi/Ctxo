import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter, IIncrementalReindex } from '@ctxo/plugin-api';
import { RoslynAdapter } from './roslyn/roslyn-adapter.js';
import { CSharpAdapter } from './csharp-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-csharp');

export interface CSharpCompositeAdapterOptions {
  /** Ask the Roslyn helper for SQL call-site edges (the host's `sqlCallSites` capability). */
  readonly sqlCallSites?: boolean;
}

/**
 * Chooses between the full-tier Roslyn launcher and the syntax-tier tree-sitter
 * adapter at initialize() time. Forwards extract*() calls to the active delegate
 * and exposes the Roslyn delegate (when active) for cli optimizations such as
 * watch-mode keep-alive and batch index pre-warm.
 *
 * When the Roslyn helper fails later (its batch run or its keep-alive cannot
 * restore, build or start), the composite switches to tree-sitter once, so the
 * C# files keep their syntax-tier symbols instead of getting none.
 *
 * SQL call-site edges (reads, writes, executes) come from the Roslyn helper
 * only; the tree-sitter tier, including after a fallback, emits none.
 */
export class CSharpCompositeAdapter implements ILanguageAdapter {
  /** The `sqlCallSites` option as constructed, whatever tier is active. */
  readonly sqlCallSites: boolean;

  private delegate: ILanguageAdapter | null = null;
  private roslyn: RoslynAdapter | null = null;
  private treeSitter: CSharpAdapter | null = null;
  private symbolRegistry: Map<string, SymbolKind> | null = null;
  private fellBack = false;

  constructor(options: CSharpCompositeAdapterOptions = {}) {
    this.sqlCallSites = options.sqlCallSites === true;
  }

  async initialize(rootDir: string): Promise<void> {
    try {
      const roslyn = new RoslynAdapter({ sqlCallSites: this.sqlCallSites });
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
    this.fallBackIfRoslynFailed();
    return this.delegate ? this.delegate.extractSymbols(filePath, source) : Promise.resolve([]);
  }

  extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    this.fallBackIfRoslynFailed();
    return this.delegate ? this.delegate.extractEdges(filePath, source) : Promise.resolve([]);
  }

  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    this.fallBackIfRoslynFailed();
    return this.delegate ? this.delegate.extractComplexity(filePath, source) : Promise.resolve([]);
  }

  isSupported(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.cs');
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    // Kept for a later switch to tree-sitter, which resolves base types through it.
    this.symbolRegistry = registry;
    this.delegate?.setSymbolRegistry?.(registry);
  }

  /** Exposed for cli watch/index optimizations. Null in syntax tier and after a fallback. */
  getRoslynDelegate(): RoslynAdapter | null {
    this.fallBackIfRoslynFailed();
    return this.fellBack ? null : this.roslyn;
  }

  /** Optional watch keep-alive capability (generic). Null in syntax tier and after a fallback. */
  getIncrementalReindex(): IIncrementalReindex | null {
    this.fallBackIfRoslynFailed();
    return this.fellBack ? null : this.roslyn;
  }

  /** Current active tier: after initialize() resolves, and again after a Roslyn failure. */
  getTier(): 'full' | 'syntax' | 'unavailable' {
    this.fallBackIfRoslynFailed();
    if (this.roslyn && !this.fellBack) return 'full';
    if (this.treeSitter) return 'syntax';
    return 'unavailable';
  }

  /**
   * Switches to the tree-sitter adapter the first time the Roslyn delegate reports a failure.
   * Warns once; never throws (a tree-sitter that cannot load leaves no delegate).
   */
  private fallBackIfRoslynFailed(): void {
    if (this.fellBack || !this.roslyn) return;
    const failure = this.roslyn.getFailure();
    if (failure === null) return;

    this.fellBack = true;
    this.delegate = null;
    log.warn(`Roslyn helper failed (${failure}); C# falls back to the tree-sitter syntax tier. Run "ctxo doctor".`);
    try {
      const treeSitter = new CSharpAdapter();
      if (this.symbolRegistry) treeSitter.setSymbolRegistry(this.symbolRegistry);
      this.treeSitter = treeSitter;
      this.delegate = treeSitter;
    } catch (err) {
      log.warn(`tree-sitter fallback unavailable: ${(err as Error).message}`);
    }
  }
}
