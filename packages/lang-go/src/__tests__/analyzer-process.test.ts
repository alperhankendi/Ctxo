import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { runBatchAnalyze } from '../analyzer/analyzer-process.js';

const mockedSpawn = vi.mocked(spawn);

interface FakeProc {
  stdout: Readable;
  stderr: Readable;
  emitter: EventEmitter;
}

function fakeProcess(opts: { stdout?: string; stderr?: string; exitCode?: number; spawnError?: Error } = {}): FakeProc {
  const stdout = Readable.from([opts.stdout ?? '']);
  const stderr = Readable.from([opts.stderr ?? '']);
  const emitter = new EventEmitter();
  // Mirror ChildProcess shape — `on` proxies to our emitter.
  const proc = {
    stdout,
    stderr,
    on: (event: string, cb: (...args: unknown[]) => void) => emitter.on(event, cb),
  };
  setTimeout(() => {
    if (opts.spawnError) {
      emitter.emit('error', opts.spawnError);
    } else {
      emitter.emit('close', opts.exitCode ?? 0);
    }
  }, 5);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedSpawn.mockReturnValueOnce(proc as any);
  return { stdout, stderr, emitter };
}

describe('runBatchAnalyze — JSONL parsing', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  it('parses a successful run with file + dead + summary records', async () => {
    fakeProcess({
      stdout: [
        '{"type":"progress","message":"loading"}',
        '{"type":"file","file":"a.go","symbols":[{"symbolId":"a.go::Foo::function","name":"Foo","kind":"function","startLine":1,"endLine":3}],"edges":[],"complexity":[]}',
        '{"type":"dead","symbolIds":["a.go::Foo::function"],"hasMain":true}',
        '{"type":"summary","totalFiles":1,"elapsed":"42ms"}',
        '',
      ].join('\n'),
    });

    const result = await runBatchAnalyze('/fake/binary', '/some/module');
    expect(result.totalFiles).toBe(1);
    expect(result.elapsed).toBe('42ms');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.file).toBe('a.go');
    expect(result.files[0]!.symbols[0]!.name).toBe('Foo');
    expect(result.dead).toEqual(['a.go::Foo::function']);
    expect(result.hasMain).toBe(true);
    expect(result.timeout).toBe(false);
  });

  it('returns empty result on non-zero exit', async () => {
    fakeProcess({ exitCode: 1, stderr: 'analyzer crashed: bad input' });
    const result = await runBatchAnalyze('/fake/binary', '/some/module');
    expect(result.files).toHaveLength(0);
    expect(result.dead).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
  });

  it('skips malformed lines without throwing', async () => {
    fakeProcess({
      stdout: [
        'not json at all',
        '{"type":"file","file":"a.go","symbols":[],"edges":[],"complexity":[]}',
        '{"type":"summary","totalFiles":1,"elapsed":"1ms"}',
        '',
      ].join('\n'),
    });
    const result = await runBatchAnalyze('/fake/binary', '/some/module');
    expect(result.files).toHaveLength(1);
    expect(result.totalFiles).toBe(1);
  });

  it('returns empty when spawn raises an error', async () => {
    fakeProcess({ spawnError: new Error('ENOENT') });
    const result = await runBatchAnalyze('/nonexistent', '/some/module');
    expect(result.files).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
  });

  it('flags timeout from dead record', async () => {
    fakeProcess({
      stdout: [
        '{"type":"file","file":"a.go","symbols":[],"edges":[],"complexity":[]}',
        '{"type":"dead","symbolIds":[],"hasMain":false,"timeout":true}',
        '{"type":"summary","totalFiles":1,"elapsed":"60s"}',
        '',
      ].join('\n'),
    });
    const result = await runBatchAnalyze('/fake/binary', '/some/module');
    expect(result.timeout).toBe(true);
    expect(result.hasMain).toBe(false);
  });
});
