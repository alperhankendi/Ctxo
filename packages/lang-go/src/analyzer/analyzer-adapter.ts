import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import type { CodeFact, SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { createLogger } from '../logger.js';
import { structTagAnnotations } from '../struct-tags.js';
import { detectGoToolchain } from './toolchain-detect.js';
import { discoverGoModule, findCtxoGoAnalyzerSource } from './module-discovery.js';
import { ensureAnalyzerBinary } from './binary-build.js';
import { sqlEdgesFromCallSites } from '../sql-edges.js';
import { runBatchAnalyze, type AnalyzerFactEvidence, type AnalyzerFileResult, type AnalyzerBatchResult } from './analyzer-process.js';
import type { DurationUnit, FactEvidence, FactOptions, LiteralKind } from '../facts/fact-types.js';
import { finishFacts } from '../facts/finish-facts.js';
import { decodeGoStringLiteral } from '../facts/go-string-literal.js';
import { GoAdapter } from '../go-adapter.js';

const log = createLogger('ctxo:lang-go');
const VALID_SYMBOL_ID = /^.+::.+::.+$/;

/** The syntax-tier fact source for files whose bytes differ from the batch's (see `extractFacts`). */
export interface GoSyntaxFacts {
  extractFacts(filePath: string, source: string): Promise<CodeFact[]>;
}

/**
 * Full-tier Go adapter. Owns the analyzer binary lifecycle and an
 * in-memory cache of batch results keyed by project-relative file path.
 *
 * Caching strategy: the first extractSymbols/extractEdges call after
 * initialize() triggers a single batch analysis run. Subsequent calls
 * read from cache. This keeps the ILanguageAdapter contract intact
 * (per-file methods) while the binary runs once per index.
 */
export class GoAnalyzerAdapter implements ILanguageAdapter {
  readonly extensions = ['.go'] as const;
  readonly tier = 'full' as const;

  private moduleRoot: string | null = null;
  private binaryPath: string | null = null;
  private modulePathPrefix = '';
  private cache = new Map<string, AnalyzerFileResult>();
  private deadSymbolIds = new Set<string>();
  private hasMain = false;
  private timedOut = false;
  private batchFailed = false;
  private batchPromise: Promise<void> | null = null;
  /** Set by `dispose`; a batch that finishes later is dropped. */
  private disposed = false;
  private initialized = false;
  private readonly sqlCallSites: boolean;
  private sqlStats: { constant: number; nonConstant: number } | undefined;
  /** Fact detector options: set when the host requests facts; without them `extractFacts` returns `[]`. */
  readonly facts: FactOptions | undefined;
  /** Facts of stale files: the composite's tree-sitter adapter, or one made on first use. */
  private syntaxFacts: GoSyntaxFacts | undefined;

  constructor(options: { readonly sqlCallSites?: boolean; readonly facts?: FactOptions; readonly syntaxFacts?: GoSyntaxFacts } = {}) {
    this.sqlCallSites = options.sqlCallSites === true;
    this.facts = options.facts;
    this.syntaxFacts = options.syntaxFacts;
  }

  /**
   * SQL argument counts reported by the analyzer (`constant` ones gave a call-site record, `nonConstant`
   * ones did not). Undefined until a batch ran with `sqlCallSites`. Cumulative per adapter instance: a full
   * index run creates fresh adapters, and `ctxo watch` never reports these stats.
   */
  getSqlStats(): { constant: number; nonConstant: number } | undefined {
    return this.sqlStats ? { ...this.sqlStats } : undefined;
  }

  isSupported(filePath: string): boolean {
    return filePath.endsWith('.go');
  }

  isReady(): boolean {
    return this.initialized && this.binaryPath !== null && this.moduleRoot !== null;
  }

  async initialize(rootDir: string): Promise<void> {
    this.disposed = false;
    const toolchain = detectGoToolchain();
    if (!toolchain.available) {
      log.info(`Go analyzer unavailable: go ${toolchain.version ?? 'not found'} (>= 1.22 required)`);
      return;
    }

    const moduleRoot = discoverGoModule(rootDir);
    if (!moduleRoot) {
      log.info('Go analyzer unavailable: no go.mod or go.work found');
      return;
    }
    this.moduleRoot = moduleRoot;
    const prefix = relative(rootDir, moduleRoot).replace(/\\/g, '/');
    this.modulePathPrefix = prefix && prefix !== '.' ? prefix : '';

    const sourceDir = findCtxoGoAnalyzerSource();
    if (!sourceDir) {
      log.info('Go analyzer unavailable: ctxo-go-analyzer source not located');
      return;
    }

    try {
      this.binaryPath = ensureAnalyzerBinary(sourceDir, toolchain.version!);
    } catch (err) {
      log.warn(`Go analyzer binary build failed: ${(err as Error).message}`);
      return;
    }

    log.info(`Go analyzer ready: go ${toolchain.version}, module ${moduleRoot}`);
    this.initialized = true;
  }

  /**
   * Returns the dead-symbol set emitted by the last batch run. Empty until
   * extractSymbols/Edges has been called at least once. Consumed by cli's
   * find_dead_code MCP tool via the composite delegate.
   */
  getDeadSymbolIds(): Set<string> {
    return this.deadSymbolIds;
  }

  /** True when the analyzer ran in binary mode (precise dead-code). */
  reachabilityHasMain(): boolean {
    return this.hasMain;
  }

  /** True when reach analysis exceeded the deadline (degraded precision). */
  reachabilityTimedOut(): boolean {
    return this.timedOut;
  }

  /** True once a batch run failed or was killed. */
  hasBatchFailed(): boolean {
    return this.batchFailed;
  }

  /**
   * Runs the batch if it has not run yet and tells whether the analyzer result can be used. False when the
   * process failed, crashed or was killed: the composite then indexes with tree-sitter instead of storing
   * an empty full-tier result.
   */
  async isUsable(): Promise<boolean> {
    if (!this.isReady()) return false;
    await this.ensureBatch();
    return !this.batchFailed;
  }

  async extractSymbols(filePath: string, _source: string): Promise<SymbolNode[]> {
    if (!this.isReady()) return [];
    await this.ensureBatch();
    const file = this.cache.get(this.normalizePath(filePath));
    if (!file) return [];
    return file.symbols
      .filter((s) => VALID_SYMBOL_ID.test(s.symbolId))
      .map((s) => {
        const annotations = s.tags ? structTagAnnotations(s.tags) : undefined;
        return {
          symbolId: s.symbolId,
          name: s.name,
          kind: s.kind as SymbolKind,
          startLine: s.startLine,
          endLine: s.endLine,
          ...(s.startOffset != null ? { startOffset: s.startOffset } : {}),
          ...(s.endOffset != null ? { endOffset: s.endOffset } : {}),
          ...(annotations ? { annotations } : {}),
        };
      });
  }

  async extractEdges(filePath: string, _source: string): Promise<GraphEdge[]> {
    if (!this.isReady()) return [];
    await this.ensureBatch();
    const file = this.cache.get(this.normalizePath(filePath));
    if (!file) return [];
    const edges: GraphEdge[] = file.edges
      .filter((e) => VALID_SYMBOL_ID.test(e.from) && VALID_SYMBOL_ID.test(e.to))
      .map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind as GraphEdge['kind'],
      }));
    // Data edges are built from the already rewritten call-site ids and skip the 3-part `to` filter above:
    // their targets are canonical names such as `dbo.loans::table`.
    if (file.sqlCallSites?.length) edges.push(...sqlEdgesFromCallSites(file.sqlCallSites));
    return edges;
  }

  /**
   * Code facts (protocol v2, only with the `facts` option): the batch's evidence for the file, finished by
   * the shared rules with the Go string literal decoder. When the source differs from the bytes the batch
   * read (the analyzer's `factSourceHash`, for example after a `ctxo watch` save), the facts of that one file
   * come from the tree-sitter collector instead (the tiers are built to agree), so stale evidence is never
   * served and a save never reruns the analyzer on the whole module (B-I1). Go has no annotation routes.
   */
  async extractFacts(filePath: string, source: string): Promise<CodeFact[]> {
    const options = this.facts;
    if (!options || !this.isReady()) return [];
    await this.ensureBatch();
    const path = this.normalizePath(filePath);
    const file = this.cache.get(path);
    if (file && isStale(file, source)) {
      this.syntaxFacts ??= new GoAdapter({ facts: options });
      return this.syntaxFacts.extractFacts(path, source);
    }
    const evidence = (file?.factEvidence ?? []).map(toFactEvidence).filter((e): e is FactEvidence => e !== undefined);
    if (evidence.length === 0) return [];
    // The analyzer's symbol lines are 1-based; fact lines and the finisher's attribution are 0-based.
    const symbols = (await this.extractSymbols(path, source)).map((s) => ({ ...s, startLine: s.startLine - 1, endLine: s.endLine - 1 }));
    return finishFacts(path, evidence, symbols, options, decodeGoStringLiteral);
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    // Tree-sitter layer fills complexity — the binary intentionally emits []
    // so the composite adapter merges the two sources without contention.
    return [];
  }

  async dispose(): Promise<void> {
    // A batch still in flight must not refill the cache after this.
    this.disposed = true;
    this.cache.clear();
    this.deadSymbolIds.clear();
    this.batchPromise = null;
    this.initialized = false;
  }

  private async ensureBatch(): Promise<void> {
    if (this.batchPromise) return this.batchPromise;
    this.batchPromise = this.runBatch();
    return this.batchPromise;
  }

  /** The one analyzer batch of this adapter; a failure marks the analyzer as failed (the composite then uses tree-sitter). */
  private async runBatch(): Promise<void> {
    if (!this.binaryPath || !this.moduleRoot) return;
    const result = await runBatchAnalyze(this.binaryPath, this.moduleRoot, {
      sqlCallSites: this.sqlCallSites,
      ...(this.facts ? { facts: this.facts } : {}),
    });
    if (this.disposed) return;
    if (result.failed) {
      this.batchFailed = true;
      log.warn('Go analyzer run failed or timed out; these files fall back to the tree-sitter syntax tier');
      return;
    }
    this.absorbBatch(result);
    if (this.sqlCallSites) {
      if (result.sql) {
        log.debug(`Go analyzer SQL arguments: ${result.sql.constant} constant, ${result.sql.nonConstant} non-constant`);
      } else {
        log.warn('Go analyzer reported no SQL statistics although --sql-call-sites was requested (analyzer too old?)');
      }
    }
    log.info(`Go analyzer batch: ${result.totalFiles} files in ${result.elapsed}, ${result.dead.length} dead`);
  }

  /** Caches the batch result. */
  private absorbBatch(result: AnalyzerBatchResult): void {
    this.cache.clear();
    this.deadSymbolIds.clear();
    this.hasMain = result.hasMain;
    this.timedOut = result.timeout;

    const rewrite = this.buildPathRewriter();
    for (const file of result.files) {
      const projectRel = rewrite(file.file);
      this.cache.set(projectRel, {
        ...file,
        file: projectRel,
        symbols: file.symbols.map((s) => ({ ...s, symbolId: rewriteId(s.symbolId, file.file, projectRel) })),
        edges: file.edges.map((e) => ({
          ...e,
          from: rewriteId(e.from, file.file, projectRel),
          to: rewriteIdAcrossModule(e.to, this.modulePathPrefix),
        })),
        // Only the enclosing symbol gets the module prefix; the table targets are built later from the text.
        ...(file.sqlCallSites
          ? { sqlCallSites: file.sqlCallSites.map((s) => ({ ...s, symbolId: rewriteIdAcrossModule(s.symbolId, this.modulePathPrefix) })) }
          : {}),
        ...(file.factEvidence
          ? {
              factEvidence: file.factEvidence.map((e) =>
                e.symbolId ? { ...e, symbolId: rewriteId(e.symbolId, file.file, projectRel) } : e,
              ),
            }
          : {}),
      });
    }
    if (result.sql) {
      this.sqlStats = {
        constant: (this.sqlStats?.constant ?? 0) + result.sql.constant,
        nonConstant: (this.sqlStats?.nonConstant ?? 0) + result.sql.nonConstant,
      };
    }
    for (const id of result.dead) {
      this.deadSymbolIds.add(rewriteIdAcrossModule(id, this.modulePathPrefix));
    }
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  private buildPathRewriter(): (analyzerRel: string) => string {
    if (!this.modulePathPrefix) return (p) => p;
    const prefix = this.modulePathPrefix;
    return (p) => `${prefix}/${p}`;
  }
}

/** True when the analyzer hashed the file and `source` is not those bytes. */
function isStale(file: AnalyzerFileResult, source: string): boolean {
  if (!file.factSourceHash) return false;
  return createHash('sha256').update(source, 'utf8').digest('hex') !== file.factSourceHash;
}

const LITERAL_KINDS: ReadonlySet<string> = new Set(['number', 'string', 'char', 'boolean', 'null']);
const DURATION_UNITS: ReadonlySet<string> = new Set(['ns', 'us', 'ms', 's', 'min', 'h', 'd']);

/** The analyzer's wire record as shared `FactEvidence`, or undefined when a field its kind needs is missing. */
function toFactEvidence(e: AnalyzerFactEvidence): FactEvidence | undefined {
  const base = { ...(e.symbolId ? { symbolId: e.symbolId } : {}), line: e.line };
  switch (e.kind) {
    case 'comparison':
      if (e.operator === undefined || e.literal === undefined || !LITERAL_KINDS.has(e.literalKind ?? '')) return undefined;
      return { kind: 'comparison', ...base, text: e.text, operator: e.operator, literal: e.literal, literalKind: e.literalKind as LiteralKind };
    case 'call':
      if (e.method === undefined) return undefined;
      return {
        kind: 'call',
        ...base,
        text: e.text,
        method: e.method,
        ...(e.qualifier !== undefined ? { qualifier: e.qualifier } : {}),
        ...(typeof e.consumer === 'string' ? { consumer: e.consumer } : {}),
        ...(Array.isArray(e.consumerTypes) && e.consumerTypes.length > 0 && e.consumerTypes.every(t => typeof t === 'string') ? { consumerTypes: e.consumerTypes } : {}),
        ...(e.inProse === true ? { inProse: true } : {}),
      };
    case 'binding':
      if (e.name === undefined || e.value === undefined) return undefined;
      return { kind: 'binding', ...base, name: e.name, value: e.value };
    case 'duration':
      if (typeof e.constructor !== 'string' || e.amount === undefined || !DURATION_UNITS.has(e.unit ?? '')) return undefined;
      return {
        kind: 'duration',
        ...base,
        ...(e.name !== undefined ? { name: e.name } : {}),
        constructor: e.constructor,
        unit: e.unit as DurationUnit,
        amount: e.amount,
      };
    case 'route':
      if (e.verb === undefined || e.route === undefined) return undefined;
      return { kind: 'route', ...base, verb: e.verb, route: e.route };
    default:
      return undefined;
  }
}

/** Replace the analyzer's module-relative file prefix in a symbol id with the project-relative one. */
function rewriteId(id: string, analyzerFile: string, projectFile: string): string {
  if (analyzerFile === projectFile) return id;
  return id.startsWith(`${analyzerFile}::`) ? `${projectFile}${id.slice(analyzerFile.length)}` : id;
}

/** Edge targets may live in any other file of the module — apply the global prefix shift. */
function rewriteIdAcrossModule(id: string, prefix: string): string {
  if (!prefix) return id;
  const sepIdx = id.indexOf('::');
  if (sepIdx <= 0) return id;
  return `${prefix}/${id}`;
}
