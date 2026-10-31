import type { z, ZodRawShape } from 'zod';
import type { CoChangeEntry, CommitChangeSet, FileIndex, SearchDocument, SearchResponse } from '../core/types.js';
import type { CtxoConfig } from '../core/config/config-schema.js';
import type { LoadedConfig } from '../core/config/load-config.js';
import type { SymbolGraph } from '../core/graph/symbol-graph.js';
import type { Logger } from '../core/logger.js';
import type { IHealthCheck } from '../core/diagnostics/types.js';
import type { IGitPort } from './i-git-port.js';

/**
 * The module API: what an opt-in module such as `@ctxo/domain` registers with the CLI, and the host
 * services it receives in return (ADR-018). Types only. A module imports these from `@ctxo/cli/internal`
 * with `import type`; every runtime service arrives through `CtxoHost.services`. The API changes only in
 * minor releases, and a module runs only when its `major.minor` equals the running CLI's.
 */

/** The 14 core MCP tools a module may enrich. */
export type CoreToolName =
  | 'get_logic_slice'
  | 'get_why_context'
  | 'get_change_intelligence'
  | 'get_blast_radius'
  | 'get_architectural_overlay'
  | 'find_dead_code'
  | 'get_context_for_task'
  | 'get_ranked_context'
  | 'search_symbols'
  | 'get_changed_symbols'
  | 'find_importers'
  | 'get_class_hierarchy'
  | 'get_symbol_importance'
  | 'get_pr_impact';

/**
 * Adds fields to a core tool's payload before the envelope, truncation and masking see it. Additive only:
 * it returns the payload with its fields added and never removes or rewrites the core's fields. Seven core
 * tools have the seam: `get_blast_radius`, `get_pr_impact` and `get_why_context` await a Promise result;
 * the synchronous `search_symbols`, `find_importers`, `get_logic_slice` and `get_context_for_task` cannot,
 * so for them a Promise result is dropped with a warning.
 */
export type ResponseEnricher = (
  payload: Record<string, unknown>,
  args: Readonly<Record<string, unknown>>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * The tokens a module keeps back from `get_context_for_task`'s budget for the fields its enricher adds,
 * given the tool's validated arguments. The core packs the code context into what is left; it rounds the
 * value and caps it at a quarter of the budget, and reserves nothing when it throws or is not finite.
 */
export type TokenReservation = (args: Readonly<Record<string, unknown>>) => number;

/**
 * A scope of `get_ranked_context` a module contributes (`scope: "<name>"`). The tool gains its `scope`
 * parameter only when a module provides one; `"code"`, the symbol ranking, stays the default. The CLI
 * validates `query` and `tokenBudget` (at least 100, default 4000), then wraps the result in the `_meta`
 * envelope and masks it. `strategy` and `searchMode` do not reach a module scope.
 */
export interface RankedContextScope {
  /** The scope name, never `code`. */
  readonly scope: string;
  /** One sentence appended to the `scope` parameter description, such as `"domain": card sections.` */
  readonly description: string;
  search(args: { readonly query: string; readonly tokenBudget: number }): Promise<Record<string, unknown>> | Record<string, unknown>;
}

/** An MCP tool a module contributes. The CLI wraps the handler with the envelope, masking and recording. */
export interface ModuleToolDefinition {
  readonly name: string;
  readonly description: string;
  /** A factory that receives the host's `zod`, so the module needs no zod dependency of its own. */
  readonly inputSchema: (zod: typeof z) => ZodRawShape;
  handler(args: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface ToolRegistrar {
  registerTool(tool: ModuleToolDefinition): void;
}

export interface ModuleCommandContext {
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readStdin(): Promise<string>;
}

/** A `ctxo <name>` command a module contributes. */
export interface ModuleCommand {
  readonly name: string;
  /** Usage lines for `ctxo <name> --help` and `ctxo --help`. */
  readonly help: readonly string[];
  /** The full usage for `ctxo <name> --help` (flags, exit codes); `help` is printed when absent. */
  readonly usage?: readonly string[];
  /** Left out of `ctxo --help` (hook commands). */
  readonly hidden?: boolean;
  /** Resolves to the exit code. */
  run(args: readonly string[], ctx: ModuleCommandContext): Promise<number>;
}

export interface CommandRegistrar {
  registerCommand(command: ModuleCommand): void;
}

/** Whether a repo-relative path (either separator) is a test file. It already holds the annotated files. */
export type TestFileCheck = (path: string) => boolean;

/** The raw commits of the configured co-change window, newest first, renames intact. */
export interface CoChangeWindowCommits {
  /** Short SHA of HEAD. */
  readonly head: string;
  /** HEAD's committer date in unix seconds. */
  readonly headCommittedAt: number;
  readonly commits: readonly CommitChangeSet[];
}

/** What a module's index pass receives at the end of `ctxo index`. */
export interface IndexPassContext {
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readonly config: CtxoConfig;
  /** The merged full index. */
  readonly indices: readonly FileIndex[];
  /** Built on first call, then reused. */
  graph(): SymbolGraph;
  readonly isTestFile: TestFileCheck;
  /** Raw window commits, renames intact; absent with --skip-history or without git. */
  readonly history?: CoChangeWindowCommits;
  /**
   * Set by `ctxo watch` only: whether its plugins were asked for facts. Watch decides it once at start, so a
   * module whose fact request changed since (a registry created while watch runs) can tell that the index lacks
   * facts. Absent under `ctxo index`, which asks for facts on every run that needs them.
   */
  readonly factsRequested?: boolean;
}

export interface InitFileResult {
  readonly file: string;
  readonly action: 'created' | 'updated' | 'skipped';
  readonly warning?: string;
}

export interface ClaudeHookEntry {
  readonly event: string;
  readonly matcher?: string;
  readonly command: string;
}

export interface InitPrompter {
  confirm(message: string, initial: boolean): Promise<boolean>;
  select<T extends string>(
    message: string,
    options: readonly { readonly value: T; readonly label: string }[],
    initial: T,
  ): Promise<T>;
}

export interface InitPartContext {
  readonly projectRoot: string;
  readonly toolIds: readonly string[];
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly boundaries?: 'by-rung' | 'report';
  /** Returns `initial` when not interactive or with --yes. */
  readonly prompt: InitPrompter;
  ensureConfigFile(): InitFileResult;
  ensureClaudeHookEntry(entry: ClaudeHookEntry): InitFileResult;
  installSkill(platformId: string, name: string, content: string): InitFileResult | undefined;
}

/** The part a module adds to `ctxo init`. */
export interface InitContribution {
  readonly part: 'domain';
  apply(ctx: InitPartContext): Promise<readonly InitFileResult[]>;
}

/** A literal value a fact detector treats as trivial (not worth a fact on its own). */
export type TrivialLiteral = number | string | boolean | null;

/**
 * Options a module hands the fact detectors of every plugin. The CLI passes them to each plugin as
 * `PluginContext.config.facts`, and only when facts are requested.
 */
export interface FactDetectorOptions {
  readonly trivialLiterals: readonly TrivialLiteral[];
  readonly normalizationMethods: readonly string[];
}

/**
 * A watched file's role for a module's index pass (`classifyWatchPath`): `input` refreshes after a short quiet
 * period, `source` counts towards `watch.snapshotMinFileChanges` like a re-indexed file.
 */
export type WatchPathKind = 'input' | 'source';

/** What a module contributes. Every member is optional; the CLI uses the ones present. */
export interface CtxoModuleRegistration {
  readonly id: 'domain';
  /**
   * Capabilities `ctxo index` and `ctxo watch` request from the plugins on the module's behalf. `factOptions`
   * reaches the plugins only with a fact request; the first module (load order) that declares them wins.
   */
  readonly indexCapabilities?: { readonly facts?: boolean; readonly factOptions?: FactDetectorOptions };
  indexPass?(ctx: IndexPassContext): Promise<void>;
  /**
   * How `ctxo watch` treats a changed repo-relative path (forward slashes) for this module's `indexPass`:
   * `input`, a file the pass reads itself (a registry, a card); `source`, a file whose change the pass also
   * depends on (an indexed file; `indexed` says whether a plugin handles it); undefined, a file the pass
   * ignores. Without it, `ctxo watch` never runs the module's pass. Called once per file event: keep it cheap.
   */
  classifyWatchPath?(path: string, indexed: boolean): WatchPathKind | undefined;
  /**
   * Whether the artifacts of `indexPass` are stale against the module's inputs (a cheap check). `ctxo watch`
   * asks once at start and runs one pass when true.
   */
  watchArtifactsStale?(): boolean;
  registerTools?(registrar: ToolRegistrar): void;
  readonly enrich?: Partial<Record<CoreToolName, ResponseEnricher>>;
  /** Tokens kept back from `get_context_for_task`'s budget for this module's enriched fields. */
  readonly reserveTaskContextTokens?: TokenReservation;
  /** Extra `get_ranked_context` scopes; a name already taken, or `code`, is skipped with a warning. */
  readonly rankedContextScopes?: readonly RankedContextScope[];
  registerCommands?(registrar: CommandRegistrar): void;
  readonly init?: InitContribution;
  readonly doctorChecks?: readonly IHealthCheck[];
}

/** A module the CLI loaded and registered: its package name, version and registration. */
export interface LoadedModule {
  readonly name: string;
  readonly version: string;
  readonly registration: CtxoModuleRegistration;
}

/** A built document index. Hits carry the document `id` in `symbolId`, its `title` in `name`, its `kind` and `path`. */
export interface DocumentSearch {
  search(query: string, limit?: number): SearchResponse;
}

/** The runtime services a module gets from the CLI instead of importing them. */
export interface CtxoHostServices {
  createLogger(namespace: string): Logger;
  loadConfig(ctxoRoot: string): LoadedConfig;
  /** The CLI's glob matcher: forward-slash normalised, dotfiles included. */
  makeGlobMatcher(patterns: readonly string[]): (path: string) => boolean;
  /** The classifier the contexts view uses: test globs, `index.tests`, test-framework annotations. */
  createTestFileCheck(config: CtxoConfig, indices: readonly FileIndex[]): TestFileCheck;
  createGit(projectRoot: string): IGitPort;
  readIndex(ctxoRoot: string): FileIndex[];
  buildGraph(indices: readonly FileIndex[]): SymbolGraph;
  /** The configured co-change window (`cochange.maxCommits`, `cochange.since`); undefined without git history. */
  readCoChangeWindow(projectRoot: string, config: CtxoConfig): Promise<CoChangeWindowCommits | undefined>;
  /**
   * The entries of `<ctxoRoot>/index/co-changes.json` as stored, one per file pair, validated and cached by
   * mtime like every other co-change read. Frozen and shared; undefined when the file is missing or invalid.
   */
  readCoChangeEntries(ctxoRoot: string): readonly CoChangeEntry[] | undefined;
  /** The nearest directory at or above `dir` that holds `.git`. */
  findGitRoot(dir: string): string | undefined;
  /** Short names of the attributes that mark a test (`Fact`, `Test`, `TestMethod`, ...): the classifier's own list. */
  readonly testFrameworkAnnotations: readonly string[];
  /** Symbol kinds that are data resources (`table`, `view`): plugin-api's own `DATA_RESOURCE_KINDS`, one source. */
  readonly dataResourceKinds: readonly string[];
  /**
   * A BM25 search over documents (the core engine: camelCase-aware, trigram and fuzzy fallback), built once.
   * Pass the documents in codepoint order (of `id`, say): equal scores keep the input order.
   */
  createDocumentSearch(documents: readonly SearchDocument[]): DocumentSearch;
  /** Splits an identifier into its words: `ILoanRepository` gives `I`, `Loan`, `Repository`; `member_account_id` gives `member`, `account`, `id`. */
  splitIdentifier(name: string): string[];
}

export interface CtxoHost {
  readonly cliVersion: string;
  readonly mode: 'mcp' | 'cli' | 'hook';
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readonly services: CtxoHostServices;
}

/** The `register` export of a module package. Resolves to undefined when the module declines to run. */
export type CtxoModuleRegister = (host: CtxoHost) => Promise<CtxoModuleRegistration | undefined>;
