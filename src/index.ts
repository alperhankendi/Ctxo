import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SqliteStorageAdapter } from './adapters/storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from './core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from './adapters/mcp/get-logic-slice.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // CLI mode — will be wired in Phase 6
    console.error(`[ctxo] CLI not yet implemented. Received: ${args.join(' ')}`);
    process.exit(1);
  }

  // Initialize adapters
  const ctxoRoot = '.ctxo';
  const storage = new SqliteStorageAdapter(ctxoRoot);
  await storage.init();

  const masking = new MaskingPipeline();

  // Create MCP server
  const server = new McpServer({ name: 'ctxo', version: '0.1.0' });

  // Register tools
  const logicSliceHandler = handleGetLogicSlice(storage, masking);

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

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[ctxo] Fatal:', (err as Error).message);
  process.exit(1);
});
