import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:http');

/**
 * Starts ctxo MCP server over HTTP with Streamable HTTP transport.
 * Enables browser-based clients (e.g. ctxo-visualizer) to connect via POST /mcp.
 *
 * Usage:
 *   CTXO_HTTP_PORT=3001 npx ctxo
 *   npx ctxo --http
 *   npx ctxo --http --port 8080
 */
export async function startHttpTransport(
  server: McpServer,
  port: number,
): Promise<{ httpServer: Server; transport: StreamableHTTPServerTransport }> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    // CORS for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    transport.handleRequest(req, res);
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, () => {
      log.info('MCP HTTP server listening on http://localhost:%d/mcp', port);
      process.stderr.write(`[ctxo] MCP HTTP server running at http://localhost:${port}/mcp\n`);
      resolve({ httpServer, transport });
    });
  });
}
