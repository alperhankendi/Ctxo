import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  loads: 0,
  runs: [] as string[],
  /** What the stand-in module command does. */
  behaviour: 'quiet' as 'quiet' | 'noisy' | 'throw' | 'missing',
}));

vi.mock('../module-commands.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../module-commands.js')>();
  return {
    ...actual,
    loadModulesFor: async () => {
      fake.loads += 1;
      if (fake.behaviour === 'throw') throw new Error('module exploded');
      return [];
    },
    runModuleCommand: async (_command: string, _args: readonly string[], options: { readStdin?: () => Promise<string> }) => {
      fake.runs.push(await options.readStdin!());
      if (fake.behaviour === 'missing') return undefined;
      if (fake.behaviour === 'noisy') process.stdout.write('{"followup_message":"noise"}\n');
      return 0;
    },
  };
});

const { CURSOR_CONTINUE_LINE, conversationRecordPath, routeEventOf, routeProjectRoot, runCursorHookRoute } = await import('../cursor-hook-route.js');

const dirs: string[] = [];
let out: string[];

beforeEach(() => {
  fake.loads = 0;
  fake.runs = [];
  fake.behaviour = 'quiet';
  out = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-cursor-route-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.git'));
  return dir;
}

function route(dir: string, stdin: string | Error): Promise<number> {
  return runCursorHookRoute(['domain-cursor-hook'], dir, {
    readStdin: async () => {
      if (stdin instanceof Error) throw stdin;
      return stdin;
    },
  });
}

const prompt = (dir: string, conversation = 'conv-1') =>
  JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: conversation, prompt: 'go', workspace_roots: [dir] });

describe('runCursorHookRoute: beforeSubmitPrompt', () => {
  it('a first prompt runs the module with the stdin it read, and prints exactly {"continue":true}', async () => {
    const dir = repo();
    expect(await route(dir, prompt(dir))).toBe(0);
    expect(fake.loads).toBe(1);
    expect(fake.runs).toEqual([prompt(dir)]);
    expect(out).toEqual([CURSOR_CONTINUE_LINE]);
  });

  it('a repeat prompt (the record exists) answers at once without loading the module', async () => {
    const dir = repo();
    mkdirSync(join(dir, '.ctxo', '.cache', 'domain-guard'), { recursive: true });
    writeFileSync(join(dir, '.ctxo', '.cache', 'domain-guard', 'cursor-conv_1.json'), '{}');
    expect(await route(dir, prompt(dir, 'conv.1'))).toBe(0);
    expect(fake.loads).toBe(0);
    expect(out).toEqual([CURSOR_CONTINUE_LINE]);
  });

  it.each([
    ['the module is missing', 'missing'],
    ['the module throws', 'throw'],
    ['the module writes to stdout', 'noisy'],
  ] as const)('prints only {"continue":true} when %s', async (_name, behaviour) => {
    fake.behaviour = behaviour;
    const dir = repo();
    expect(await route(dir, prompt(dir))).toBe(0);
    expect(out).toEqual([CURSOR_CONTINUE_LINE]);
  });

  it.each([
    ['non-JSON stdin', '{oops'],
    ['empty stdin', ''],
    ['a JSON array', '[]'],
    ['a payload whose event cannot be told', JSON.stringify({ conversation_id: 'x' })],
  ])('prints {"continue":true} for %s, without loading the module', async (_name, stdin) => {
    const dir = repo();
    expect(await route(dir, stdin)).toBe(0);
    expect(fake.loads).toBe(0);
    expect(out).toEqual([CURSOR_CONTINUE_LINE]);
  });

  it('prints {"continue":true} when reading stdin fails', async () => {
    expect(await route(repo(), new Error('EPIPE'))).toBe(0);
    expect(out).toEqual([CURSOR_CONTINUE_LINE]);
  });

  it('a prompt told by its shape (no hook_event_name) is handled as a prompt', async () => {
    const dir = repo();
    const stdin = JSON.stringify({ conversation_id: 'shape', prompt: 'go', workspace_roots: [dir] });
    await route(dir, stdin);
    expect(fake.runs).toEqual([stdin]);
    expect(out).toEqual([CURSOR_CONTINUE_LINE]);
  });
});

describe('runCursorHookRoute: stop', () => {
  it('runs the module and lets its output through', async () => {
    fake.behaviour = 'noisy';
    const dir = repo();
    const stdin = JSON.stringify({ hook_event_name: 'stop', status: 'completed', conversation_id: 'c', workspace_roots: [dir] });
    expect(await route(dir, stdin)).toBe(0);
    expect(fake.runs).toEqual([stdin]);
    expect(out).toEqual(['{"followup_message":"noise"}\n']);
  });

  it('prints nothing when the module is missing or throws, or for another named event', async () => {
    const dir = repo();
    fake.behaviour = 'missing';
    await route(dir, JSON.stringify({ hook_event_name: 'stop', status: 'completed' }));
    fake.behaviour = 'throw';
    await route(dir, JSON.stringify({ hook_event_name: 'stop', status: 'completed' }));
    fake.behaviour = 'quiet';
    await route(dir, JSON.stringify({ hook_event_name: 'afterFileEdit' }));
    expect(out).toEqual([]);
  });
});

describe('route helpers', () => {
  it('routeEventOf follows the domain rule: name first, then shape', () => {
    expect(routeEventOf({ hook_event_name: 'stop' })).toBe('stop');
    expect(routeEventOf({ hook_event_name: 'afterFileEdit', prompt: 'x' })).toBe('other');
    expect(routeEventOf({ prompt: 'x' })).toBe('beforeSubmitPrompt');
    expect(routeEventOf({ status: 'completed' })).toBe('stop');
    expect(routeEventOf({ loop_count: 0 })).toBe('stop');
    expect(routeEventOf({})).toBeUndefined();
    expect(routeEventOf(undefined)).toBeUndefined();
  });

  it('conversationRecordPath matches the session store file name', () => {
    expect(conversationRecordPath({ conversation_id: 'a/b:c' }, '/p')).toBe(join('/p', '.ctxo', '.cache', 'domain-guard', 'cursor-a_b_c.json'));
    expect(conversationRecordPath({ generation_id: 'g1' }, '/p')).toBe(join('/p', '.ctxo', '.cache', 'domain-guard', 'cursor-generation-g1.json'));
    expect(conversationRecordPath({}, '/p')).toBeUndefined();
  });

  it('routeProjectRoot uses the git root of workspace_roots[0], normalising /c:/ on win32, else the cwd', () => {
    const dir = repo();
    const nested = join(dir, 'src');
    mkdirSync(nested);
    expect(routeProjectRoot({ workspace_roots: [nested] }, tmpdir())).toBe(dir);
    const elsewhere = mkdtempSync(join(tmpdir(), 'ctxo-cursor-route-none-'));
    dirs.push(elsewhere);
    expect(routeProjectRoot({}, elsewhere)).toBe(elsewhere);
    if (process.platform === 'win32') {
      expect(routeProjectRoot({ workspace_roots: [`/${nested.replace(/\\/g, '/')}`] }, elsewhere, 'win32').toLowerCase()).toBe(dir.replace(/\\/g, '/').toLowerCase());
    }
  });
});
