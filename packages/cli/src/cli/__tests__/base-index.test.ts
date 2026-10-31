import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexCommitInWorktree, readIndexAtCommit } from '../base-index.js';
import { IndexCommand } from '../index-command.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

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

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-base-index-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

describe('readIndexAtCommit', () => {
  it('is undefined when the commit has no index entry', async () => {
    const dir = repo();
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const sha = commit(dir, 'init');
    expect(await readIndexAtCommit(dir, sha)).toBeUndefined();
  });

  it('reads the entries of the commit, not of the working tree, and calls them current when the hashes match', async () => {
    const dir = repo();
    const a = 'export const a = 1;\n';
    put(dir, 'src/a.ts', a);
    put(dir, 'README.md', '# readme\n');
    entry(dir, 'src/a.ts', a);
    // Artifacts and history are not entries.
    put(dir, '.ctxo/index/co-changes.json', '{"pairs":[]}');
    put(dir, '.ctxo/index/domain/boundaries.json', '{"ctxoArtifact":"domain-boundaries"}');
    const sha = commit(dir, 'init');
    // The working tree moves on: the commit's index is what is read.
    put(dir, 'src/b.ts', 'export const b = 2;\n');
    entry(dir, 'src/b.ts', 'export const b = 2;\n');

    const result = await readIndexAtCommit(dir, sha);
    expect(result).toMatchObject({ current: true, staleReasons: [] });
    expect(result!.indices.map((index) => index.file)).toEqual(['src/a.ts']);
  });

  it('is not current when a hash differs, an entry has none, or an indexable file has no entry', async () => {
    const dir = repo();
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    put(dir, 'src/b.ts', 'export const b = 1;\n');
    put(dir, 'src/c.ts', 'export const c = 1;\n');
    put(dir, 'src/ignored/d.ts', 'export const d = 1;\n');
    put(dir, '.ctxo/config.yaml', 'version: "1.0"\nindex:\n  ignore: ["src/ignored/**"]\n');
    entry(dir, 'src/a.ts', 'old text\n');
    entry(dir, 'src/b.ts', '', null);
    const sha = commit(dir, 'init');

    const result = await readIndexAtCommit(dir, sha);
    expect(result!.current).toBe(false);
    expect(result!.staleReasons).toEqual([
      'src/a.ts: content hash differs',
      'src/b.ts: the entry has no content hash',
      'src/c.ts: not indexed',
    ]);
  });

  it('works from a project folder inside the repository', async () => {
    const dir = repo();
    const project = join(dir, 'app');
    const a = 'export const a = 1;\n';
    put(project, 'src/a.ts', a);
    entry(project, 'src/a.ts', a);
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
  const leftovers = (dir: string): string[] => {
    const parent = join(dir, '.ctxo', '.cache', 'base-worktrees');
    return existsSync(parent) ? readdirSync(parent) : [];
  };

  it('indexes the commit in a temporary worktree, leaves the working tree alone and removes the worktree', async () => {
    const dir = repo();
    put(dir, '.gitignore', '.ctxo/.cache/\n');
    put(dir, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    const base = commit(dir, 'init');
    put(dir, 'src/a.ts', 'export function beta(): number {\n  return 2;\n}\n');
    commit(dir, 'rename alpha');
    put(dir, 'src/wip.ts', 'export const wip = 1;\n');

    const indices = await indexCommitInWorktree(dir, base);
    const symbols = indices.flatMap((index) => index.symbols.map((symbol) => symbol.symbolId));
    expect(symbols).toContain('src/a.ts::alpha::function');
    expect(symbols).not.toContain('src/a.ts::beta::function');

    expect(worktreesOf(dir)).toHaveLength(1);
    expect(leftovers(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf-8')).toContain('beta');
    expect(existsSync(join(dir, 'src/wip.ts'))).toBe(true);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(existsSync(join(dir, '.ctxo', 'index'))).toBe(false);
  }, 120_000);

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
});
