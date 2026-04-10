import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHttpTransport } from './adapters/transport/http-server-transport.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './core/logger.js';
import { SqliteStorageAdapter } from './adapters/storage/sqlite-storage-adapter.js';
import { MaskingPipeline, type MaskingPatternConfig } from './core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from './adapters/mcp/get-logic-slice.js';
import { handleGetWhyContext } from './adapters/mcp/get-why-context.js';
import { handleGetChangeIntelligence } from './adapters/mcp/get-change-intelligence.js';
import { SimpleGitAdapter } from './adapters/git/simple-git-adapter.js';
import { handleGetBlastRadius } from './adapters/mcp/get-blast-radius.js';
import { handleGetArchitecturalOverlay } from './adapters/mcp/get-architectural-overlay.js';
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
import type { ISessionRecorderPort } from './ports/i-session-recorder-port.js';

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
  const configPath = join(ctxoRoot, 'config.yaml');
  if (!existsSync(configPath)) return true;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    // Simple YAML parsing for stats.enabled — avoid importing yaml package
    const match = raw.match(/stats:\s*\n\s*enabled:\s*(true|false)/);
    if (match) return match[1] !== 'false';
    return true;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // HTTP mode — check before CLI routing since --http is a server flag, not a CLI command
  const httpPortStr = process.env.CTXO_HTTP_PORT
    || (args.includes('--http') ? (args[args.indexOf('--port') + 1] || '3001') : null);

  if (!httpPortStr && args.length > 0) {
    // CLI mode
    const { CliRouter } = await import('./cli/cli-router.js');
    const router = new CliRouter(process.cwd());
    await router.route(args);
    return;
  }

  // Initialize adapters
  const ctxoRoot = '.ctxo';
  const storage = new SqliteStorageAdapter(ctxoRoot);
  await storage.init();

  const masking = loadMaskingConfig(ctxoRoot);
  const git = new SimpleGitAdapter(process.cwd());

  // Session recording (opt-out via config.yaml stats.enabled: false)
  const recorder: ISessionRecorderPort | null = readStatsEnabled(ctxoRoot)
    ? new SessionRecorderAdapter(storage.getDb(), () => storage.persist())
    : null;

  // Create MCP server
  const server = new McpServer({ name: 'ctxo', version: '0.1.0' });

  // Staleness detection
  const { StalenessDetector } = await import('./core/staleness/staleness-detector.js');
  const staleness = new StalenessDetector(process.cwd(), ctxoRoot);

  registerTools(server, storage, masking, git, staleness, recorder, ctxoRoot);

  // Start MCP server — HTTP mode or stdio mode
  if (httpPortStr) {
    await startHttpTransport(async () => {
      const s = new McpServer({ name: 'ctxo', version: '0.1.0' });
      registerTools(s, storage, masking, git, staleness, recorder, ctxoRoot);
      return s;
    }, parseInt(httpPortStr, 10));
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

function registerTools(
  server: McpServer,
  storage: SqliteStorageAdapter,
  masking: MaskingPipeline,
  git: SimpleGitAdapter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  staleness: any,
  recorder: ISessionRecorderPort | null,
  ctxoRoot = '.ctxo',
) {
  // Tool annotations — all Ctxo tools are read-only index queries
  const toolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  // Register tools — each handler wrapped with session recording
  const logicSliceHandler = withRecording('get_logic_slice', handleGetLogicSlice(storage, masking, staleness, ctxoRoot), recorder);
  const whyContextHandler = withRecording('get_why_context', handleGetWhyContext(storage, git, masking, staleness, ctxoRoot), recorder);
  const changeIntelligenceHandler = withRecording('get_change_intelligence', handleGetChangeIntelligence(storage, git, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_logic_slice',
    {
      description: 'Retrieve a symbol and all its transitive dependencies as a Logic-Slice. Use this when you need to UNDERSTAND what a symbol depends on (downstream view). L1=signature only, L2=direct deps, L3=full closure, L4=with token budget. Use `intent` to filter dependencies by keyword (e.g., "core", "adapter"). All responses include `_meta` with item counts and truncation info. For impact analysis (what BREAKS if this changes), use get_blast_radius instead. For task-specific context, use get_context_for_task.',
      inputSchema: {
        symbolId: z.string().optional().describe('Single symbol ID (format: file::name::kind)'),
        symbolIds: z.array(z.string()).optional().describe('Batch: array of symbol IDs'),
        level: z.number().min(1).max(4).optional().default(3).describe('Detail level (L1=signature, L2=direct deps, L3=full closure, L4=with token budget)'),
        intent: z.string().optional().describe('Filter dependencies by intent keywords (e.g., "core", "adapter")'),
      },
      annotations: toolAnnotations,
    },
    (args) => logicSliceHandler(args),
  );

  server.registerTool(
    'get_why_context',
    {
      description: 'Retrieve git commit history intent and anti-pattern warnings (reverts, rollbacks) for a symbol. Use this when you need to understand WHY code was written this way or whether it has a history of problems. Pair with get_change_intelligence for complexity/churn scores.',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
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

  const blastRadiusHandler = withRecording('get_blast_radius', handleGetBlastRadius(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_blast_radius',
    {
      description: 'BEFORE modifying any function or class, call this to understand impact. Returns all symbols that would break if the target changes, split into confirmed (direct importers), likely (co-changed), and potential (transitive) tiers with risk scores. Use `confidence` to filter by tier, `intent` to filter by keyword. Large results are auto-truncated with `_meta.hint` for drill-in. For what a symbol DEPENDS ON (downstream), use get_logic_slice instead. For full PR-level analysis, use get_pr_impact.',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        confidence: z.enum(['confirmed', 'likely', 'potential']).optional().describe('Filter by confidence tier'),
        intent: z.string().optional().describe('Filter impacted symbols by intent keywords (e.g., "test", "adapter")'),
      },
      annotations: toolAnnotations,
    },
    (args) => blastRadiusHandler(args),
  );

  const overlayHandler = withRecording('get_architectural_overlay', handleGetArchitecturalOverlay(storage, masking, staleness), recorder);

  server.registerTool(
    'get_architectural_overlay',
    {
      description: 'Get the project architectural layer map — identifies which symbols belong to Domain, Infrastructure, and Adapter layers. Use this when onboarding to a new codebase or validating that a change respects layer boundaries. For symbol-level analysis, use get_logic_slice or get_blast_radius.',
      inputSchema: {
        layer: z.string().optional().describe('Filter by specific layer name'),
      },
      annotations: toolAnnotations,
    },
    (args) => overlayHandler(args),
  );

  const deadCodeHandler = withRecording('find_dead_code', handleFindDeadCode(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'find_dead_code',
    {
      description: 'Find unreachable symbols and files that are never imported or called anywhere. Use this during cleanup, refactoring, or before deleting code to confirm it is truly unused. Use `intent` to filter results by keyword (e.g., "adapter", "function"). Large results are auto-truncated with `_meta`. For reverse dependency lookup of a specific symbol, use find_importers instead.',
      inputSchema: {
        includeTests: z.boolean().optional().default(false).describe('Include test files in analysis (default: exclude)'),
        intent: z.string().optional().describe('Filter dead code results by intent keywords (e.g., "adapter", "function")'),
      },
      annotations: toolAnnotations,
    },
    (args) => deadCodeHandler(args),
  );

  const contextForTaskHandler = withRecording('get_context_for_task', handleGetContextForTask(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_context_for_task',
    {
      description: 'Get task-optimized context for a symbol based on what you are about to do. Specify taskType: "fix" (bug investigation — includes history + anti-patterns), "extend" (add feature — includes deps + blast radius), "refactor" (restructure — includes importers + complexity), or "understand" (learn — includes full slice + architecture). This is the BEST starting point when you know both the symbol and your intent.',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        taskType: z.enum(['fix', 'extend', 'refactor', 'understand']).describe('Task type determines which context is most relevant'),
        tokenBudget: z.number().optional().default(4000).describe('Max tokens for context (default 4000)'),
      },
      annotations: toolAnnotations,
    },
    (args) => contextForTaskHandler(args),
  );

  const rankedContextHandler = withRecording('get_ranked_context', handleGetRankedContext(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_ranked_context',
    {
      description: 'Search and rank symbols by relevance to a natural language query, packed within a token budget. Uses BM25 text matching + PageRank importance scoring. Results include `_meta` with truncation info. Use this when you have a question or topic but do not know which specific symbol to look at. For exact symbol name search, use search_symbols instead.',
      inputSchema: {
        query: z.string().min(1).describe('Search query (matches symbol names)'),
        tokenBudget: z.number().optional().default(4000).describe('Max tokens for results (default 4000)'),
        strategy: z.enum(['combined', 'dependency', 'importance']).optional().default('combined').describe('Ranking strategy'),
      },
      annotations: toolAnnotations,
    },
    (args) => rankedContextHandler(args),
  );

  const searchSymbolsHandler = withRecording('search_symbols', handleSearchSymbols(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'search_symbols',
    {
      description: 'Search symbols by exact name or regex pattern across the codebase index. Use this when you know (part of) the symbol name and need to find its ID for use with other tools. For semantic/relevance-based search, use get_ranked_context instead.',
      inputSchema: {
        pattern: z.string().min(1).describe('Search pattern (substring or regex)'),
        kind: z.enum(['function', 'class', 'interface', 'method', 'variable', 'type']).optional().describe('Filter by symbol kind'),
        filePattern: z.string().optional().describe('Filter by file path substring'),
        limit: z.number().int().min(1).max(100).optional().default(25).describe('Max results (default 25)'),
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

  const findImportersHandler = withRecording('find_importers', handleFindImporters(storage, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'find_importers',
    {
      description: 'Find all symbols that import or depend on a given symbol (reverse dependency / "who uses this?"). Use this to check if a symbol is safe to modify or delete. Supports transitive traversal for deep impact chains. Use `intent` to filter by keyword (e.g., "test", "core"). For forward dependencies (what this symbol uses), use get_logic_slice. For aggregated impact with risk scores, use get_blast_radius.',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        edgeKinds: z.array(z.enum(['imports', 'calls', 'extends', 'implements', 'uses'])).optional().describe('Filter by edge kinds'),
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
        kind: z.enum(['function', 'class', 'interface', 'method', 'variable', 'type']).optional().describe('Filter by symbol kind'),
        filePattern: z.string().optional().describe('Filter by file path substring'),
        damping: z.number().min(0).max(1).optional().default(0.85).describe('PageRank damping factor (default 0.85)'),
      },
      annotations: toolAnnotations,
    },
    (args) => symbolImportanceHandler(args),
  );

  const prImpactHandler = withRecording('get_pr_impact', handleGetPrImpact(storage, git, masking, staleness, ctxoRoot), recorder);

  server.registerTool(
    'get_pr_impact',
    {
      description: 'Analyze the full impact of a PR or recent changes in a SINGLE call — combines changed symbols + blast radius + co-change history into one risk assessment. Results include `_meta` with truncation info. Use this FIRST when reviewing a PR or evaluating recent commits. For single-symbol analysis, use get_blast_radius instead.',
      inputSchema: {
        since: z.string().optional().default('HEAD~1').describe('Git ref to diff against (default HEAD~1)'),
        maxFiles: z.number().int().min(1).optional().default(50).describe('Max changed files to analyze'),
        confidence: z.enum(['confirmed', 'likely', 'potential']).optional().describe('Filter impacted symbols by confidence tier'),
      },
      annotations: toolAnnotations,
    },
    (args) => prImpactHandler(args),
  );

  // Register empty resource/prompt capabilities to prevent -32601 errors
  // from MCP clients that unconditionally call listResources/listPrompts
  server.resource('ctxo-status', 'ctxo://status', async (uri) => ({
    contents: [{ uri: uri.href, text: 'Ctxo MCP server is running.' }],
  }));
}

main().catch((err: unknown) => {
  log.error('Fatal: %s', (err as Error).message);
  process.exit(1);
});
