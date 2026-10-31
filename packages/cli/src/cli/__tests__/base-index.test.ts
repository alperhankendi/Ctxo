import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexCommitInWorktree, readIndexAtCommit, sweepLeftoverWorktrees } from '../base-index.js';
import { IndexCommand } from '../index-command.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];
/** The TypeScript plugin resolves from the CLI's own node_modules when the project has none. */
const PACKAGE_JSON = JSON.stringify({ name: 'sample', private: true, devDependencies: { '@ctxo/lang-typescript': '*' } });

let env: IsolatedGitEnv;
const dirs: string[] = [];

beforeEach(() => {
  env = isolateGitEnv();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  env.restore();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function put(dir: string, file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text, 'utf-8');
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, ...IDENTITY, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf-8').digest('hex');

/** An index entry for `file` under `<root>/.ctxo/index/`, hashed from `text` unless `hash` is given. */
function entry(root: string, file: string, text: string, hash: string | null = sha256(text)): void {
  const index: Record<string, unknown> = { file, lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] };
  if (hash !== null) index['contentHash'] = hash;
  put(root, `.ctxo/index/${file}.json`, JSON.stringify(index));
}

/** A source file and its matching index entry. */
function source(root: string, file: string, text: string): void {
  put(root, file, text);
  entry(root, file, text);
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-base-index-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

describe('readIndexAtCommit', () => {
  it('is undefined when the commit has no index entry', async () => {
    const dir = repo();
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const sha = commit(dir, 'init');
    expect(await readIndexAtCommit(dir, sha)).toBeUndefined();
  });

  it('reads the entries of the commit, not of the working tree, and calls them current when the hashes match', async () => {
    const dir = repo();
    put(dir, 'package.json', PACKAGE_JSON);
    source(dir, 'src/a.ts', 'export const a = 1;\n');
    put(dir, 'README.md', '# readme\n');
    // Artifacts and history are not entries.
    put(dir, '.ctxo/index/co-changes.json', '{"pairs":[]}');
    put(dir, '.ctxo/index/domain/boundaries.json', '{"ctxoArtifact":"domain-boundaries"}');
    const sha = commit(dir, 'init');
    source(dir, 'src/b.ts', 'export const b = 2;\n');

    const result = await readIndexAtCommit(dir, sha);
    expect(result).toMatchObject({ current: true, staleReasons: [] });
    expect(result!.indices.map((index) => index.file)).toEqual(['src/a.ts']);
  });

  it('is not current when a hash differs, an entry has none, a selected file has no entry or an entry is not selected', async () => {
    const dir = repo();
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    put(dir, 'src/b.ts', 'export const b = 1;\n');
    put(dir, 'src/c.ts', 'export const c = 1;\n');
    put(dir, 'src/ignored/d.ts', 'export const d = 1;\n');
    put(dir, '.ctxo/config.yaml', 'version: "1.0"\nindex:\n  ignore: ["src/ignored/**"]\n');
    entry(dir, 'src/a.ts', 'old text\n');
    entry(dir, 'src/b.ts', '', null);
    entry(dir, 'src/ignored/d.ts', 'export const d = 1;\n');
    const sha = commit(dir, 'init');

    const result = await readIndexAtCommit(dir, sha);
    expect(result!.current).toBe(false);
    expect(result!.staleReasons).toEqual([
      'src/c.ts: not indexed',
      'src/b.ts: the entry has no content hash',
      `src/ignored/d.ts: not a file ctxo index selects at ${sha.slice(0, 7)}`,
      'src/a.ts: content hash differs',
    ]);
  });

  it('compares through the checkout filters, so a CRLF checkout (core.autocrlf=true) is current', async () => {
    const dir = repo();
    git(dir, 'config', 'core.autocrlf', 'true');
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export const a = 1;\nexport const b = 2;\n');
    commit(dir, 'source');
    // Check out again: the working tree now holds CRLF, as on Windows; ctxo index hashes that text.
    rmSync(join(dir, 'src/a.ts'));
    git(dir, 'checkout', '--', 'src/a.ts');
    const onDisk = readFileSync(join(dir, 'src/a.ts'), 'utf-8');
    expect(onDisk).toContain('\r\n');
    entry(dir, 'src/a.ts', onDisk);
    const sha = commit(dir, 'index');

    expect(await readIndexAtCommit(dir, sha)).toMatchObject({ current: true });
  });

  it('compares through git\'s own filters when the raw and CRLF forms differ (a smudge filter)', async () => {
    const dir = repo();
    git(dir, 'config', 'filter.upper.smudge', 'tr a-z A-Z');
    git(dir, 'config', 'filter.upper.clean', 'cat');
    put(dir, '.gitattributes', '*.ts filter=upper\n');
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    commit(dir, 'source');
    rmSync(join(dir, 'src/a.ts'));
    git(dir, 'checkout', '--', 'src/a.ts');
    const onDisk = readFileSync(join(dir, 'src/a.ts'), 'utf-8');
    expect(onDisk).toBe('EXPORT CONST A = 1;\n');
    entry(dir, 'src/a.ts', onDisk);
    const sha = commit(dir, 'index');

    expect(await readIndexAtCommit(dir, sha)).toMatchObject({ current: true });
  });

  it('selects files as ctxo index does in an npm workspaces monorepo: no root-level files, no ignored projects', async () => {
    const dir = repo();
    put(dir, 'package.json', JSON.stringify({ ...JSON.parse(PACKAGE_JSON), workspaces: ['packages/*'] }));
    put(dir, '.ctxo/config.yaml', 'version: "1.0"\nindex:\n  ignoreProjects: ["packages/legacy"]\n');
    put(dir, 'vitest.config.ts', 'export default {};\n');
    put(dir, 'scripts/build.ts', 'export {};\n');
    put(dir, 'packages/legacy/src/old.ts', 'export const old = 1;\n');
    source(dir, 'packages/app/src/main.ts', 'export const main = 1;\n');
    const sha = commit(dir, 'init');

    expect(await readIndexAtCommit(dir, sha)).toMatchObject({ current: true, staleReasons: [] });
  });

  it('accepts the index a later commit holds when it is current for the commit (the post-commit hook lag)', async () => {
    const dir = repo();
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const base = commit(dir, 'source');
    // The hook indexes `base` after the commit; the entry lands with the next commit.
    entry(dir, 'src/a.ts', 'export const a = 1;\n');
    put(dir, 'docs/note.md', 'unrelated\n');
    const next = commit(dir, 'docs, and the index of the last commit');

    expect(await readIndexAtCommit(dir, base)).toBeUndefined();
    expect(await readIndexAtCommit(dir, base, { indexCommit: next })).toMatchObject({ current: true });

    // A later index whose files changed after the base is not current for it.
    source(dir, 'src/a.ts', 'export const a = 2;\n');
    const later = commit(dir, 'change a');
    expect(await readIndexAtCommit(dir, base, { indexCommit: later })).toMatchObject({ current: false, staleReasons: ['src/a.ts: content hash differs'] });
  });

  it('works from a project folder inside the repository', async () => {
    const dir = repo();
    const project = join(dir, 'app');
    put(project, 'package.json', PACKAGE_JSON);
    source(project, 'src/a.ts', 'export const a = 1;\n');
    put(dir, 'other/x.ts', 'export const x = 1;\n');
    const sha = commit(dir, 'init');

    const result = await readIndexAtCommit(project, sha);
    expect(result).toMatchObject({ current: true });
    expect(result!.indices.map((index) => index.file)).toEqual(['src/a.ts']);
  });

  it('refuses a revision that looks like a flag', async () => {
    const dir = repo();
    await expect(readIndexAtCommit(dir, '--output=x')).rejects.toThrow('invalid revision');
  });
});

describe('indexCommitInWorktree', () => {
  const worktreesOf = (dir: string): string[] => git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '));
  const parentOf = (dir: string): string => join(dir, '.ctxo', '.cache', 'base-worktrees');
  const leftovers = (dir: string): string[] => (existsSync(parentOf(dir)) ? readdirSync(parentOf(dir)) : []);

  it('indexes the commit in a temporary worktree, leaves the working tree alone and removes the worktree', async () => {
    const dir = repo();
    put(dir, '.gitignore', '.ctxo/.cache/\n');
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    const base = commit(dir, 'init');
    put(dir, 'src/a.ts', 'export function beta(): number {\n  return 2;\n}\n');
    commit(dir, 'rename alpha');
    put(dir, 'src/wip.ts', 'export const wip = 1;\n');

    const result = await indexCommitInWorktree(dir, base);
    const symbols = result.indices.flatMap((index) => index.symbols.map((symbol) => symbol.symbolId));
    expect(symbols).toContain('src/a.ts::alpha::function');
    expect(symbols).not.toContain('src/a.ts::beta::function');
    expect(result.edgeQuality).toBe('full');
    expect(result.warnings).toEqual([]);

    expect(worktreesOf(dir)).toHaveLength(1);
    expect(leftovers(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf-8')).toContain('beta');
    expect(existsSync(join(dir, 'src/wip.ts'))).toBe(true);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(existsSync(join(dir, '.ctxo', 'index'))).toBe(false);
  }, 120_000);

  it('warns when the base was indexed at a lower edge quality than HEAD', async () => {
    const dir = repo();
    put(dir, 'package.json', PACKAGE_JSON);
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const base = commit(dir, 'init');
    put(dir, '.ctxo/index/communities.json', JSON.stringify({ edgeQuality: 'full' }));
    vi.spyOn(IndexCommand.prototype, 'run').mockImplementation(async function (this: IndexCommand) {
      put(this.ctxoRoot, 'index/src/a.ts.json', JSON.stringify({ file: 'src/a.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] }));
      this.lastRunEdgeQuality = 'mixed';
      this.lastRunTiers = { csharp: 'syntax' };
    });

    const result = await indexCommitInWorktree(dir, base);
    expect(result.tiers).toEqual({ csharp: 'syntax' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('edge quality "mixed" (csharp on the syntax tier), HEAD\'s index at "full"');
    expect(result.warnings[0]).toContain('dotnet restore');
  });

  it('removes the worktree when the index fails', async () => {
    const dir = repo();
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const base = commit(dir, 'init');
    vi.spyOn(IndexCommand.prototype, 'run').mockRejectedValue(new Error('plugin crashed'));

    await expect(indexCommitInWorktree(dir, base)).rejects.toThrow('plugin crashed');
    expect(worktreesOf(dir)).toHaveLength(1);
    expect(leftovers(dir)).toEqual([]);
  });

  it('rejects an unknown commit without leaving a worktree', async () => {
    const dir = repo();
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    commit(dir, 'init');
    await expect(indexCommitInWorktree(dir, '0123456789abcdef0123456789abcdef01234567')).rejects.toThrow(/git worktree failed/);
    expect(worktreesOf(dir)).toHaveLength(1);
    expect(leftovers(dir)).toEqual([]);
  });

  it('sweeps the worktree a killed run left, and never one whose process still runs', async () => {
    const dir = repo();
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const base = commit(dir, 'init');
    const parent = parentOf(dir);
    mkdirSync(parent, { recursive: true });
    const dead = join(parent, 'dead');
    const live = join(parent, 'live');
    const old = join(parent, 'old');
    git(dir, 'worktree', 'add', '--detach', '--quiet', dead, base);
    writeFileSync(`${dead}.lock`, '2147483646', 'utf-8');
    mkdirSync(live);
    writeFileSync(`${live}.lock`, String(process.pid), 'utf-8');
    mkdirSync(old);
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(old, longAgo, longAgo);

    expect(sweepLeftoverWorktrees(dir, parent).sort()).toEqual(['dead', 'old']);
    expect(readdirSync(parent).sort()).toEqual(['live', 'live.lock']);
    expect(worktreesOf(dir)).toHaveLength(1);
  });
});
