import { readdirSync, renameSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:storage');

const TMP_SUFFIX_RE = /\.\d+\.tmp$/;
const TMP_STALE_THRESHOLD_MS = 60_000; // anything older than 60 s is from a dead process

export function atomicWrite(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, targetPath);
}

/**
 * Remove orphaned .<pid>.tmp files left behind when a previous write crashed
 * (SIGKILL / power loss / ENOSPC). Only files older than a threshold are
 * removed so we never race a concurrent writer.
 *
 * Safe to call on every startup — walks the supplied directory non-recursively.
 */
export function sweepStaleTmpFiles(dir: string, now: number = Date.now()): number {
  if (!existsSync(dir)) return 0;
  let cleaned = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        cleaned += sweepStaleTmpFiles(join(dir, entry.name), now);
        continue;
      }
      if (!TMP_SUFFIX_RE.test(entry.name)) continue;
      const full = join(dir, entry.name);
      try {
        const age = now - statSync(full).mtimeMs;
        if (age < TMP_STALE_THRESHOLD_MS) continue;
        unlinkSync(full);
        cleaned++;
      } catch (err) {
        log.error(`failed to sweep ${entry.name}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    log.error(`failed to scan ${dir}: ${(err as Error).message}`);
  }
  return cleaned;
}
