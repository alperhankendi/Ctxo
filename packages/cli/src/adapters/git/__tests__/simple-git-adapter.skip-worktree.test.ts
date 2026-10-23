import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SimpleGitAdapter } from '../simple-git-adapter.js';

// Developer machines often set commit.gpgsign=true globally. Without these overrides every
// commit in a temp repo would open a GPG prompt and hang the test.
const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

// `git sparse-checkout` exists since git 2.25; its usage message exits with 129, an unknown command with 1.
const SPARSE_CHECKOUT_SUPPORTED = (() => {
  try {
    execFileSync('git', ['sparse-checkout', '-h'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    return (err as { status?: number }).status === 129;
  }
})();

// Every temp repo is registered the moment it exists, so afterEach removes it even when a later
// setup step throws.
const tempDirs: string[] = [];

interface TempRepo {
  readonly dir: string;
  git(...args: string[]): string;
  write(file: string, content: string): void;
  remove(file: string): void;
  commit(message: string): void;
}

function createRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-skip-worktree-'));
  tempDirs.push(dir);
  const run = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(['init', '-q']);

  return {
    dir,
    git: (...args) => run(args),
    write(file, content) {
      const full = join(dir, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    },
    remove(file) {
      rmSync(join(dir, file), { recursive: true, force: true });
    },
    commit(message) {
      run(['add', '-A']);
      run([...IDENTITY, 'commit', '-q', '-m', message]);
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort: Windows can hold a handle briefly after the test body returns */
    }
  }
});

describe('SimpleGitAdapter.getSkipWorktreePaths', () => {
  it('lists the tracked paths that git marks skip-worktree, verbatim and with forward slashes', async () => {
    const repo = createRepo();
    repo.write('src/kept.ts', 'export const kept = 1;\n');
    repo.write('docs/note.md', 'note\n');
    repo.write('odd dir/with space.ts', 'export const a = 1;\n');
    repo.write('src/\u00f6d\u00fcn\u00e7.ts', 'export const b = 2;\n');
    repo.commit('init');
    repo.git('update-index', '--skip-worktree', 'docs/note.md', 'odd dir/with space.ts', 'src/\u00f6d\u00fcn\u00e7.ts');
    // The files are gone from the working tree on purpose, as in a sparse checkout.
    repo.remove('docs');
    repo.remove('odd dir');
    repo.remove('src/\u00f6d\u00fcn\u00e7.ts');

    const paths = await new SimpleGitAdapter(repo.dir).getSkipWorktreePaths();

    expect(paths).toBeDefined();
    expect([...paths!].sort()).toEqual(['docs/note.md', 'odd dir/with space.ts', 'src/\u00f6d\u00fcn\u00e7.ts']);
  });

  it('returns an empty set when no path is marked', async () => {
    const repo = createRepo();
    repo.write('src/kept.ts', 'export const kept = 1;\n');
    repo.commit('init');

    const paths = await new SimpleGitAdapter(repo.dir).getSkipWorktreePaths();

    expect(paths).toBeDefined();
    expect(paths!.size).toBe(0);
  });

  it('returns an empty set in a repository without any commit', async () => {
    const repo = createRepo();

    const paths = await new SimpleGitAdapter(repo.dir).getSkipWorktreePaths();

    expect(paths).toBeDefined();
    expect(paths!.size).toBe(0);
  });

  it.skipIf(!SPARSE_CHECKOUT_SUPPORTED)('lists the paths outside the cone of a real sparse checkout', async () => {
    const repo = createRepo();
    repo.write('in/a.ts', 'export const a = 1;\n');
    repo.write('out/b.ts', 'export const b = 2;\n');
    repo.commit('init');
    repo.git('sparse-checkout', 'init', '--cone');
    repo.git('sparse-checkout', 'set', 'in');
    expect(existsSync(join(repo.dir, 'out'))).toBe(false); // really not checked out

    const paths = await new SimpleGitAdapter(repo.dir).getSkipWorktreePaths();

    expect([...paths!]).toEqual(['out/b.ts']);
  });

  it('returns undefined when git cannot list the files, so a caller can fail safe', async () => {
    // An existing directory that is not a repository: `git ls-files` fails there. The ceiling stops git
    // from finding a repository above the temp folder, wherever that folder happens to be.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notARepo = mkdtempSync(join(tmpdir(), 'ctxo-not-a-repo-'));
    tempDirs.push(notARepo);

    const paths = await new SimpleGitAdapter(notARepo).getSkipWorktreePaths();

    expect(paths).toBeUndefined();
    // The failure is reported once, and the test output stays clean.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ctxo:git\] ERROR Failed to list skip-worktree paths: /),
    );
  });
});
