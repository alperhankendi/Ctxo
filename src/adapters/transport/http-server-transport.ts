import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:http');

/**
 * Starts ctxo MCP server over HTTP with Streamable HTTP transport.
 * Uses a single persistent transport per server lifetime.
 * Browser clients share the same session via Mcp-Session-Id header.
 *
 * Usage:
 *   CTXO_HTTP_PORT=3001 npx ctxo
 *   npx ctxo --http
 */
export async function startHttpTransport(
  server: McpServer,
  port: number,
): Promise<{ httpServer: Server; transport: StreamableHTTPServerTransport }> {
  // Single stateful transport — one session for the lifetime of the server
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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

    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      log.error('HTTP request error: %s', (err as Error).message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, () => {
      log.info('MCP HTTP server listening on http://localhost:%d', port);
      process.stderr.write(`[ctxo] MCP HTTP server running at http://localhost:${port}\n`);
      resolve({ httpServer, transport });
    });
  });
}
