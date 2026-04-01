import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

function loadMaskingConfig(ctxoRoot: string): MaskingPipeline {
  const jsonConfigPath = join(ctxoRoot, 'masking.json');

  // Try JSON masking config first
  if (existsSync(jsonConfigPath)) {
    try {
      const raw = readFileSync(jsonConfigPath, 'utf-8');
      const patterns: MaskingPatternConfig[] = JSON.parse(raw);
      console.error(`[ctxo] Loaded ${patterns.length} custom masking pattern(s)`);
      return MaskingPipeline.fromConfig(patterns);
    } catch (err) {
      console.error(`[ctxo] Failed to load masking config: ${(err as Error).message}`);
    }
  }

  return new MaskingPipeline();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
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

  // Create MCP server
  const server = new McpServer({ name: 'ctxo', version: '0.1.0' });

  // Staleness detection
  const { StalenessDetector } = await import('./core/staleness/staleness-detector.js');
  const staleness = new StalenessDetector(process.cwd(), ctxoRoot);

  // Register tools
  const logicSliceHandler = handleGetLogicSlice(storage, masking, staleness, ctxoRoot);
  const whyContextHandler = handleGetWhyContext(storage, git, masking, staleness, ctxoRoot);
  const changeIntelligenceHandler = handleGetChangeIntelligence(storage, git, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_logic_slice',
    {
      description: 'Retrieve a Logic-Slice for a named symbol — the symbol plus all transitive dependencies',
      inputSchema: {
        symbolId: z.string().optional().describe('Single symbol ID (format: file::name::kind)'),
        symbolIds: z.array(z.string()).optional().describe('Batch: array of symbol IDs'),
        level: z.number().min(1).max(4).optional().default(3).describe('Detail level (L1=signature, L2=direct deps, L3=full closure, L4=with token budget)'),
      },
    },
    (args) => logicSliceHandler(args),
  );

  server.registerTool(
    'get_why_context',
    {
      description: 'Retrieve git commit intent, anti-pattern warnings from revert history for a symbol',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        maxCommits: z.number().int().min(1).optional().describe('Limit commit history to N most recent commits'),
      },
    },
    (args) => whyContextHandler(args),
  );

  server.registerTool(
    'get_change_intelligence',
    {
      description: 'Retrieve complexity x churn composite score for a symbol',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
      },
    },
    (args) => changeIntelligenceHandler(args),
  );

  const blastRadiusHandler = handleGetBlastRadius(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_blast_radius',
    {
      description: 'Retrieve the blast radius for a symbol — symbols that would break if it changed',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
      },
    },
    (args) => blastRadiusHandler(args),
  );

  const overlayHandler = handleGetArchitecturalOverlay(storage, masking, staleness);

  server.registerTool(
    'get_architectural_overlay',
    {
      description: 'Retrieve an architectural overlay — layer map identifying Domain, Infrastructure, and Adapter boundaries',
      inputSchema: {
        layer: z.string().optional().describe('Filter by specific layer name'),
      },
    },
    (args) => overlayHandler(args),
  );

  const deadCodeHandler = handleFindDeadCode(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'find_dead_code',
    {
      description: 'Find unreachable symbols and files — dead code that is never imported or called',
      inputSchema: {
        includeTests: z.boolean().optional().default(false).describe('Include test files in analysis (default: exclude)'),
      },
    },
    (args) => deadCodeHandler(args),
  );

  const contextForTaskHandler = handleGetContextForTask(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_context_for_task',
    {
      description: 'Get task-aware context for a symbol — optimized for fix, extend, refactor, or understand workflows',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        taskType: z.enum(['fix', 'extend', 'refactor', 'understand']).describe('Task type determines which context is most relevant'),
        tokenBudget: z.number().optional().default(4000).describe('Max tokens for context (default 4000)'),
      },
    },
    (args) => contextForTaskHandler(args),
  );

  const rankedContextHandler = handleGetRankedContext(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_ranked_context',
    {
      description: 'Search and rank symbols by relevance to a query, packed within a token budget',
      inputSchema: {
        query: z.string().min(1).describe('Search query (matches symbol names)'),
        tokenBudget: z.number().optional().default(4000).describe('Max tokens for results (default 4000)'),
        strategy: z.enum(['combined', 'dependency', 'importance']).optional().default('combined').describe('Ranking strategy'),
      },
    },
    (args) => rankedContextHandler(args),
  );

  const searchSymbolsHandler = handleSearchSymbols(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'search_symbols',
    {
      description: 'Search symbols by name or regex pattern across the codebase index',
      inputSchema: {
        pattern: z.string().min(1).describe('Search pattern (substring or regex)'),
        kind: z.enum(['function', 'class', 'interface', 'method', 'variable', 'type']).optional().describe('Filter by symbol kind'),
        filePattern: z.string().optional().describe('Filter by file path substring'),
        limit: z.number().int().min(1).max(100).optional().default(25).describe('Max results (default 25)'),
      },
    },
    (args) => searchSymbolsHandler(args),
  );

  const changedSymbolsHandler = handleGetChangedSymbols(storage, git, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_changed_symbols',
    {
      description: 'Get symbols in recently changed files (git diff based)',
      inputSchema: {
        since: z.string().optional().default('HEAD~1').describe('Git ref to diff against (default HEAD~1)'),
        maxFiles: z.number().int().min(1).optional().default(50).describe('Max changed files to process (default 50)'),
      },
    },
    (args) => changedSymbolsHandler(args),
  );

  const findImportersHandler = handleFindImporters(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'find_importers',
    {
      description: 'Find all symbols that import or depend on a given symbol (reverse dependency lookup)',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        edgeKinds: z.array(z.enum(['imports', 'calls', 'extends', 'implements', 'uses'])).optional().describe('Filter by edge kinds'),
        transitive: z.boolean().optional().default(false).describe('Follow transitive reverse edges (default false)'),
        maxDepth: z.number().int().min(1).max(10).optional().default(5).describe('Max BFS depth for transitive mode (default 5)'),
      },
    },
    (args) => findImportersHandler(args),
  );

  const classHierarchyHandler = handleGetClassHierarchy(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_class_hierarchy',
    {
      description: 'Get class inheritance hierarchy — ancestors (extends/implements) and descendants',
      inputSchema: {
        symbolId: z.string().min(1).optional().describe('Root symbol ID (omit for full project hierarchy)'),
        direction: z.enum(['ancestors', 'descendants', 'both']).optional().default('both').describe('Traversal direction (default both)'),
      },
    },
    (args) => classHierarchyHandler(args),
  );

  const symbolImportanceHandler = handleGetSymbolImportance(storage, masking, staleness, ctxoRoot);

  server.registerTool(
    'get_symbol_importance',
    {
      description: 'Rank symbols by importance using PageRank centrality on the dependency graph',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().default(25).describe('Max results (default 25)'),
        kind: z.enum(['function', 'class', 'interface', 'method', 'variable', 'type']).optional().describe('Filter by symbol kind'),
        filePattern: z.string().optional().describe('Filter by file path substring'),
        damping: z.number().min(0).max(1).optional().default(0.85).describe('PageRank damping factor (default 0.85)'),
      },
    },
    (args) => symbolImportanceHandler(args),
  );

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[ctxo] Fatal:', (err as Error).message);
  process.exit(1);
});
