import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * `ctxo domain-guard-hook` through the built CLI (ADR-018 Decision 5, PF30): simulated SessionStart, Stop
 * and TaskCompleted events on stdin, the exit codes and the two output streams, and the modules the fast
 * hook route loads. The live `claude --debug` check of the registered hooks is an owner check.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = join(HERE, '..', '..');
// `--import` takes a URL: a bare Windows path would read as a `d:` scheme.
const RECORD_IMPORTS = pathToFileURL(join(HERE, '..', 'fixtures', 'record-imports.mjs')).href;

const cliPackageJson = createRequire(import.meta.url).resolve('@ctxo/cli/package.json');
const CLI_BIN = join(dirname(cliPackageJson), (JSON.parse(readFileSync(cliPackageJson, 'utf-8')) as { bin: { ctxo: string } }).bin.ctxo);

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];
const BASE_TIME = 1_700_000_000;
const ISOLATED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_CONFIG_SYSTEM'];

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending.md
    paths: ["src/Lending/**"]
    rung: named
`;

const dirs: string[] = [];
let gitConfig: string;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ISOLATED) delete env[k];
  delete env['DEBUG'];
  env['GIT_CONFIG_GLOBAL'] = gitConfig;
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  return { ...env, ...extra };
}

let commits = 0;
function git(dir: string, ...args: string[]): string {
  commits += 1;
  const when = `${BASE_TIME + commits * 60} +0000`;
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    env: childEnv({ GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(dir: string, file: string, content: string): void {
  const full = join(dir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function commit(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, ...IDENTITY, 'commit', '-q', '-m', message);
}

/** A repo with the registry on `main`, then a `feat` branch; `withDomain` links `node_modules/@ctxo/domain`. */
function createProject(withDomain: boolean): string {
  const dir = tempDir('ctxo-domain-guard-e2e-');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, '.gitignore', 'node_modules/\n.ctxo/.cache/\n');
  write(dir, 'package.json', JSON.stringify({ name: 'guard-fixture', private: true }, null, 2));
  write(dir, 'docs/domain/contexts.yaml', REGISTRY);
  write(dir, 'docs/domain/lending.md', '# Lending\n');
  write(dir, 'src/Lending/LoanPolicy.cs', 'class LoanPolicy {}\n');
  commit(dir, 'init');
  git(dir, 'checkout', '-q', '-b', 'feat');
  if (withDomain) {
    mkdirSync(join(dir, 'node_modules', '@ctxo'), { recursive: true });
    symlinkSync(DOMAIN_DIR, join(dir, 'node_modules', '@ctxo', 'domain'), 'junction');
  }
  return dir;
}

interface HookRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

function hook(dir: string, event: Record<string, unknown>, options: { readonly importLog?: string } = {}): HookRun {
  const nodeArgs = options.importLog !== undefined ? ['--import', RECORD_IMPORTS] : [];
  const started = Date.now();
  const result = spawnSync(process.execPath, [...nodeArgs, CLI_BIN, 'domain-guard-hook'], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, ...event }),
    encoding: 'utf-8',
    env: childEnv(options.importLog !== undefined ? { CTXO_IMPORT_LOG: options.importLog } : {}),
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ms: Date.now() - started };
}

beforeAll(() => {
  if (!existsSync(CLI_BIN)) throw new Error(`Build @ctxo/cli first: ${CLI_BIN} is missing`);
  if (!existsSync(join(DOMAIN_DIR, 'dist', 'index.js'))) throw new Error('Build @ctxo/domain first: dist/index.js is missing');
  const dir = tempDir('ctxo-domain-guard-gitenv-');
  gitConfig = join(dir, 'gitconfig');
  writeFileSync(gitConfig, '');
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('ctxo domain-guard-hook (built CLI)', () => {
  it('the hook route blocks a Stop through the built CLI', () => {
    const dir = createProject(true);

    const start = hook(dir, { session_id: 'e2e-1', hook_event_name: 'SessionStart', source: 'startup' });
    expect(start).toMatchObject({ status: 0, stdout: '', stderr: '' });
    expect(existsSync(join(dir, '.ctxo', '.cache', 'domain-guard', 'e2e-1.json'))).toBe(true);

    write(dir, 'src/Lending/LoanPolicy.cs', 'class LoanPolicy { int maxLoans = 5; }\n');
    commit(dir, 'change the loan policy');

    const stop = hook(dir, { session_id: 'e2e-1', hook_event_name: 'Stop', stop_hook_active: false });
    expect(stop.status).toBe(0);
    expect(stop.stderr).toBe('');
    const decision = JSON.parse(stop.stdout) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('ctxo domain guard: 1 context has committed changes without a card update.');
    expect(decision.reason).toContain('- lending: 1 file (src/Lending/LoanPolicy.cs)');
    expect(decision.reason).toContain('  Domain-Unchanged: lending (reason)');

    // Blocked once: the same HEAD allows, and stop_hook_active always allows.
    expect(hook(dir, { session_id: 'e2e-1', hook_event_name: 'Stop', stop_hook_active: false })).toMatchObject({ status: 0, stdout: '', stderr: '' });
    expect(hook(dir, { session_id: 'e2e-1', hook_event_name: 'Stop', stop_hook_active: true })).toMatchObject({ status: 0, stdout: '', stderr: '' });

    // TaskCompleted in another session that saw the commit happen: exit 2, the reason on stderr.
    const other = createProject(true);
    hook(other, { session_id: 'e2e-2', hook_event_name: 'SessionStart' });
    write(other, 'src/Lending/LoanPolicy.cs', 'class LoanPolicy { int maxLoans = 5; }\n');
    commit(other, 'change the loan policy');
    const task = hook(other, { session_id: 'e2e-2', hook_event_name: 'TaskCompleted' });
    expect(task.status).toBe(2);
    expect(task.stdout).toBe('');
    expect(task.stderr).toContain('ctxo domain guard: 1 context has committed changes without a card update.\n');

    // A malformed payload allows silently.
    const bad = spawnSync(process.execPath, [CLI_BIN, 'domain-guard-hook'], { cwd: dir, input: '{oops', encoding: 'utf-8', env: childEnv() });
    expect(bad).toMatchObject({ status: 0, stdout: '' });
  });

  it('the hook route reads an invalid config once: register does not load it', () => {
    const dir = createProject(true);
    write(dir, '.ctxo/config.yaml', 'domain: [\n');
    const count = (text: string): number => text.split('Invalid YAML').length - 1;

    const start = hook(dir, { session_id: 'e2e-4', hook_event_name: 'SessionStart', source: 'startup' });
    const stop = hook(dir, { session_id: 'e2e-4', hook_event_name: 'Stop', stop_hook_active: false });

    expect(start.status).toBe(0);
    expect(stop.status).toBe(0);
    // The guard command's own config read may warn once; the module's registration adds no second warning.
    expect(count(start.stderr)).toBeLessThanOrEqual(1);
    expect(count(stop.stderr)).toBeLessThanOrEqual(1);
  });

  it('the hook route never loads the MCP SDK or the CLI router', () => {
    const dir = createProject(true);
    const importLog = join(tempDir('ctxo-domain-guard-imports-'), 'imports.log');
    hook(dir, { session_id: 'e2e-3', hook_event_name: 'SessionStart' }, { importLog });
    write(dir, 'src/Lending/LoanPolicy.cs', 'class LoanPolicy { int maxLoans = 5; }\n');
    commit(dir, 'change the loan policy');
    const stop = hook(dir, { session_id: 'e2e-3', hook_event_name: 'Stop' }, { importLog });
    expect(stop.stderr).toBe('');
    expect(JSON.parse(stop.stdout).decision).toBe('block');

    const urls = readFileSync(importLog, 'utf-8').split('\n').filter((line) => line.length > 0);
    // The recorder works: it saw the CLI entry and the domain module.
    expect(urls.some((url) => url.replace(/\\/g, '/').includes('/domain/dist/index.js'))).toBe(true);
    const forbidden = urls.filter((url) => ['@modelcontextprotocol', 'cli-router', 'mcp-server'].some((name) => url.includes(name)));
    expect(forbidden).toEqual([]);
  });

  it('the hook route exits 0 silently without @ctxo/domain', () => {
    const dir = createProject(false);
    for (const event of ['SessionStart', 'Stop', 'TaskCompleted']) {
      expect(hook(dir, { session_id: 'e2e-4', hook_event_name: event })).toMatchObject({ status: 0, stdout: '', stderr: '' });
    }
    expect(existsSync(join(dir, '.ctxo', '.cache', 'domain-guard'))).toBe(false);
  });
});

function cursorHook(dir: string, event: Record<string, unknown>, options: { readonly importLog?: string } = {}): HookRun {
  const nodeArgs = options.importLog !== undefined ? ['--import', RECORD_IMPORTS] : [];
  const started = Date.now();
  const result = spawnSync(process.execPath, [...nodeArgs, CLI_BIN, 'domain-cursor-hook'], {
    cwd: dir,
    input: JSON.stringify({ workspace_roots: [dir], ...event }),
    encoding: 'utf-8',
    env: childEnv(options.importLog !== undefined ? { CTXO_IMPORT_LOG: options.importLog } : {}),
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ms: Date.now() - started };
}

describe('ctxo domain-cursor-hook (built CLI)', () => {
  it('reminds once on stop through the fast route and never blocks', () => {
    const dir = createProject(true);
    const importLog = join(tempDir('ctxo-domain-cursor-imports-'), 'imports.log');

    const prompt = cursorHook(dir, { conversation_id: 'conv-e2e', generation_id: 'g1', hook_event_name: 'beforeSubmitPrompt', prompt: 'go' });
    expect(prompt).toMatchObject({ status: 0, stdout: '{"continue":true}\n', stderr: '' });

    write(dir, 'src/Lending/LoanPolicy.cs', 'class LoanPolicy { int maxLoans = 5; }\n');
    commit(dir, 'change the loan policy');

    const stop = cursorHook(dir, { conversation_id: 'conv-e2e', generation_id: 'g1', hook_event_name: 'stop', status: 'completed', loop_count: 0 }, { importLog });
    expect(stop.status).toBe(0);
    expect(stop.stderr).toBe('');
    const out = JSON.parse(stop.stdout) as Record<string, string>;
    expect(Object.keys(out)).toEqual(['followup_message']);
    expect(out['followup_message']).toContain('ctxo domain reminder: 1 context has committed changes without a card update.');
    expect(out['followup_message']).toContain('  Domain-Unchanged: lending (reason)');

    // Once per conversation.
    const again = cursorHook(dir, { conversation_id: 'conv-e2e', generation_id: 'g2', hook_event_name: 'stop', status: 'completed', loop_count: 0 });
    expect(again).toMatchObject({ status: 0, stdout: '', stderr: '' });

    const urls = readFileSync(importLog, 'utf-8').split('\n').filter((line) => line.length > 0);
    const forbidden = urls.filter((url) => ['@modelcontextprotocol', 'cli-router', 'mcp-server'].some((name) => url.includes(name)));
    expect(forbidden).toEqual([]);
  });

  it('exits 0 silently without @ctxo/domain', () => {
    const dir = createProject(false);
    expect(cursorHook(dir, { conversation_id: 'c', hook_event_name: 'beforeSubmitPrompt' })).toMatchObject({ status: 0, stdout: '', stderr: '' });
    expect(cursorHook(dir, { conversation_id: 'c', hook_event_name: 'stop', loop_count: 0 })).toMatchObject({ status: 0, stdout: '', stderr: '' });
  });
});
