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

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[ctxo] Fatal:', (err as Error).message);
  process.exit(1);
});
