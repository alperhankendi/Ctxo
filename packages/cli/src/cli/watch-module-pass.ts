import type { LoadedModule, WatchPathKind } from '../ports/i-ctxo-module.js';

/** Quiet period after an edit of a module input (a card, the glossary, the registry) before the pass runs. */
export const MODULE_INPUT_QUIET_MS = 1000;
/** Quiet period after enough re-indexed source files, the community snapshot's debounce. */
export const MODULE_SOURCE_QUIET_MS = 5000;
/** How long a due pass waits while a file is still being re-indexed. */
export const MODULE_BUSY_RETRY_MS = 300;

export interface WatchModulePassSchedulerOptions {
  /** Distinct source files that arm the pass (`watch.snapshotMinFileChanges`). */
  readonly sourceThreshold: number;
  /** Runs the module index passes once. A rejection is reported and the scheduler goes on. */
  readonly run: (trigger: { readonly inputs: number; readonly sources: number }) => Promise<void>;
  /** True while a re-index is pending or running; a due pass waits for it, so it reads the new index. */
  readonly isBusy?: () => boolean;
  readonly report?: (message: string) => void;
  readonly inputQuietMs?: number;
  readonly sourceQuietMs?: number;
  readonly busyRetryMs?: number;
}

/**
 * When `ctxo watch` runs the module index passes. Never once per file event:
 *
 * - An edited module input (`classifyWatchPath` says `input`: a card, the glossary, the registry, a
 *   shadow-specs file) arms the pass after `MODULE_INPUT_QUIET_MS` without further events. These files are
 *   cheap to read, and the domain tools report them as stale until the pass ran.
 * - Changed source files (`source`) are counted; once `sourceThreshold` distinct ones are pending, the pass
 *   is armed after `MODULE_SOURCE_QUIET_MS`, the same policy as the community snapshot.
 * - Every event while armed restarts the quiet period. One pass covers everything noted before it starts; a
 *   pass never overlaps another, and events during a pass are kept for the next one.
 */
export class WatchModulePassScheduler {
  private readonly inputs = new Set<string>();
  private readonly sources = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private disposed = false;
  private readonly inputQuietMs: number;
  private readonly sourceQuietMs: number;
  private readonly busyRetryMs: number;
  private readonly report: (message: string) => void;

  constructor(private readonly options: WatchModulePassSchedulerOptions) {
    this.inputQuietMs = options.inputQuietMs ?? MODULE_INPUT_QUIET_MS;
    this.sourceQuietMs = options.sourceQuietMs ?? MODULE_SOURCE_QUIET_MS;
    this.busyRetryMs = options.busyRetryMs ?? MODULE_BUSY_RETRY_MS;
    this.report = options.report ?? ((message: string) => console.error(message));
  }

  /** Notes one changed path of the given kind. */
  note(kind: WatchPathKind, path: string): void {
    if (this.disposed) return;
    (kind === 'input' ? this.inputs : this.sources).add(path);
    if (this.running === undefined) this.arm();
  }

  /** The pass in flight, if any (tests and shutdown). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private delay(): number | undefined {
    if (this.inputs.size > 0) return this.inputQuietMs;
    if (this.sources.size > 0 && this.sources.size >= this.options.sourceThreshold) return this.sourceQuietMs;
    return undefined;
  }

  private arm(delay = this.delay()): void {
    if (delay === undefined || this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire(): void {
    this.timer = undefined;
    if (this.disposed || this.running !== undefined || this.delay() === undefined) return;
    if (this.options.isBusy?.()) {
      this.arm(this.busyRetryMs);
      return;
    }
    const trigger = { inputs: this.inputs.size, sources: this.sources.size };
    this.inputs.clear();
    this.sources.clear();
    this.running = (async () => {
      try {
        await this.options.run(trigger);
      } catch (err) {
        this.report(`[ctxo] Module index pass failed: ${(err as Error).message}`);
      } finally {
        this.running = undefined;
        // Events noted during the pass get their own.
        this.arm();
      }
    })();
  }
}

/**
 * The kind of a changed path for the modules that run under `ctxo watch` (the first module's answer wins), or
 * undefined when no module's pass depends on it. A module whose classifier throws is skipped with a report.
 */
export function classifyWatchPath(
  modules: readonly LoadedModule[],
  path: string,
  indexed: boolean,
  report: (message: string) => void = (message) => console.error(message),
): WatchPathKind | undefined {
  let kind: WatchPathKind | undefined;
  for (const module of modules) {
    const classify = module.registration.classifyWatchPath;
    if (typeof classify !== 'function' || typeof module.registration.indexPass !== 'function') continue;
    try {
      const answer = classify.call(module.registration, path, indexed);
      if (answer === 'input') return 'input';
      if (answer === 'source') kind = 'source';
    } catch (err) {
      report(`[ctxo] ${module.name} watch classification failed for ${path}: ${(err as Error).message}`);
    }
  }
  return kind;
}

/** The modules `ctxo watch` runs an index pass for: those with both `indexPass` and `classifyWatchPath`. */
export function watchPassModules(modules: readonly LoadedModule[]): LoadedModule[] {
  return modules.filter(
    (module) =>
      typeof module.registration.indexPass === 'function' && typeof module.registration.classifyWatchPath === 'function',
  );
}
