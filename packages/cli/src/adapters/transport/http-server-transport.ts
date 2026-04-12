import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:http');

/**
 * Factory function that creates and registers all tools on a fresh McpServer.
 * Passed in from the composition root so this adapter doesn't import tool handlers.
 */
export type ServerFactory = () => Promise<McpServer>;

/**
 * Starts ctxo MCP over HTTP. Each browser session gets its own McpServer + transport.
 * This avoids the "already connected" error when multiple clients connect.
 *
 * Usage:
 *   CTXO_HTTP_PORT=3001 npx ctxo
 *   npx ctxo --http
 */
export async function startHttpTransport(
  serverFactory: ServerFactory,
  port: number,
): Promise<{ httpServer: Server }> {
  // Map of session ID -> { transport, server }
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      try {
        await sessions.get(sessionId)!.transport.handleRequest(req, res);
      } catch (err) {
        log.error('Request error: %s', (err as Error).message);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
      return;
    }

    // Invalid session
    if (sessionId && !sessions.has(sessionId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
      return;
    }

    // New session — create fresh server + transport
    try {
      const server = await serverFactory();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          log.info('Session closed: %s', transport.sessionId);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, { transport, server });
        log.info('New session: %s (total: %d)', transport.sessionId, sessions.size);
      }
    } catch (err) {
      log.error('Session creation error: %s', (err as Error).message);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, () => {
      log.info('MCP HTTP server listening on http://localhost:%d', port);
      process.stderr.write(`[ctxo] MCP HTTP server running at http://localhost:${port}\n`);
      resolve({ httpServer });
    });
  });
}
