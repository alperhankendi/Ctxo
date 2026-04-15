import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { createLogger } from '../../core/logger.js';
import type { CommunitySnapshot } from '../../core/types.js';
import { atomicWrite } from './atomic-write.js';

const log = createLogger('ctxo:community-snapshot');

const DEFAULT_HISTORY_LIMIT = 10;
const HISTORY_DIR_NAME = 'communities.history';
const CURRENT_FILE_NAME = 'communities.json';

export class CommunitySnapshotWriter {
  private readonly indexDir: string;
  private readonly historyDir: string;
  private readonly historyLimit: number;

  constructor(ctxoRoot: string, historyLimit: number = DEFAULT_HISTORY_LIMIT) {
    this.indexDir = join(ctxoRoot, 'index');
    this.historyDir = join(this.indexDir, HISTORY_DIR_NAME);
    this.historyLimit = historyLimit;
  }

  writeSnapshot(snapshot: CommunitySnapshot): void {
    mkdirSync(this.indexDir, { recursive: true });
    mkdirSync(this.historyDir, { recursive: true });

    // Archive the previous current snapshot (if any) into history BEFORE
    // overwriting. This keeps history as "snapshots older than current" —
    // drift and boundary-violation detectors compare current vs history[0]
    // and must not see current in both positions.
    const currentPath = join(this.indexDir, CURRENT_FILE_NAME);
    if (existsSync(currentPath)) {
      try {
        const existingRaw = readFileSync(currentPath, 'utf-8');
        const existing = JSON.parse(existingRaw) as CommunitySnapshot;
        const historyFile = this.historyFilename(existing);
        this.atomicWrite(join(this.historyDir, historyFile), existingRaw);
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
    const bounded = typeof limit === 'number' ? entries.slice(0, limit) : entries;
    const snapshots: CommunitySnapshot[] = [];
    for (const name of bounded) {
      const snap = this.safeParse(join(this.historyDir, name));
      if (snap) snapshots.push(snap);
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
