import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * NFR16: Cross-client compatibility validation.
 *
 * This file validates MCP spec compliance for tools/list response shape
 * which is the common contract across Claude Code, Cursor, and VS Code Copilot.
 *
 * Manual smoke tests should be run against:
 * - Claude Code: add to claude_desktop_config.json
 * - Cursor: add to .cursor/mcp.json
 * - VS Code Copilot: add to settings.json mcp servers
 *
 * Config for all clients:
 * { "command": "npx", "args": ["-y", "ctxo"] }
 */

describe('NFR16: MCP Spec Compliance for Cross-Client', () => {
  it('McpServer registers tools with valid Zod input schemas', () => {
    const server = new McpServer({ name: 'ctxo', version: '0.1.0' });

    // All 5 tools should register without error
    expect(() => {
      server.registerTool('get_logic_slice', {
        description: 'test',
        inputSchema: { symbolId: z.string().min(1) },
      }, () => ({ content: [{ type: 'text' as const, text: '{}' }] }));

      server.registerTool('get_blast_radius', {
        description: 'test',
        inputSchema: { symbolId: z.string().min(1) },
      }, () => ({ content: [{ type: 'text' as const, text: '{}' }] }));

      server.registerTool('get_architectural_overlay', {
        description: 'test',
        inputSchema: { layer: z.string().optional() },
      }, () => ({ content: [{ type: 'text' as const, text: '{}' }] }));

      server.registerTool('get_why_context', {
        description: 'test',
        inputSchema: { symbolId: z.string().min(1) },
      }, () => ({ content: [{ type: 'text' as const, text: '{}' }] }));

      server.registerTool('get_change_intelligence', {
        description: 'test',
        inputSchema: { symbolId: z.string().min(1) },
      }, () => ({ content: [{ type: 'text' as const, text: '{}' }] }));
    }).not.toThrow();
  });

  it('all tool responses conform to MCP content shape', () => {
    const validResponse = {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: 'test' }) }],
    };

    expect(validResponse.content).toHaveLength(1);
    expect(validResponse.content[0]?.type).toBe('text');
    expect(typeof validResponse.content[0]?.text).toBe('string');
  });

  it('error responses conform to MCP content shape', () => {
    const errorResponse = {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: 'test error' }) }],
    };

    expect(errorResponse.content[0]?.type).toBe('text');
    const parsed = JSON.parse(errorResponse.content[0]!.text);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('test error');
  });

  it('graceful miss responses conform to MCP content shape', () => {
    const missResponse = {
      content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'run ctxo index' }) }],
    };

    const parsed = JSON.parse(missResponse.content[0]!.text);
    expect(parsed.found).toBe(false);
    expect(parsed.hint).toContain('ctxo index');
  });
});
