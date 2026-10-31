import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtxoModuleRegistration, LoadedModule } from '../../ports/i-ctxo-module.js';
import {
  MODULE_INPUT_QUIET_MS,
  MODULE_MAX_WAIT_MS,
  MODULE_SOURCE_QUIET_MS,
  WatchModulePassScheduler,
  classifyWatchPath,
  watchPassModules,
} from '../watch-module-pass.js';

const moduleOf = (registration: Partial<CtxoModuleRegistration>, name = '@ctxo/domain'): LoadedModule => ({
  name,
  version: '0.0.0',
  registration: { id: 'domain', ...registration },
});

describe('WatchModulePassScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const create = (overrides: Partial<ConstructorParameters<typeof WatchModulePassScheduler>[0]> = {}) => {
    const run = vi.fn(async () => {});
    const report = vi.fn();
    const scheduler = new WatchModulePassScheduler({ sourceThreshold: 5, run, report, ...overrides });
    return { scheduler, run: (overrides.run as typeof run | undefined) ?? run, report };
  };

  it('runs the pass once, a quiet period after a card edit', async () => {
    const { scheduler, run } = create();
    scheduler.note('input', 'docs/domain/lending/domain.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await scheduler.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ inputs: 1, sources: 0, start: false });
  });

  it('batches many events into one pass', async () => {
    const { scheduler, run } = create();
    for (let i = 0; i < 40; i += 1) {
      scheduler.note('input', 'docs/domain/contexts.yaml');
      scheduler.note('input', `docs/domain/c${i % 3}/domain.md`);
      scheduler.note('source', `src/f${i}.ts`);
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ inputs: 4, sources: 40, start: false });
    await vi.advanceTimersByTimeAsync(MODULE_SOURCE_QUIET_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('counts source files towards the threshold, then waits the source quiet period', async () => {
    const { scheduler, run } = create({ sourceThreshold: 3 });
    scheduler.note('source', 'src/a.ts');
    scheduler.note('source', 'src/b.ts');
    scheduler.note('source', 'src/a.ts');
    await vi.advanceTimersByTimeAsync(MODULE_SOURCE_QUIET_MS * 2);
    expect(run).not.toHaveBeenCalled();
    scheduler.note('source', 'src/c.ts');
    await vi.advanceTimersByTimeAsync(MODULE_SOURCE_QUIET_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await scheduler.idle();
    expect(run).toHaveBeenCalledWith({ inputs: 0, sources: 3, start: false });
  });

  it('a card edit also carries the pending source files below the threshold', async () => {
    const { scheduler, run } = create();
    scheduler.note('source', 'src/a.ts');
    scheduler.note('input', 'docs/domain/glossary.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(run).toHaveBeenCalledWith({ inputs: 1, sources: 1, start: false });
  });

  it('waits while a re-index is pending, so the pass reads the new index', async () => {
    let busy = true;
    const { scheduler, run } = create({ isBusy: () => busy });
    scheduler.note('input', 'docs/domain/contexts.yaml');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS * 3);
    expect(run).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never overlaps passes; events during a pass get one more pass', async () => {
    let release: () => void = () => {};
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => (release = resolve));
      active -= 1;
    });
    const { scheduler } = create({ run });
    scheduler.note('input', 'docs/domain/a.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.note('input', 'docs/domain/b.md');
    scheduler.note('input', 'docs/domain/c.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await scheduler.idle();
    // The first pass held 3 s of clock, so the follow-up waits the adaptive 2 x 3 s.
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({ inputs: 2, sources: 0, start: false });
    release();
    await scheduler.idle();
    expect(maxActive).toBe(1);
  });

  it('a failing pass is reported and the next edit still runs a pass', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const { scheduler, report } = create({ run });
    scheduler.note('input', 'docs/domain/a.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(report).toHaveBeenCalledWith('[ctxo] Module index pass failed: boom');
    scheduler.note('input', 'docs/domain/a.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits at least twice the last pass before the next card-edit pass', async () => {
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 4000));
    });
    const durations: number[] = [];
    const { scheduler } = create({ run, onPassDuration: (ms) => durations.push(ms) });
    scheduler.note('input', 'docs/domain/a.md');
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS + 4000);
    await scheduler.idle();
    expect(durations).toEqual([4000]);
    scheduler.note('input', 'docs/domain/a.md');
    await vi.advanceTimersByTimeAsync(8000 - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a stream of edits postpones a due pass at most the max wait', async () => {
    const { scheduler, run } = create();
    for (let t = 0; t < MODULE_MAX_WAIT_MS + 5000; t += 500) {
      scheduler.note('input', 'docs/domain/a.md');
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('pending re-indexes postpone a due pass at most the max wait', async () => {
    const { scheduler, run } = create({ isBusy: () => true });
    scheduler.note('input', 'docs/domain/a.md');
    await vi.advanceTimersByTimeAsync(MODULE_MAX_WAIT_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs one start-up pass when asked', async () => {
    const { scheduler, run } = create();
    scheduler.requestStartPass();
    await vi.advanceTimersByTimeAsync(MODULE_INPUT_QUIET_MS);
    await scheduler.idle();
    expect(run).toHaveBeenCalledWith({ inputs: 0, sources: 0, start: true });
    await vi.advanceTimersByTimeAsync(MODULE_SOURCE_QUIET_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs nothing after dispose', async () => {
    const { scheduler, run } = create();
    scheduler.note('input', 'docs/domain/a.md');
    scheduler.dispose();
    scheduler.note('input', 'docs/domain/b.md');
    await vi.advanceTimersByTimeAsync(MODULE_SOURCE_QUIET_MS);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('classifyWatchPath', () => {
  const indexPass = async () => {};

  it('asks the modules that have both an index pass and a classifier', () => {
    const classify = vi.fn((path: string, indexed: boolean) => (path.endsWith('.md') ? 'input' : indexed ? 'source' : undefined));
    const modules = [moduleOf({ indexPass, classifyWatchPath: classify })];
    expect(classifyWatchPath(modules, 'docs/domain/lending/domain.md', false)).toBe('input');
    expect(classifyWatchPath(modules, 'src/a.ts', true)).toBe('source');
    expect(classifyWatchPath(modules, 'README.txt', false)).toBeUndefined();
    expect(classify).toHaveBeenCalledWith('src/a.ts', true);
  });

  it('answers undefined without a module, a classifier or an index pass', () => {
    expect(classifyWatchPath([], 'docs/domain/contexts.yaml', false)).toBeUndefined();
    expect(classifyWatchPath([moduleOf({ indexPass })], 'docs/domain/contexts.yaml', false)).toBeUndefined();
    expect(classifyWatchPath([moduleOf({ classifyWatchPath: () => 'input' })], 'x', false)).toBeUndefined();
    expect(watchPassModules([moduleOf({ indexPass }), moduleOf({ classifyWatchPath: () => 'input' })])).toEqual([]);
  });

  it('reports a classifier that throws and asks the next module', () => {
    const report = vi.fn();
    const modules = [
      moduleOf({ indexPass, classifyWatchPath: () => { throw new Error('bad'); } }, 'first'),
      moduleOf({ indexPass, classifyWatchPath: () => 'source' }, 'second'),
    ];
    expect(classifyWatchPath(modules, 'src/a.ts', true, report)).toBe('source');
    expect(report).toHaveBeenCalledWith('[ctxo] first watch classification failed for src/a.ts: bad');
  });
});
