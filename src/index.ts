import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'ctxo', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // CLI mode — will be wired in Phase 6
    console.error(`[ctxo] CLI not yet implemented. Received: ${args.join(' ')}`);
    process.exit(1);
  }

  // MCP server mode
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[ctxo] Fatal:', (err as Error).message);
  process.exit(1);
});
