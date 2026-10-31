import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the fold guard keeps per session (spec 10.4): where the session started and the fingerprints it blocked. */
export interface GuardSessionRecord {
  readonly version: 1;
  /** Full SHA of HEAD at SessionStart; null when the repository had no commit yet (D10). */
  readonly startHead: string | null;
  readonly blocked: readonly string[];
  /** Cursor reminder only: when the last reminder went out (ms since the epoch), for the time-window fallback. */
  readonly remindedAt?: number;
}

const DIRECTORY = 'domain-guard';

/** Session records untouched this long are pruned when a new session record is created. */
export const RECORD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is GuardSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v['version'] === 1 &&
    (v['startHead'] === null || typeof v['startHead'] === 'string') &&
    Array.isArray(v['blocked']) &&
    v['blocked'].every((entry) => typeof entry === 'string') &&
    (v['remindedAt'] === undefined || (typeof v['remindedAt'] === 'number' && Number.isFinite(v['remindedAt'])))
  );
}

/**
 * One JSON file per session under `<cacheDir>/domain-guard/`. Each file is read once, never checked first;
 * a new record is created in one step (`wx`) so a resumed session keeps its original record, and an update
 * goes to a fresh temporary file renamed over the record (PF27). Nothing here throws.
 */
export class GuardSessionStore {
  private readonly dir: string;

  /** `cacheDir` is `<projectRoot>/.ctxo/.cache`. */
  constructor(
    cacheDir: string,
    private readonly logError: (message: string) => void = (message) => console.error(`[ctxo:domain-guard] ${message}`),
  ) {
    this.dir = join(cacheDir, DIRECTORY);
  }

  private file(sessionId: string): string {
    return join(this.dir, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  }

  /** The session's record; undefined when it is missing or unreadable. */
  read(sessionId: string): GuardSessionRecord | undefined {
    let text: string;
    try {
      text = readFileSync(this.file(sessionId), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.logError(`Cannot read the session record: ${(err as Error).message}`);
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) {
        return {
          version: 1,
          startHead: parsed.startHead,
          blocked: [...parsed.blocked],
          ...(parsed.remindedAt !== undefined ? { remindedAt: parsed.remindedAt } : {}),
        };
      }
    } catch {
      // Reported below.
    }
    this.logError(`Ignoring an unreadable session record for ${sessionId}`);
    return undefined;
  }

  /**
   * Writes `record` only when the session has none yet. True when this call created it. A created record also
   * prunes the records not touched for `RECORD_MAX_AGE_MS` (one directory listing, once per new session).
   */
  create(sessionId: string, record: GuardSessionRecord, now: number = Date.now()): boolean {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file(sessionId), JSON.stringify(record), { encoding: 'utf-8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') this.logError(`Cannot write the session record: ${(err as Error).message}`);
      return false;
    }
    this.prune(now);
    return true;
  }

  /** Deletes record files (and leftover temporary files) older than `RECORD_MAX_AGE_MS`. Never throws. */
  prune(now: number = Date.now()): void {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
      const path = join(this.dir, name);
      try {
        if (now - statSync(path).mtimeMs > RECORD_MAX_AGE_MS) rmSync(path, { force: true });
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  }

  /** Replaces the session's record. */
  write(sessionId: string, record: GuardSessionRecord): void {
    const target = this.file(sessionId);
    const temp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(temp, JSON.stringify(record), { encoding: 'utf-8', flag: 'wx' });
      renameSync(temp, target);
    } catch (err) {
      this.logError(`Cannot write the session record: ${(err as Error).message}`);
      try {
        rmSync(temp, { force: true });
      } catch {
        // Nothing more to do.
      }
    }
  }
}
