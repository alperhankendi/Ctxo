import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { IndexCommand } from '../index-command.js';
import * as pluginLoader from '../plugin-loader.js';
import { ContextsViewReader } from '../../adapters/storage/contexts-view-reader.js';
import type { ContextsView } from '../../core/contexts-view/contexts-view-builder.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';
import {
  cleanupTempProjects,
  createProject,
  IDENTITY,
  trackTempDir,
  type TempProject,
} from './helpers/temp-project.js';

const BILLING = ['src/billing/a.ts', 'src/billing/b.ts', 'src/billing/c.ts'];

function viewPath(dir: string): string {
  return join(dir, '.ctxo', 'index', 'contexts-view.json');
}

function readView(dir: string): ContextsView {
  return JSON.parse(readFileSync(viewPath(dir), 'utf-8')) as ContextsView;
}

function writeConfig(dir: string, yaml: string): void {
  mkdirSync(join(dir, '.ctxo'), { recursive: true });
  writeFileSync(join(dir, '.ctxo', 'config.yaml'), `version: "1.0"\n${yaml}`, 'utf-8');
}

/** Every path the view mentions, whatever the section; the settings echo the config globs, so they do not count. */
function mentioned(view: ContextsView, file: string): boolean {
  return JSON.stringify({ ...view, settings: undefined }).includes(file);
}

function addBilling(project: TempProject): void {
  project.write('src/billing/a.ts', "import { b } from './b';\n\nexport function a(): number {\n  return b();\n}\n");
  project.write('src/billing/b.ts', "import { c } from './c';\n\nexport function b(): number {\n  return c();\n}\n");
  project.write('src/billing/c.ts', 'export function c(): number {\n  return 1;\n}\n');
  project.write(
    'src/billing/__tests__/a.test.ts',
    "import { a } from '../a';\n\nexport function testA(): number {\n  return a();\n}\n",
  );
  project.commit('feat: billing');
}

describe('IndexCommand contexts view', () => {
  let project: TempProject;
  let errorSpy: MockInstance<typeof console.error>;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    project = createProject();
    addBilling(project);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    cleanupTempProjects();
  });

  it('ctxo index writes contexts-view.json with the billing candidate and no test file', async () => {
    await new IndexCommand(project.dir).run();

    const view = readView(project.dir);
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0]).toMatchObject({ label: 'src/billing', files: BILLING });
    expect(view.coverage).toEqual({ files: 6, covered: 3, ratio: 0.5 });
    expect(mentioned(view, 'a.test.ts')).toBe(false);
    const lines = errorSpy.mock.calls.map((args) => args.join(' '));
    expect(lines).toContainEqual(expect.stringMatching(/^\[ctxo\] Contexts view: 1 candidates cover 3\/6 files \(50%\), 0 hubs, 3 unclustered$/));
  });

  it('a second index run on the same commit leaves contexts-view.json byte-identical and unwritten', async () => {
    await new IndexCommand(project.dir).run();
    const path = viewPath(project.dir);
    const bytes = readFileSync(path);
    utimesSync(path, 1_600_000_000, 1_600_000_000);
    const before = statSync(path).mtimeMs;

    await new IndexCommand(project.dir).run();

    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it('--skip-community leaves an existing contexts-view.json untouched', async () => {
    await new IndexCommand(project.dir).run();
    const path = viewPath(project.dir);
    writeFileSync(path, '{"marker":true}', 'utf-8');

    await new IndexCommand(project.dir).run({ skipCommunity: true });

    expect(readFileSync(path, 'utf-8')).toBe('{"marker":true}');
  });

  it('contextsView.exclude and index.tests remove files from the view', async () => {
    writeConfig(project.dir, 'contextsView:\n  exclude:\n    - "src/billing/c.ts"\n');
    await new IndexCommand(project.dir).run();
    expect(mentioned(readView(project.dir), 'src/billing/c.ts')).toBe(false);
    expect(mentioned(readView(project.dir), 'src/billing/b.ts')).toBe(true);

    writeConfig(project.dir, 'index:\n  tests:\n    - "src/billing/b.ts"\n');
    await new IndexCommand(project.dir).run();
    const view = readView(project.dir);
    expect(mentioned(view, 'src/billing/b.ts')).toBe(false);
    expect(mentioned(view, 'src/billing/c.ts')).toBe(true);
  });

  it("a deleted file's committed JSON does not make it a node", async () => {
    await new IndexCommand(project.dir).run();
    expect(mentioned(readView(project.dir), 'src/billing/c.ts')).toBe(true);

    rmSync(join(project.dir, 'src', 'billing', 'c.ts'));
    await new IndexCommand(project.dir).run();

    expect(mentioned(readView(project.dir), 'src/billing/c.ts')).toBe(false);
  });

  it("an incremental run does not make a deleted file's committed JSON a node", async () => {
    await new IndexCommand(project.dir).run();
    expect(mentioned(readView(project.dir), 'src/billing/c.ts')).toBe(true);

    // The incremental run merges the committed JSON of c.ts, which it neither re-indexes nor prunes.
    rmSync(join(project.dir, 'src', 'billing', 'c.ts'));
    await new IndexCommand(project.dir).run({ files: ['src/billing/a.ts'] });

    expect(mentioned(readView(project.dir), 'src/billing/c.ts')).toBe(false);
  });

  it('logs "Contexts view skipped" and still finishes when the view cannot be written', async () => {
    mkdirSync(viewPath(project.dir), { recursive: true });

    await expect(new IndexCommand(project.dir).run()).resolves.toBeUndefined();

    const lines = errorSpy.mock.calls.map((args) => args.join(' '));
    expect(lines).toContainEqual(expect.stringMatching(/^\[ctxo\] Contexts view skipped: /));
  });

  it('the view a real index run writes passes the schema', async () => {
    await new IndexCommand(project.dir).run();

    const read = new ContextsViewReader(join(project.dir, '.ctxo')).readContextsView();

    expect(read).toEqual(readView(project.dir));
    expect(read?.candidates).toHaveLength(1);
  });

  it('an incremental --files run writes the same view as a full run', async () => {
    await new IndexCommand(project.dir).run();
    const full = readFileSync(viewPath(project.dir));
    rmSync(viewPath(project.dir));

    await new IndexCommand(project.dir).run({ files: ['src/billing/a.ts'] });

    expect(existsSync(viewPath(project.dir))).toBe(true);
    expect(readFileSync(viewPath(project.dir)).equals(full)).toBe(true);
  });

  it('ctxo index replaces a conflict-marked contexts-view.json', async () => {
    await new IndexCommand(project.dir).run();
    const good = readFileSync(viewPath(project.dir), 'utf-8');
    writeFileSync(viewPath(project.dir), `<<<<<<< HEAD\n${good}\n=======\n${good}\n>>>>>>> other\n`, 'utf-8');

    await new IndexCommand(project.dir).run();

    expect(readFileSync(viewPath(project.dir), 'utf-8')).toBe(good);
  });
});

// A repository no language plugin indexes (Python here) still has a history: with cochange.include, a full
// run computes co-change for the included files and a contexts view from co-change alone.
describe('IndexCommand contexts view without a language plugin', () => {
  const BILLING_PY = ['billing/invoice.py', 'billing/ledger.py', 'billing/tax.py'];
  const SHIPPING_PY = ['shipping/label.py', 'shipping/parcel.py', 'shipping/route.py'];
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(pluginLoader, 'loadPlugins').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    cleanupTempProjects();
  });

  /** A repository of .py files only: billing and shipping each change together three times after the first commit. */
  function pythonRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-pyrepo-'));
    trackTempDir(dir);
    let day = 0;
    const git = (args: string[], env: Record<string, string> = {}): void => {
      execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    };
    const commit = (message: string, files: readonly string[]): void => {
      for (const file of files) {
        mkdirSync(join(dir, dirname(file)), { recursive: true });
        appendFileSync(join(dir, file), `# ${message}\n`);
      }
      day += 1;
      const when = `${1_700_000_000 + day * 86_400} +0000`;
      git(['add', '-A']);
      git([...IDENTITY, 'commit', '-q', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
    };
    git(['init', '-q']);
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    appendFileSync(join(dir, '.git', 'info', 'exclude'), '.ctxo/\n.gitignore\n');
    commit('init', [...BILLING_PY, ...SHIPPING_PY]);
    for (let n = 1; n <= 3; n++) {
      commit(`billing ${n}`, BILLING_PY);
      commit(`shipping ${n}`, SHIPPING_PY);
    }
    writeConfig(dir, 'cochange:\n  include:\n    - "**/*.py"\n');
    return dir;
  }

  it('a full run with an empty index writes co-changes.json and a co-change-only contexts view', async () => {
    const dir = pythonRepo();

    await new IndexCommand(dir).run({});

    const coChanges = JSON.parse(readFileSync(join(dir, '.ctxo', 'index', 'co-changes.json'), 'utf-8')) as {
      entries: Array<{ file1: string; file2: string }>;
    };
    expect(coChanges.entries.length).toBeGreaterThan(0);
    expect(coChanges.entries.every((entry) => entry.file1.endsWith('.py') && entry.file2.endsWith('.py'))).toBe(true);
    const view = readView(dir);
    expect(view.candidates.map(({ id, label, files }) => ({ id, label, files }))).toEqual([
      { id: 1, label: 'billing', files: BILLING_PY },
      { id: 2, label: 'shipping', files: SHIPPING_PY },
    ]);
    // Co-change only: no symbol edge between candidates.
    expect(view.candidates.every((candidate) => candidate.crossEdges.length === 0)).toBe(true);
    expect(view.coverage).toEqual({ files: 6, covered: 6, ratio: 1 });
  });
});
