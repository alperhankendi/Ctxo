import { readFileSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import type { ContextsView } from '../../core/contexts-view/contexts-view-builder.js';
import { ContextsViewSchema } from '../../core/contexts-view/contexts-view-schema.js';
import { createLogger } from '../../core/logger.js';
import type { IContextsViewPort } from '../../ports/i-contexts-view-port.js';

const log = createLogger('ctxo:contexts-view');

/** What one version of the file, told apart by mtime and size, held: a view, or `undefined` for unusable content. */
interface CachedContent {
  readonly version: string;
  readonly view: ContextsView | undefined;
}

const UNTIL_REWRITTEN = 'the contexts view is ignored until ctxo index rewrites it';
const UNTIL_RETRY = 'the contexts view is ignored for now and the next call tries again';

/**
 * Freezes the view and everything in it. It is shared by all callers, so an in-place edit (a sort, say)
 * would silently change what every other caller sees; frozen, the first attempt throws instead.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Reads `<ctxoRoot>/index/contexts-view.json`, validates it with `ContextsViewSchema` and caches the result
 * until the file's mtime or size changes. It never throws; `undefined` means there is no usable view.
 *
 * - A missing file is the normal state of a project that was never indexed: silent.
 * - Content that is not JSON (a merge conflict, a hand edit) or not a view warns once per file version and
 *   is cached like good content, since the answer stays the same until the file changes.
 * - Any other trouble (a stat error that is not ENOENT, a failed read) is never cached; it warns once for
 *   as long as the same problem lasts.
 */
export class ContextsViewReader implements IContextsViewPort {
  private readonly filePath: string;
  private cached: CachedContent | undefined;
  private lastWarning: string | undefined;

  constructor(ctxoRoot: string) {
    this.filePath = join(ctxoRoot, 'index', 'contexts-view.json');
  }

  readContextsView(): ContextsView | undefined {
    let stats: Stats;
    try {
      stats = statSync(this.filePath);
    } catch (err) {
      this.cached = undefined;
      const { code, message } = err as NodeJS.ErrnoException;
      if (code === 'ENOENT') {
        this.lastWarning = undefined;
      } else {
        this.warnOnce(`stat ${code ?? message}`, `cannot be inspected (${message})`, UNTIL_RETRY);
      }
      return undefined;
    }

    // The stat is taken before the read, so a file replaced in between is cached under the older key and
    // the next call reads again.
    // The inode joins mtime and size because atomicWrite renames in a fresh file, so a same-size rewrite in
    // one mtime tick still changes the key.
    const version = `${stats.mtimeMs}:${stats.size}:${stats.ino}`;
    if (this.cached?.version === version) return this.cached.view;
    return this.load(version);
  }

  private load(version: string): ContextsView | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      this.cached = undefined;
      this.warnOnce(`read ${version}`, `cannot be read (${(err as Error).message})`, UNTIL_RETRY);
      return undefined;
    }

    const view = this.parse(raw, version);
    this.cached = { version, view };
    if (view) this.lastWarning = undefined;
    return view;
  }

  private parse(raw: string, version: string): ContextsView | undefined {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.warnOnce(`content ${version}`, `is not valid JSON (${(err as Error).message})`, UNTIL_REWRITTEN);
      return undefined;
    }
    const parsed = ContextsViewSchema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue && issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : '';
      this.warnOnce(
        `content ${version}`,
        `is not a valid contexts view (${where}${issue?.message ?? 'unknown problem'})`,
        UNTIL_REWRITTEN,
      );
      return undefined;
    }
    return deepFreeze(parsed.data);
  }

  private warnOnce(key: string, problem: string, consequence: string): void {
    if (this.lastWarning === key) return;
    this.lastWarning = key;
    log.warn(`${this.filePath} ${problem}; ${consequence}`);
  }
}
