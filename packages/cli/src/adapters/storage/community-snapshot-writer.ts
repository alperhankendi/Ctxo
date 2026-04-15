import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { createLogger } from '../../core/logger.js';
import type { CommunitySnapshot } from '../../core/types.js';
import { atomicWrite } from './atomic-write.js';

const log = createLogger('ctxo:community-snapshot');

const DEFAULT_HISTORY_LIMIT = 10;
const HISTORY_DIR_NAME = 'communities.history';
const CURRENT_FILE_NAME = 'communities.json';
const NOCOMMIT_SHA = 'nocommit';

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
    // overwriting. This keeps history as "snapshots older than current" —
    // drift and boundary-violation detectors compare current vs history[0]
    // and must not see current in both positions.
    //
    // Skip archival for snapshots whose commitSha is 'nocommit' (git
    // unavailable at write time). They have no stable anchor for drift
    // comparison and would pollute history with indistinguishable entries.
    const currentPath = join(this.indexDir, CURRENT_FILE_NAME);
    if (existsSync(currentPath)) {
      try {
        const existingRaw = readFileSync(currentPath, 'utf-8');
        const existing = JSON.parse(existingRaw) as CommunitySnapshot;
        if (existing.commitSha && existing.commitSha !== NOCOMMIT_SHA) {
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

  listHistory(limit?: number): CommunitySnapshot[] {
    if (!existsSync(this.historyDir)) return [];
    const entries = readdirSync(this.historyDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse();
    const snapshots: CommunitySnapshot[] = [];
    for (const name of entries) {
      const snap = this.safeParse(join(this.historyDir, name));
      if (!snap) continue;
      // Defense in depth: filter any legacy `nocommit` entries that slipped
      // into history before the writer skip-archival guard landed.
      if (!snap.commitSha || snap.commitSha === NOCOMMIT_SHA) continue;
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

  private rotateHistory(): void {
    if (!existsSync(this.historyDir)) return;
    const entries = readdirSync(this.historyDir)
      .filter((name) => name.endsWith('.json'))
      .sort();
    const excess = entries.length - this.historyLimit;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i++) {
      const target = join(this.historyDir, entries[i]!);
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
