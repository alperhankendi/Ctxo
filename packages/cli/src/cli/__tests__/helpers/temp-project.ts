import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'sample-project');

// Developer machines often set commit.gpgsign=true globally. Without these overrides every commit
// in a temp repo would open a GPG prompt and hang the test.
export const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

// The n-th commit of a TempProject is dated BASE_TIME + n days. "Newest first" never depends on how
// git breaks same-second ties, a `since` window has exact edges, and the dates sit years before the
// wall clock, so a window anchored to "now" instead of HEAD would show up as an empty one.
const BASE_TIME = 1_700_000_000;
const SECONDS_PER_DAY = 86_400;

export interface TempProject {
  readonly dir: string;
  git(...args: string[]): string;
  /** Writes a file (creating folders) without committing it. */
  write(file: string, content: string): void;
  /** Stages everything that is not ignored and commits it, dated one day after the previous commit. */
  commit(message: string): void;
  /** Appends a comment line to each file (creating it when needed), then commits them together. */
  commitTogether(message: string, files: readonly string[]): void;
}

// Every temp dir is registered the moment it exists, so cleanupTempProjects removes it even when a
// later setup step throws.
const tempDirs: string[] = [];

/** Registers a directory for removal by `cleanupTempProjects`. */
export function trackTempDir(dir: string): void {
  tempDirs.push(dir);
}

/** Removes every directory created since the last call; call it from afterEach. */
export function cleanupTempProjects(): void {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort: Windows holds simple-git / sqlite handles briefly after the test body returns */
    }
  }
}

/** A git repository holding the sample project, with one commit named `init` (day 1). */
export function createProject(): TempProject {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-cochange-'));
  trackTempDir(dir);
  cpSync(FIXTURES_DIR, dir, { recursive: true });
  let commits = 0;

  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  run(['init', '-q']);
  // Index runs write .ctxo/ and a .gitignore into the project; keep them out of later commits.
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '.ctxo/\n.gitignore\n');

  const project: TempProject = {
    dir,
    git: (...args) => run(args),
    write(file, content) {
      const full = join(dir, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    },
    commit(message) {
      commits += 1;
      const when = `${BASE_TIME + commits * SECONDS_PER_DAY} +0000`;
      run(['add', '-A']);
      run([...IDENTITY, 'commit', '-q', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
    },
    commitTogether(message, files) {
      for (const file of files) {
        const full = join(dir, file);
        mkdirSync(dirname(full), { recursive: true });
        appendFileSync(full, `// ${message}\n`);
      }
      project.commit(message);
    },
  };

  project.commit('init');
  return project;
}
