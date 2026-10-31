import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REGISTRY_SKELETON } from '../../src/init/domain-init.js';

/**
 * `ctxo init --only domain` through the built CLI, with @ctxo/domain linked into the project's
 * node_modules (a junction on Windows): config defaults, registry skeleton, fold guard hooks and skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = join(HERE, '..', '..');

const cliPackageJson = createRequire(import.meta.url).resolve('@ctxo/cli/package.json');
const CLI_BIN = join(dirname(cliPackageJson), (JSON.parse(readFileSync(cliPackageJson, 'utf-8')) as { bin: { ctxo: string } }).bin.ctxo);

const ISOLATED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_CONFIG_SYSTEM'];

const dirs: string[] = [];
let gitConfig: string;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ISOLATED) delete env[k];
  delete env['DEBUG'];
  delete env['CI'];
  env['GIT_CONFIG_GLOBAL'] = gitConfig;
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  return env;
}

function createProject(): string {
  const dir = tempDir('ctxo-domain-init-e2e-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: childEnv() });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'init-fixture', private: true }, null, 2));
  mkdirSync(join(dir, 'node_modules', '@ctxo'), { recursive: true });
  symlinkSync(DOMAIN_DIR, join(dir, 'node_modules', '@ctxo', 'domain'), 'junction');
  return dir;
}

function init(dir: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_BIN, 'init', ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: childEnv(),
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  if (!existsSync(CLI_BIN)) throw new Error(`Build @ctxo/cli first: ${CLI_BIN} is missing`);
  if (!existsSync(join(DOMAIN_DIR, 'dist', 'index.js'))) throw new Error('Build @ctxo/domain first: dist/index.js is missing');
  gitConfig = join(tempDir('ctxo-domain-init-gitenv-'), 'gitconfig');
  writeFileSync(gitConfig, '');
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('ctxo init --only domain (built CLI)', () => {
  it('sets up the config, registry, fold guard hooks and skill, and a second run writes nothing', () => {
    const dir = createProject();

    const first = init(dir, '--only', 'domain', '--tools', 'claude-code', '-y', '--boundaries', 'report');
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toBe('');

    const config = parse(readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8'));
    expect(config.domain.boundaries.enforce).toBe('report');
    expect(config.gate.enabled).toBe(true);
    expect(readFileSync(join(dir, 'docs', 'domain', 'contexts.yaml'), 'utf-8')).toBe(REGISTRY_SKELETON);

    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'));
    for (const event of ['SessionStart', 'Stop', 'TaskCompleted']) {
      expect(settings.hooks[event], event).toEqual([{ hooks: [{ type: 'command', command: 'ctxo domain-guard-hook' }] }]);
    }
    expect(settings.hooks.SubagentStop).toBeUndefined();
    expect(readFileSync(join(dir, '.claude', 'skills', 'ctxo-domain-fold', 'SKILL.md'), 'utf-8')).toContain('name: ctxo-domain-fold');
    expect(first.stderr.split('\n').filter((line) => line.startsWith('[ctxo] '))).toEqual([
      '[ctxo] ✓ .ctxo/config.yaml (created)',
      '[ctxo] ✓ docs/domain/contexts.yaml (created)',
      '[ctxo] ✓ .claude/settings.json (SessionStart) (created)',
      '[ctxo] ✓ .claude/settings.json (Stop) (updated)',
      '[ctxo] ✓ .claude/settings.json (TaskCompleted) (updated)',
      '[ctxo] ✓ .claude/skills/ctxo-domain-fold/SKILL.md (created)',
    ]);

    const second = init(dir, '--only', 'domain', '--tools', 'claude-code', '-y', '--boundaries', 'report');
    expect(second.status, second.stderr).toBe(0);
    const rows = second.stderr.split('\n').filter((line) => line.startsWith('[ctxo] '));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) expect(row).toMatch(/\(unchanged\)$/);
    expect(existsSync(join(dir, '.cursor', 'hooks.json'))).toBe(false);
  });

  it('with Cursor, merges the fold reminder into .cursor/hooks.json and keeps its other hooks', () => {
    const dir = createProject();
    mkdirSync(join(dir, '.cursor'));
    writeFileSync(join(dir, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }] } }, null, 2));

    const first = init(dir, '--only', 'domain', '--tools', 'cursor', '-y', '--boundaries', 'report');
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toContain('[ctxo] ✓ .cursor/hooks.json (updated)');
    expect(JSON.parse(readFileSync(join(dir, '.cursor', 'hooks.json'), 'utf-8'))).toEqual({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: './format.sh' }],
        beforeSubmitPrompt: [{ command: 'ctxo domain-cursor-hook' }],
        stop: [{ command: 'ctxo domain-cursor-hook' }],
      },
    });
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);

    const second = init(dir, '--only', 'domain', '--tools', 'cursor', '-y', '--boundaries', 'report');
    expect(second.stderr).toContain('[ctxo] ✓ .cursor/hooks.json (unchanged)');
  });
});
