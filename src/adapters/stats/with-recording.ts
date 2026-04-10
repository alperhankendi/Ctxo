import type { ISessionRecorderPort, SessionEvent } from '../../ports/i-session-recorder-port.js';

type McpToolResult = { content: Array<{ type: 'text'; text: string }> };
type McpHandler = (args: Record<string, unknown>) => McpToolResult | Promise<McpToolResult>;

/**
 * Wraps an MCP handler with session recording.
 * Recording is fire-and-forget — errors are swallowed, never affect tool response.
 *
 * @param toolName - MCP tool name (e.g., 'get_logic_slice')
 * @param handler - Original handler function (sync or async)
 * @param recorder - Session recorder (null = recording disabled, zero overhead)
 */
export function withRecording(
  toolName: string,
  handler: McpHandler,
  recorder: ISessionRecorderPort | null,
): McpHandler {
  if (!recorder) return handler;

  return (args: Record<string, unknown>) => {
    const start = performance.now();
    const resultOrPromise = handler(args);

    // Handle async handlers
    if (resultOrPromise instanceof Promise) {
      return resultOrPromise.then((result) => {
        recordEvent(toolName, args, result, performance.now() - start, recorder);
        return result;
      });
    }

    // Sync handler
    const latencyMs = performance.now() - start;
    recordEvent(toolName, args, resultOrPromise, latencyMs, recorder);
    return resultOrPromise;
  };
}

function recordEvent(
  toolName: string,
  args: Record<string, unknown>,
  result: McpToolResult,
  latencyMs: number,
  recorder: ISessionRecorderPort,
): void {
  try {
    const responseText = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    let truncated = false;
    try {
      const parsed = JSON.parse(responseText);
      truncated = parsed?._meta?.truncated ?? false;
    } catch { /* non-JSON response, ignore */ }

    const responseBytes = Buffer.byteLength(responseText, 'utf-8');

    // Extract detail level: args.level (number) → 'L1'...'L4'
    const rawLevel = args['level'];
    let detailLevel: SessionEvent['detailLevel'] = null;
    if (typeof rawLevel === 'number' && rawLevel >= 1 && rawLevel <= 4) {
      detailLevel = `L${rawLevel}` as SessionEvent['detailLevel'];
    }

    const event: SessionEvent = {
      tool: toolName,
      symbolId: (typeof args['symbolId'] === 'string' ? args['symbolId'] : null),
      detailLevel,
      responseTokens: Math.ceil(responseBytes / 4),
      responseBytes,
      latencyMs,
      truncated,
    };

    recorder.record(event);
  } catch {
    // Recording failure must never affect tool response
  }
}
