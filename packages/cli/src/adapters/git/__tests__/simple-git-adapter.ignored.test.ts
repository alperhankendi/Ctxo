import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SimpleGitAdapter } from '../simple-git-adapter.js';

// Developer machines often set commit.gpgsign=true globally. Without these overrides every
// commit in a temp repo would open a GPG prompt and hang the test.
const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

// A name outside ASCII, built from its code point so that this file stays plain ASCII.
const S_CEDILLA = String.fromCharCode(0x15f);

// Every temp repo is registered the moment it exists, so afterEach removes it even when a later
// setup step throws.
const tempDirs: string[] = [];

interface TempRepo {
  readonly dir: string;
  git(...args: string[]): string;
  write(file: string, content: string): void;
  commit(message: string): void;
}

function createRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-ignored-'));
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

describe('SimpleGitAdapter.getIgnoredPaths', () => {
  it('returns the given paths that git ignores, and leaves out tracked and ordinary ones', async () => {
    const repo = createRepo();
    repo.write('.gitignore', 'dist/\n*.log\n');
    repo.write('src/kept.ts', 'export const kept = 1;\n');
    repo.write('dist/app.js', 'export const app = 1;\n');
    repo.write('dist/forced.js', 'export const forced = 1;\n');
    repo.write('logs/with space.log', 'a\n');
    repo.write(`logs/${S_CEDILLA}ube.log`, 'b\n');
    repo.git('add', '.gitignore', 'src/kept.ts');
    repo.git('add', '-f', 'dist/forced.js'); // tracked although the pattern matches: git does not call it ignored
    repo.commit('init');

    const ignored = await new SimpleGitAdapter(repo.dir).getIgnoredPaths([
      'src/kept.ts',
      'dist/app.js',
      'dist/forced.js',
      'logs/with space.log',
      `logs/${S_CEDILLA}ube.log`,
      'src/never-created.ts',
    ]);

    expect(ignored).toBeDefined();
    expect([...ignored!].sort()).toEqual(['dist/app.js', 'logs/with space.log', `logs/${S_CEDILLA}ube.log`]);
  });

  it('returns an empty set when none of the paths is ignored', async () => {
    const repo = createRepo();
    repo.write('src/kept.ts', 'export const kept = 1;\n');
    repo.commit('init');

    const ignored = await new SimpleGitAdapter(repo.dir).getIgnoredPaths(['src/kept.ts']);

    expect(ignored).toBeDefined();
    expect(ignored!.size).toBe(0);
  });

  it('returns an empty set for an empty list', async () => {
    const repo = createRepo();

    const ignored = await new SimpleGitAdapter(repo.dir).getIgnoredPaths([]);

    expect(ignored).toBeDefined();
    expect(ignored!.size).toBe(0);
  });

  it('returns undefined when git cannot check, so a caller can say so', async () => {
    // An existing directory that is not a repository. The ceiling stops git from finding a repository
    // above the temp folder, wherever that folder happens to be.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notARepo = mkdtempSync(join(tmpdir(), 'ctxo-not-a-repo-'));
    tempDirs.push(notARepo);

    const ignored = await new SimpleGitAdapter(notARepo).getIgnoredPaths(['src/a.ts']);

    expect(ignored).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[ctxo:git\] ERROR Failed to check ignored paths: /));
  });
});
