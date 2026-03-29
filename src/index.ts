import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SqliteStorageAdapter } from './adapters/storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from './core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from './adapters/mcp/get-logic-slice.js';
import { handleGetWhyContext } from './adapters/mcp/get-why-context.js';
import { handleGetChangeIntelligence } from './adapters/mcp/get-change-intelligence.js';
import { SimpleGitAdapter } from './adapters/git/simple-git-adapter.js';
import { handleGetBlastRadius } from './adapters/mcp/get-blast-radius.js';
import { handleGetArchitecturalOverlay } from './adapters/mcp/get-architectural-overlay.js';

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

  const masking = new MaskingPipeline();
  const git = new SimpleGitAdapter(process.cwd());

  // Create MCP server
  const server = new McpServer({ name: 'ctxo', version: '0.1.0' });

  // Register tools
  const logicSliceHandler = handleGetLogicSlice(storage, masking);
  const whyContextHandler = handleGetWhyContext(storage, git, masking);
  const changeIntelligenceHandler = handleGetChangeIntelligence(storage, git, masking);

  server.registerTool(
    'get_logic_slice',
    {
      description: 'Retrieve a Logic-Slice for a named symbol — the symbol plus all transitive dependencies',
      inputSchema: {
        symbolId: z.string().min(1).describe('The symbol ID (format: file::name::kind)'),
        level: z.number().min(1).max(4).optional().default(3).describe('Detail level (1=minimal, 4=full)'),
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

  const blastRadiusHandler = handleGetBlastRadius(storage, masking);

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

  const overlayHandler = handleGetArchitecturalOverlay(storage, masking);

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

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[ctxo] Fatal:', (err as Error).message);
  process.exit(1);
});
