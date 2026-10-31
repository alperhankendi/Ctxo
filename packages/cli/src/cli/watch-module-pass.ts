import type { LoadedModule, WatchPathKind } from '../ports/i-ctxo-module.js';

/** Shortest quiet period after an edit of a module input (a card, the glossary, the registry) before the pass runs. */
export const MODULE_INPUT_QUIET_MS = 1000;
/** Quiet period after enough re-indexed source files, the community snapshot's debounce. */
export const MODULE_SOURCE_QUIET_MS = 5000;
/** How long a due pass waits while a file is still being re-indexed. */
export const MODULE_BUSY_RETRY_MS = 300;
/** The longest a due pass is postponed by further events or pending re-indexes. */
export const MODULE_MAX_WAIT_MS = 30_000;

/** What set off one pass: distinct input and source paths, and whether it is the start-up pass. */
export interface WatchPassTrigger {
  readonly inputs: number;
  readonly sources: number;
  readonly start: boolean;
}

export interface WatchModulePassSchedulerOptions {
  /** Distinct source files that arm the pass (`watch.snapshotMinFileChanges`). */
  readonly sourceThreshold: number;
  /** Runs the module index passes once. A rejection is reported and the scheduler goes on. */
  readonly run: (trigger: WatchPassTrigger) => Promise<void>;
  /** True while a re-index is pending or running; a due pass waits for it, so it reads the new index. */
  readonly isBusy?: () => boolean;
  readonly report?: (message: string) => void;
  /** Called with the duration of each pass in ms (the CLI logs it at debug level). */
  readonly onPassDuration?: (ms: number) => void;
  readonly inputQuietMs?: number;
  readonly sourceQuietMs?: number;
  readonly busyRetryMs?: number;
  readonly maxWaitMs?: number;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/**
 * When `ctxo watch` runs the module index passes. Never once per file event:
 *
 * - An edited module input (`classifyWatchPath` says `input`: a card, the glossary, the registry) arms the pass
 *   after a quiet period of `max(MODULE_INPUT_QUIET_MS, 2 x the duration of the last pass)` without further
 *   events, so a repository whose pass takes seconds is not re-scanned on every autosave.
 * - Changed source files (`source`) are counted; once `sourceThreshold` distinct ones are pending, the pass is
 *   armed after `MODULE_SOURCE_QUIET_MS` (or the adaptive input delay when longer), the community snapshot's policy.
 * - Every event while armed restarts the quiet period, and a due pass waits while a re-index is pending, but a
 *   pass is never postponed more than `MODULE_MAX_WAIT_MS` after it first became due.
 * - One pass covers everything noted before it starts; a pass never overlaps another, and events during a pass
 *   are kept for the next one.
 */
export class WatchModulePassScheduler {
  private readonly inputs = new Set<string>();
  private readonly sources = new Set<string>();
  private startPending = false;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private disposed = false;
  /** When the pending pass first became due; reset when a pass starts. */
  private dueSince: number | undefined;
  private lastPassMs = 0;
  private readonly inputQuietMs: number;
  private readonly sourceQuietMs: number;
  private readonly busyRetryMs: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly report: (message: string) => void;

  constructor(private readonly options: WatchModulePassSchedulerOptions) {
    this.inputQuietMs = options.inputQuietMs ?? MODULE_INPUT_QUIET_MS;
    this.sourceQuietMs = options.sourceQuietMs ?? MODULE_SOURCE_QUIET_MS;
    this.busyRetryMs = options.busyRetryMs ?? MODULE_BUSY_RETRY_MS;
    this.maxWaitMs = options.maxWaitMs ?? MODULE_MAX_WAIT_MS;
    this.now = options.now ?? Date.now;
    this.report = options.report ?? ((message: string) => console.error(message));
  }

  /** Notes one changed path of the given kind. */
  note(kind: WatchPathKind, path: string): void {
    if (this.disposed) return;
    (kind === 'input' ? this.inputs : this.sources).add(path);
    if (this.running === undefined) this.arm();
  }

  /** Asks for one pass at start-up (the artifacts are stale against their inputs), with the input quiet period. */
  requestStartPass(): void {
    if (this.disposed) return;
    this.startPending = true;
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

  /** The adaptive quiet period of an input edit: at least twice the last pass. */
  private inputDelay(): number {
    return Math.max(this.inputQuietMs, 2 * this.lastPassMs);
  }

  private delay(): number | undefined {
    if (this.inputs.size > 0 || this.startPending) return this.inputDelay();
    if (this.sources.size > 0 && this.sources.size >= this.options.sourceThreshold) {
      return Math.max(this.sourceQuietMs, this.inputDelay());
    }
    return undefined;
  }

  /** Arms the timer, never beyond `maxWaitMs` after the pass first became due. */
  private arm(delay = this.delay()): void {
    if (delay === undefined || this.disposed) return;
    const now = this.now();
    this.dueSince ??= now;
    const capped = Math.max(0, Math.min(delay, this.dueSince + this.maxWaitMs - now));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), capped);
  }

  private fire(): void {
    this.timer = undefined;
    if (this.disposed || this.running !== undefined || this.delay() === undefined) return;
    const overdue = this.dueSince !== undefined && this.now() - this.dueSince >= this.maxWaitMs;
    if (!overdue && this.options.isBusy?.()) {
      this.arm(this.busyRetryMs);
      return;
    }
    const trigger: WatchPassTrigger = { inputs: this.inputs.size, sources: this.sources.size, start: this.startPending };
    this.inputs.clear();
    this.sources.clear();
    this.startPending = false;
    this.dueSince = undefined;
    this.running = (async () => {
      const started = this.now();
      try {
        await this.options.run(trigger);
      } catch (err) {
        this.report(`[ctxo] Module index pass failed: ${(err as Error).message}`);
      } finally {
        this.lastPassMs = Math.max(0, this.now() - started);
        this.options.onPassDuration?.(this.lastPassMs);
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
