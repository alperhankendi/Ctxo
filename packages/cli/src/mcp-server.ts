/**
 * The MCP composition root (ADR-018): wires the storage, git, masking and recording adapters to the 14
 * tool handlers and starts the server on stdio or HTTP. The entry (`index.ts`) imports this file only when
 * it starts the server, so the CLI commands and the hook route never load the MCP SDK.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHttpTransport } from './adapters/transport/http-server-transport.js';
import { z, type ZodRawShape } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './core/logger.js';
import { SymbolKindSchema, EdgeKindSchema } from './core/types.js';
import { SqliteStorageAdapter } from './adapters/storage/sqlite-storage-adapter.js';
import { CoChangeReader } from './adapters/storage/co-change-reader.js';
import { MaskingPipeline, type MaskingPatternConfig } from './core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from './adapters/mcp/get-logic-slice.js';
import { handleGetWhyContext } from './adapters/mcp/get-why-context.js';
import { handleGetChangeIntelligence } from './adapters/mcp/get-change-intelligence.js';
import { SimpleGitAdapter } from './adapters/git/simple-git-adapter.js';
import { handleGetBlastRadius } from './adapters/mcp/get-blast-radius.js';
import { handleGetArchitecturalOverlay, OVERLAY_MODES } from './adapters/mcp/get-architectural-overlay.js';
import { ContextsViewReader } from './adapters/storage/contexts-view-reader.js';
import { handleFindDeadCode } from './adapters/mcp/get-dead-code.js';
import { handleGetContextForTask } from './adapters/mcp/get-context-for-task.js';
import { handleGetRankedContext } from './adapters/mcp/get-ranked-context.js';
import { handleSearchSymbols } from './adapters/mcp/search-symbols.js';
import { handleGetChangedSymbols } from './adapters/mcp/get-changed-symbols.js';
import { handleFindImporters } from './adapters/mcp/find-importers.js';
import { handleGetClassHierarchy } from './adapters/mcp/get-class-hierarchy.js';
import { handleGetSymbolImportance } from './adapters/mcp/get-symbol-importance.js';
import { handleGetPrImpact } from './adapters/mcp/get-pr-impact.js';
import { SessionRecorderAdapter } from './adapters/stats/session-recorder-adapter.js';
import { withRecording } from './adapters/stats/with-recording.js';
import { collectEnrichers, collectTaskContextReservation } from './adapters/mcp/enrich-payload.js';
import { CORE_TOOL_NAMES, collectModuleTools, handleModuleTool, moduleInputShape } from './adapters/mcp/module-tool-handler.js';
import { CODE_SCOPE, collectRankedScopes, rankedScopeDescription, rankedScopeNames, withRankedScopes } from './adapters/mcp/ranked-scope-handler.js';
import type { StalenessCheck } from './adapters/mcp/get-logic-slice.js';
import type { LoadedModule } from './adapters/modules/module-loader.js';
import type { ISessionRecorderPort } from './ports/i-session-recorder-port.js';
import type { ICoChangePort } from './ports/i-co-change-port.js';
import type { IStoragePort } from './ports/i-storage-port.js';
import type { IGitPort } from './ports/i-git-port.js';
import type { IMaskingPort } from './ports/i-masking-port.js';
import { detectWorkspace } from './adapters/workspace/single-package-workspace.js';
import { setWorkspaceMeta } from './core/response-envelope.js';
import { loadConfig, maskingClusterLabelPatterns, statsEnabled } from './core/config/load-config.js';
import { ClusterLabelMasker } from './core/overlay/cluster-label-masker.js';
import { loadModulesFor } from './cli/module-commands.js';

const log = createLogger('ctxo:mcp');

function loadMaskingConfig(ctxoRoot: string): MaskingPipeline {
  const jsonConfigPath = join(ctxoRoot, 'masking.json');

  // Try JSON masking config first
  if (existsSync(jsonConfigPath)) {
    try {
      const raw = readFileSync(jsonConfigPath, 'utf-8');
      const patterns: MaskingPatternConfig[] = JSON.parse(raw);
      log.info(`Loaded ${patterns.length} custom masking pattern(s)`);
      return MaskingPipeline.fromConfig(patterns);
    } catch (err) {
      log.error(`Failed to load masking config: ${(err as Error).message}`);
    }
  }

  return new MaskingPipeline();
}

function readStatsEnabled(ctxoRoot: string): boolean {
  return statsEnabled(loadConfig(ctxoRoot).config);
}

const PKG_VERSION: string = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export interface StartMcpServerOptions {
  /** Serve over HTTP on this port; stdio when absent. */
  readonly httpPort?: number;
}

/** Starts the MCP server for the project in the working directory, over HTTP or stdio. */
export async function startMcpServer(options: StartMcpServerOptions = {}): Promise<void> {
  // Initialize adapters
  const ctxoRoot = '.ctxo';
  const workspace = detectWorkspace(process.cwd());
  setWorkspaceMeta({ root: workspace.root });
  const storage = new SqliteStorageAdapter(ctxoRoot, { allowProductionPath: true });
  await storage.init();

  const masking = loadMaskingConfig(ctxoRoot);
  const clusterLabelMasker = new ClusterLabelMasker(
    maskingClusterLabelPatterns(loadConfig(ctxoRoot).config),
  );
  const git = new SimpleGitAdapter(process.cwd());
  // One reader for the whole server (every HTTP session too): it caches the co-change matrix by mtime.
  const coChange = new CoChangeReader(ctxoRoot);

  // Session recording (opt-out via config.yaml stats.enabled: false)
  const recorder: ISessionRecorderPort | null = readStatsEnabled(ctxoRoot)
    ? new SessionRecorderAdapter(storage.getDb(), () => storage.persist())
    : null;

  // Create MCP server
  const server = new McpServer({ name: 'ctxo', version: PKG_VERSION });

  // Staleness detection
  const { StalenessDetector } = await import('./core/staleness/staleness-detector.js');
  const staleness = new StalenessDetector(process.cwd(), ctxoRoot);

  // Opt-in modules (@ctxo/domain), loaded once for the server and every HTTP session. The project root is
  // the directory whose .ctxo the server reads. Never rejects: without a module the core runs unchanged.
  const modules = await loadModulesFor(workspace.root, 'mcp');

  registerTools(server, storage, masking, git, staleness, recorder, ctxoRoot, clusterLabelMasker, coChange, modules);

  // Start MCP server — HTTP mode or stdio mode
  if (options.httpPort !== undefined) {
    await startHttpTransport(async () => {
      const s = new McpServer({ name: 'ctxo', version: PKG_VERSION });
      registerTools(s, storage, masking, git, staleness, recorder, ctxoRoot, clusterLabelMasker, coChange, modules);
      return s;
    }, options.httpPort);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

/**
 * Registers the 14 core tools, then the tools of the loaded modules, on `server`. A module's enrichers
 * reach the seven core tools with an enrich seam, their token reservations reach get_context_for_task and
 * their ranked-context scopes reach get_ranked_context (its `scope` parameter exists only then); a module tool named like a core tool, or one whose input schema cannot be built, is skipped with a
 * warning. Exported for tests.
 */
export function registerTools(
  server: McpServer,
  storage: IStoragePort,
  masking: IMaskingPort,
  git: IGitPort,
  staleness: StalenessCheck | undefined,
  recorder: ISessionRecorderPort | null,
  ctxoRoot = '.ctxo',
  clusterLabelMasker?: ClusterLabelMasker,
  coChange?: ICoChangePort,
  modules: readonly LoadedModule[] = [],
): void {
  const enrichers = collectEnrichers(modules);
  const taskContextReservation = collectTaskContextReservation(modules);
  const rankedScopes = collectRankedScopes(modules);

  // Tool annotations — all Ctxo tools are read-only index queries
  const toolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  // The tools that resolve a symbol id through the graph also take the 2-part id of a SQL object.
  const SYMBOL_ID_FORMAT = 'format: file::name::kind; a SQL table, view or procedure also as name::kind, for example dbo.loans::table';

  // Register tools — each handler wrapped with session recording
  const logicSliceHandler = withRecording('get_logic_slice', handleGetLogicSlice(storage, masking, staleness, ctxoRoot, enrichers.get('get_logic_slice')), recorder);
  const whyContextHandler = withRecording('get_why_context', handleGetWhyContext(storage, git, masking, staleness, ctxoRoot, clusterLabelMasker, enrichers.get('get_why_context')), recorder);
  const changeIntelligenceHandler = withRecording('get_change_intelligence', handleGetChangeIntelligence(storage, git, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_logic_slice',
    {
      description: 'Retrieve a symbol and all its transitive dependencies as a Logic-Slice. Use this when you need to UNDERSTAND what a symbol depends on (downstream view). L1=signature only, L2=direct deps, L3=full closure, L4=with token budget and symbol annotations (attributes, columns; only L4 includes them). Use `intent` to filter dependencies by keyword (e.g., "core", "adapter"). All responses include `_meta` with item counts and truncation info. For impact analysis (what BREAKS if this changes), use get_blast_radius instead. For task-specific context, use get_context_for_task. With @ctxo/domain and a registry, the root symbol carries `context` (its named context id).',
      inputSchema: {
        symbolId: z.string().optional().describe(`Single symbol ID (${SYMBOL_ID_FORMAT})`),
        symbolIds: z.array(z.string()).optional().describe('Batch: array of symbol IDs'),
        level: z.number().min(1).max(4).optional().default(3).describe('Detail level (L1=signature, L2=direct deps, L3=full closure, L4=with token budget and annotations)'),
        intent: z.string().optional().describe('Filter dependencies by intent keywords (e.g., "core", "adapter")'),
      },
      annotations: toolAnnotations,
    },
    (args) => logicSliceHandler(args),
  );

  server.registerTool(
    'get_why_context',
    {
      description: 'Retrieve git commit history intent and anti-pattern warnings (reverts, rollbacks) for a symbol. Use this when you need to understand WHY code was written this way or whether it has a history of problems. Pair with get_change_intelligence for complexity/churn scores. With @ctxo/domain and a registry, `contextDrift` reports the named context of the symbol: its share of cross-context edges over time and files that moved between contexts. With @ctxo/domain and a domain graph, `decisions` lists up to five card decisions of the context of the symbol with their provenance, those naming a rule linked to the symbol first.',
      inputSchema: {
        symbolId: z.string().min(1).describe(`The symbol ID (${SYMBOL_ID_FORMAT})`),
        maxCommits: z.number().int().min(1).optional().describe('Limit commit history to N most recent commits'),
      },
      annotations: toolAnnotations,
    },
    (args) => whyContextHandler(args),
  );

  server.registerTool(
    'get_change_intelligence',
    {
      description: 'Retrieve complexity x churn composite score for a symbol — identifies hotspots that are both complex and frequently changed. Use this to prioritize refactoring targets or assess risk before modifying code. For git history details, use get_why_context. For impact scope, use get_blast_radius.',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
      },
      annotations: toolAnnotations,
    },
    (args) => changeIntelligenceHandler(args),
  );

  const blastRadiusHandler = withRecording('get_blast_radius', handleGetBlastRadius(storage, masking, staleness, ctxoRoot, git, clusterLabelMasker, coChange, enrichers.get('get_blast_radius')), recorder);

  server.registerTool(
    'get_blast_radius',
    {
      description: 'BEFORE modifying any symbol (a function, class, method or type, or a SQL table, view or procedure), call this to understand impact. Returns every symbol that depends on the target, directly or transitively, with risk scores that fall with depth. `overallRiskScore` is `sum / (sum + 5)` over those scores and never reaches 1: above 0.7 is high (about 12 direct dependents), above 0.3 medium (about 3). Each dependent is in the tier of its strongest edge: confirmed (`calls`, `extends`, `implements` and the data edges `reads`, `writes`, `executes`), likely (co-changed or `uses`), and potential (`imports`). When co-change history exists, `coChangedFiles` lists up to 10 files that often change together with the target\'s file but have no dependency path to it (informational: not counted in the tiers or risk scores). Use `confidence` to filter by tier, `intent` to filter by keyword. Large results are auto-truncated with `_meta.hint` for drill-in. For what a symbol DEPENDS ON (downstream), use get_logic_slice instead. For full PR-level analysis, use get_pr_impact. With @ctxo/domain and a registry, each impacted symbol carries `context` (its named context id). With @ctxo/domain and a domain graph (built by `ctxo index`), `rulesAffected` lists the card rules linked to the symbol or its dependents, and `cardsToUpdate` the cards that hold them.',
      inputSchema: {
        symbolId: z.string().min(1).describe(`The symbol ID (${SYMBOL_ID_FORMAT}). Every definition of a SQL object, and its name::kind id, has the same dependents`),
        confidence: z.enum(['confirmed', 'likely', 'potential']).optional().describe('Filter by confidence tier'),
        intent: z.string().optional().describe('Filter impacted symbols by intent keywords (e.g., "test", "adapter")'),
      },
      annotations: toolAnnotations,
    },
    (args) => blastRadiusHandler(args),
  );

  const overlayHandler = withRecording('get_architectural_overlay', handleGetArchitecturalOverlay(storage, masking, staleness, git, clusterLabelMasker, new ContextsViewReader(ctxoRoot)), recorder);

  server.registerTool(
    'get_architectural_overlay',
    {
      description: 'Get the project architecture map. mode "both" (default) returns the regex layer map (Domain, Infrastructure, Adapter, Test, Composition, Configuration) plus data-driven Louvain communities; "regex" or "communities" returns one of them. mode "contexts" returns candidate bounded contexts computed by `ctxo index`: file-level clusters of dependencies and co-change with hub files damped. The summary lists every candidate with label, size, cohesion and top terms, plus hubs and name collisions (type names whose shapes differ between candidates). Use this when onboarding to a new codebase, validating layer boundaries, or preparing a context map. For symbol-level analysis, use get_logic_slice or get_blast_radius. Pass candidate: <id> for one candidate in full: its files, cross-candidate edges, co-change pairs, hubs and collisions. The summary also gives each candidate\'s sharedTableCount and the totals dataResourcesTotal, sharedResourcesTotal and externalResourcesTotal. With candidate: <id>, the detail adds sharedTables (SQL tables and views that files of this candidate and at least one other read or write, with access modes per candidate; up to the first 15 by name, each with up to 10 accesses) and the candidate\'s own dataResources (up to the first 15 by name, each with its access modes, writer count, the owning candidate when only one writes it, and an external flag for resources that no .sql file defines). Both lists hold fewer entries when the response limit requires; sharedTableCount and dataResourcesTotal keep the full counts, and ctxo contexts --json has the full lists.',
      inputSchema: {
        layer: z.string().optional().describe('Filter by specific layer name'),
        mode: z.enum(OVERLAY_MODES).optional().describe('View to return: "both" (default) layers plus communities, "regex" layer map, "communities" Louvain clusters, "contexts" candidate contexts (file level)'),
        candidate: z.number().int().positive().optional().describe('With mode "contexts": the id of one candidate to return in full (files, terms, cross edges, co-change pairs, its hubs and collisions); omit for the summary of all candidates'),
      },
      annotations: toolAnnotations,
    },
    (args) => overlayHandler(args),
  );

  const deadCodeHandler = withRecording('find_dead_code', handleFindDeadCode(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'find_dead_code',
    {
      description: 'Find unreachable symbols and files that are never imported or called anywhere. Use this during cleanup, refactoring, or before deleting code to confirm it is truly unused. Symbols in .sql files are never reported. Use `intent` to filter results by keyword (e.g., "adapter", "function"). Large results are auto-truncated with `_meta`. For reverse dependency lookup of a specific symbol, use find_importers instead.',
      inputSchema: {
        includeTests: z.boolean().optional().default(false).describe('Include test files (default test globs and files with a test-framework annotation such as @Test) in analysis (default: exclude)'),
        intent: z.string().optional().describe('Filter dead code results by intent keywords (e.g., "adapter", "function")'),
      },
      annotations: toolAnnotations,
    },
    (args) => deadCodeHandler(args),
  );

  const contextForTaskHandler = withRecording('get_context_for_task', handleGetContextForTask(storage, masking, staleness, ctxoRoot, coChange, enrichers.get('get_context_for_task'), taskContextReservation), recorder);

  server.registerTool(
    'get_context_for_task',
    {
      description: 'Get task-optimized context for a symbol based on what you are about to do. Specify taskType: "fix" (bug investigation - includes history + anti-patterns), "extend" (add feature - includes deps + blast radius), "refactor" (restructure - includes importers + complexity), or "understand" (learn - includes full slice + architecture). Context entries that depend on the symbol (its blast radius) carry an optional `confidence` tier: confirmed, likely or potential, where co-change history can raise potential to likely. This is the BEST starting point when you know both the symbol and your intent. With @ctxo/domain and a domain graph, `cardExcerpt` adds the card rules linked to the symbol and its neighbours, the terms of its context and its contracts within `tokenBudget` (left out when even an empty excerpt does not fit).',
      inputSchema: {
        symbolId: z.string().min(1).describe(`The symbol ID (${SYMBOL_ID_FORMAT})`),
        taskType: z.enum(['fix', 'extend', 'refactor', 'understand']).describe('Task type determines which context is most relevant'),
        tokenBudget: z.number().optional().default(4000).describe('Max tokens for context (default 4000)'),
      },
      annotations: toolAnnotations,
    },
    (args) => contextForTaskHandler(args),
  );

  // Module scopes wrap the unchanged code handler inside the recording, so their calls are recorded under
  // get_ranked_context. The `scope` parameter exists only when a module provides a scope.
  const rankedContextHandler = withRecording('get_ranked_context', withRankedScopes(handleGetRankedContext(storage, masking, staleness, ctxoRoot), rankedScopes, masking), recorder);
  const rankedScopeShape: ZodRawShape =
    rankedScopes.size === 0
      ? {}
      : {
          scope: z
            .enum([CODE_SCOPE, ...rankedScopeNames(rankedScopes)] as [string, ...string[]])
            .optional()
            .default(CODE_SCOPE)
            .describe(rankedScopeDescription(rankedScopes)),
        };

  server.registerTool(
    'get_ranked_context',
    {
      description: 'Search and rank symbols by relevance to a natural language query, packed within a token budget. Uses BM25 text matching + PageRank importance scoring. Results include `_meta` with truncation info. Use this when you have a question or topic but do not know which specific symbol to look at. For exact symbol name search, use search_symbols instead.',
      inputSchema: {
        query: z.string().min(1).describe('Search query (matches symbol names)'),
        tokenBudget: z.number().optional().default(4000).describe('Max tokens for results (default 4000)'),
        strategy: z.enum(['combined', 'dependency', 'importance']).optional().default('combined').describe('Ranking strategy'),
        searchMode: z.enum(['fts', 'legacy']).optional().default('fts').describe('"fts" (default): BM25 ranking with camelCase splitting, trigram fallback and typo correction; "legacy": substring matching; strategy "importance" always uses legacy matching'),
        ...rankedScopeShape,
      },
      annotations: toolAnnotations,
    },
    (args) => rankedContextHandler(args),
  );

  const searchSymbolsHandler = withRecording('search_symbols', handleSearchSymbols(storage, masking, staleness, ctxoRoot, undefined, enrichers.get('search_symbols')), recorder);

  server.registerTool(
    'search_symbols',
    {
      description: 'Search symbols by exact name or regex pattern across the codebase index. Use this when you know (part of) the symbol name and need to find its ID for use with other tools. For semantic/relevance-based search, use get_ranked_context instead. With @ctxo/domain and a registry, each result carries `context` (its named context id).',
      inputSchema: {
        pattern: z.string().min(1).describe('Search pattern (substring or regex)'),
        kind: SymbolKindSchema.optional().describe('Filter by symbol kind (table, view and procedure come from SQL plugins)'),
        filePattern: z.string().optional().describe('Filter by file path substring'),
        limit: z.number().int().min(1).max(100).optional().default(25).describe('Max results (default 25)'),
        mode: z.enum(['regex', 'fts']).optional().default('regex').describe('"regex" (default): case-insensitive regex or substring match on names; "fts": BM25 relevance search'),
      },
      annotations: toolAnnotations,
    },
    (args) => searchSymbolsHandler(args),
  );

  const changedSymbolsHandler = withRecording('get_changed_symbols', handleGetChangedSymbols(storage, git, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_changed_symbols',
    {
      description: 'Get symbols in recently changed files based on git diff. Use this to see what was modified in recent commits. For full PR risk assessment (changed symbols + blast radius + co-changes), use get_pr_impact instead.',
      inputSchema: {
        since: z.string().optional().default('HEAD~1').describe('Git ref to diff against (default HEAD~1)'),
        maxFiles: z.number().int().min(1).optional().default(50).describe('Max changed files to process (default 50)'),
      },
      annotations: toolAnnotations,
    },
    (args) => changedSymbolsHandler(args),
  );

  const findImportersHandler = withRecording('find_importers', handleFindImporters(storage, masking, staleness, ctxoRoot, enrichers.get('find_importers')), recorder);

  server.registerTool(
    'find_importers',
    {
      description: 'Find all symbols that import or depend on a given symbol (reverse dependency / "who uses this?"). Use this to check if a symbol is safe to modify or delete. Supports transitive traversal for deep impact chains. Use `intent` to filter by keyword (e.g., "test", "core"). For forward dependencies (what this symbol uses), use get_logic_slice. For aggregated impact with risk scores, use get_blast_radius. With @ctxo/domain and a registry, each importer carries `context` (its named context id).',
      inputSchema: {
        symbolId: z.string().min(1).describe(`The symbol ID (${SYMBOL_ID_FORMAT}). Every definition of a SQL object, and its name::kind id, has the same importers`),
        edgeKinds: z.array(EdgeKindSchema).optional().describe('Filter by edge kinds (reads, writes and executes are data access)'),
        transitive: z.boolean().optional().default(false).describe('Follow transitive reverse edges (default false)'),
        maxDepth: z.number().int().min(1).max(10).optional().default(5).describe('Max BFS depth for transitive mode (default 5)'),
        intent: z.string().optional().describe('Filter importers by intent keywords (e.g., "test", "core", "adapter")'),
      },
      annotations: toolAnnotations,
    },
    (args) => findImportersHandler(args),
  );

  const classHierarchyHandler = withRecording('get_class_hierarchy', handleGetClassHierarchy(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_class_hierarchy',
    {
      description: 'Get class inheritance hierarchy — ancestors (extends/implements chain) and descendants (subclasses). Use this when working with OOP code to understand type relationships before modifying a base class or interface. For dependency-based relationships (imports/calls), use get_logic_slice or find_importers.',
      inputSchema: {
        symbolId: z.string().min(1).optional().describe('Root symbol ID (omit for full project hierarchy)'),
        direction: z.enum(['ancestors', 'descendants', 'both']).optional().default('both').describe('Traversal direction (default both)'),
      },
      annotations: toolAnnotations,
    },
    (args) => classHierarchyHandler(args),
  );

  const symbolImportanceHandler = withRecording('get_symbol_importance', handleGetSymbolImportance(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_symbol_importance',
    {
      description: 'Rank symbols by structural importance using PageRank centrality on the dependency graph. Use this to identify the most critical symbols in the codebase — high-PageRank symbols are heavily depended upon and risky to change. For finding unused/unimportant code, use find_dead_code instead.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().default(25).describe('Max results (default 25)'),
        kind: SymbolKindSchema.optional().describe('Filter by symbol kind (table, view and procedure come from SQL plugins)'),
        filePattern: z.string().optional().describe('Filter by file path substring'),
        damping: z.number().min(0).max(1).optional().default(0.85).describe('PageRank damping factor (default 0.85)'),
      },
      annotations: toolAnnotations,
    },
    (args) => symbolImportanceHandler(args),
  );

  const prImpactHandler = withRecording('get_pr_impact', handleGetPrImpact(storage, git, masking, staleness, ctxoRoot, clusterLabelMasker, coChange, enrichers.get('get_pr_impact')), recorder);

  server.registerTool(
    'get_pr_impact',
    {
      description: 'Analyze the full impact of a PR or recent changes in a SINGLE call: combines changed symbols + blast radius + co-change history into one risk assessment. `riskLevel` is high when a changed symbol\'s blast-radius `overallRiskScore` is above 0.7 (about 12 direct dependents), medium above 0.3 (about 3), else low. Results include `_meta` with truncation info. Use this FIRST when reviewing a PR or evaluating recent commits. For single-symbol analysis, use get_blast_radius instead. With @ctxo/domain and a registry, changed symbols carry `context` and `contextBoundaryViolations` lists edges that touch them and cross a context boundary outside its contracts. With @ctxo/domain and a domain graph, `contextsTouched` (the commits after the merge base of `since` and HEAD, plus the working tree), `cardsChanged` and `rulesWithoutTests` report the named contexts the change touched, the cards it changed and their rules without a test link.',
      inputSchema: {
        since: z.string().optional().default('HEAD~1').describe('Git ref to diff against (default HEAD~1)'),
        maxFiles: z.number().int().min(1).optional().default(50).describe('Max changed files to analyze'),
        confidence: z.enum(['confirmed', 'likely', 'potential']).optional().describe('Filter impacted symbols by confidence tier'),
      },
      annotations: toolAnnotations,
    },
    (args) => prImpactHandler(args),
  );

  // Module tools (ADR-018) come after the core tools, with the same annotations and session recording; the
  // handler adds the envelope, masking and the staleness warning. A tool that fails to register is skipped.
  const indexedFiles = () => storage.listIndexedFiles();
  for (const tool of collectModuleTools(modules, CORE_TOOL_NAMES)) {
    try {
      const moduleToolHandler = withRecording(tool.name, handleModuleTool(tool, masking, staleness, indexedFiles), recorder);
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: moduleInputShape(tool, z), annotations: toolAnnotations },
        (args) => moduleToolHandler(args),
      );
    } catch (err) {
      log.warn(`Module tool "${tool.name}" was not registered: ${(err as Error).message}`);
    }
  }

  // Register empty resource/prompt capabilities to prevent -32601 errors
  // from MCP clients that unconditionally call listResources/listPrompts
  server.resource('ctxo-status', 'ctxo://status', async (uri) => ({
    contents: [{ uri: uri.href, text: 'Ctxo MCP server is running.' }],
  }));
}
