import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FileChangeEvent, FileChangeHandler } from '../../ports/i-watcher-port.js';
import type { IndexPassContext, LoadedModule, WatchPathKind } from '../../ports/i-ctxo-module.js';

/**
 * `ctxo watch` with the module seam: the chokidar watcher and the plugin loader are replaced, everything else
 * (JSON writer, SQLite cache, config, the module pass runner) is real, in a temp project without git.
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

const CARD = 'docs/domain/lending/domain.md';
const REGISTRY = 'docs/domain/contexts.yaml';

interface Fixture {
  root: string;
  passes: IndexPassContext[];
  modules: LoadedModule[];
  emit(event: FileChangeEvent, path: string): void;
  write(path: string, text: string): void;
}

function classify(path: string, indexed: boolean): WatchPathKind | undefined {
  if (path === REGISTRY || path === CARD) return 'input';
  return indexed ? 'source' : undefined;
}

describe('ctxo watch runs the module index passes', () => {
  let fx: Fixture;
  let errors: string[];
  let listeners: { sigint: Function[]; sigterm: Function[] };

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'ctxo-watch-module-'));
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, 'utf-8');
    };
    mkdirSync(join(root, '.ctxo'), { recursive: true });
    write('.ctxo/config.yaml', 'version: "1.0"\nwatch:\n  snapshotMinFileChanges: 3\n');
    const passes: IndexPassContext[] = [];
    const modules: LoadedModule[] = [
      {
        name: '@ctxo/domain',
        version: '0.0.0',
        registration: {
          id: 'domain',
          indexPass: async (ctx) => {
            passes.push(ctx);
          },
          classifyWatchPath: classify,
        },
      },
    ];
    fx = {
      root,
      passes,
      modules,
      write,
      emit: (event, path) => watcherState.handler!(event, join(root, path)),
    };
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    listeners = { sigint: process.listeners('SIGINT'), sigterm: process.listeners('SIGTERM') };
  });

  afterEach(() => {
    for (const l of process.listeners('SIGINT')) if (!listeners.sigint.includes(l)) process.removeListener('SIGINT', l as never);
    for (const l of process.listeners('SIGTERM')) if (!listeners.sigterm.includes(l)) process.removeListener('SIGTERM', l as never);
    vi.restoreAllMocks();
    watcherState.handler = undefined;
    // Best effort: a watcher of an earlier test can still hold a file on Windows.
    try {
      rmSync(fx.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // left for the OS temp cleanup
    }
  });

  const until = async (condition: () => boolean, ms = 20_000): Promise<void> => {
    const end = Date.now() + ms;
    while (!condition()) {
      if (Date.now() > end) throw new Error(`timed out; stderr:\n${errors.join('\n')}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('runs the pass after a card edit, with the merged index and no change log', async () => {
    await new WatchCommand(fx.root).run({ modules: fx.modules });
    fx.write('src/a.ts', 'export function f() {}\n');
    fx.emit('add', 'src/a.ts');
    await until(() => existsSync(join(fx.root, '.ctxo/index/src/a.ts.json')));
    fx.write(CARD, '# Lending\n');
    fx.emit('change', CARD);
    await until(() => fx.passes.length === 1);
    const ctx = fx.passes[0]!;
    expect(ctx.indices.map((i) => i.file)).toEqual(['src/a.ts']);
    expect(ctx.history).toBeUndefined();
    expect(ctx.projectRoot).toBe(fx.root);
    expect(errors.some((e) => e.includes('Module index pass after 1 module input change(s) and 1 source change(s)'))).toBe(true);
  });

  it('runs one pass after a registry edit and a burst of events', async () => {
    await new WatchCommand(fx.root).run({ modules: fx.modules });
    fx.write(REGISTRY, 'version: 1\ncontexts: []\n');
    for (let i = 0; i < 20; i += 1) {
      fx.emit('change', REGISTRY);
      fx.emit('change', CARD);
    }
    await until(() => fx.passes.length === 1);
    await wait(1500);
    expect(fx.passes).toHaveLength(1);
  });

  it('ignores files no module reads, and sources below the threshold', async () => {
    await new WatchCommand(fx.root).run({ modules: fx.modules });
    fx.write('README.md', '# readme\n');
    fx.emit('change', 'README.md');
    fx.emit('unlink', 'notes.txt');
    fx.write('src/a.ts', 'export function f() {}\n');
    fx.emit('change', 'src/a.ts');
    await wait(1800);
    expect(fx.passes).toHaveLength(0);
  });

  it('runs no pass without the module, exactly as before', async () => {
    const indexPass = vi.fn(async () => {});
    // A module without classifyWatchPath (an older @ctxo/domain) takes no part either.
    await new WatchCommand(fx.root).run({
      modules: [{ name: '@ctxo/domain', version: '0.0.0', registration: { id: 'domain', indexPass } }],
    });
    fx.write(CARD, '# Lending\n');
    fx.emit('change', CARD);
    fx.write('src/a.ts', 'export function f() {}\n');
    fx.emit('change', 'src/a.ts');
    await wait(1800);
    expect(indexPass).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes('Module index pass'))).toBe(false);
  });

  it('logs a failing pass and keeps watching', async () => {
    let calls = 0;
    const modules: LoadedModule[] = [
      {
        name: '@ctxo/domain',
        version: '0.0.0',
        registration: {
          id: 'domain',
          indexPass: async () => {
            calls += 1;
            throw new Error('graph exploded');
          },
          classifyWatchPath: classify,
        },
      },
    ];
    await new WatchCommand(fx.root).run({ modules });
    fx.write(CARD, '# Lending\n');
    fx.emit('change', CARD);
    await until(() => calls === 1);
    await until(() => errors.some((e) => e.includes('@ctxo/domain index pass failed: graph exploded')));
    fx.write('src/b.ts', 'export function f() {}\n');
    fx.emit('add', 'src/b.ts');
    await until(() => existsSync(join(fx.root, '.ctxo/index/src/b.ts.json')));
    fx.emit('change', CARD);
    await until(() => calls === 2);
  });
});
