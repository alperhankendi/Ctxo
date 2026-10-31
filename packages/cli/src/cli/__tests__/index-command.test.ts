import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { CodeFact, CtxoLanguagePlugin, PluginContext } from '@ctxo/plugin-api';
import { IndexCommand } from '../index-command.js';
import * as pluginLoader from '../plugin-loader.js';
import * as pluginDiscovery from '../../adapters/language/plugin-discovery.js';
import * as detectorModule from '../../core/overlay/community-detector.js';
import type { LoadedModule } from '../../adapters/modules/module-loader.js';
import type { IndexPassContext } from '../../ports/i-ctxo-module.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'sample-project');

function setupTempProject(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-cli-'));

  // Copy fixture files
  cpSync(FIXTURES_DIR, tempDir, { recursive: true });

  // Init git repo so git ls-files works
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'add', '.'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'init'], { cwd: tempDir, stdio: 'ignore' });

  return tempDir;
}

describe('IndexCommand', () => {
  let tempDir: string;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    tempDir = setupTempProject();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    // Windows holds simple-git / sqlite handles briefly after test body returns;
    // cleanup is best-effort to avoid false-positive test failures.
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  });

  it('ctxo index builds communities with the configured options', async () => {
    mkdirSync(join(tempDir, '.ctxo'), { recursive: true });
    writeFileSync(
      join(tempDir, '.ctxo', 'config.yaml'),
      'communities:\n  resolution: 0.5\n  godNodeMaxResults: 1\n',
    );
    const Real = detectorModule.CommunityDetector;
    const calls: unknown[] = [];
    vi.spyOn(detectorModule, 'CommunityDetector').mockImplementation(function (this: unknown, options?: unknown) {
      calls.push(options);
      return new Real(options as never);
    } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await new IndexCommand(tempDir).run({});

    expect(calls).toEqual([{ resolution: 0.5, godNodeMaxResults: 1 }]);
  });

  it('discovers all .ts files in project directory', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const indexDir = join(tempDir, '.ctxo', 'index', 'src');
    expect(existsSync(indexDir)).toBe(true);

    const files = readdirSync(indexDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(3);
  });

  it('writes one JSON file per source file to .ctxo/index/', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const greetIndex = join(tempDir, '.ctxo', 'index', 'src', 'greet.ts.json');
    expect(existsSync(greetIndex)).toBe(true);

    const content = JSON.parse(readFileSync(greetIndex, 'utf-8'));
    expect(content.file).toBe('src/greet.ts');
    expect(content.symbols.length).toBeGreaterThan(0);
  });

  it('creates schema-version file on first run', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const versionFile = join(tempDir, '.ctxo', 'index', 'schema-version');
    expect(existsSync(versionFile)).toBe(true);
    expect(readFileSync(versionFile, 'utf-8').trim()).toBe('1.0.0');
  });

  it('populates SQLite cache from extracted data', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const dbFile = join(tempDir, '.ctxo', '.cache', 'symbols.db');
    expect(existsSync(dbFile)).toBe(true);
  });

  it('ensures .ctxo/.cache/ is in .gitignore', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.ctxo/.cache/');
  });

  it('handles project with zero supported files gracefully', async () => {
    // Create empty project
    const emptyDir = mkdtempSync(join(tmpdir(), 'ctxo-empty-'));
    execFileSync('git', ['init'], { cwd: emptyDir, stdio: 'ignore' });
    mkdirSync(join(emptyDir, 'src'));
    writeFileSync(join(emptyDir, 'src', 'readme.md'), '# Hello', 'utf-8');
    execFileSync('git', ['add', '.'], { cwd: emptyDir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'init'], { cwd: emptyDir, stdio: 'ignore' });

    const cmd = new IndexCommand(emptyDir);
    await cmd.run();

    // Should not crash, schema version should still exist
    const versionFile = join(emptyDir, '.ctxo', 'index', 'schema-version');
    expect(existsSync(versionFile)).toBe(true);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('extracts symbols correctly from fixture files', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const utilsIndex = join(tempDir, '.ctxo', 'index', 'src', 'utils.ts.json');
    const content = JSON.parse(readFileSync(utilsIndex, 'utf-8'));

    const symbolNames = content.symbols.map((s: { name: string }) => s.name);
    expect(symbolNames).toContain('formatName');
    expect(symbolNames).toContain('VERSION');
  });

  it('resolves cross-file import edge kinds correctly via multi-file project', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const greetIndex = join(tempDir, '.ctxo', 'index', 'src', 'greet.ts.json');
    const content = JSON.parse(readFileSync(greetIndex, 'utf-8'));

    const importEdge = content.edges.find(
      (e: { kind: string; to: string }) => e.kind === 'imports' && e.to.includes('formatName')
    );
    expect(importEdge).toBeDefined();
    // formatName is a function in utils.ts — should resolve to ::function, not ::class (heuristic)
    expect(importEdge.to).toBe('src/utils.ts::formatName::function');
  });

  it('extracts interfaces and type aliases from fixture files', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const typesIndex = join(tempDir, '.ctxo', 'index', 'src', 'types.ts.json');
    const content = JSON.parse(readFileSync(typesIndex, 'utf-8'));

    const symbolNames = content.symbols.map((s: { name: string }) => s.name);
    expect(symbolNames).toContain('User');
    expect(symbolNames).toContain('Role');
  });

  it('writes communities.json on full index run', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();
    expect(existsSync(join(tempDir, '.ctxo', 'index', 'communities.json'))).toBe(true);
  });

  it('skips community detection with --skip-community and preserves any existing snapshot', async () => {
    // Full run first — produces real snapshot.
    await new IndexCommand(tempDir).run();
    const snapshotPath = join(tempDir, '.ctxo', 'index', 'communities.json');
    expect(existsSync(snapshotPath)).toBe(true);
    const beforeMtime = readFileSync(snapshotPath, 'utf-8');

    // Re-index with skipCommunity — snapshot must not be touched.
    await new IndexCommand(tempDir).run({ skipCommunity: true });
    const afterMtime = readFileSync(snapshotPath, 'utf-8');
    expect(afterMtime).toBe(beforeMtime);
  });

  it('the summary and edge quality use the C# tier after the Roslyn batch', async () => {
    writeFileSync(join(tempDir, 'src', 'LoanService.cs'), 'public class LoanService {}\n', 'utf-8');
    // A C# composite whose Roslyn helper fails its batch: it then reports the tree-sitter syntax tier.
    let batchFailed = false;
    const roslyn = {
      isReady: () => !batchFailed,
      batchIndex: vi.fn(async () => {
        batchFailed = true;
      }),
      startKeepAlive: async () => false,
      reindexFile: async () => null,
      dispose: async () => {},
    };
    const composite = {
      extractSymbols: async (file: string) => [
        { symbolId: `${file}::LoanService::class`, name: 'LoanService', kind: 'class' as const, startLine: 0, endLine: 0 },
      ],
      extractEdges: async () => [],
      extractComplexity: async () => [],
      isSupported: (file: string) => file.endsWith('.cs'),
      getRoslynDelegate: () => (batchFailed ? null : roslyn),
      getTier: () => (batchFailed ? 'syntax' : 'full'),
    };
    const plugin = {
      apiVersion: '1',
      id: 'csharp',
      name: 'C#',
      version: '0.0.0',
      extensions: ['.cs'],
      tier: 'full',
      createAdapter: () => composite,
    };
    vi.spyOn(pluginLoader, 'loadPlugins').mockResolvedValue([
      { plugin, adapter: composite, specifier: '@ctxo/lang-csharp' },
    ] as unknown as Awaited<ReturnType<typeof pluginLoader.loadPlugins>>);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await new IndexCommand(tempDir).run({ skipHistory: true });

    expect(roslyn.batchIndex).toHaveBeenCalledOnce();
    const stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(stderr).toContain('[ctxo]   C#: 1 files (syntax tier - the Roslyn helper failed, run "ctxo doctor")');
    const snapshot = JSON.parse(readFileSync(join(tempDir, '.ctxo', 'index', 'communities.json'), 'utf-8'));
    expect(snapshot.edgeQuality).toBe('syntax-only');
  });

  it('recomputes community snapshot over the FULL project graph during --file incremental re-index', async () => {
    // Full run establishes real snapshot.
    await new IndexCommand(tempDir).run();
    const snapshotPath = join(tempDir, '.ctxo', 'index', 'communities.json');
    const before = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const beforeClusterCount = new Set(
      (before.communities as Array<{ communityId: number }>).map((c) => c.communityId),
    ).size;
    const beforeSymbolCount = before.communities.length;

    // Incremental re-index of a single file MUST refresh communities.json using the full
    // graph (committed index merged with in-memory fileIndex) — not just the 1-file subgraph.
    await new IndexCommand(tempDir).run({ file: 'src/types.ts' });
    const after = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const afterClusterCount = new Set(
      (after.communities as Array<{ communityId: number }>).map((c) => c.communityId),
    ).size;
    const afterSymbolCount = after.communities.length;

    // computedAt must advance (snapshot refreshed).
    expect(after.computedAt).not.toBe(before.computedAt);
    // Symbol count must match the full project — NOT just the 1-file subgraph.
    // If --file mode incorrectly ran over the subgraph we would see only that file's symbols.
    expect(afterSymbolCount).toBeGreaterThanOrEqual(beforeSymbolCount);
    // Cluster count stays in the right order of magnitude (no singleton explosion).
    expect(afterClusterCount).toBeLessThanOrEqual(beforeSymbolCount);
  });
});

describe('IndexCommand module seams', () => {
  let tempDir: string;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    tempDir = setupTempProject();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  });

  interface PassRecord {
    readonly indices: number;
    readonly commits: number | undefined;
    readonly head: string | undefined;
    readonly sameGraph: boolean;
    readonly graphNodes: number;
    readonly testFile: boolean;
    readonly sourceFile: boolean;
    readonly ctxoRoot: string;
  }

  function moduleWith(indexPass: (ctx: IndexPassContext) => Promise<void>): LoadedModule {
    return { name: '@ctxo/domain', version: '0.0.0', registration: { id: 'domain', indexPass } };
  }

  function recorder(seen: PassRecord[]): LoadedModule {
    return moduleWith(async (ctx) => {
      const graph = ctx.graph();
      seen.push({
        indices: ctx.indices.length,
        commits: ctx.history?.commits.length,
        head: ctx.history?.head,
        sameGraph: ctx.graph() === graph,
        graphNodes: graph.nodeCount,
        testFile: ctx.isTestFile('src/__tests__/greet.test.ts'),
        sourceFile: ctx.isTestFile('src/greet.ts'),
        ctxoRoot: ctx.ctxoRoot,
      });
    });
  }

  it('ctxo index runs module index passes on the merged index and survives a failing pass', async () => {
    const seen: PassRecord[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await new IndexCommand(tempDir).run({ modules: [recorder(seen)] });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      indices: 3,
      commits: 1,
      sameGraph: true,
      testFile: true,
      sourceFile: false,
      ctxoRoot: join(tempDir, '.ctxo'),
    });
    expect(seen[0]!.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(seen[0]!.graphNodes).toBeGreaterThan(0);

    // An incremental run re-indexes one file; the pass still sees the merged index of all three.
    await new IndexCommand(tempDir).run({ files: ['src/types.ts'], modules: [recorder(seen)] });
    expect(seen[1]).toMatchObject({ indices: 3, commits: 1 });

    // A throwing pass is reported; the passes after it still run and the run completes.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = moduleWith(async () => {
      throw new Error('registry exploded');
    });
    await new IndexCommand(tempDir).run({ modules: [failing, recorder(seen)] });

    const stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(stderr).toContain('[ctxo] @ctxo/domain index pass failed: registry exploded');
    expect(stderr).toContain('[ctxo] Index complete');
    expect(seen).toHaveLength(3);
  });

  it('a commit that changed no indexable file still runs module index passes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await new IndexCommand(tempDir).run({ skipHistory: true, modules: [] });

    mkdirSync(join(tempDir, 'docs', 'domain', 'lending'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'domain', 'lending', 'domain.md'), '# Lending\n', 'utf-8');
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...args], {
        cwd: tempDir,
        stdio: 'ignore',
      });
    };
    git('add', 'docs/domain/lending/domain.md');
    git('commit', '-m', 'docs: lending card');

    const seen: PassRecord[] = [];
    await new IndexCommand(tempDir).run({ commit: 'HEAD', modules: [recorder(seen)] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ indices: 3 });
  });

  it('module index passes run with --skip-community and --skip-history, and never with --check', async () => {
    const seen: PassRecord[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await new IndexCommand(tempDir).run({ skipCommunity: true, skipHistory: true, modules: [recorder(seen)] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ indices: 3, commits: undefined, head: undefined });

    // A failed community detection does not skip it either.
    vi.spyOn(detectorModule, 'CommunityDetector').mockImplementation(function () {
      throw new Error('louvain down');
    } as never);
    await new IndexCommand(tempDir).run({ modules: [recorder(seen)] });
    expect(seen).toHaveLength(2);

    await new IndexCommand(tempDir).run({ check: true, modules: [recorder(seen)] });
    expect(seen).toHaveLength(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('facts are requested when a module asks for them', async () => {
    writeFileSync(join(tempDir, 'src', 'a.fake'), 'fake source\n', 'utf-8');
    const fact: CodeFact = { kind: 'endpoint', symbolId: 'src/a.fake::a::function', line: 1, text: 'GET /a' };
    const capabilities: Array<PluginContext['capabilities']> = [];
    const extractFacts = vi.fn(async () => [fact]);
    const plugin: CtxoLanguagePlugin = {
      apiVersion: '2',
      id: 'fake',
      name: 'fake',
      version: '0.0.1',
      extensions: ['.fake'],
      tier: 'syntax',
      createAdapter: (ctx: PluginContext) => {
        capabilities.push(ctx.capabilities);
        return {
          extractSymbols: async () => [{ symbolId: 'src/a.fake::a::function', name: 'a', kind: 'function', startLine: 0, endLine: 0 }],
          extractEdges: async () => [],
          extractComplexity: async () => [],
          extractFacts,
          isSupported: () => true,
        };
      },
    };
    vi.spyOn(pluginDiscovery, 'discoverPlugins').mockResolvedValue({
      plugins: [{ plugin, specifier: 'ctxo-lang-fake' }],
      failures: [],
    } as unknown as Awaited<ReturnType<typeof pluginDiscovery.discoverPlugins>>);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const jsonFile = join(tempDir, '.ctxo', 'index', 'src', 'a.fake.json');

    // Without a module asking (and without index.facts), no facts are requested.
    await new IndexCommand(tempDir).run({ skipHistory: true, modules: [] });
    expect(capabilities.at(-1)?.facts).toBe(false);
    expect(extractFacts).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse(readFileSync(jsonFile, 'utf-8')))).not.toContain('facts');

    const asking: LoadedModule = {
      name: '@ctxo/domain',
      version: '0.0.0',
      registration: { id: 'domain', indexCapabilities: { facts: true } },
    };
    await new IndexCommand(tempDir).run({ skipHistory: true, modules: [asking] });

    // Both sites follow the module: the capability handed to the plugins and the Phase 1c extraction.
    expect(capabilities.at(-1)?.facts).toBe(true);
    expect(extractFacts).toHaveBeenCalled();
    expect(JSON.parse(readFileSync(jsonFile, 'utf-8')).facts).toEqual([fact]);
  });

  it('ctxo index drops retry-timeout and normalization facts of test files and keeps the other kinds', async () => {
    mkdirSync(join(tempDir, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'policy.fake'), 'fake source\n', 'utf-8');
    writeFileSync(join(tempDir, 'src', '__tests__', 'policy.test.fake'), 'fake source\n', 'utf-8');
    const factsFor = (file: string): CodeFact[] => [
      { kind: 'literal-comparison', symbolId: `${file}::a::function`, line: 1, text: 'n >= 5', detail: { operator: '>=', literal: '5' } },
      { kind: 'retry-timeout', symbolId: `${file}::a::function`, line: 2, text: 'maxRetries = 3', detail: { name: 'maxRetries', value: '3' } },
      { kind: 'normalization', symbolId: `${file}::a::function`, line: 3, text: 'email.trim()', detail: { method: 'trim' } },
    ];
    const plugin: CtxoLanguagePlugin = {
      apiVersion: '2',
      id: 'fake',
      name: 'fake',
      version: '0.0.1',
      extensions: ['.fake'],
      tier: 'syntax',
      createAdapter: () => ({
        extractSymbols: async (file: string) => [{ symbolId: `${file}::a::function`, name: 'a', kind: 'function', startLine: 0, endLine: 3 }],
        extractEdges: async () => [],
        extractComplexity: async () => [],
        extractFacts: async (file: string) => factsFor(file),
        isSupported: () => true,
      }),
    };
    vi.spyOn(pluginDiscovery, 'discoverPlugins').mockResolvedValue({
      plugins: [{ plugin, specifier: 'ctxo-lang-fake' }],
      failures: [],
    } as unknown as Awaited<ReturnType<typeof pluginDiscovery.discoverPlugins>>);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const asking: LoadedModule = {
      name: '@ctxo/domain',
      version: '0.0.0',
      registration: { id: 'domain', indexCapabilities: { facts: true } },
    };
    const read = (file: string) => JSON.parse(readFileSync(join(tempDir, '.ctxo', 'index', `${file}.json`), 'utf-8')).facts;

    await new IndexCommand(tempDir).run({ skipHistory: true, modules: [asking] });
    expect(read('src/policy.fake')).toEqual(factsFor('src/policy.fake'));
    expect(read('src/__tests__/policy.test.fake')).toEqual([factsFor('src/__tests__/policy.test.fake')[0]]);

    // An incremental run applies the same rule.
    await new IndexCommand(tempDir).run({ skipHistory: true, files: ['src/__tests__/policy.test.fake'], modules: [asking] });
    expect(read('src/__tests__/policy.test.fake')).toEqual([factsFor('src/__tests__/policy.test.fake')[0]]);
  });
});
