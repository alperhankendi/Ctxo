import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { changeLogSize, writeCoChangeMatrix, type WriteCoChangeMatrixOptions } from '../index-cochange.js';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { resolveCoChangeConfig } from '../../core/config/load-config.js';
import type { CtxoConfig } from '../../core/config/config-schema.js';
import type { CanonicalCommit } from '../../core/history/change-log.js';
import type { CoChangeMatrix } from '../../core/types.js';

// Developer machines often set commit.gpgsign=true globally; a signing prompt would hang the test.
const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

const BASE_TIME = 1_700_000_000;
const SECONDS_PER_DAY = 86_400;

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSources(root: string, files: readonly string[]): void {
  for (const file of files) {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, `// ${file}\n`, 'utf-8');
  }
}

/** The n-th commit of a test history: dated n days after BASE_TIME, touching `files`. */
function commit(n: number, files: readonly string[]): CanonicalCommit {
  return {
    hash: `hash${n}`,
    message: `commit ${n}`,
    date: new Date((BASE_TIME + n * SECONDS_PER_DAY) * 1000).toISOString(),
    author: 'Test',
    committedAt: BASE_TIME + n * SECONDS_PER_DAY,
    files: [...files].sort(),
  };
}

/** Three commits, newest first, that each touch every file in `files`. */
function sharedHistory(files: readonly string[]): CanonicalCommit[] {
  return [commit(3, files), commit(2, files), commit(1, files)];
}

function coChangesPath(ctxoRoot: string): string {
  return join(ctxoRoot, 'index', 'co-changes.json');
}

function readMatrix(ctxoRoot: string): CoChangeMatrix {
  return JSON.parse(readFileSync(coChangesPath(ctxoRoot), 'utf-8')) as CoChangeMatrix;
}

function pairsOf(matrix: CoChangeMatrix): string[] {
  return matrix.entries.map((entry) => `${entry.file1} + ${entry.file2}`);
}

function optionsFor(
  project: string,
  overrides: Partial<WriteCoChangeMatrixOptions> & { config?: CtxoConfig } = {},
): WriteCoChangeMatrixOptions {
  const { config, ...rest } = overrides;
  return {
    writer: new JsonIndexWriter(join(project, '.ctxo')),
    projectRoot: project,
    commits: sharedHistory(['src/a.ts', 'src/b.ts']),
    head: 'abc1234',
    headCommittedAt: BASE_TIME + 3 * SECONDS_PER_DAY,
    coChange: resolveCoChangeConfig(config ?? {}),
    indexedFiles: ['src/a.ts', 'src/b.ts'],
    ...rest,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort: Windows can hold a handle briefly after the test body returns */
    }
  }
});

describe('changeLogSize', () => {
  // The co-change window needs `windowCommits` commits; intent[] needs enough history to find
  // `maxHistory` commits for every file, which is approximated as `maxHistory * 50`.
  it.each([
    ['the default window beats a small --max-history', 2000, 1, 2000],
    ['--max-history 100 asks for more than the default window', 2000, 100, 5000],
    ['the two limits are equal', 2000, 40, 2000],
    ['a wider window beats --max-history', 7000, 20, 7000],
    ['a narrow window still leaves room for --max-history', 3, 20, 1000],
  ])('%s', (_label, windowCommits, maxHistory, expected) => {
    expect(changeLogSize(windowCommits, maxHistory)).toBe(expected);
  });

  it('reads the whole history when the window is "all", whatever --max-history says', () => {
    expect(changeLogSize('all', 1)).toBe('all');
    expect(changeLogSize('all', 1000)).toBe('all');
  });
});

describe('writeCoChangeMatrix', () => {
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('writes the matrix of the indexed files and logs the window', () => {
    const project = tempDir('ctxo-cochange-step-');
    writeSources(project, ['src/a.ts', 'src/b.ts']);

    writeCoChangeMatrix(optionsFor(project));

    const matrix = readMatrix(join(project, '.ctxo'));
    expect(matrix.entries).toEqual([{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 3, frequency: 1 }]);
    expect(matrix.window).toMatchObject({ head: 'abc1234', commitsScanned: 3, commitsUsed: 3, massSkipped: 0 });
    expect(errorSpy).toHaveBeenCalledWith(
      '[ctxo] Co-change: 1 pairs from 3 commits (0 mass commits skipped, window last 2000 commits, 3 scanned)',
    );
  });

  it('drops an indexed file that is gone from the working tree', () => {
    const project = tempDir('ctxo-cochange-step-');
    writeSources(project, ['src/a.ts', 'src/b.ts']); // src/gone.ts is indexed but has no source left

    writeCoChangeMatrix(
      optionsFor(project, {
        commits: sharedHistory(['src/a.ts', 'src/b.ts', 'src/gone.ts']),
        indexedFiles: ['src/a.ts', 'src/b.ts', 'src/gone.ts'],
      }),
    );

    expect(pairsOf(readMatrix(join(project, '.ctxo')))).toEqual(['src/a.ts + src/b.ts']);
  });

  it('drops a tracked file that cochange.include matches but that is gone from the working tree', () => {
    const project = tempDir('ctxo-cochange-step-');
    writeSources(project, ['src/a.ts', 'db/live.sql', 'db/old.sql']);
    execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: project, stdio: 'ignore' });
    execFileSync('git', [...IDENTITY, 'commit', '-q', '-m', 'init'], { cwd: project, stdio: 'ignore' });
    // Deleted from the working tree but not yet from git: `git ls-files` still lists it.
    rmSync(join(project, 'db', 'old.sql'));

    writeCoChangeMatrix(
      optionsFor(project, {
        commits: sharedHistory(['src/a.ts', 'db/live.sql', 'db/old.sql']),
        indexedFiles: ['src/a.ts'],
        config: { cochange: { include: ['db/**'] } },
      }),
    );

    expect(pairsOf(readMatrix(join(project, '.ctxo')))).toEqual(['db/live.sql + src/a.ts']);
  });

  it('leaves co-changes.json untouched and says why when git cannot list the tracked files', () => {
    const project = tempDir('ctxo-cochange-step-');
    writeSources(project, ['src/a.ts', 'src/b.ts']);
    const writer = new JsonIndexWriter(join(project, '.ctxo'));
    // A good file from an earlier run.
    writeCoChangeMatrix(optionsFor(project, { writer }));
    const before = readFileSync(coChangesPath(join(project, '.ctxo')));
    errorSpy.mockClear();

    // The working directory does not exist, so `git ls-files` cannot run at all.
    writeCoChangeMatrix(
      optionsFor(project, {
        writer,
        projectRoot: join(project, 'no-such-directory'),
        commits: sharedHistory(['src/a.ts']),
        config: { cochange: { include: ['**/*.sql'] } },
      }),
    );

    expect(readFileSync(coChangesPath(join(project, '.ctxo'))).equals(before)).toBe(true);
    const lines = errorSpy.mock.calls.map((args) => args.join(' '));
    expect(lines).toContainEqual(expect.stringMatching(/^\[ctxo\] git ls-files failed: .+co-changes\.json not updated$/));
    expect(lines.some((line) => line.includes('Co-change:'))).toBe(false);
  });

  it('does not run git at all when cochange.include is empty', () => {
    const project = tempDir('ctxo-cochange-step-');

    // The working directory does not exist, so a `git ls-files` call would fail and skip the write.
    writeCoChangeMatrix(optionsFor(project, { projectRoot: join(project, 'no-such-directory') }));

    expect(existsSync(coChangesPath(join(project, '.ctxo')))).toBe(true);
    expect(errorSpy.mock.calls.map((args) => args.join(' ')).some((line) => line.includes('git ls-files'))).toBe(false);
  });
});
