import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexCommand } from '../index-command.js';
import * as pluginLoader from '../plugin-loader.js';
import { compareCodepoint } from '../../core/compare-codepoint.js';
import { OrphanedFilesCheck } from '../../adapters/diagnostics/checks/index-check.js';
import { SimpleGitAdapter } from '../../adapters/git/simple-git-adapter.js';
import { JsonIndexReader } from '../../adapters/storage/json-index-reader.js';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../../adapters/storage/sqlite-storage-adapter.js';
import type {
  BoundaryViolationsArtifact,
  CoChangeMatrix,
  CommunitySnapshot,
  DriftEventsArtifact,
  FileIndex,
} from '../../core/types.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'sample-project');

// Developer machines often set commit.gpgsign=true globally. Every operation that creates a commit in
// a temp repo (commit, merge) must override it, or the test would wait for a GPG prompt.
const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

// The n-th commit of a TempProject is dated BASE_TIME + n days, so "newest first" never depends on how
// git breaks same-second ties.
const BASE_TIME = 1_700_000_000;
const SECONDS_PER_DAY = 86_400;

/** True on file systems that treat `a` and `A` as one name (Windows and, by default, macOS). */
const CASE_INSENSITIVE_FS = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'ctxo-case-probe-'));
  try {
    writeFileSync(join(probe, 'probe.txt'), '', 'utf-8');
    return existsSync(join(probe, 'PROBE.TXT'));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

interface TempProject {
  readonly dir: string;
  git(...args: string[]): string;
  /** Writes a file in the working tree, creating its folder when needed. */
  write(file: string, content: string): void;
  /** Appends one line to a file in the working tree. */
  append(file: string, line: string): void;
  /** Stages everything that is not ignored and commits it, dated one day after the previous commit. */
  commit(message: string): void;
  /** Merges `branch` into the current branch with a merge commit, dated like the other commits. */
  merge(branch: string): void;
  /** Short SHA of HEAD, as `git rev-parse --short HEAD` prints it. */
  head(): string;
}

// Every temp dir is registered the moment it exists, so afterEach removes it even when a later setup
// step throws.
const tempDirs: string[] = [];

/** A git repository holding the sample project, with one root commit named `init` (day 1). */
function createProject(): TempProject {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-incremental-'));
  tempDirs.push(dir);
  cpSync(FIXTURES_DIR, dir, { recursive: true });
  let commits = 0;

  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const nextDate = (): Record<string, string> => {
    commits += 1;
    const when = `${BASE_TIME + commits * SECONDS_PER_DAY} +0000`;
    return { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  };

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
    append(file, line) {
      appendFileSync(join(dir, file), `${line}\n`, 'utf-8');
    },
    commit(message) {
      const env = nextDate();
      run(['add', '-A']);
      run([...IDENTITY, 'commit', '-q', '-m', message], env);
    },
    merge(branch) {
      run([...IDENTITY, 'merge', '--no-ff', '-q', '-m', `merge ${branch}`, branch], nextDate());
    },
    head: () => run(['rev-parse', '--short', 'HEAD']),
  };

  project.commit('init');
  return project;
}

const GREET_AND_TYPES = ['src/greet.ts', 'src/types.ts'] as const;

/** `count` commits that each modify src/greet.ts and src/types.ts. */
function commitGreetAndTypes(project: TempProject, count: number): void {
  for (let n = 1; n <= count; n++) {
    for (const file of GREET_AND_TYPES) project.append(file, `// change ${n}`);
    project.commit(`feat: change ${n}`);
  }
}

/** The file of the two-cluster project whose edge to src/b/b1.ts is the only one that leaves a cluster. */
const BRIDGE = 'src/a/a3.ts';

/**
 * Writes (without committing) two tightly connected clusters of three files, a1 to a3 and b1 to b3,
 * joined by one edge from a3 to b1. With no snapshot history, that edge is the project's only
 * boundary violation.
 */
function writeTwoClusters(project: TempProject): void {
  const cluster = (name: string, others: string[]): string =>
    others.map((other) => `import { ${other} } from './${other}';`).join('\n') +
    `\nexport function ${name}(): number {\n  return ${others.map((other) => `${other}()`).join(' + ')};\n}\n`;
  project.write('src/a/a1.ts', cluster('a1', ['a2', 'a3']));
  project.write('src/a/a2.ts', cluster('a2', ['a1', 'a3']));
  project.write(
    BRIDGE,
    "import { b1 } from '../b/b1';\n" + cluster('a3', ['a1', 'a2']).replace('return a1() + a2()', 'return b1() + a1() + a2()'),
  );
  project.write('src/b/b1.ts', cluster('b1', ['b2', 'b3']));
  project.write('src/b/b2.ts', cluster('b2', ['b1', 'b3']));
  project.write('src/b/b3.ts', cluster('b3', ['b1', 'b2']));
}

/** A tracked file that no language plugin handles, as another machine, with a plugin this one lacks, would see it. */
const NOTE = 'docs/note.xyz';

/**
 * Writes the index entry that such a machine would have committed for `file`. The file itself must
 * exist in the repository: this machine cannot index it, but it must not throw the entry away.
 */
function writePluginlessEntry(project: TempProject, file: string): void {
  new JsonIndexWriter(join(project.dir, '.ctxo')).write({
    file,
    lastModified: 1_700_000_000,
    symbols: [{ symbolId: `${file}::Note::class`, name: 'Note', kind: 'class', startLine: 0, endLine: 1 }],
    edges: [],
    intent: [],
    antiPatterns: [],
  });
}

function indexJson(dir: string, file: string): string {
  return join(dir, '.ctxo', 'index', `${file}.json`);
}

function hasIndexEntry(dir: string, file: string): boolean {
  return existsSync(indexJson(dir, file));
}

function readFileIndex(dir: string, file: string): FileIndex {
  return JSON.parse(readFileSync(indexJson(dir, file), 'utf-8')) as FileIndex;
}

function symbolNames(dir: string, file: string): string[] {
  return readFileIndex(dir, file).symbols.map((symbol) => symbol.name);
}

function readCoChanges(dir: string): CoChangeMatrix {
  return JSON.parse(readFileSync(join(dir, '.ctxo', 'index', 'co-changes.json'), 'utf-8')) as CoChangeMatrix;
}

function readSnapshot(dir: string): CommunitySnapshot {
  return JSON.parse(readFileSync(join(dir, '.ctxo', 'index', 'communities.json'), 'utf-8')) as CommunitySnapshot;
}

/** A snapshot without the one field that differs between two runs at the same HEAD. */
const withoutComputedAt = (snapshot: CommunitySnapshot): Omit<CommunitySnapshot, 'computedAt'> => {
  const { computedAt: _computedAt, ...rest } = snapshot;
  return rest;
};

function readViolations(dir: string): BoundaryViolationsArtifact {
  return JSON.parse(
    readFileSync(join(dir, '.ctxo', 'index', 'boundary-violations.json'), 'utf-8'),
  ) as BoundaryViolationsArtifact;
}

function readDrift(dir: string): DriftEventsArtifact {
  return JSON.parse(readFileSync(join(dir, '.ctxo', 'index', 'drift-events.json'), 'utf-8')) as DriftEventsArtifact;
}

function writeConfig(dir: string, yaml: string): void {
  mkdirSync(join(dir, '.ctxo'), { recursive: true });
  writeFileSync(join(dir, '.ctxo', 'config.yaml'), `version: "1.0"\n${yaml}`, 'utf-8');
}

// A file whose source changes on disk, without a commit, while an incremental run names other files:
// that run must leave its index entry as it was. A full run, which re-indexes everything, would pick
// the marker up, so every scenario that has to prove "only the named files" uses this pair.
const MARKER = 'changedOnDiskOnly';

function changeOnDisk(project: TempProject, file: string): void {
  project.append(file, `export function ${MARKER}(): void {}`);
}

function expectNotReindexed(project: TempProject, file: string): void {
  expect(symbolNames(project.dir, file)).not.toContain(MARKER);
}

interface IndexContents {
  readonly files: string[];
  readonly symbolIds: string[];
  readonly edgeCount: number;
}

/** What the committed JSON index holds. */
function readJsonContents(dir: string): IndexContents {
  const indices = new JsonIndexReader(join(dir, '.ctxo')).readAll();
  return {
    files: indices.map((idx) => idx.file).sort(),
    symbolIds: indices.flatMap((idx) => idx.symbols.map((symbol) => symbol.symbolId)).sort(),
    edgeCount: indices.reduce((sum, idx) => sum + idx.edges.length, 0),
  };
}

/**
 * What the SQLite cache holds, read from a copy of the cache file placed in a root without a JSON
 * index. init() rebuilds the cache from the JSON index when there is one; with none, it keeps exactly
 * what the run under test persisted.
 */
async function readSqliteContents(dir: string): Promise<IndexContents> {
  const scratch = mkdtempSync(join(tmpdir(), 'ctxo-sqlite-view-'));
  tempDirs.push(scratch);
  mkdirSync(join(scratch, '.cache'), { recursive: true });
  cpSync(join(dir, '.ctxo', '.cache', 'symbols.db'), join(scratch, '.cache', 'symbols.db'));

  const storage = new SqliteStorageAdapter(scratch);
  try {
    await storage.init();
    return {
      files: storage.listIndexedFiles(),
      symbolIds: storage.getAllSymbols().map((symbol) => symbol.symbolId).sort(),
      edgeCount: storage.getAllEdges().length,
    };
  } finally {
    storage.close();
  }
}

function logLines(spy: MockInstance<typeof console.error>): string[] {
  return spy.mock.calls.map((args) => args.join(' '));
}

/** The run options that select the given paths: the `files` option, or the older `file` spelling. */
type Selector = (paths: string[]) => { files?: string[]; file?: string };

const SPELLINGS: Array<[string, Selector]> = [
  ['--files', (paths) => ({ files: paths })],
  ['--file', (paths) => ({ file: paths[0] })],
];

describe('IndexCommand incremental runs', () => {
  let project: TempProject;
  let errorSpy: MockInstance<typeof console.error>;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    // The temp repos commit and index with the machine's git: no inherited GIT_DIR, no global or
    // system git config (a global core.quotePath=false would also hide the non-ASCII path bugs).
    gitEnv = isolateGitEnv();
    project = createProject();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        /* best effort: Windows holds simple-git / sqlite handles briefly after the test body returns */
      }
    }
  });

  // --file is the old spelling of --files with one path; both must behave the same.
  describe.each(SPELLINGS)('%s', (_flag, select) => {
    it('keeps every co-change entry', async () => {
      commitGreetAndTypes(project, 3);
      await new IndexCommand(project.dir).run();
      const full = readCoChanges(project.dir);
      expect(full.entries.length).toBeGreaterThan(0);
      const before = readFileSync(join(project.dir, '.ctxo', 'index', 'co-changes.json'));
      changeOnDisk(project, 'src/utils.ts');

      await new IndexCommand(project.dir).run(select(['src/types.ts']));

      expect(readCoChanges(project.dir).entries).toEqual(full.entries);
      expect(readFileSync(join(project.dir, '.ctxo', 'index', 'co-changes.json')).equals(before)).toBe(true);
      expectNotReindexed(project, 'src/utils.ts');
    });

    it('keeps SQLite complete', async () => {
      await new IndexCommand(project.dir).run();
      expect((await readSqliteContents(project.dir)).files).toEqual(['src/greet.ts', 'src/types.ts', 'src/utils.ts']);
      changeOnDisk(project, 'src/utils.ts');

      await new IndexCommand(project.dir).run(select(['src/types.ts']));

      // Every indexed file, not just the one named, with the symbols and edges of the JSON index once each.
      const cache = await readSqliteContents(project.dir);
      const json = readJsonContents(project.dir);
      expect(cache.files).toEqual(['src/greet.ts', 'src/types.ts', 'src/utils.ts']);
      expect(cache.files).toEqual(json.files);
      expect(cache.symbolIds).toEqual(json.symbolIds);
      expect(cache.edgeCount).toBe(json.edgeCount);
      expect(cache.edgeCount).toBeGreaterThan(0);
      expectNotReindexed(project, 'src/utils.ts');
    });

    it('resolves edges against the committed registry', async () => {
      // A PascalCase function: without the registry its kind would be guessed as a class.
      project.write('src/models.ts', 'export function Widget(): string {\n  return "widget";\n}\n');
      project.write(
        'src/render.ts',
        "import { Widget } from './models';\n\nexport function render(): string {\n  return Widget();\n}\n",
      );
      project.commit('feat: add widget and render');
      await new IndexCommand(project.dir).run();
      const fullEdges = readFileIndex(project.dir, 'src/render.ts').edges;
      expect(fullEdges.length).toBeGreaterThan(0);
      expect(fullEdges.map((edge) => edge.to)).toContain('src/models.ts::Widget::function');
      project.append('src/render.ts', '// edited');
      changeOnDisk(project, 'src/utils.ts');

      await new IndexCommand(project.dir).run(select(['src/render.ts']));

      expect(readFileIndex(project.dir, 'src/render.ts').edges).toEqual(fullEdges);
      expectNotReindexed(project, 'src/utils.ts');
    });

    it('computes boundary-violations.json from the full graph', async () => {
      // a1 has no edge that leaves its cluster, so re-indexing a1 alone sees no violation unless the
      // full graph is used.
      writeTwoClusters(project);
      project.commit('feat: two clusters with one bridge');
      await new IndexCommand(project.dir).run();
      const full = readViolations(project.dir);
      expect(full.violations.length).toBeGreaterThan(0);
      changeOnDisk(project, 'src/b/b2.ts');

      await new IndexCommand(project.dir).run(select(['src/a/a1.ts']));

      const incremental = readViolations(project.dir);
      expect(incremental.violations.length).toBe(full.violations.length);
      expect(incremental.commitSha).toBe(project.head());
      expectNotReindexed(project, 'src/b/b2.ts');
    });
  });

  // A file that has left the project (deleted, or newly excluded by index.ignore) is gone from SQLite,
  // the snapshot, the artifacts and the co-change matrix after a full run, and its JSON is pruned.
  const LEAVES_THE_PROJECT: Array<[string, (leaving: TempProject) => void]> = [
    ['deleted', (leaving) => rmSync(join(leaving.dir, BRIDGE))],
    [
      'newly matched by index.ignore',
      (leaving) => writeConfig(leaving.dir, `index:\n  ignore:\n    - "${BRIDGE}"\n`),
    ],
  ];

  describe.each(LEAVES_THE_PROJECT)('a full run after the bridge file is %s', (_how, leaveTheProject) => {
    it('leaves it out of SQLite, the snapshot, the artifacts and the co-change matrix', async () => {
      writeTwoClusters(project);
      project.commit('feat: two clusters with one bridge');
      for (let n = 1; n <= 2; n++) {
        // The bridge and a1 change together, so the co-change matrix pairs them.
        project.append(BRIDGE, `// change ${n}`);
        project.append('src/a/a1.ts', `// change ${n}`);
        project.commit(`feat: change ${n}`);
      }
      const mentionsBridge = (value: unknown): boolean => JSON.stringify(value).includes(BRIDGE);

      await new IndexCommand(project.dir).run();
      const before = await readSqliteContents(project.dir);
      expect(before.files).toContain(BRIDGE);
      expect(mentionsBridge(readSnapshot(project.dir).communities)).toBe(true);
      expect(mentionsBridge(readViolations(project.dir).violations)).toBe(true);
      expect(mentionsBridge(readCoChanges(project.dir).entries)).toBe(true);

      leaveTheProject(project);
      await new IndexCommand(project.dir).run();

      expect(hasIndexEntry(project.dir, BRIDGE)).toBe(false); // pruned, so no later run can bring it back
      const cache = await readSqliteContents(project.dir);
      expect(cache.files).not.toContain(BRIDGE);
      expect(cache.symbolIds.some((id) => id.startsWith(`${BRIDGE}::`))).toBe(false);
      expect(mentionsBridge(readSnapshot(project.dir).communities)).toBe(false);
      expect(mentionsBridge(readViolations(project.dir).violations)).toBe(false);
      expect(mentionsBridge(readCoChanges(project.dir).entries)).toBe(false);
      // What is left is the rest of the project, still complete.
      expect(cache.files).toEqual(before.files.filter((file) => file !== BRIDGE));
    });
  });

  // A full run does not leave the index of the files that have left the project lying around, because an
  // incremental run builds on the committed index and would bring them back. It prunes only what is
  // surely stale: the source is gone, or index.ignore / index.ignoreProjects now excludes it. A file that
  // exists and is not excluded stays, even when no plugin loaded here handles it.
  describe('a full run prunes stale index entries', () => {
    async function indexFilesThatWillLeave(): Promise<void> {
      project.write('src/gone.ts', 'export const gone = 1;\n');
      project.write('src/muted.ts', 'export const muted = 1;\n');
      project.write(NOTE, 'a note that no plugin here handles\n');
      project.commit('feat: files that will leave the index');
      writePluginlessEntry(project, NOTE);
      await new IndexCommand(project.dir).run();
      for (const file of ['src/gone.ts', 'src/muted.ts', NOTE]) {
        expect(hasIndexEntry(project.dir, file)).toBe(true);
      }
    }

    async function makeTwoOfThemLeave(): Promise<void> {
      rmSync(join(project.dir, 'src', 'gone.ts'));
      writeConfig(project.dir, 'index:\n  ignore:\n    - "src/muted.ts"\n');
      await new IndexCommand(project.dir).run();
    }

    it('deletes the JSON of a deleted file and of a newly ignored file, and keeps that of a file only its plugin is missing for', async () => {
      await indexFilesThatWillLeave();
      errorSpy.mockClear();

      await makeTwoOfThemLeave();

      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(false);
      expect(hasIndexEntry(project.dir, 'src/muted.ts')).toBe(false);
      // It exists and is not ignored; this machine just has no plugin for it.
      expect(hasIndexEntry(project.dir, NOTE)).toBe(true);
      expect(readFileIndex(project.dir, NOTE).symbols.map((symbol) => symbol.name)).toEqual(['Note']);
      for (const file of ['src/greet.ts', 'src/types.ts', 'src/utils.ts']) {
        expect(hasIndexEntry(project.dir, file)).toBe(true);
      }
      expect(logLines(errorSpy).some((line) => line.startsWith('[ctxo] Pruned 2 stale index entries'))).toBe(true);
    });

    it('also deletes the JSON of files in a project that index.ignoreProjects now skips', async () => {
      project.write(
        'package.json',
        JSON.stringify({ name: 'root', workspaces: ['packages/*'], devDependencies: { '@ctxo/lang-typescript': 'workspace:*' } }),
      );
      project.write('packages/keep/package.json', JSON.stringify({ name: 'keep' }));
      project.write('packages/keep/src/a.ts', 'export const a = 1;\n');
      project.write('packages/experimental-foo/package.json', JSON.stringify({ name: 'experimental-foo' }));
      project.write('packages/experimental-foo/src/b.ts', 'export const b = 2;\n');
      project.commit('feat: workspaces');
      await new IndexCommand(project.dir).run();
      expect(hasIndexEntry(project.dir, 'packages/experimental-foo/src/b.ts')).toBe(true);

      writeConfig(project.dir, 'index:\n  ignoreProjects:\n    - "packages/experimental-*"\n');
      await new IndexCommand(project.dir).run();

      expect(hasIndexEntry(project.dir, 'packages/experimental-foo/src/b.ts')).toBe(false);
      expect(hasIndexEntry(project.dir, 'packages/keep/src/a.ts')).toBe(true);
    });

    it('refreshes co-change, the snapshot and SQLite when the last indexed files leave the project', async () => {
      commitGreetAndTypes(project, 2);
      await new IndexCommand(project.dir).run();
      expect(readCoChanges(project.dir).entries.length).toBeGreaterThan(0);

      // Nothing is discovered any more, so this run re-indexes no file; it only prunes.
      writeConfig(project.dir, 'index:\n  ignore:\n    - "src/**"\n');
      await new IndexCommand(project.dir).run();

      for (const file of ['src/greet.ts', 'src/types.ts', 'src/utils.ts']) {
        expect(hasIndexEntry(project.dir, file)).toBe(false);
      }
      expect((await readSqliteContents(project.dir)).files).toEqual([]);
      expect(readSnapshot(project.dir).communities).toEqual([]);
      expect(readCoChanges(project.dir).entries).toEqual([]);
    });

    it('does not prune on an incremental run', async () => {
      await indexFilesThatWillLeave();
      rmSync(join(project.dir, 'src', 'gone.ts'));

      await new IndexCommand(project.dir).run({ files: ['src/types.ts'] });

      // Only the listed file is looked at; clearing the rest of the index is the job of a full run.
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(true);
    });

    it('a later --files run does not bring the pruned files back', async () => {
      await indexFilesThatWillLeave();
      await makeTwoOfThemLeave();

      await new IndexCommand(project.dir).run({ files: ['src/types.ts'] });

      const cache = await readSqliteContents(project.dir);
      expect(cache.files).not.toContain('src/gone.ts');
      expect(cache.files).not.toContain('src/muted.ts');
      const snapshot = JSON.stringify(readSnapshot(project.dir).communities);
      expect(snapshot).not.toContain('src/gone.ts');
      expect(snapshot).not.toContain('src/muted.ts');
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(false);
      expect(hasIndexEntry(project.dir, 'src/muted.ts')).toBe(false);
    });
  });

  // In a sparse checkout git still tracks the files outside the cone, but they are absent from the working
  // tree on purpose. Their committed index entries are data that other machines rely on, so nothing may
  // delete one just because its source is not on disk.
  describe('a path that git marks skip-worktree is never removed from the index', () => {
    async function indexThenGoSparse(): Promise<void> {
      project.write('src/off-cone.ts', 'export const offCone = 1;\n');
      project.write('src/gone.ts', 'export const gone = 1;\n');
      project.commit('feat: files for the sparse checkout');
      await new IndexCommand(project.dir).run();
      expect(hasIndexEntry(project.dir, 'src/off-cone.ts')).toBe(true);
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(true);
      // The checkout turns sparse: git still tracks the file, but it is no longer in the working tree.
      project.git('update-index', '--skip-worktree', 'src/off-cone.ts');
      rmSync(join(project.dir, 'src', 'off-cone.ts'));
      // A file that is really deleted, for contrast.
      rmSync(join(project.dir, 'src', 'gone.ts'));
    }

    const FAIL_SAFE_WARNING =
      '[ctxo] Could not tell which paths git marks skip-worktree (sparse checkout): no stale index entry was removed';

    it('a full run keeps the JSON of the skip-worktree path and still prunes the deleted file', async () => {
      await indexThenGoSparse();
      const skipWorktree = vi.spyOn(SimpleGitAdapter.prototype, 'getSkipWorktreePaths'); // calls through

      await new IndexCommand(project.dir).run();

      expect(hasIndexEntry(project.dir, 'src/off-cone.ts')).toBe(true);
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(false);
      expect(skipWorktree).toHaveBeenCalledTimes(1); // one git call, kept in memory
      expect(logLines(errorSpy).some((line) => line.startsWith('[ctxo] Pruned 1 stale index entry'))).toBe(true);
    });

    it('a full run prunes nothing when git cannot tell which paths are skip-worktree', async () => {
      await indexThenGoSparse();
      vi.spyOn(SimpleGitAdapter.prototype, 'getSkipWorktreePaths').mockResolvedValue(undefined);
      errorSpy.mockClear();

      await new IndexCommand(project.dir).run();

      expect(hasIndexEntry(project.dir, 'src/off-cone.ts')).toBe(true);
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(true); // fail safe: not even the deleted one
      expect(logLines(errorSpy)).toContain(FAIL_SAFE_WARNING);
      expect(logLines(errorSpy).some((line) => line.includes('Pruned'))).toBe(false);
    });

    it('a full run does not ask git while nothing looks stale', async () => {
      await new IndexCommand(project.dir).run();
      const skipWorktree = vi.spyOn(SimpleGitAdapter.prototype, 'getSkipWorktreePaths');

      await new IndexCommand(project.dir).run();

      expect(skipWorktree).not.toHaveBeenCalled();
    });

    it('--files keeps the JSON of a skip-worktree path that is absent and drops the one that is deleted', async () => {
      await indexThenGoSparse();

      await new IndexCommand(project.dir).run({ files: ['src/off-cone.ts', 'src/gone.ts'] });

      expect(hasIndexEntry(project.dir, 'src/off-cone.ts')).toBe(true);
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(false);
    });

    it('--files removes nothing when git cannot tell which paths are skip-worktree', async () => {
      await indexThenGoSparse();
      vi.spyOn(SimpleGitAdapter.prototype, 'getSkipWorktreePaths').mockResolvedValue(undefined);
      errorSpy.mockClear();

      await new IndexCommand(project.dir).run({ files: ['src/off-cone.ts', 'src/gone.ts'] });

      expect(hasIndexEntry(project.dir, 'src/off-cone.ts')).toBe(true);
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(true);
      expect(logLines(errorSpy)).toContain(FAIL_SAFE_WARNING);
    });

    it('--commit HEAD keeps the JSON of a skip-worktree path that the commit changed', async () => {
      project.write('src/off-cone.ts', 'export const offCone = 1;\n');
      project.commit('feat: add the file');
      await new IndexCommand(project.dir).run();
      // A commit that reaches the repository without the file being in this working tree (a cherry-pick,
      // say) lists it as modified while it is absent.
      project.append('src/off-cone.ts', '// edited elsewhere');
      project.commit('feat: edit the file');
      project.git('update-index', '--skip-worktree', 'src/off-cone.ts');
      rmSync(join(project.dir, 'src', 'off-cone.ts'));

      await new IndexCommand(project.dir).run({ commit: 'HEAD' });

      expect(hasIndexEntry(project.dir, 'src/off-cone.ts')).toBe(true);
    });
  });

  // The co-change matrix is committed and shared, so it must not depend on which language plugins the
  // machine that wrote it had loaded: every file the committed index knows, and that still exists and is
  // not excluded, takes part, whether this run could index it or not. Communities, SQLite and the
  // architecture artifacts are local graph products and hold the files this run discovered.
  describe('co-change does not depend on the installed language plugins', () => {
    async function indexWithHistory(): Promise<void> {
      project.write(NOTE, 'a note that no plugin here handles\n');
      project.commit('feat: add the note');
      for (let n = 1; n <= 3; n++) {
        project.append(NOTE, `change ${n}`);
        project.append('src/types.ts', `// change ${n}`);
        project.commit(`feat: change ${n}`);
      }
      writePluginlessEntry(project, NOTE);
      await new IndexCommand(project.dir).run();
    }

    it('a file this machine cannot index still takes part in the co-change matrix of a full run', async () => {
      await indexWithHistory();

      const pair = readCoChanges(project.dir).entries.find(
        (entry) => entry.file1 === NOTE && entry.file2 === 'src/types.ts',
      );
      expect(pair).toBeDefined();
      expect(pair!.sharedCommits).toBe(3);
      // The local graph products hold only what this run discovered.
      expect((await readSqliteContents(project.dir)).files).not.toContain(NOTE);
      expect(JSON.stringify(readSnapshot(project.dir).communities)).not.toContain(NOTE);
    });

    it('an incremental run writes the same matrix as the full run for the same HEAD', async () => {
      await indexWithHistory();
      const file = join(project.dir, '.ctxo', 'index', 'co-changes.json');
      const full = readFileSync(file);

      await new IndexCommand(project.dir).run({ files: ['src/types.ts'] });

      expect(readFileSync(file).equals(full)).toBe(true);
    });
  });

  // Right after a clone, before the dependencies are installed, no language plugin loads and a full run
  // discovers no file. It may still prune and refresh co-change, but it must not replace the snapshot and
  // the artifacts that the committed entries still describe with empty ones.
  describe('a full run that discovers nothing because no language plugin loads', () => {
    const ARTIFACTS = ['communities.json', 'boundary-violations.json', 'drift-events.json'];
    const indexFile = (file: string): string => join(project.dir, '.ctxo', 'index', file);

    async function indexProjectWithHistory(): Promise<void> {
      project.write('src/gone.ts', 'export const gone = 1;\n');
      project.commit('feat: add gone');
      for (let n = 1; n <= 2; n++) {
        project.append('src/gone.ts', `// change ${n}`);
        project.append('src/types.ts', `// change ${n}`);
        project.commit(`feat: change ${n}`);
      }
      commitGreetAndTypes(project, 2);
      await new IndexCommand(project.dir).run();
      expect(JSON.stringify(readCoChanges(project.dir).entries)).toContain('src/gone.ts');
    }

    function committedProducts(): { artifacts: Record<string, Buffer>; history: string[] } {
      return {
        artifacts: Object.fromEntries(ARTIFACTS.map((file) => [file, readFileSync(indexFile(file))])),
        history: readdirSync(indexFile('communities.history')),
      };
    }

    function expectProductsUntouched(before: { artifacts: Record<string, Buffer>; history: string[] }): void {
      for (const file of ARTIFACTS) expect(readFileSync(indexFile(file)).equals(before.artifacts[file]!)).toBe(true);
      expect(readdirSync(indexFile('communities.history'))).toEqual(before.history);
    }

    function noPluginHint(spy: MockInstance<typeof console.error>): boolean {
      return logLines(spy).some(
        (line) => line.includes('No language plugin is loaded') && line.includes('ctxo install') && line.includes('--install-missing'),
      );
    }

    it('prunes the stale entry and refreshes co-change, and leaves the snapshot, its history and the artifacts alone', async () => {
      await indexProjectWithHistory();
      const before = committedProducts();
      rmSync(join(project.dir, 'src', 'gone.ts')); // stale: its source is gone
      vi.spyOn(pluginLoader, 'loadPlugins').mockResolvedValue([]);
      errorSpy.mockClear();

      await new IndexCommand(project.dir).run();

      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(false);
      for (const file of ['src/greet.ts', 'src/types.ts', 'src/utils.ts']) {
        expect(hasIndexEntry(project.dir, file)).toBe(true);
      }
      expectProductsUntouched(before);
      // Co-change is built from git and the surviving entries, so it does not need a plugin: the deleted file
      // is out of it and the pair of two surviving files, which nothing was discovered for, is still in.
      const entries = readCoChanges(project.dir).entries;
      expect(JSON.stringify(entries)).not.toContain('src/gone.ts');
      expect(entries.some((entry) => entry.file1 === 'src/greet.ts' && entry.file2 === 'src/types.ts')).toBe(true);
      expect(noPluginHint(errorSpy)).toBe(true);
    });

    it('with nothing to prune it changes no committed product, and says why', async () => {
      await indexProjectWithHistory();
      const before = committedProducts();
      const coChanges = readFileSync(indexFile('co-changes.json'));
      vi.spyOn(pluginLoader, 'loadPlugins').mockResolvedValue([]);
      errorSpy.mockClear();

      await new IndexCommand(project.dir).run();

      expectProductsUntouched(before);
      expect(readFileSync(indexFile('co-changes.json')).equals(coChanges)).toBe(true);
      expect(hasIndexEntry(project.dir, 'src/gone.ts')).toBe(true);
      expect(noPluginHint(errorSpy)).toBe(true);
    });
  });

  // Louvain can depend on the order the graph is built in, so a full run and an incremental run at the
  // same HEAD must feed it the same order: the files sorted by name.
  describe('community detection is fed in a deterministic order', () => {
    async function indexClustersThenAddA0(): Promise<void> {
      writeTwoClusters(project);
      project.commit('feat: two clusters with one bridge');
      await new IndexCommand(project.dir).run();
      // A new file that sorts before every file that is already indexed in its folder.
      project.write('src/a/a0.ts', "import { a1 } from './a1';\n\nexport function a0(): number {\n  return a1();\n}\n");
      project.commit('feat: add a0');
    }

    /** Records the files in the order each run hands them to community detection. */
    function recordSnapshotInput(): () => string[] {
      const spy = vi.spyOn(
        IndexCommand.prototype as unknown as { buildCommunitySnapshot: (indices: readonly FileIndex[], ...rest: unknown[]) => Promise<unknown> },
        'buildCommunitySnapshot',
      );
      return () => (spy.mock.calls.at(-1)![0] as readonly FileIndex[]).map((idx) => idx.file);
    }

    it('an incremental run hands it the files sorted by name, a new file in its place', async () => {
      await indexClustersThenAddA0();
      const filesHandedOver = recordSnapshotInput();

      await new IndexCommand(project.dir).run({ commit: 'HEAD' });

      const files = filesHandedOver();
      expect(files).toContain('src/a/a0.ts');
      expect(files).toEqual([...files].sort(compareCodepoint));
    });

    it('a full run hands it the files sorted by name too', async () => {
      await indexClustersThenAddA0();
      const filesHandedOver = recordSnapshotInput();

      await new IndexCommand(project.dir).run();

      const files = filesHandedOver();
      expect(files).toContain('src/a/a0.ts');
      expect(files).toEqual([...files].sort(compareCodepoint));
    });

    it('a full run over a monorepo hands it the files sorted by name, whatever order the workspaces are declared in', async () => {
      project.write(
        'package.json',
        JSON.stringify({
          name: 'root',
          workspaces: ['packages/zeta', 'packages/alpha'],
          devDependencies: { '@ctxo/lang-typescript': 'workspace:*' },
        }),
      );
      project.write('packages/zeta/package.json', JSON.stringify({ name: 'zeta' }));
      project.write('packages/zeta/src/z.ts', 'export const z = 1;\n');
      project.write('packages/alpha/package.json', JSON.stringify({ name: 'alpha' }));
      project.write('packages/alpha/src/a.ts', 'export const a = 1;\n');
      project.commit('feat: two workspaces, declared out of name order');
      const filesHandedOver = recordSnapshotInput();

      await new IndexCommand(project.dir).run();

      // Files are discovered workspace by workspace, zeta first; community detection gets them by name.
      expect(filesHandedOver()).toEqual(['packages/alpha/src/a.ts', 'packages/zeta/src/z.ts']);
    });

    it('communities.json from an incremental run equals the one from a full run at the same HEAD', async () => {
      await indexClustersThenAddA0();
      await new IndexCommand(project.dir).run({ commit: 'HEAD' });
      const incremental = withoutComputedAt(readSnapshot(project.dir));

      await new IndexCommand(project.dir).run();

      expect(withoutComputedAt(readSnapshot(project.dir))).toEqual(incremental);
    });
  });

  // `git ls-files` prints a path with non-ASCII characters in quotes and octal escapes unless it is run
  // with -z. Full runs and the doctor must read the same names the incremental runs (which use -z) do.
  describe('a tracked file with a non-ASCII name', () => {
    const NON_ASCII = 'src/ödünç kaydı.ts';

    function commitNonAsciiFile(): void {
      project.write(
        NON_ASCII,
        "import { greet } from './greet';\n\nexport function oduncKaydi(): string {\n  return greet('odunc');\n}\n",
      );
      project.commit('feat: add a file with a non-ASCII name');
    }

    it('a full run indexes it into the JSON index and into SQLite', async () => {
      commitNonAsciiFile();

      await new IndexCommand(project.dir).run();

      expect(hasIndexEntry(project.dir, NON_ASCII)).toBe(true);
      expect(symbolNames(project.dir, NON_ASCII)).toEqual(['oduncKaydi']);
      const cache = await readSqliteContents(project.dir);
      expect(cache.files).toContain(NON_ASCII);
      expect(cache.symbolIds).toContain(`${NON_ASCII}::oduncKaydi::function`);
      expect(cache.files).toEqual(readJsonContents(project.dir).files);
    });

    it('communities.json from an incremental run equals the one from a full run at the same HEAD', async () => {
      await new IndexCommand(project.dir).run();
      commitNonAsciiFile();
      await new IndexCommand(project.dir).run({ commit: 'HEAD' });
      const incremental = withoutComputedAt(readSnapshot(project.dir));
      expect(JSON.stringify(incremental.communities)).toContain(NON_ASCII);

      await new IndexCommand(project.dir).run();

      expect(withoutComputedAt(readSnapshot(project.dir))).toEqual(incremental);
      expect(hasIndexEntry(project.dir, NON_ASCII)).toBe(true);
    });

    it('doctor does not report the entry of an incremental run as an orphan', async () => {
      commitNonAsciiFile();
      await new IndexCommand(project.dir).run({ commit: 'HEAD' });
      expect(hasIndexEntry(project.dir, NON_ASCII)).toBe(true);

      const result = await new OrphanedFilesCheck().run({
        projectRoot: project.dir,
        ctxoRoot: join(project.dir, '.ctxo'),
      });

      // "none" (not "none (git ls-files unavailable)"): git answered, and no entry is an orphan.
      expect(result).toMatchObject({ status: 'pass', message: 'none' });
    });
  });

  // Drift and boundary confidence is built on distinct commits: several runs on one commit are one data
  // point, and the commit being indexed is not its own history.
  describe('the architecture artifacts count history in distinct commits', () => {
    const depth = (dir: string): Array<{ snapshotsAvailable: number; distinctCommits: number }> =>
      [readDrift(dir), readViolations(dir)].map(({ snapshotsAvailable, distinctCommits }) => ({
        snapshotsAvailable,
        distinctCommits,
      }));

    it('writes distinctCommits next to snapshotsAvailable, and a rerun on the same commit adds nothing', async () => {
      await new IndexCommand(project.dir).run();
      expect(depth(project.dir)).toEqual(Array(2).fill({ snapshotsAvailable: 0, distinctCommits: 0 }));

      commitGreetAndTypes(project, 1);
      await new IndexCommand(project.dir).run();
      await new IndexCommand(project.dir).run();
      expect(depth(project.dir)).toEqual(Array(2).fill({ snapshotsAvailable: 1, distinctCommits: 1 }));

      commitGreetAndTypes(project, 1);
      await new IndexCommand(project.dir).run();
      expect(depth(project.dir)).toEqual(Array(2).fill({ snapshotsAvailable: 2, distinctCommits: 2 }));
    });

    it('does not count a snapshot of the current commit that an older version left in history', async () => {
      await new IndexCommand(project.dir).run();
      commitGreetAndTypes(project, 1);
      await new IndexCommand(project.dir).run();
      // Older versions archived the previous run's snapshot even at the same HEAD, so history could hold
      // the current commit. Seed such a leftover as the newest history file.
      const historyDir = join(project.dir, '.ctxo', 'index', 'communities.history');
      const current = readSnapshot(project.dir);
      writeFileSync(join(historyDir, `2999-01-01T00-00-00-000Z-${current.commitSha}.json`), JSON.stringify(current), 'utf-8');

      await new IndexCommand(project.dir).run();

      // Two files in history, but only the first commit is an earlier commit.
      expect(depth(project.dir)).toEqual(Array(2).fill({ snapshotsAvailable: 2, distinctCommits: 1 }));
    });
  });

  // The JSON entry of a source file x is x.json, so an entry whose "file" field says co-changes would name
  // the co-change matrix. Pruning and removal delete the JSON file that was read, never one built from that
  // field, and they count a deletion only when a file was really deleted.
  describe('an index file whose file field names an artifact', () => {
    function writeCraftedEntry(file: string): void {
      writeFileSync(
        join(project.dir, '.ctxo', 'index', 'crafted.json'),
        JSON.stringify({ file, lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] }),
        'utf-8',
      );
    }

    it.each([
      ['co-changes', 'co-changes.json', {}],
      ['communities', 'communities.json', { skipCommunity: true }],
    ])('does not make a full run delete %s.json, and the crafted file itself is pruned', async (name, artifact, options) => {
      commitGreetAndTypes(project, 2);
      await new IndexCommand(project.dir).run();
      const artifactPath = join(project.dir, '.ctxo', 'index', artifact);
      expect(existsSync(artifactPath)).toBe(true);
      writeCraftedEntry(name);

      await new IndexCommand(project.dir).run(options);

      expect(existsSync(artifactPath)).toBe(true);
      expect(existsSync(join(project.dir, '.ctxo', 'index', 'crafted.json'))).toBe(false);
    });

    it('does not make a full run delete a snapshot from the history', async () => {
      commitGreetAndTypes(project, 1);
      await new IndexCommand(project.dir).run();
      // History holds one snapshot per commit, so only a run on a new commit archives the first snapshot.
      commitGreetAndTypes(project, 1);
      await new IndexCommand(project.dir).run();
      const historyDir = join(project.dir, '.ctxo', 'index', 'communities.history');
      const archived = readdirSync(historyDir).filter((name) => name.endsWith('.json'));
      expect(archived.length).toBeGreaterThan(0);
      writeCraftedEntry(`communities.history/${archived[0]!.replace(/\.json$/, '')}`);

      await new IndexCommand(project.dir).run();

      expect(existsSync(join(historyDir, archived[0]!))).toBe(true);
    });

    it('does not make an incremental removal delete an artifact', async () => {
      project.write('co-changes', 'not source code\n');
      project.commit('chore: add a file named like an artifact');
      commitGreetAndTypes(project, 2);
      await new IndexCommand(project.dir).run();
      writeCraftedEntry('co-changes');
      project.git('rm', '-q', 'co-changes');
      project.commit('chore: remove it again');

      await new IndexCommand(project.dir).run({ commit: 'HEAD' });

      expect(existsSync(join(project.dir, '.ctxo', 'index', 'co-changes.json'))).toBe(true);
    });

    it('counts a prune only when a file was really deleted', async () => {
      await new IndexCommand(project.dir).run();
      rmSync(join(project.dir, 'src', 'utils.ts')); // stale
      vi.spyOn(JsonIndexWriter.prototype, 'deleteEntryFile').mockReturnValue(false);
      errorSpy.mockClear();

      await new IndexCommand(project.dir).run();

      expect(logLines(errorSpy).some((line) => line.includes('Pruned'))).toBe(false);
    });
  });

  // A full run leaves out what .gitignore covers (it lists files with --exclude-standard), so a path listed
  // by name is left out too. Tracked files are never "ignored" in git's eyes, as in the full run.
  describe('--files and .gitignore', () => {
    beforeEach(() => {
      project.write('.gitignore', 'dist/\n');
      project.write('dist/app.js', 'export const app = 1;\n');
    });

    it('skips a listed file that .gitignore covers, as a full run does', async () => {
      await new IndexCommand(project.dir).run({ files: ['dist/app.js', 'src/types.ts'] });

      expect(hasIndexEntry(project.dir, 'dist/app.js')).toBe(false);
      expect(hasIndexEntry(project.dir, 'src/types.ts')).toBe(true);
      expect(
        logLines(errorSpy).some((line) => line.startsWith('[ctxo] Skipped 1 listed file(s) that a full run would not index')),
      ).toBe(true);
    });

    it('still indexes a listed file that git tracks although .gitignore matches it', async () => {
      project.git('add', '-f', 'dist/app.js');
      project.commit('feat: force-add the build output');

      await new IndexCommand(project.dir).run({ files: ['dist/app.js'] });

      expect(hasIndexEntry(project.dir, 'dist/app.js')).toBe(true);
    });

    it('indexes the file anyway, and says so, when git cannot check', async () => {
      vi.spyOn(SimpleGitAdapter.prototype, 'getIgnoredPaths').mockResolvedValue(undefined);

      await new IndexCommand(project.dir).run({ files: ['dist/app.js'] });

      expect(hasIndexEntry(project.dir, 'dist/app.js')).toBe(true);
      expect(logLines(errorSpy)).toContain(
        '[ctxo] Could not ask git which listed files .gitignore excludes: indexing them anyway',
      );
    });

    it('does not ask git about the files of a commit, which are tracked', async () => {
      const getIgnoredPaths = vi.spyOn(SimpleGitAdapter.prototype, 'getIgnoredPaths');
      commitGreetAndTypes(project, 1);

      await new IndexCommand(project.dir).run({ commit: 'HEAD' });

      expect(getIgnoredPaths).not.toHaveBeenCalled();
    });
  });

  it('--files re-indexes only the files that a full run would index', async () => {
    writeConfig(project.dir, 'index:\n  ignore:\n    - "fixtures/**"\n');
    project.write('fixtures/skip.ts', 'export const skipped = 1;\n');
    project.write('README.md', '# readme\n');
    project.commit('chore: add ignored fixture and readme');

    // Backslashes, a ./ prefix, an unsupported language, an ignored file, a path outside the project
    // and a file that does not exist: only the first two are indexed.
    await new IndexCommand(project.dir).run({
      files: ['src\\types.ts', './src/greet.ts', 'README.md', 'fixtures/skip.ts', '../outside.ts', 'src/missing.ts'],
    });

    expect(hasIndexEntry(project.dir, 'src/types.ts')).toBe(true);
    expect(hasIndexEntry(project.dir, 'src/greet.ts')).toBe(true);
    for (const file of ['src/utils.ts', 'README.md', 'fixtures/skip.ts', 'src/missing.ts']) {
      expect(hasIndexEntry(project.dir, file)).toBe(false);
    }
    const lines = logLines(errorSpy);
    expect(lines).toContain('[ctxo] Skipped ../outside.ts: not a path inside the project');
    // README.md and fixtures/skip.ts; src/missing.ts is indexable in principle, it is just not there.
    expect(lines.some((line) => line.startsWith('[ctxo] Skipped 2 listed file(s) that a full run would not index'))).toBe(true);
  });

  it('--files applies index.ignoreProjects and the workspace layout like a full run', async () => {
    project.write(
      'package.json',
      JSON.stringify({ name: 'root', workspaces: ['packages/*'], devDependencies: { '@ctxo/lang-typescript': 'workspace:*' } }),
    );
    writeConfig(project.dir, 'index:\n  ignoreProjects:\n    - "packages/experimental-*"\n');
    project.write('packages/keep/package.json', JSON.stringify({ name: 'keep' }));
    project.write('packages/keep/src/a.ts', 'export const a = 1;\n');
    project.write('packages/keep/src/not-listed.ts', 'export const notListed = 1;\n');
    project.write('packages/experimental-foo/package.json', JSON.stringify({ name: 'experimental-foo' }));
    project.write('packages/experimental-foo/src/b.ts', 'export const b = 2;\n');
    project.write('tools/outside.ts', 'export const outside = 3;\n');
    project.commit('feat: workspaces');

    await new IndexCommand(project.dir).run({
      files: ['packages/keep/src/a.ts', 'packages/experimental-foo/src/b.ts', 'tools/outside.ts'],
    });

    expect(hasIndexEntry(project.dir, 'packages/keep/src/a.ts')).toBe(true);
    expect(hasIndexEntry(project.dir, 'packages/experimental-foo/src/b.ts')).toBe(false);
    expect(hasIndexEntry(project.dir, 'tools/outside.ts')).toBe(false);
    // A full run would index this file too; a run for a.ts alone must not.
    expect(hasIndexEntry(project.dir, 'packages/keep/src/not-listed.ts')).toBe(false);
  });

  it('--files that selects nothing to index leaves the index, co-change and the snapshot as they were', async () => {
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    const read = (file: string): Buffer => readFileSync(join(project.dir, '.ctxo', 'index', file));
    const before = { snapshot: read('communities.json'), coChanges: read('co-changes.json'), greet: read('src/greet.ts.json') };

    project.write('README.md', '# readme\n');
    await new IndexCommand(project.dir).run({ files: ['README.md'] });

    expect(read('communities.json').equals(before.snapshot)).toBe(true);
    expect(read('co-changes.json').equals(before.coChanges)).toBe(true);
    expect(read('src/greet.ts.json').equals(before.greet)).toBe(true);
    // The SQLite cache is rebuilt from the committed index and still holds every file.
    expect((await readSqliteContents(project.dir)).files).toEqual(['src/greet.ts', 'src/types.ts', 'src/utils.ts']);
  });

  it('--files drops a listed file that is gone from the working tree from the index', async () => {
    await new IndexCommand(project.dir).run();
    expect(hasIndexEntry(project.dir, 'src/utils.ts')).toBe(true);
    expect(JSON.stringify(readSnapshot(project.dir).communities)).toContain('src/utils.ts');
    rmSync(join(project.dir, 'src', 'utils.ts'));

    await new IndexCommand(project.dir).run({ files: ['src/utils.ts'] });

    expect(hasIndexEntry(project.dir, 'src/utils.ts')).toBe(false);
    expect((await readSqliteContents(project.dir)).files).toEqual(['src/greet.ts', 'src/types.ts']);
    // Removing a file changes the graph, so the snapshot is recomputed without it.
    expect(JSON.stringify(readSnapshot(project.dir).communities)).not.toContain('src/utils.ts');
  });

  it('--commit HEAD re-indexes changed files, removes deleted ones and follows a rename', async () => {
    project.write('src/extra.ts', 'export function extra(): number {\n  return 1;\n}\n');
    project.write('src/old-name.ts', 'export function legacy(): string {\n  return "legacy";\n}\n');
    project.commit('feat: add extra and old-name');
    project.append('src/extra.ts', '// touched');
    project.append('src/old-name.ts', '// touched');
    project.commit('chore: touch extra and old-name');
    await new IndexCommand(project.dir).run();
    expect(hasIndexEntry(project.dir, 'src/extra.ts')).toBe(true);
    expect(hasIndexEntry(project.dir, 'src/old-name.ts')).toBe(true);
    // They changed together twice, so the matrix has an entry for them before the last commit.
    expect(JSON.stringify(readCoChanges(project.dir).entries)).toContain('src/extra.ts');

    // One commit with a modification, a deletion and a rename, and a file that no language plugin indexes.
    project.append('src/greet.ts', 'export function farewell(name: string): string { return `Bye, ${name}`; }');
    project.git('rm', '-q', 'src/extra.ts');
    project.git('mv', 'src/old-name.ts', 'src/new-name.ts');
    project.write('README.md', '# notes\n');
    project.commit('refactor: change greet, drop extra, rename old-name');
    changeOnDisk(project, 'src/utils.ts'); // not part of the commit
    errorSpy.mockClear();

    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    expect(symbolNames(project.dir, 'src/greet.ts')).toContain('farewell');
    expect(hasIndexEntry(project.dir, 'src/extra.ts')).toBe(false);
    expect(hasIndexEntry(project.dir, 'src/old-name.ts')).toBe(false);
    expect(hasIndexEntry(project.dir, 'src/new-name.ts')).toBe(true);
    // The history of the renamed file goes back across the rename.
    expect(readFileIndex(project.dir, 'src/new-name.ts').intent.map((entry) => entry.message)).toEqual([
      'refactor: change greet, drop extra, rename old-name',
      'chore: touch extra and old-name',
      'feat: add extra and old-name',
    ]);
    expectNotReindexed(project, 'src/utils.ts');
    expect(hasIndexEntry(project.dir, 'README.md')).toBe(false);
    // The commit changes files that nothing indexes; that is normal and not worth a log line.
    expect(logLines(errorSpy).some((line) => line.includes('listed file(s)'))).toBe(false);
    expect(logLines(errorSpy)).toContain('[ctxo] Incremental re-index: 2 file(s) to index, 2 to remove (commit HEAD)');

    // The removed files are gone from everything built from the merged index.
    expect((await readSqliteContents(project.dir)).files).toEqual([
      'src/greet.ts',
      'src/new-name.ts',
      'src/types.ts',
      'src/utils.ts',
    ]);
    const gone = (text: string): boolean => text.includes('src/extra.ts') || text.includes('src/old-name.ts');
    expect(gone(JSON.stringify(readSnapshot(project.dir).communities))).toBe(false);
    expect(gone(JSON.stringify(readCoChanges(project.dir).entries))).toBe(false);
  });

  it('--commit HEAD on a commit that only deletes a file removes it everywhere and refreshes co-change and the snapshot', async () => {
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    const headBefore = project.head();

    project.git('rm', '-q', 'src/utils.ts');
    project.commit('chore: remove utils');
    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    expect(project.head()).not.toBe(headBefore);
    expect(hasIndexEntry(project.dir, 'src/utils.ts')).toBe(false);
    expect((await readSqliteContents(project.dir)).files).toEqual(['src/greet.ts', 'src/types.ts']);
    expect(readSnapshot(project.dir).commitSha).toBe(project.head());
    expect(readCoChanges(project.dir).window?.head).toBe(project.head());
    expect(JSON.stringify(readSnapshot(project.dir).communities)).not.toContain('src/utils.ts');
  });

  it('--commit HEAD goes on when a removed file cannot be deleted from the index', async () => {
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    project.git('rm', '-q', 'src/utils.ts');
    project.commit('chore: remove utils');
    vi.spyOn(JsonIndexWriter.prototype, 'deleteEntryFile').mockImplementation(() => {
      throw new Error('EPERM: locked');
    });

    await expect(new IndexCommand(project.dir).run({ commit: 'HEAD' })).resolves.toBeUndefined();

    expect(logLines(errorSpy)).toContain('[ctxo] Could not remove src/utils.ts from the index: EPERM: locked');
    // Everything else was still produced, without the file that could not be deleted.
    expect((await readSqliteContents(project.dir)).files).toEqual(['src/greet.ts', 'src/types.ts']);
    expect(readSnapshot(project.dir).commitSha).toBe(project.head());
    expect(JSON.stringify(readSnapshot(project.dir).communities)).not.toContain('src/utils.ts');
  });

  it('--commit HEAD never deletes an index artifact because a deleted repository file has its name', async () => {
    // The JSON entry of a file `x` is `x.json`, so a deleted file called `co-changes` would name the
    // co-change matrix. Only paths that really have an index entry are removed.
    project.write('co-changes', 'not source code\n');
    project.commit('chore: add a file named like an artifact');
    commitGreetAndTypes(project, 2);
    await new IndexCommand(project.dir).run();
    project.git('rm', '-q', 'co-changes');
    project.commit('chore: remove it again');

    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    expect(existsSync(join(project.dir, '.ctxo', 'index', 'co-changes.json'))).toBe(true);
    expect(readCoChanges(project.dir).window?.head).toBe(project.head());
  });

  it('--commit HEAD on a root commit indexes its files', async () => {
    // Not part of any commit: a full run would index it, a run for the root commit must not.
    project.write('src/untracked.ts', 'export const untracked = 1;\n');

    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    for (const file of ['src/greet.ts', 'src/types.ts', 'src/utils.ts']) {
      expect(hasIndexEntry(project.dir, file)).toBe(true);
    }
    expect(hasIndexEntry(project.dir, 'src/untracked.ts')).toBe(false);
    expect(readSnapshot(project.dir).commitSha).toBe(project.head());
    expect(readCoChanges(project.dir).window).toMatchObject({ head: project.head(), commitsScanned: 1 });
  });

  it('--commit HEAD on a merge commit re-indexes nothing but refreshes co-change and the snapshot', async () => {
    commitGreetAndTypes(project, 2);
    const main = project.git('rev-parse', '--abbrev-ref', 'HEAD');
    project.git('checkout', '-q', '-b', 'side');
    project.write('src/side.ts', 'export function side(): number {\n  return 2;\n}\n');
    project.append('src/greet.ts', 'export function sideGreeting(): string { return "side"; }');
    project.commit('feat: work on the side branch');
    project.git('checkout', '-q', main);
    project.append('src/utils.ts', 'export const MAIN_ONLY = true;');
    project.commit('feat: work on the main branch');

    await new IndexCommand(project.dir).run();
    const headBefore = project.head();
    const files = ['src/greet.ts', 'src/types.ts', 'src/utils.ts'];
    const bytesBefore = files.map((file) => readFileSync(indexJson(project.dir, file)));
    const commitsBefore = readCoChanges(project.dir).window!.commitsScanned;

    project.merge('side');
    expect(project.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3); // a real merge
    await expect(new IndexCommand(project.dir).run({ commit: 'HEAD' })).resolves.toBeUndefined();

    // Nothing was re-indexed: the merged-in file is not indexed and no entry changed.
    expect(hasIndexEntry(project.dir, 'src/side.ts')).toBe(false);
    files.forEach((file, i) => expect(readFileSync(indexJson(project.dir, file)).equals(bytesBefore[i]!)).toBe(true));
    // Co-change and the snapshot follow the new HEAD.
    expect(project.head()).not.toBe(headBefore);
    const window = readCoChanges(project.dir).window!;
    expect(window.head).toBe(project.head());
    expect(window.commitsScanned).toBe(commitsBefore + 1); // the side commit joined the history
    expect(readSnapshot(project.dir).commitSha).toBe(project.head());
  });

  // `Case.ts` and `case.ts` name one JSON file here, so the entry of the old name must be deleted
  // before the entry of the new name is written, or the delete would take the new entry with it.
  it.skipIf(!CASE_INSENSITIVE_FS)('--commit HEAD follows a case-only rename on a case-insensitive file system', async () => {
    project.write('src/Case.ts', 'export function shout(): string {\n  return "hi";\n}\n');
    project.commit('feat: add Case');
    await new IndexCommand(project.dir).run();
    project.git('mv', 'src/Case.ts', 'src/case.ts');
    project.commit('refactor: lower-case the file name');

    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    const indexed = new JsonIndexReader(join(project.dir, '.ctxo')).readAll().map((idx) => idx.file);
    expect(indexed).toContain('src/case.ts');
    expect(indexed).not.toContain('src/Case.ts');
    expect((await readSqliteContents(project.dir)).files).toContain('src/case.ts');
  });

  it('--commit with a revision git cannot resolve fails and indexes nothing', async () => {
    await expect(new IndexCommand(project.dir).run({ commit: 'no-such-revision' })).rejects.toThrow(
      /--commit no-such-revision/,
    );

    expect(hasIndexEntry(project.dir, 'src/greet.ts')).toBe(false);
    expect(existsSync(join(project.dir, '.ctxo', 'index', 'co-changes.json'))).toBe(false);
  });

  it('the snapshot commitSha is the real short HEAD', async () => {
    commitGreetAndTypes(project, 1);
    await new IndexCommand(project.dir).run();
    expect(readSnapshot(project.dir).commitSha).toBe(project.head());

    commitGreetAndTypes(project, 1);
    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    expect(readSnapshot(project.dir).commitSha).toBe(project.head());
    expect(readViolations(project.dir).commitSha).toBe(project.head());
  });

  it('the snapshot commitSha falls back to git in the project directory when the git adapter cannot tell HEAD', async () => {
    commitGreetAndTypes(project, 1);
    vi.spyOn(SimpleGitAdapter.prototype, 'getHeadSha').mockResolvedValue(undefined);

    await new IndexCommand(project.dir).run();

    // The process runs in another repository (this one); only the project directory gives the right SHA.
    expect(readSnapshot(project.dir).commitSha).toBe(project.head());
  });

  it('the snapshot commitSha is the untruncated short HEAD, whatever length git abbreviates to', async () => {
    // The staleness check compares the snapshot's commitSha with `git rev-parse --short HEAD`, so a
    // repository that abbreviates to 12 characters must not get its SHA cut to 8.
    project.git('config', 'core.abbrev', '12');
    commitGreetAndTypes(project, 1);

    await new IndexCommand(project.dir).run({ commit: 'HEAD' });

    const { commitSha } = readSnapshot(project.dir);
    expect(commitSha).toHaveLength(12);
    expect(commitSha).toBe(project.head());
  });
});
