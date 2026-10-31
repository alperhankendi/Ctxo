import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleHost } from '@ctxo/cli/internal';
import { CURSOR_REMINDER_WINDOW_MS, normaliseWorkspaceRoot, parseCursorPayload, type CursorPayload } from '../../core/guard.js';
import { GuardSessionStore } from '../../adapters/guard-session-store.js';
import { CURSOR_CONTINUE, domainCursorHookCommand, evaluateCursorHook, type CursorHookResult } from '../domain-cursor-hook-command.js';
import { evaluateGuard } from '../domain-guard-hook-command.js';

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];
const BASE_TIME = 1_700_000_000;
const ISOLATED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending.md
    paths: ["src/Lending/**"]
    rung: named
  - id: billing
    name: Billing
    paths: ["src/Billing/**"]
    rung: fear
`;

interface Repo {
  readonly dir: string;
  git(...args: string[]): string;
  write(file: string, content: string): void;
  commit(message: string, ...more: string[]): string;
}

let saved: Map<string, string | undefined>;
let configDir: string;
const dirs: string[] = [];
let stdout: string[];

beforeEach(() => {
  saved = new Map(ISOLATED.map((k) => [k, process.env[k]]));
  for (const k of ISOLATED) delete process.env[k];
  configDir = mkdtempSync(join(tmpdir(), 'ctxo-domain-gitenv-'));
  writeFileSync(join(configDir, 'gitconfig'), '');
  process.env['GIT_CONFIG_GLOBAL'] = join(configDir, 'gitconfig');
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  stdout = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(configDir, { recursive: true, force: true });
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function initRepo(): Repo {
  const dir = tempDir('ctxo-domain-cursor-');
  let n = 0;
  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(['init', '-q', '-b', 'main']);
  const repo: Repo = {
    dir,
    git: (...args) => run(args),
    write(file, content) {
      const full = join(dir, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    },
    commit(message, ...more) {
      run(['add', '-A']);
      n += 1;
      const when = `${BASE_TIME + n * 60} +0000`;
      run([...IDENTITY, 'commit', '-q', '--allow-empty', ...[message, ...more].flatMap((m) => ['-m', m])], {
        GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_DATE: when,
      });
      return run(['rev-parse', 'HEAD']);
    },
  };
  repo.write('.gitignore', '.ctxo/.cache/\n');
  return repo;
}

/** `main` with the registry, the Lending card and code, then (by default) a `feat` branch. */
function createRepo(options: { readonly branch?: string; readonly registry?: boolean } = {}): Repo {
  const repo = initRepo();
  if (options.registry !== false) {
    repo.write('docs/domain/contexts.yaml', REGISTRY);
    repo.write('docs/domain/lending.md', '# Lending\n');
  }
  repo.write('src/Lending/LoanPolicy.cs', 'class LoanPolicy {}\n');
  repo.write('src/Billing/Invoice.cs', 'class Invoice {}\n');
  repo.commit('init');
  if (options.branch !== 'main') repo.git('checkout', '-q', '-b', options.branch ?? 'feat');
  return repo;
}

let edits = 0;
function changeLending(repo: Repo): void {
  edits += 1;
  repo.write('src/Lending/LoanPolicy.cs', `class LoanPolicy { int x${edits}; }\n`);
  repo.commit(`change lending ${edits}`);
}

/** A payload; a `stop` carries `status: "completed"` unless `status` says otherwise (null: no status). */
function cursorPayload(
  event: CursorPayload['event'],
  ids: { conversationId?: string; generationId?: string } = { conversationId: 'conv-1' },
  loopCount = 0,
  status: string | null = 'completed',
): CursorPayload {
  return { event, loopCount, ...ids, ...(event === 'stop' && status !== null ? { status } : {}) };
}

function cursor(repo: Repo | string, p: CursorPayload, now?: number): Promise<CursorHookResult> {
  const projectRoot = typeof repo === 'string' ? repo : repo.dir;
  const host = createModuleHost({ projectRoot, mode: 'hook' });
  return evaluateCursorHook(p, { host, projectRoot, ...(now !== undefined ? { now: () => now } : {}) });
}

function claude(repo: Repo, event: 'SessionStart' | 'Stop', sessionId = 'claude-1') {
  const host = createModuleHost({ projectRoot: repo.dir, mode: 'hook' });
  return evaluateGuard({ sessionId, event, stopHookActive: false }, { host, projectRoot: repo.dir });
}

function followup(result: CursorHookResult): string {
  expect(result.stdout?.endsWith('\n')).toBe(true);
  const parsed = JSON.parse(result.stdout ?? '') as Record<string, unknown>;
  expect(Object.keys(parsed)).toEqual(['followup_message']);
  expect(typeof parsed['followup_message']).toBe('string');
  return parsed['followup_message'] as string;
}

const QUIET: CursorHookResult = {};

describe('parseCursorPayload', () => {
  it('reads the ids, the loop count and the first workspace root', () => {
    expect(
      parseCursorPayload(
        JSON.stringify({ hook_event_name: 'stop', conversation_id: 'c', generation_id: 'g', loop_count: 1, status: 'completed', workspace_roots: ['/repo', '/other'] }),
      ),
    ).toEqual({ event: 'stop', conversationId: 'c', generationId: 'g', loopCount: 1, workspaceRoot: '/repo', status: 'completed' });
    expect(parseCursorPayload(JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', prompt: 'hi' }))).toEqual({ event: 'beforeSubmitPrompt', loopCount: 0 });
  });

  it('tells the event from the shape when hook_event_name is missing', () => {
    expect(parseCursorPayload(JSON.stringify({ conversation_id: 'c', prompt: 'hi' }))?.event).toBe('beforeSubmitPrompt');
    expect(parseCursorPayload(JSON.stringify({ conversation_id: 'c', status: 'completed' }))).toMatchObject({ event: 'stop', status: 'completed' });
    expect(parseCursorPayload(JSON.stringify({ conversation_id: 'c', loop_count: 0 }))?.event).toBe('stop');
    expect(parseCursorPayload(JSON.stringify({ conversation_id: 'c' }))).toBeUndefined();
  });

  it('normalises a Windows /c:/ workspace root on win32 only', () => {
    const raw = JSON.stringify({ hook_event_name: 'stop', workspace_roots: ['/c:/Users/me/repo'] });
    expect(parseCursorPayload(raw, 'win32')?.workspaceRoot).toBe('c:/Users/me/repo');
    expect(parseCursorPayload(raw, 'linux')?.workspaceRoot).toBe('/c:/Users/me/repo');
    expect(normaliseWorkspaceRoot('/D:\\repo', 'win32')).toBe('D:\\repo');
    expect(normaliseWorkspaceRoot('/home/me/repo', 'win32')).toBe('/home/me/repo');
  });

  it('rejects other events and anything that is not a JSON object', () => {
    expect(parseCursorPayload(JSON.stringify({ hook_event_name: 'afterFileEdit', conversation_id: 'c' }))).toBeUndefined();
    expect(parseCursorPayload(JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }))).toBeUndefined();
    expect(parseCursorPayload('[]')).toBeUndefined();
    expect(parseCursorPayload('{oops')).toBeUndefined();
    expect(parseCursorPayload('')).toBeUndefined();
  });
});

describe('evaluateCursorHook', () => {
  it('beforeSubmitPrompt records the start and lets the prompt through; stop then reminds once', async () => {
    const repo = createRepo();
    expect(await cursor(repo, cursorPayload('beforeSubmitPrompt'))).toEqual({ stdout: CURSOR_CONTINUE });
    expect(new GuardSessionStore(join(repo.dir, '.ctxo', '.cache')).read('cursor-conv-1')?.blocked).toEqual([]);

    changeLending(repo);
    const message = followup(await cursor(repo, cursorPayload('stop'), 1_000));
    expect(message).toBe(
      [
        'ctxo domain reminder: 1 context has committed changes without a card update.',
        '- lending: 1 file (src/Lending/LoanPolicy.cs)',
        '  card: docs/domain/lending.md (unchanged)',
        'Update the card if behaviour changed (rules, decisions, contracts), then commit it.',
        'If behaviour did not change, add this trailer to a commit:',
        '  Domain-Unchanged: lending (reason)',
        'The ctxo-domain-fold skill walks through the fold. This reminder does not block and comes once per conversation.',
      ].join('\n'),
    );
    expect(new GuardSessionStore(join(repo.dir, '.ctxo', '.cache')).read('cursor-conv-1')?.remindedAt).toBe(1_000);

    // Once per conversation: a later prompt and a new unresolved change stay quiet.
    await cursor(repo, cursorPayload('beforeSubmitPrompt'));
    changeLending(repo);
    expect(await cursor(repo, cursorPayload('stop'))).toEqual(QUIET);

    // Another conversation started after these commits has nothing to fold.
    await cursor(repo, cursorPayload('beforeSubmitPrompt', { conversationId: 'conv-2' }));
    expect(await cursor(repo, cursorPayload('stop', { conversationId: 'conv-2' }))).toEqual(QUIET);
  });

  it.each([
    ['aborted', 'aborted'],
    ['error', 'error'],
    ['a missing status', null],
    ['an unknown status', 'paused'],
  ])('a stop with %s prints nothing and records nothing, so a later completed stop still reminds', async (_name, status) => {
    const repo = createRepo();
    await cursor(repo, cursorPayload('beforeSubmitPrompt'));
    changeLending(repo);
    expect(await cursor(repo, cursorPayload('stop', { conversationId: 'conv-1' }, 0, status))).toEqual(QUIET);
    const record = new GuardSessionStore(join(repo.dir, '.ctxo', '.cache')).read('cursor-conv-1');
    expect(record?.remindedAt).toBeUndefined();
    expect(record?.blocked).toEqual([]);
    followup(await cursor(repo, cursorPayload('stop')));
  });

  it('a repeat prompt reads the record and never touches git', async () => {
    const repo = createRepo();
    await cursor(repo, cursorPayload('beforeSubmitPrompt'));
    const store = new GuardSessionStore(join(repo.dir, '.ctxo', '.cache'));
    const first = store.read('cursor-conv-1');
    expect(first?.startHead).toMatch(/^[0-9a-f]{40}$/);
    // Count every git call through a proxy over the real port.
    const base = createModuleHost({ projectRoot: repo.dir, mode: 'hook' });
    let gitCalls = 0;
    const host = {
      ...base,
      services: {
        ...base.services,
        createGit: (root: string) =>
          new Proxy(base.services.createGit(root), {
            get(target, prop, receiver) {
              const value = Reflect.get(target, prop, receiver) as unknown;
              if (typeof value !== 'function') return value;
              return (...args: unknown[]) => {
                gitCalls += 1;
                return (value as (...a: unknown[]) => unknown).apply(target, args);
              };
            },
          }),
      },
    };
    expect(await evaluateCursorHook(cursorPayload('beforeSubmitPrompt'), { host, projectRoot: repo.dir })).toEqual({ stdout: CURSOR_CONTINUE });
    expect(gitCalls).toBe(0);
    expect(store.read('cursor-conv-1')).toEqual(first);
    // A new conversation does call git once, to record its start.
    await evaluateCursorHook(cursorPayload('beforeSubmitPrompt', { conversationId: 'conv-new' }), { host, projectRoot: repo.dir });
    expect(gitCalls).toBe(1);
  });

  it('stays quiet while a follow-up is already running (loop_count above 0)', async () => {
    const repo = createRepo();
    await cursor(repo, cursorPayload('beforeSubmitPrompt'));
    changeLending(repo);
    expect(await cursor(repo, cursorPayload('stop', { conversationId: 'conv-1' }, 1))).toEqual(QUIET);
    followup(await cursor(repo, cursorPayload('stop')));
  });

  it('honours domain.guard.enabled: false', async () => {
    const repo = createRepo();
    repo.write('.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  guard:\n    enabled: false\n');
    await cursor(repo, cursorPayload('beforeSubmitPrompt'));
    changeLending(repo);
    expect(await cursor(repo, cursorPayload('stop'))).toEqual(QUIET);
  });

  it('falls back to the generation id, then to a time window', async () => {
    const repo = createRepo();
    await cursor(repo, cursorPayload('beforeSubmitPrompt', { generationId: 'gen-1' }));
    changeLending(repo);
    followup(await cursor(repo, cursorPayload('stop', { generationId: 'gen-1' })));
    expect(await cursor(repo, cursorPayload('stop', { generationId: 'gen-1' }))).toEqual(QUIET);

    const other = createRepo();
    await cursor(other, cursorPayload('beforeSubmitPrompt', {}));
    changeLending(other);
    followup(await cursor(other, cursorPayload('stop', {}), 1_000_000));
    changeLending(other);
    // Inside the window: quiet. After it: a new unresolved state reminds again.
    expect(await cursor(other, cursorPayload('stop', {}), 1_000_000 + CURSOR_REMINDER_WINDOW_MS - 1)).toEqual(QUIET);
    followup(await cursor(other, cursorPayload('stop', {}), 1_000_000 + CURSOR_REMINDER_WINDOW_MS));
  });

  it('fails open: a git failure, a corrupt registry or a missing project print nothing on stop and continue on a prompt', async () => {
    const corrupt = createRepo();
    await cursor(corrupt, cursorPayload('beforeSubmitPrompt'));
    corrupt.write('docs/domain/contexts.yaml', 'version: 1\ncontexts: [ {');
    changeLending(corrupt);
    expect(await cursor(corrupt, cursorPayload('stop'))).toEqual(QUIET);

    const broken = createRepo();
    await cursor(broken, cursorPayload('beforeSubmitPrompt'));
    changeLending(broken);
    renameSync(join(broken.dir, '.git'), join(broken.dir, 'git-moved'));
    expect(await cursor(broken, cursorPayload('stop'))).toEqual(QUIET);

    const missing = join(tempDir('ctxo-domain-cursor-gone-'), 'does-not-exist');
    expect(await cursor(missing, cursorPayload('stop'))).toEqual(QUIET);
    expect(await cursor(missing, cursorPayload('beforeSubmitPrompt'))).toEqual({ stdout: CURSOR_CONTINUE });
  });
});

describe('decision parity with the Claude Code guard', () => {
  /** Runs the same story for both hooks (separate sessions) and returns whether each fired on the final stop. */
  async function both(repo: Repo, story: () => void, options: { readonly startRecorded?: boolean } = {}): Promise<[boolean, boolean]> {
    if (options.startRecorded !== false) {
      await claude(repo, 'SessionStart');
      await cursor(repo, cursorPayload('beforeSubmitPrompt'));
    }
    story();
    const claudeFired = (await claude(repo, 'Stop')).stdout !== undefined;
    const cursorFired = (await cursor(repo, cursorPayload('stop'))).stdout !== undefined;
    return [claudeFired, cursorFired];
  }

  const cases: { readonly name: string; readonly expected: boolean; readonly repo?: () => Repo; readonly story: (repo: Repo) => void; readonly startRecorded?: boolean }[] = [
    { name: 'a context changed without a card update', expected: true, story: changeLending },
    {
      name: 'the card folded in a later commit',
      expected: false,
      story: (repo) => {
        changeLending(repo);
        repo.write('docs/domain/lending.md', '# Lending\n\nLEND-03: at most five loans.\n');
        repo.commit('docs: fold');
      },
    },
    { name: 'a Domain-Unchanged trailer', expected: false, story: (repo) => (changeLending(repo), void repo.commit('chore', 'Domain-Unchanged: lending (refactor)')) },
    {
      name: 'domain.guard.enabled: false',
      expected: false,
      story: (repo) => {
        repo.write('.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  guard:\n    enabled: false\n');
        changeLending(repo);
      },
    },
    { name: 'no registry', expected: false, repo: () => createRepo({ registry: false }), story: changeLending },
    {
      name: 'uncommitted changes only',
      expected: false,
      story: (repo) => repo.write('src/Lending/LoanPolicy.cs', 'class LoanPolicy { int dirty; }\n'),
    },
    {
      name: 'a context without a card',
      expected: false,
      story: (repo) => {
        repo.write('src/Billing/Invoice.cs', 'class Invoice { int y; }\n');
        repo.commit('billing only');
      },
    },
    {
      name: 'on main with domain.guard.base: main',
      expected: true,
      repo: () => {
        const repo = createRepo({ branch: 'main' });
        repo.write('.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  guard:\n    base: main\n');
        return repo;
      },
      story: changeLending,
    },
    { name: 'hook installed mid-session (no start record)', expected: false, story: changeLending, startRecorded: false },
  ];

  for (const c of cases) {
    it(`same verdict: ${c.name}`, async () => {
      const repo = (c.repo ?? (() => createRepo()))();
      const [claudeFired, cursorFired] = await both(repo, () => c.story(repo), { startRecorded: c.startRecorded });
      expect(claudeFired).toBe(c.expected);
      expect(cursorFired).toBe(claudeFired);
    });
  }
});

describe('domainCursorHookCommand', () => {
  async function runCommand(stdin: string, projectRoot: string): Promise<number> {
    const host = createModuleHost({ projectRoot, mode: 'hook' });
    const command = domainCursorHookCommand(host);
    expect(command.name).toBe('domain-cursor-hook');
    expect(command.hidden).toBe(true);
    return command.run([], { projectRoot, ctxoRoot: join(projectRoot, '.ctxo'), readStdin: async () => stdin });
  }

  it('reads the payload from stdin and finds the project from workspace_roots', async () => {
    const repo = createRepo();
    const elsewhere = tempDir('ctxo-domain-cursor-elsewhere-');
    const roots = [join(repo.dir, 'src')];
    expect(await runCommand(JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'cmd', workspace_roots: roots }), elsewhere)).toBe(0);
    expect(stdout.join('')).toBe(CURSOR_CONTINUE);
    stdout.length = 0;
    changeLending(repo);
    const stop = JSON.stringify({ hook_event_name: 'stop', conversation_id: 'cmd', status: 'completed', loop_count: 0, workspace_roots: roots });
    expect(await runCommand(stop, elsewhere)).toBe(0);
    const out = JSON.parse(stdout.join('')) as { followup_message: string };
    expect(out.followup_message).toContain('Domain-Unchanged: lending (reason)');
  });

  it('answers exactly {"continue":true} to unreadable input and to a payload whose event it cannot tell', async () => {
    const repo = createRepo();
    for (const stdin of ['{oops', '', '[]', JSON.stringify({ conversation_id: 'x' })]) {
      stdout.length = 0;
      expect(await runCommand(stdin, repo.dir)).toBe(0);
      expect(stdout.join(''), stdin).toBe(CURSOR_CONTINUE);
    }
  });

  it('prints nothing for another named event or a stop it cannot use', async () => {
    const repo = createRepo();
    expect(await runCommand(JSON.stringify({ hook_event_name: 'afterFileEdit' }), repo.dir)).toBe(0);
    expect(await runCommand(JSON.stringify({ hook_event_name: 'stop', status: 'aborted', conversation_id: 'z' }), repo.dir)).toBe(0);
    expect(stdout).toEqual([]);
  });

  it('a prompt answers {"continue":true} with the guard disabled and when the project is gone', async () => {
    const repo = createRepo();
    repo.write('.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  guard:\n    enabled: false\n');
    expect(await runCommand(JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'off' }), repo.dir)).toBe(0);
    const missing = join(tempDir('ctxo-domain-cursor-gone-'), 'nope');
    expect(await runCommand(JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'gone' }), missing)).toBe(0);
    expect(stdout.join('')).toBe(CURSOR_CONTINUE + CURSOR_CONTINUE);
  });

  it('a prompt answers {"continue":true} when reading stdin throws', async () => {
    const host = createModuleHost({ projectRoot: process.cwd(), mode: 'hook' });
    const code = await domainCursorHookCommand(host).run([], {
      projectRoot: process.cwd(),
      ctxoRoot: join(process.cwd(), '.ctxo'),
      readStdin: async () => {
        throw new Error('EPIPE');
      },
    });
    expect(code).toBe(0);
    expect(stdout.join('')).toBe(CURSOR_CONTINUE);
  });
});
