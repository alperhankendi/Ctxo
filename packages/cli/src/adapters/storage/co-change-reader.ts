import { readFileSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { loadCoChangeMap } from '../../core/co-change/co-change-analyzer.js';
import { createLogger } from '../../core/logger.js';
import { CoChangeMatrixSchema, type CoChangeEntry } from '../../core/types.js';
import type { ICoChangePort } from '../../ports/i-co-change-port.js';

const log = createLogger('ctxo:co-change');

type CoChangeMap = Map<string, CoChangeEntry[]>;

/**
 * What one version of the file, told apart by mtime and size, held: a usable map, or `undefined` for
 * content that was read but is unusable. It never stands for an I/O failure.
 */
interface CachedContent {
  readonly version: string;
  readonly map: CoChangeMap | undefined;
}

/** The problem is in the content, so nothing changes until the file does. */
const UNTIL_REWRITTEN = 'co-change is ignored until ctxo index rewrites it';
/** The problem may be passing: nothing is remembered about it, and the next call tries again. */
const UNTIL_RETRY = 'co-change is ignored for now and the next call tries again';

/**
 * Reads `<ctxoRoot>/index/co-changes.json` for every caller that tiers a blast radius: the MCP handlers,
 * `ctxo blast-radius`, the safe-edit gate and `ctxo gate --preview`.
 *
 * The file is validated with `CoChangeMatrixSchema` and turned into a lookup by file. The result is cached
 * until the file's mtime or size changes, so a long-running MCP server picks up a matrix that `ctxo index`
 * or the post-commit hook rewrites, without parsing it again on every call. Size joins the mtime in the
 * key because a coarse file system clock can give two different writes the same mtime.
 *
 * It never throws, and every caller works from the dependency graph alone when it returns `undefined`:
 * - A missing file (ENOENT) is the normal state of a project without history: silent.
 * - Content that is not JSON or not a matrix warns once and is cached like good content, since it stays
 *   the same answer until the file changes.
 * - Any other trouble (a stat error that is not ENOENT, a read that fails) says nothing about the content,
 *   so it is never cached: the next call tries again. It warns once for as long as the same problem lasts.
 *
 * The warning is deduplicated by its own key (`lastWarning`), not by the data cache, because the cache
 * deliberately forgets failures that are worth retrying.
 *
 * The returned map is shared between calls and frozen (every list and every entry): treat it as read-only.
 */
export class CoChangeReader implements ICoChangePort {
  private readonly filePath: string;
  private cached: CachedContent | undefined;
  /** What the last warning was about, so one problem is reported once. */
  private lastWarning: string | undefined;

  constructor(ctxoRoot: string) {
    this.filePath = join(ctxoRoot, 'index', 'co-changes.json');
  }

  readCoChangeMap(): CoChangeMap | undefined {
    let stats: Stats;
    try {
      stats = statSync(this.filePath);
    } catch (err) {
      // Whatever was cached may be out of date once the file cannot be seen, so it goes in every case.
      this.cached = undefined;
      const { code, message } = err as NodeJS.ErrnoException;
      if (code === 'ENOENT') {
        this.lastWarning = undefined; // a clean slate: a bad file that comes back is worth a new warning
      } else {
        this.warnOnce(`stat ${code ?? message}`, `cannot be inspected (${message})`, UNTIL_RETRY);
      }
      return undefined;
    }

    // The stat is taken before the read: a file replaced in between is cached under the older key, so the
    // next call sees a different stat and reads again. The other order could keep stale content under a new key.
    const version = `${stats.mtimeMs}:${stats.size}`;
    if (this.cached?.version === version) return this.cached.map;
    return this.load(version);
  }

  private load(version: string): CoChangeMap | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      this.cached = undefined;
      this.warnOnce(`read ${version}`, `cannot be read (${(err as Error).message})`, UNTIL_RETRY);
      return undefined;
    }

    const map = this.parse(raw, version);
    this.cached = { version, map };
    if (map) this.lastWarning = undefined;
    return map;
  }

  private parse(raw: string, version: string): CoChangeMap | undefined {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return this.unusable(version, `is not valid JSON (${(err as Error).message})`);
    }

    const parsed = CoChangeMatrixSchema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue && issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : '';
      return this.unusable(version, `is not a valid co-change matrix (${where}${issue?.message ?? 'unknown problem'})`);
    }
    return freezeEntries(loadCoChangeMap(parsed.data));
  }

  private unusable(version: string, problem: string): undefined {
    this.warnOnce(`content ${version}`, problem, UNTIL_REWRITTEN);
    return undefined;
  }

  private warnOnce(key: string, problem: string, consequence: string): void {
    if (this.lastWarning === key) return;
    this.lastWarning = key;
    log.warn(`${this.filePath} ${problem}; ${consequence}`);
  }
}

/**
 * Freezes every list and every entry of the map. It is shared by all callers, so an in-place edit (a sort,
 * say) would silently change what every other caller sees; frozen, the first attempt throws instead. The
 * map itself stays a plain Map.
 */
function freezeEntries(map: CoChangeMap): CoChangeMap {
  for (const list of map.values()) {
    for (const entry of list) Object.freeze(entry);
    Object.freeze(list);
  }
  return map;
}
