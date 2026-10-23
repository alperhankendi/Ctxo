import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexCommand } from '../index-command.js';
import { SimpleGitAdapter } from '../../adapters/git/simple-git-adapter.js';
import { CoChangeMatrixSchema, type CoChangeMatrix, type FileIndex } from '../../core/types.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';
import { FIXTURES_DIR, cleanupTempProjects, createProject, trackTempDir, type TempProject } from './helpers/temp-project.js';

const LONG_AGO = new Date('2001-01-01T00:00:00Z');

const GREET_AND_TYPES = ['src/greet.ts', 'src/types.ts'] as const;

/** `count` commits that each modify src/greet.ts and src/types.ts. */
function commitGreetAndTypes(project: TempProject, count: number): void {
  for (let n = 1; n <= count; n++) project.commitTogether(`feat: change ${n}`, GREET_AND_TYPES);
}

function coChangesFile(dir: string): string {
  return join(dir, '.ctxo', 'index', 'co-changes.json');
}

function readCoChanges(dir: string): CoChangeMatrix {
  return JSON.parse(readFileSync(coChangesFile(dir), 'utf-8')) as CoChangeMatrix;
}

function readFileIndex(dir: string, file: string): FileIndex {
  return JSON.parse(readFileSync(join(dir, '.ctxo', 'index', `${file}.json`), 'utf-8')) as FileIndex;
}

function findPair(matrix: CoChangeMatrix, file1: string, file2: string) {
  return matrix.entries.find((entry) => entry.file1 === file1 && entry.file2 === file2);
}

function mentions(matrix: CoChangeMatrix, file: string): boolean {
  return matrix.entries.some((entry) => entry.file1 === file || entry.file2 === file);
}

function writeConfig(dir: string, yaml: string): void {
  mkdirSync(join(dir, '.ctxo'), { recursive: true });
  writeFileSync(join(dir, '.ctxo', 'config.yaml'), `version: "1.0"\n${yaml}`, 'utf-8');
}

describe('IndexCommand co-change', () => {
  let project: TempProject;
  let errorSpy: MockInstance<typeof console.error>;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    // The temp repos commit and index with the machine's git: no inherited GIT_DIR, no global or
    // system git config.
    gitEnv = isolateGitEnv();
    project = createProject();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    cleanupTempProjects();
  });

  it('full index writes co-changes.json with window metadata', async () => {
    commitGreetAndTypes(project, 3);

    await new IndexCommand(project.dir).run();

    const matrix = readCoChanges(project.dir);
    const pair = findPair(matrix, 'src/greet.ts', 'src/types.ts');
    expect(pair).toBeDefined();
    // init plus the three commits above
    expect(pair!.sharedCommits).toBe(4);
    expect(pair!.sharedCommits).toBeGreaterThanOrEqual(2);
    expect(matrix.window).toEqual({
      maxCommits: 2000,
      head: project.git('rev-parse', '--short', 'HEAD'),
      commitsScanned: 4,
      commitsUsed: 4,
      massSkipped: 0,
      maxFilesPerCommit: 30,
      minShared: 2,
    });
    // The reader accepts what the builder wrote.
    expect(CoChangeMatrixSchema.safeParse(matrix).success).toBe(true);
  });

  it('the window is independent of --max-history', async () => {
    commitGreetAndTypes(project, 3);

    await new IndexCommand(project.dir).run({ maxHistory: 1 });

    const pair = findPair(readCoChanges(project.dir), 'src/greet.ts', 'src/types.ts');
    expect(pair!.sharedCommits).toBeGreaterThanOrEqual(2);
    expect(pair!.sharedCommits).toBe(4);
    // --max-history still decides how much commit history each file keeps.
    expect(readFileIndex(project.dir, 'src/greet.ts').intent).toHaveLength(1);
  });

  it('cochange.exclude removes files from the matrix and cochange.include adds non-indexed tracked files', async () => {
    for (let n = 1; n <= 3; n++) {
      project.commitTogether(`feat: change ${n}`, ['src/greet.ts', 'src/types.ts', 'docs/notes.md']);
    }

    // No cochange block yet: docs/notes.md is tracked, but no language plugin indexes it.
    await new IndexCommand(project.dir).run();
    const before = readCoChanges(project.dir);
    expect(findPair(before, 'src/greet.ts', 'src/types.ts')).toBeDefined();
    expect(mentions(before, 'docs/notes.md')).toBe(false);

    writeConfig(project.dir, 'cochange:\n  include:\n    - "docs/**"\n  exclude:\n    - "src/types.ts"\n');
    await new IndexCommand(project.dir).run();

    const after = readCoChanges(project.dir);
    expect(mentions(after, 'src/types.ts')).toBe(false);
    expect(findPair(after, 'docs/notes.md', 'src/greet.ts')?.sharedCommits).toBe(3);
  });

  it('cochange.exclude also removes a tracked file that cochange.include would add', async () => {
    for (let n = 1; n <= 3; n++) {
      project.commitTogether(`feat: change ${n}`, ['src/greet.ts', 'docs/notes.md', 'docs/other.md']);
    }

    writeConfig(project.dir, 'cochange:\n  include:\n    - "docs/**"\n  exclude:\n    - "docs/notes.md"\n');
    await new IndexCommand(project.dir).run();

    const matrix = readCoChanges(project.dir);
    expect(mentions(matrix, 'docs/notes.md')).toBe(false);
    expect(findPair(matrix, 'docs/other.md', 'src/greet.ts')?.sharedCommits).toBe(3);
  });

  it('intent[] follows renames', async () => {
    project.commitTogether('feat: change greet', ['src/greet.ts']);
    project.git('mv', 'src/greet.ts', 'src/hello.ts');
    project.commit('refactor: rename greet to hello');

    await new IndexCommand(project.dir).run();

    const hello = readFileIndex(project.dir, 'src/hello.ts');
    expect(hello.intent.map((commit) => commit.message)).toEqual([
      'refactor: rename greet to hello',
      'feat: change greet',
      'init',
    ]);
    expect(existsSync(join(project.dir, '.ctxo', 'index', 'src', 'greet.ts.json'))).toBe(false);
  });

  it('co-change keeps the history of a file across a rename', async () => {
    commitGreetAndTypes(project, 2);
    project.git('mv', 'src/greet.ts', 'src/hello.ts');
    project.commit('refactor: rename greet to hello');

    await new IndexCommand(project.dir).run();

    const matrix = readCoChanges(project.dir);
    // init and the two commits before the rename count for the new name; the old name is gone.
    expect(findPair(matrix, 'src/hello.ts', 'src/types.ts')?.sharedCommits).toBe(3);
    expect(mentions(matrix, 'src/greet.ts')).toBe(false);
  });

  it('a failing change log leaves an existing co-changes.json untouched', async () => {
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    const file = coChangesFile(project.dir);
    const before = readFileSync(file);

    // History moves on, so a run that does read git would write a different matrix.
    project.commitTogether('feat: change 3', GREET_AND_TYPES);
    const getChangeLog = vi.spyOn(SimpleGitAdapter.prototype, 'getChangeLog').mockResolvedValue(undefined);
    await expect(new IndexCommand(project.dir).run()).resolves.toBeUndefined();

    expect(getChangeLog).toHaveBeenCalled();
    expect(readFileSync(file).equals(before)).toBe(true);
    // intent[] and antiPatterns stay empty, as they did when the batch history failed.
    expect(readFileIndex(project.dir, 'src/greet.ts')).toMatchObject({ intent: [], antiPatterns: [] });

    // Control: with git readable again the same run does write the newer matrix.
    getChangeLog.mockRestore();
    await new IndexCommand(project.dir).run();
    expect(readFileSync(file).equals(before)).toBe(false);
  });

  it.each([
    ['--max-history 1 leaves the default window of 2000 commits', { maxHistory: 1 }, 2000],
    ['--max-history 100 asks for 100 * 50 commits, more than the default window', { maxHistory: 100 }, 5000],
    ['--cochange-commits all reads the whole history', { cochangeCommits: 'all' as const }, 'all'],
  ])('reads the change log with the right fetch size: %s', async (_label, options, expected) => {
    commitGreetAndTypes(project, 1);
    // No stub: the spy calls through, so the run still gets its real change log.
    const getChangeLog = vi.spyOn(SimpleGitAdapter.prototype, 'getChangeLog');

    await new IndexCommand(project.dir).run(options);

    expect(getChangeLog).toHaveBeenCalledTimes(1);
    expect(getChangeLog).toHaveBeenCalledWith(expected);
    expect(readCoChanges(project.dir).window).toMatchObject({ commitsScanned: 2 });
  });

  it('an unexpected failure while reading history does not stop the run or touch co-changes.json', async () => {
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    const before = readFileSync(coChangesFile(project.dir));
    rmSync(join(project.dir, '.ctxo', 'index', 'communities.json'));

    // The source changes on disk, so Phase 3 has something new to write.
    appendFileSync(join(project.dir, 'src', 'utils.ts'), 'export function shout(text: string): string { return text; }\n');
    vi.spyOn(SimpleGitAdapter.prototype, 'getChangeLog').mockRejectedValue(new Error('boom'));
    await expect(new IndexCommand(project.dir).run()).resolves.toBeUndefined();

    expect(readFileSync(coChangesFile(project.dir)).equals(before)).toBe(true);
    const lines = errorSpy.mock.calls.map((args) => args.join(' '));
    expect(lines).toContain('[ctxo] History and co-change skipped: boom');
    // The run went on: the new symbol is indexed (Phase 3) and the snapshot is rewritten (Phase 2c).
    expect(readFileIndex(project.dir, 'src/utils.ts').symbols.map((symbol) => symbol.name)).toContain('shout');
    expect(existsSync(join(project.dir, '.ctxo', 'index', 'communities.json'))).toBe(true);
  });

  it('a git ls-files failure leaves co-changes.json untouched instead of dropping the cochange.include files', async () => {
    for (let n = 1; n <= 3; n++) {
      project.commitTogether(`feat: change ${n}`, ['src/greet.ts', 'src/types.ts', 'docs/notes.md']);
    }
    writeConfig(project.dir, 'cochange:\n  include:\n    - "docs/**"\n');
    await new IndexCommand(project.dir).run();
    const before = readFileSync(coChangesFile(project.dir));
    expect(mentions(readCoChanges(project.dir), 'docs/notes.md')).toBe(true);

    // A broken index makes `git ls-files` fail, while `git log` still works. An explicit file list
    // keeps file discovery from needing `git ls-files`.
    writeFileSync(join(project.dir, '.git', 'index'), 'not an index', 'utf-8');
    errorSpy.mockClear();
    await expect(new IndexCommand(project.dir).run({ file: 'src/types.ts' })).resolves.toBeUndefined();

    expect(readFileSync(coChangesFile(project.dir)).equals(before)).toBe(true);
    const lines = errorSpy.mock.calls.map((args) => args.join(' '));
    expect(lines).toContainEqual(expect.stringMatching(/^\[ctxo\] git ls-files failed: .*co-changes\.json not updated$/));
  });

  it('a repository without any commit indexes without writing co-changes.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-cochange-nohead-'));
    trackTempDir(dir);
    cpSync(FIXTURES_DIR, dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });

    await expect(new IndexCommand(dir).run()).resolves.toBeUndefined();

    // The files are indexed (git ls-files lists untracked files too), but there is no history to read.
    expect(readFileIndex(dir, 'src/greet.ts')).toMatchObject({ intent: [], antiPatterns: [] });
    expect(existsSync(coChangesFile(dir))).toBe(false);
  });

  it('a shallow clone indexes with a smaller but valid window', async () => {
    commitGreetAndTypes(project, 2);
    const cloneParent = mkdtempSync(join(tmpdir(), 'ctxo-cochange-clone-'));
    trackTempDir(cloneParent);
    const cloneDir = join(cloneParent, 'clone');
    // file:// matters: a plain path would make git ignore --depth.
    execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(project.dir).href, cloneDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await expect(new IndexCommand(cloneDir).run()).resolves.toBeUndefined();

    const matrix = readCoChanges(cloneDir);
    expect(matrix.window?.commitsScanned).toBe(1);
    expect(matrix.window?.commitsUsed).toBe(1);
    expect(matrix.entries).toEqual([]);
    expect(CoChangeMatrixSchema.safeParse(matrix).success).toBe(true);
    expect(readFileIndex(cloneDir, 'src/greet.ts').intent).toHaveLength(1);
  });

  it('a second run on the same history does not rewrite co-changes.json', async () => {
    commitGreetAndTypes(project, 3);
    await new IndexCommand(project.dir).run();
    const file = coChangesFile(project.dir);
    const before = readFileSync(file);
    utimesSync(file, LONG_AGO, LONG_AGO);
    const agedMtime = statSync(file).mtimeMs;

    await new IndexCommand(project.dir).run();

    expect(statSync(file).mtimeMs).toBe(agedMtime);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('--skip-history leaves co-changes.json alone', async () => {
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    const before = readFileSync(coChangesFile(project.dir));

    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run({ skipHistory: true });

    expect(readFileSync(coChangesFile(project.dir)).equals(before)).toBe(true);
  });

  it('an incremental --file run keeps every co-change entry (#157)', async () => {
    commitGreetAndTypes(project, 3);
    await new IndexCommand(project.dir).run();
    const full = readCoChanges(project.dir);
    expect(full.entries.length).toBeGreaterThan(0);
    const before = readFileSync(coChangesFile(project.dir));

    await new IndexCommand(project.dir).run({ file: 'src/types.ts' });

    expect(readCoChanges(project.dir).entries).toEqual(full.entries);
    expect(readFileSync(coChangesFile(project.dir)).equals(before)).toBe(true);
  });

  it.each([
    ['a full run', undefined],
    ['an incremental --file run', 'src/types.ts'],
  ])('files deleted from the repo drop out of the matrix on %s', async (_label, file) => {
    for (let n = 1; n <= 2; n++) {
      project.commitTogether(`feat: change ${n}`, ['src/greet.ts', 'src/types.ts', 'src/utils.ts']);
    }
    await new IndexCommand(project.dir).run();
    expect(findPair(readCoChanges(project.dir), 'src/types.ts', 'src/utils.ts')).toBeDefined();

    project.git('rm', '-q', 'src/utils.ts');
    project.commit('chore: remove utils');
    // The index still holds the JSON of the deleted file, as it does until something removes it.
    expect(existsSync(join(project.dir, '.ctxo', 'index', 'src', 'utils.ts.json'))).toBe(true);

    await new IndexCommand(project.dir).run(file ? { file } : {});

    const matrix = readCoChanges(project.dir);
    expect(mentions(matrix, 'src/utils.ts')).toBe(false);
    expect(findPair(matrix, 'src/greet.ts', 'src/types.ts')).toBeDefined();
  });

  it('cochange.maxCommits from config.yaml sets the window and --cochange-commits overrides it', async () => {
    commitGreetAndTypes(project, 4); // 5 commits including init
    writeConfig(project.dir, 'cochange:\n  maxCommits: 3\n');

    await new IndexCommand(project.dir).run();
    expect(readCoChanges(project.dir).window).toMatchObject({ maxCommits: 3, commitsScanned: 3 });

    await new IndexCommand(project.dir).run({ cochangeCommits: 2 });
    expect(readCoChanges(project.dir).window).toMatchObject({ maxCommits: 2, commitsScanned: 2 });

    await new IndexCommand(project.dir).run({ cochangeCommits: 'all' });
    expect(readCoChanges(project.dir).window).toMatchObject({ maxCommits: 'all', commitsScanned: 5 });
  });

  it('--cochange-since counts back from the committer date of HEAD, not from the wall clock', async () => {
    commitGreetAndTypes(project, 4); // days 2 to 5 after init on day 1; HEAD is day 5

    await new IndexCommand(project.dir).run({ cochangeSince: '2d' });

    const matrix = readCoChanges(project.dir);
    // HEAD minus two days is day 3, and a commit made exactly at the cutoff stays: days 3, 4 and 5.
    expect(matrix.window).toMatchObject({ maxCommits: 2000, since: '2d', commitsScanned: 3, commitsUsed: 3 });
    expect(findPair(matrix, 'src/greet.ts', 'src/types.ts')?.sharedCommits).toBe(3);
    expect(CoChangeMatrixSchema.safeParse(matrix).success).toBe(true);
  });

  it('cochange.maxFilesPerCommit skips mass commits and reports them', async () => {
    commitGreetAndTypes(project, 3);
    writeConfig(project.dir, 'cochange:\n  maxFilesPerCommit: 2\n');

    await new IndexCommand(project.dir).run();

    // init touches three files, above the limit of two; the three small commits are used.
    const matrix = readCoChanges(project.dir);
    expect(matrix.window).toMatchObject({ maxFilesPerCommit: 2, commitsScanned: 4, commitsUsed: 3, massSkipped: 1 });
    expect(findPair(matrix, 'src/greet.ts', 'src/types.ts')?.sharedCommits).toBe(3);
  });

  it('logs how many pairs and commits the matrix is built from, and the window', async () => {
    commitGreetAndTypes(project, 3);

    await new IndexCommand(project.dir).run();

    const lines = errorSpy.mock.calls.map((args) => args.join(' '));
    expect(lines).toContain(
      '[ctxo] Co-change: 1 pairs from 4 commits (0 mass commits skipped, window last 2000 commits, 4 scanned)',
    );
  });
});
