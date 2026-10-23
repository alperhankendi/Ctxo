import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { compareCodepoint } from '../../core/compare-codepoint.js';
import { createLogger } from '../../core/logger.js';
import type { CommunitySnapshot } from '../../core/types.js';
import { atomicWrite } from './atomic-write.js';

const log = createLogger('ctxo:community-snapshot');

const DEFAULT_HISTORY_LIMIT = 10;
const HISTORY_DIR_NAME = 'communities.history';
const CURRENT_FILE_NAME = 'communities.json';
const NOCOMMIT_SHA = 'nocommit';
/** The counter `historyFilename` puts before the extension when two archives would get the same name. */
const COLLISION_COUNTER_RE = /^(.*)\.(\d+)\.json$/;

export interface CommunitySnapshotWriterOptions {
  readonly historyLimit?: number;
  /**
   * Acknowledge that this writer targets a production `.ctxo/` root (user's
   * real project). Required when the path is outside the system tmpdir; this
   * prevents test runs from accidentally writing a tiny/invalid snapshot into
   * the developer's real project via an unisolated fixture.
   */
  readonly allowProductionPath?: boolean;
}

export class CommunitySnapshotWriter {
  private readonly indexDir: string;
  private readonly historyDir: string;
  private readonly historyLimit: number;

  constructor(
    ctxoRoot: string,
    historyLimitOrOptions: number | CommunitySnapshotWriterOptions = DEFAULT_HISTORY_LIMIT,
  ) {
    const options: CommunitySnapshotWriterOptions =
      typeof historyLimitOrOptions === 'number'
        ? { historyLimit: historyLimitOrOptions }
        : historyLimitOrOptions;

    this.indexDir = join(ctxoRoot, 'index');
    this.historyDir = join(this.indexDir, HISTORY_DIR_NAME);
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;

    assertSafeWritePath(ctxoRoot, options.allowProductionPath ?? false);
  }

  writeSnapshot(snapshot: CommunitySnapshot): void {
    mkdirSync(this.indexDir, { recursive: true });
    mkdirSync(this.historyDir, { recursive: true });

    // Archive the previous current snapshot (if any) into history BEFORE
    // overwriting. This keeps history as "snapshots older than current".
    // Drift and boundary-violation detectors compare current against the
    // newest history entry from a different commit (history[0] on a clean
    // history) and must not see current in both positions.
    //
    // Two cases are not archived:
    // - commitSha 'nocommit' (git unavailable at write time). Such snapshots
    //   have no stable anchor for drift comparison and would pollute history
    //   with indistinguishable entries.
    // - the same commit as the new snapshot. History is a chain of commits,
    //   not of runs: the v1 post-commit hook ran `ctxo index --file` once per
    //   changed file (the v2 hook runs `ctxo index --commit HEAD` once) and
    //   `ctxo watch` re-snapshots after every burst of edits, all at the same
    //   HEAD. The new snapshot simply replaces current, so a
    //   commit enters history once, when the next commit supersedes it.
    const currentPath = join(this.indexDir, CURRENT_FILE_NAME);
    if (existsSync(currentPath)) {
      try {
        const existingRaw = readFileSync(currentPath, 'utf-8');
        const existing = JSON.parse(existingRaw) as CommunitySnapshot;
        const existingCommit = archivedCommit(existing);
        if (existingCommit !== undefined && existingCommit !== snapshot.commitSha) {
          const historyFile = this.historyFilename(existing);
          this.atomicWrite(join(this.historyDir, historyFile), existingRaw);
        }
      } catch (err) {
        log.error(`failed to archive existing snapshot: ${(err as Error).message}`);
      }
    }

    const json = JSON.stringify(snapshot, null, 2);
    this.atomicWrite(currentPath, json);

    this.rotateHistory();
  }

  readCurrent(): CommunitySnapshot | undefined {
    const path = join(this.indexDir, CURRENT_FILE_NAME);
    if (!existsSync(path)) return undefined;
    return this.safeParse(path);
  }

  /**
   * Archived snapshots, newest first, at most one per commit. Where several
   * files hold the same commitSha (older versions archived once per
   * `ctxo index --file` run) the newest file wins. `limit` caps the number of
   * commits returned. Read-only: the duplicates stay on disk until the next
   * write rotates them out.
   */
  listHistory(limit?: number): CommunitySnapshot[] {
    if (!existsSync(this.historyDir)) return [];
    const snapshots: CommunitySnapshot[] = [];
    const seen = new Set<string>();
    for (const name of this.historyNames().reverse()) {
      const snap = this.safeParse(join(this.historyDir, name));
      // Defense in depth: filter any legacy `nocommit` entries that slipped
      // into history before the writer skip-archival guard landed.
      const commit = archivedCommit(snap);
      if (!snap || commit === undefined) continue;
      if (seen.has(commit)) continue;
      seen.add(commit);
      snapshots.push(snap);
      if (typeof limit === 'number' && snapshots.length >= limit) break;
    }
    return snapshots;
  }

  private atomicWrite(targetPath: string, content: string): void {
    atomicWrite(targetPath, content);
  }

  private historyFilename(snapshot: CommunitySnapshot): string {
    const ts = snapshot.computedAt.replace(/[:.]/g, '-');
    const sha = snapshot.commitSha || 'nocommit';
    const base = join(this.historyDir, `${ts}-${sha}`);
    // Collision guard: if the same-timestamp file already exists (rare but
    // possible with sub-millisecond writes), append a monotonic suffix.
    let candidate = `${base}.json`;
    let n = 1;
    while (existsSync(candidate)) {
      candidate = `${base}.${n++}.json`;
      if (n > 1_000) break; // safety
    }
    return candidate.slice(this.historyDir.length + 1);
  }

  /** The `.json` files in the history folder, oldest first. */
  private historyNames(): string[] {
    return readdirSync(this.historyDir)
      .filter((name) => name.endsWith('.json'))
      .sort(compareHistoryNames);
  }

  /**
   * Rotation in two steps. First the duplicates go: every file that is not
   * the newest readable file of its commit (the copies older versions left
   * behind, one per `ctxo index --file` run). Then, by file count, the oldest
   * files beyond `historyLimit`. Copies therefore never use up slots, history
   * keeps each commit at most once, and a commit's newest file is removed
   * only together with its commit, when that is among the oldest beyond the
   * limit. Files that stand for no commit (unreadable, 'nocommit') are not
   * duplicates of anything and age out by count like the rest.
   */
  private rotateHistory(): void {
    if (!existsSync(this.historyDir)) return;
    const seen = new Set<string>();
    const unique: string[] = []; // one file per commit, plus files that stand for none; newest first
    const doomed: string[] = [];
    for (const name of this.historyNames().reverse()) {
      const commit = archivedCommit(this.safeParse(join(this.historyDir, name)));
      if (commit !== undefined) {
        if (seen.has(commit)) {
          doomed.push(name);
          continue;
        }
        seen.add(commit);
      }
      unique.push(name);
    }
    doomed.push(...unique.slice(this.historyLimit));

    for (const name of doomed) {
      const target = join(this.historyDir, name);
      try {
        unlinkSync(target);
      } catch (err) {
        log.error(`failed to rotate ${basename(target)}: ${(err as Error).message}`);
      }
    }
  }

  private safeParse(path: string): CommunitySnapshot | undefined {
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as CommunitySnapshot;
    } catch (err) {
      log.error(`failed to parse ${basename(path)}: ${(err as Error).message}`);
      return undefined;
    }
  }
}

/**
 * The commit a snapshot stands for in history, or undefined when it stands for
 * none: unreadable, no commitSha, or 'nocommit'. Those are never archived and
 * never listed.
 */
function archivedCommit(snapshot: CommunitySnapshot | undefined): string | undefined {
  const sha = snapshot?.commitSha;
  return sha && sha !== NOCOMMIT_SHA ? sha : undefined;
}

/**
 * Orders history file names oldest first. A name starts with the snapshot's
 * timestamp, so comparing names is comparing time, with one exception: when
 * two archives share a timestamp and a commit, `historyFilename` numbers the
 * later one ("<ts>-<sha>.1.json") and "x.1.json" sorts before "x.json". The
 * name without the counter decides first, the counter breaks the tie.
 */
function compareHistoryNames(a: string, b: string): number {
  const [baseA, counterA] = splitCollisionCounter(a);
  const [baseB, counterB] = splitCollisionCounter(b);
  return compareCodepoint(baseA, baseB) || counterA - counterB;
}

function splitCollisionCounter(name: string): [base: string, counter: number] {
  const match = COLLISION_COUNTER_RE.exec(name);
  return match ? [`${match[1]}.json`, Number(match[2])] : [name, 0];
}

/**
 * Production `.ctxo/` roots must be opted into explicitly. This catches
 * the rogue case where a test forgets to pass a tmpdir and would otherwise
 * clobber the developer's real snapshot (as happened during v0.8 runtime
 * analysis — a 39-node modularity-0 snapshot appeared in the repo root from
 * an unisolated fixture).
 */
function assertSafeWritePath(ctxoRoot: string, allowProduction: boolean): void {
  const resolved = resolve(ctxoRoot);
  const tmpRoot = resolve(tmpdir());
  const inTmp = resolved.startsWith(tmpRoot);
  if (inTmp || allowProduction) return;
  throw new Error(
    `CommunitySnapshotWriter: refusing to write to non-tmp path ${resolved}. ` +
      `Pass { allowProductionPath: true } for production CLI writes, or target a tmpdir-based path in tests.`,
  );
}
