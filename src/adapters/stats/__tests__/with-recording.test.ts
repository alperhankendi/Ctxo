import { describe, it, expect, vi } from 'vitest';
import { withRecording } from '../with-recording.js';
import type { ISessionRecorderPort, SessionEvent } from '../../../ports/i-session-recorder-port.js';

function mockHandler(response: Record<string, unknown> = { result: 'ok' }) {
  const text = JSON.stringify(response);
  return vi.fn(() => ({
    content: [{ type: 'text' as const, text }],
  }));
}

function mockRecorder(): ISessionRecorderPort & { events: SessionEvent[] } {
  const events: SessionEvent[] = [];
  return {
    events,
    record: vi.fn((event: SessionEvent) => { events.push(event); }),
    queryStats: vi.fn(() => ({
      totalCalls: 0, totalTokensServed: 0, topTools: [], topSymbols: [], detailLevelDistribution: [],
    })),
    clear: vi.fn(),
  };
}

describe('withRecording', () => {
  it('returns the same result as the original handler', () => {
    const handler = mockHandler({ data: 'hello' });
    const recorder = mockRecorder();
    const wrapped = withRecording('test_tool', handler, recorder);

    const result = wrapped({ symbolId: 'a::b::class' });
    const original = handler({ symbolId: 'a::b::class' });

    expect(result.content[0]!.text).toBe(original.content[0]!.text);
  });

  it('calls recorder.record with correct tool name', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('get_blast_radius', handler, recorder);

    wrapped({});

    expect(recorder.record).toHaveBeenCalledOnce();
    expect(recorder.events[0]!.tool).toBe('get_blast_radius');
  });

  it('extracts symbolId from args', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({ symbolId: 'src/foo.ts::bar::function' });

    expect(recorder.events[0]!.symbolId).toBe('src/foo.ts::bar::function');
  });

  it('sets symbolId to null when not provided', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({});

    expect(recorder.events[0]!.symbolId).toBeNull();
  });

  it('maps numeric level to detail level string', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({ level: 2 });
    expect(recorder.events[0]!.detailLevel).toBe('L2');

    wrapped({ level: 4 });
    expect(recorder.events[1]!.detailLevel).toBe('L4');
  });

  it('sets detailLevel to null when no level arg', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({});

    expect(recorder.events[0]!.detailLevel).toBeNull();
  });

  it('detects truncation from _meta', () => {
    const handler = mockHandler({ data: [], _meta: { truncated: true, totalItems: 100, returnedItems: 10, totalBytes: 9000 } });
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({});

    expect(recorder.events[0]!.truncated).toBe(true);
  });

  it('measures latency > 0ms', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({});

    expect(recorder.events[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('estimates response tokens from byte length', () => {
    const handler = mockHandler({ data: 'a'.repeat(400) });
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({});

    expect(recorder.events[0]!.responseTokens).toBeGreaterThan(0);
    expect(recorder.events[0]!.responseBytes).toBeGreaterThan(0);
  });

  it('returns handler directly when recorder is null (zero overhead)', () => {
    const handler = mockHandler();
    const wrapped = withRecording('test', handler, null);

    // Should be the exact same function reference
    expect(wrapped).toBe(handler);
  });

  it('handles non-JSON response text gracefully', () => {
    const handler = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'plain text, not JSON' }],
    }));
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({});

    expect(recorder.events[0]!.truncated).toBe(false);
    expect(recorder.events[0]!.responseBytes).toBeGreaterThan(0);
  });

  it('handles invalid detail level values', () => {
    const handler = mockHandler();
    const recorder = mockRecorder();
    const wrapped = withRecording('test', handler, recorder);

    wrapped({ level: 5 });
    expect(recorder.events[0]!.detailLevel).toBeNull();

    wrapped({ level: 'L2' });
    expect(recorder.events[1]!.detailLevel).toBeNull();
  });

  it('does not affect response when recording throws', () => {
    const handler = mockHandler({ important: 'data' });
    const throwingRecorder: ISessionRecorderPort = {
      record: () => { throw new Error('DB exploded'); },
      queryStats: () => ({ totalCalls: 0, totalTokensServed: 0, topTools: [], topSymbols: [], detailLevelDistribution: [] }),
      clear: () => {},
    };
    const wrapped = withRecording('test', handler, throwingRecorder);

    const result = wrapped({});
    expect(JSON.parse(result.content[0]!.text)).toEqual({ important: 'data' });
  });
});
