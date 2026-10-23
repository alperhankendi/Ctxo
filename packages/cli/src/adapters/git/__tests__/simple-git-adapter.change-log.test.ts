import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SimpleGitAdapter } from '../simple-git-adapter.js';
import type { ChangeLog, FileChange } from '../../../core/types.js';

// Developer machines often set commit.gpgsign=true globally. Without these overrides every
// commit or merge in a temp repo would open a GPG prompt and hang the test.
const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

// The n-th commit made through a TempRepo is dated BASE_TIME + n minutes, so "newest first"
// never depends on how git breaks same-second ties.
const BASE_TIME = 1_700_000_000;
const commitTime = (n: number): number => BASE_TIME + n * 60;

interface TempRepo {
  readonly dir: string;
  git(...args: string[]): string;
  write(file: string, content: string): void;
  /** Stages everything, commits, and returns the full SHA. */
  commit(message: string): string;
  /** Merges with --no-ff so a merge commit is always created; returns the full SHA. */
  merge(branch: string, message: string): string;
}

// Every temp repo is registered here the moment it exists, so afterEach removes it even when
// a later setup step throws.
const tempDirs: string[] = [];

function createRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-change-log-'));
  tempDirs.push(dir);
  let commits = 0;

  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  const nextTimestamp = (): Record<string, string> => {
    commits += 1;
    const when = `${commitTime(commits)} +0000`;
    return { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  };

  run(['init', '-q']);
  // git log detects renames by default (diff.renames is on unless a user turns it off), and
  // diff-tree never reads that setting. Switching it off here means rename entries can only
  // come from the explicit -M the adapter passes.
  run(['config', 'diff.renames', 'false']);

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
      run([...IDENTITY, 'commit', '-q', '-m', message], nextTimestamp());
      return run(['rev-parse', 'HEAD']);
    },
    merge(branch, message) {
      run([...IDENTITY, 'merge', '--no-ff', '-q', '-m', message, branch], nextTimestamp());
      return run(['rev-parse', 'HEAD']);
    },
  };
}

/**
 * c1 on the main branch, c2 on a side branch, c3 on the main branch, then a --no-ff merge of
 * the side branch. Three non-merge commits are reachable from HEAD, and HEAD is a merge commit.
 */
function createMergedHistory() {
  const repo = createRepo();
  repo.write('src/a.ts', 'export const a = 1;\n');
  const c1 = repo.commit('add a');
  const mainBranch = repo.git('rev-parse', '--abbrev-ref', 'HEAD');

  repo.git('checkout', '-q', '-b', 'side');
  repo.write('src/side.ts', 'export const side = 1;\n');
  const c2 = repo.commit('add side');

  repo.git('checkout', '-q', mainBranch);
  repo.write('src/a.ts', 'export const a = 2;\n');
  const c3 = repo.commit('change a');

  const merge = repo.merge('side', 'merge side');
  return { repo, c1, c2, c3, merge };
}

async function readChangeLog(dir: string, maxCommits: number | 'all' = 'all'): Promise<ChangeLog> {
  const changeLog = await new SimpleGitAdapter(dir).getChangeLog(maxCommits);
  if (!changeLog) throw new Error('expected a change log, got undefined');
  return changeLog;
}

/** Sorts by path (codepoint order) so assertions do not depend on git's output order. */
function byPath(changes: FileChange[] | undefined): FileChange[] {
  if (!changes) throw new Error('expected file changes, got undefined');
  return [...changes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Replaces the adapter's git client with canned output, for shapes real git cannot be made to emit. */
function stubGitOutput(adapter: SimpleGitAdapter, output: (args: string[]) => string): void {
  Object.assign(adapter, { git: { raw: async (args: string[]) => output(args) } });
}

describe('SimpleGitAdapter change log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('getChangeLog returns non-merge commits newest first with name-status changes', async () => {
    const { repo, c1, c2, c3, merge } = createMergedHistory();

    const changeLog = await readChangeLog(repo.dir);

    expect(changeLog.commits.map((c) => c.hash)).toEqual([c3, c2, c1]);
    expect(changeLog.commits.map((c) => c.hash)).not.toContain(merge);
    expect(changeLog.commits.map((c) => c.changes)).toEqual([
      [{ status: 'M', path: 'src/a.ts' }],
      [{ status: 'A', path: 'src/side.ts' }],
      [{ status: 'A', path: 'src/a.ts' }],
    ]);

    const newest = changeLog.commits[0]!;
    expect(newest.message).toBe('change a');
    expect(newest.author).toBe('Test');
    expect(newest.committedAt).toBe(commitTime(3));
    expect(Date.parse(newest.date) / 1000).toBe(commitTime(3));
  });

  it('getChangeLog reports renames with oldPath', async () => {
    const repo = createRepo();
    repo.write('src/a.ts', 'export const a = 1;\n');
    repo.commit('add a');
    repo.git('mv', 'src/a.ts', 'src/b.ts');
    repo.commit('rename a to b');

    const changeLog = await readChangeLog(repo.dir);

    expect(changeLog.commits[0]?.changes).toEqual([
      { status: 'R', path: 'src/b.ts', oldPath: 'src/a.ts' },
    ]);
  });

  it('getChangeLog keeps paths with spaces and non-ASCII characters intact', async () => {
    const repo = createRepo();
    repo.write('src/ödünç kaydı.ts', 'export const kayit = 1;\n');
    repo.commit('add file with a non-ASCII name');

    const changeLog = await readChangeLog(repo.dir);

    expect(changeLog.commits[0]?.changes[0]?.path).toBe('src/ödünç kaydı.ts');
    expect(changeLog.commits[0]?.changes).toHaveLength(1);
  });

  it('getChangeLog honours maxCommits and anchors head to HEAD even when HEAD is a merge', async () => {
    const { repo, c2, c3, merge } = createMergedHistory();

    const changeLog = await readChangeLog(repo.dir, 2);

    expect(changeLog.commits.map((c) => c.hash)).toEqual([c3, c2]);
    expect(changeLog.head).toBe(repo.git('rev-parse', '--short', 'HEAD'));
    expect(merge.startsWith(changeLog.head)).toBe(true);
    expect(c3.startsWith(changeLog.head)).toBe(false);
    expect(changeLog.headCommittedAt).toBe(commitTime(4));
  });

  it('getChangeLog returns undefined in a repo with no commits', async () => {
    const repo = createRepo();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const changeLog = await new SimpleGitAdapter(repo.dir).getChangeLog('all');

    expect(changeLog).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ctxo:git]'));
  });

  it('getChangeLog handles a case-only rename and returns forward-slash paths', async () => {
    const repo = createRepo();
    repo.write('src/Foo.ts', 'export const foo = 1;\n');
    repo.commit('add Foo');
    repo.git('mv', 'src/Foo.ts', 'src/tmp.ts');
    repo.commit('Foo to tmp');
    repo.git('mv', 'src/tmp.ts', 'src/foo.ts');
    repo.commit('tmp to foo');

    const changeLog = await readChangeLog(repo.dir);

    expect(changeLog.commits.map((c) => c.changes)).toEqual([
      [{ status: 'R', path: 'src/foo.ts', oldPath: 'src/tmp.ts' }],
      [{ status: 'R', path: 'src/tmp.ts', oldPath: 'src/Foo.ts' }],
      [{ status: 'A', path: 'src/Foo.ts' }],
    ]);
    for (const change of changeLog.commits.flatMap((c) => c.changes)) {
      expect(change.path).not.toContain('\\');
      expect(change.oldPath ?? '').not.toContain('\\');
    }
  });

  it('getChangeLog tolerates CRLF noise and normalises backslash separators', async () => {
    const hash = 'a'.repeat(40);
    const adapter = new SimpleGitAdapter(tmpdir());
    stubGitOutput(adapter, (args) =>
      args.includes('-1')
        ? 'abc1234\x1f1700000100\r\n'
        : [
            `\x1e${hash}\x1f2023-11-14T22:14:20+00:00\x1f1700000060\x1fTest\x1fsubject line\r\x00\r\n`,
            'R100\x00src\\a.ts\x00src\\b.ts\x00',
            'M\x00src\\dir\\mod.ts\x00',
          ].join(''),
    );

    const changeLog = await adapter.getChangeLog('all');

    expect(changeLog).toEqual({
      head: 'abc1234',
      headCommittedAt: 1700000100,
      commits: [
        {
          hash,
          message: 'subject line',
          date: '2023-11-14T22:14:20+00:00',
          author: 'Test',
          committedAt: 1700000060,
          changes: [
            { status: 'R', path: 'src/b.ts', oldPath: 'src/a.ts' },
            { status: 'M', path: 'src/dir/mod.ts' },
          ],
        },
      ],
    });
  });

  it('getChangeLog and getCommitFileChanges pin output-affecting git config on every call', async () => {
    const calls: string[][] = [];
    const adapter = new SimpleGitAdapter(tmpdir());
    stubGitOutput(adapter, (args) => {
      calls.push(args);
      return args.includes('-1') ? 'abc1234\x1f1700000100\n' : '';
    });

    await adapter.getChangeLog('all');
    await adapter.getCommitFileChanges('abc1234');

    expect(calls).toHaveLength(3);
    for (const args of calls) {
      // quotepath keeps paths verbatim; showSignature=false keeps gpg text out of the log stream
      expect(args.slice(0, 4)).toEqual(['-c', 'core.quotepath=off', '-c', 'log.showSignature=false']);
    }
  });

  it('getChangeLog skips leading noise, broken records and unknown status letters', async () => {
    const first = 'b'.repeat(40);
    const second = 'c'.repeat(40);
    const header = (hash: string, time: number, subject: string) =>
      `\x1e${hash}\x1f2023-11-14T22:14:20+00:00\x1f${time}\x1fTest\x1f${subject}\x00\n`;
    const adapter = new SimpleGitAdapter(tmpdir());
    stubGitOutput(adapter, (args) =>
      args.includes('-1')
        ? 'abc1234\x1f1700000100\n'
        : [
            'gpg: Good signature\r\n',
            header(first, 1700000120, 'first'),
            'U\x00conflict.ts\x00T\x00src/link.ts\x00',
            '\x1enot-a-record',
            header(second, 1700000060, 'second'),
            'M\x00src/mod.ts\x00',
          ].join(''),
    );

    const changeLog = await adapter.getChangeLog('all');

    expect(changeLog?.commits.map((c) => [c.hash, c.changes])).toEqual([
      [first, [{ status: 'T', path: 'src/link.ts' }]],
      [second, [{ status: 'M', path: 'src/mod.ts' }]],
    ]);
  });

  it('getCommitFileChanges lists the files of a root commit and of a later commit, including deletions and renames', async () => {
    const repo = createRepo();
    repo.write('src/a.ts', 'export const a = 1;\n');
    repo.write('src/keep.ts', 'export const keep = 1;\n');
    repo.write('src/mod.ts', 'export const mod = 1;\n');
    const root = repo.commit('root');
    repo.git('mv', 'src/a.ts', 'src/b.ts');
    repo.git('rm', '-q', 'src/keep.ts');
    repo.write('src/mod.ts', 'export const mod = 2;\n');
    const later = repo.commit('rename, delete and modify');
    const adapter = new SimpleGitAdapter(repo.dir);

    expect(byPath(await adapter.getCommitFileChanges(root))).toEqual([
      { status: 'A', path: 'src/a.ts' },
      { status: 'A', path: 'src/keep.ts' },
      { status: 'A', path: 'src/mod.ts' },
    ]);
    expect(byPath(await adapter.getCommitFileChanges(later))).toEqual([
      { status: 'R', path: 'src/b.ts', oldPath: 'src/a.ts' },
      { status: 'D', path: 'src/keep.ts' },
      { status: 'M', path: 'src/mod.ts' },
    ]);
  });

  it('getCommitFileChanges returns an empty list for a merge commit', async () => {
    const { repo, merge } = createMergedHistory();

    expect(await new SimpleGitAdapter(repo.dir).getCommitFileChanges(merge)).toEqual([]);
  });

  it('getCommitFileChanges returns undefined for an unknown revision', async () => {
    const repo = createRepo();
    repo.write('src/a.ts', 'export const a = 1;\n');
    repo.commit('root');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await new SimpleGitAdapter(repo.dir).getCommitFileChanges('does-not-exist')).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ctxo:git]'));
  });

  it('getCommitFileChanges never forwards an option-like revision to git', async () => {
    const calls: string[][] = [];
    const adapter = new SimpleGitAdapter(tmpdir());
    stubGitOutput(adapter, (args) => {
      calls.push(args);
      return '';
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await adapter.getCommitFileChanges('--stdin')).toBeUndefined();

    expect(calls).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('option-like'));
  });
});
