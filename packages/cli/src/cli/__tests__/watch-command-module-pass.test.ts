import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FileChangeEvent, FileChangeHandler } from '../../ports/i-watcher-port.js';
import type { CtxoModuleRegistration, IndexPassContext, LoadedModule, WatchPathKind } from '../../ports/i-ctxo-module.js';

/**
 * `ctxo watch` with the module seam: the chokidar watcher and the plugin loader are replaced, everything else
 * (JSON writer, SQLite cache, config, the module pass runner) is real, in a temp project without git. Timers are
 * fake (setTimeout and clearTimeout only), so the quiet periods are stepped, never waited for; real I/O runs
 * between the steps. Every watcher is stopped after its test.
 */

const watcherState = vi.hoisted(() => ({ handler: undefined as FileChangeHandler | undefined }));

vi.mock('../../adapters/watcher/chokidar-watcher-adapter.js', () => ({
  ChokidarWatcherAdapter: class {
    start(handler: FileChangeHandler): void {
      watcherState.handler = handler;
    }
    async stop(): Promise<void> {}
  },
}));

vi.mock('../plugin-loader.js', () => ({
  loadPlugins: async () => [
    {
      specifier: 'fake',
      plugin: { id: 'fake', version: '0.0.0', tier: 'syntax', extensions: ['.ts'] },
      adapter: {
        extractSymbols: async (file: string) => [
          { symbolId: `${file}::f::function`, name: 'f', kind: 'function', startLine: 0, endLine: 1 },
        ],
        extractEdges: async () => [],
        extractComplexity: async () => [],
        isSupported: (file: string) => file.endsWith('.ts'),
      },
    },
  ],
}));

const { WatchCommand } = await import('../watch-command.js');
type Watch = InstanceType<typeof WatchCommand>;

const CARD = 'docs/domain/lending/domain.md';
const REGISTRY = 'docs/domain/contexts.yaml';

function classify(path: string, indexed: boolean): WatchPathKind | undefined {
  if (path === REGISTRY || path === CARD) return 'input';
  return indexed ? 'source' : undefined;
}

describe('ctxo watch runs the module index passes', () => {
  let root: string;
  let passes: IndexPassContext[];
  let errors: string[];
  let running: Watch[];

  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, 'utf-8');
  };
  const emit = (event: FileChangeEvent, path: string) => watcherState.handler!(event, join(root, path));
  const domainModule = (extra: Partial<CtxoModuleRegistration> = {}): LoadedModule => ({
    name: '@ctxo/domain',
    version: '0.0.0',
    registration: {
      id: 'domain',
      indexPass: async (ctx) => {
        passes.push(ctx);
      },
      classifyWatchPath: classify,
      ...extra,
    },
  });
  const start = async (modules: readonly LoadedModule[]): Promise<Watch> => {
    const watch = new WatchCommand(root);
    running.push(watch);
    await watch.run({ modules });
    return watch;
  };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  /** Steps fake time in 100 ms slices, letting real I/O run between them, until `condition` holds. */
  const until = async (condition: () => boolean): Promise<void> => {
    const end = Date.now() + 20_000;
    while (!condition()) {
      if (Date.now() > end) throw new Error(`timed out; stderr:\n${errors.join('\n')}`);
      await vi.advanceTimersByTimeAsync(100);
      await tick();
    }
  };
  /** Steps `ms` of fake time. */
  const elapse = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 100) {
      await vi.advanceTimersByTimeAsync(100);
      await tick();
    }
  };
  const indexed = (file: string) => existsSync(join(root, '.ctxo/index', `${file}.json`));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root = mkdtempSync(join(tmpdir(), 'ctxo-watch-module-'));
    mkdirSync(join(root, '.ctxo'), { recursive: true });
    write('.ctxo/config.yaml', 'version: "1.0"\nwatch:\n  snapshotMinFileChanges: 3\n');
    passes = [];
    errors = [];
    running = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    for (const watch of running) await watch.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    watcherState.handler = undefined;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('runs the pass after a card edit, with the merged index, the start config and no change log', async () => {
    await start([domainModule()]);
    write('src/a.ts', 'export function f() {}\n');
    emit('add', 'src/a.ts');
    await until(() => indexed('src/a.ts'));
    // A config edit after start does not reach the pass: watch reads the config once.
    write('.ctxo/config.yaml', 'version: "1.0"\nwatch:\n  snapshotMinFileChanges: 9\n');
    write(CARD, '# Lending\n');
    emit('change', CARD);
    await until(() => passes.length === 1);
    const ctx = passes[0]!;
    expect(ctx.indices.map((i) => i.file)).toEqual(['src/a.ts']);
    expect(ctx.history).toBeUndefined();
    expect(ctx.projectRoot).toBe(root);
    expect(ctx.config.watch?.snapshotMinFileChanges).toBe(3);
    expect(ctx.factsRequested).toBe(false);
    expect(errors).toContain('[ctxo] Module index pass after 1 module input change(s) and 1 source change(s)');
  });

  it('tells the pass when the plugins were asked for facts', async () => {
    await start([domainModule({ indexCapabilities: { facts: true } })]);
    write(CARD, '# Lending\n');
    emit('change', CARD);
    await until(() => passes.length === 1);
    expect(passes[0]!.factsRequested).toBe(true);
  });

  it('runs one pass after a registry edit and a burst of events', async () => {
    await start([domainModule()]);
    write(REGISTRY, 'version: 1\ncontexts: []\n');
    for (let i = 0; i < 20; i += 1) {
      emit('change', REGISTRY);
      emit('change', CARD);
    }
    await until(() => passes.length === 1);
    await elapse(15_000);
    expect(passes).toHaveLength(1);
  });

  it('ignores files no module reads, and sources below the threshold', async () => {
    await start([domainModule()]);
    write('README.md', '# readme\n');
    emit('change', 'README.md');
    emit('unlink', 'notes.txt');
    write('src/a.ts', 'export function f() {}\n');
    emit('change', 'src/a.ts');
    await until(() => indexed('src/a.ts'));
    await elapse(15_000);
    expect(passes).toHaveLength(0);
  });

  it('runs no pass without the module, exactly as before', async () => {
    const indexPass = vi.fn(async () => {});
    // A module without classifyWatchPath (an older @ctxo/domain) takes no part either.
    await start([{ name: '@ctxo/domain', version: '0.0.0', registration: { id: 'domain', indexPass, watchArtifactsStale: () => true } }]);
    write(CARD, '# Lending\n');
    emit('change', CARD);
    write('src/a.ts', 'export function f() {}\n');
    emit('change', 'src/a.ts');
    await until(() => indexed('src/a.ts'));
    await elapse(15_000);
    expect(indexPass).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes('Module index pass') || e.includes('stale'))).toBe(false);
  });

  it('runs one pass at start when the module reports stale artifacts, and none otherwise', async () => {
    await start([domainModule({ watchArtifactsStale: () => true })]);
    await until(() => passes.length === 1);
    expect(errors).toContain('[ctxo] Module artifacts are stale against their inputs; refreshing them');
    expect(errors).toContain('[ctxo] Module index pass after start (stale artifacts)');
    await elapse(15_000);
    expect(passes).toHaveLength(1);
  });

  it('runs no start pass when the artifacts are fresh, or the check throws', async () => {
    await start([domainModule({ watchArtifactsStale: () => false })]);
    await elapse(5000);
    expect(passes).toHaveLength(0);
    await running.pop()!.stop();
    await start([domainModule({ watchArtifactsStale: () => { throw new Error('no state'); } })]);
    await elapse(5000);
    expect(passes).toHaveLength(0);
    expect(errors).toContain('[ctxo] @ctxo/domain stale check failed: no state');
  });

  it('logs a failing pass and keeps watching', async () => {
    let calls = 0;
    await start([
      domainModule({
        indexPass: async () => {
          calls += 1;
          throw new Error('graph exploded');
        },
      }),
    ]);
    write(CARD, '# Lending\n');
    emit('change', CARD);
    await until(() => calls === 1);
    await until(() => errors.includes('[ctxo] @ctxo/domain index pass failed: graph exploded'));
    write('src/b.ts', 'export function f() {}\n');
    emit('add', 'src/b.ts');
    await until(() => indexed('src/b.ts'));
    emit('change', CARD);
    await until(() => calls === 2);
  });

  it('stop() drains an in-flight pass and stops further passes', async () => {
    let release: () => void = () => {};
    let finished = false;
    const watch = await start([
      domainModule({
        indexPass: async () => {
          await new Promise<void>((resolve) => (release = resolve));
          finished = true;
        },
      }),
    ]);
    write(CARD, '# Lending\n');
    emit('change', CARD);
    await elapse(1500);
    const stopping = watch.stop();
    release();
    await stopping;
    expect(finished).toBe(true);
    emit('change', CARD);
    await elapse(5000);
    expect(errors).toContain('[ctxo] Watcher stopped');
  });
});
