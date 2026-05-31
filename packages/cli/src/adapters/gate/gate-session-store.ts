import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:gate-store');

/** Tracks which symbols the gate has already warned about, per session. */
export class GateSessionStore {
  constructor(private readonly cacheDir: string) {}

  private file(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.cacheDir, 'gate', `${safe}.json`);
  }

  private read(sessionId: string): Set<string> {
    const f = this.file(sessionId);
    if (!existsSync(f)) return new Set();
    try {
      return new Set(JSON.parse(readFileSync(f, 'utf-8')) as string[]);
    } catch (err) {
      log.error(`${(err as Error).message}`);
      return new Set();
    }
  }

  hasWarned(sessionId: string, symbolId: string): boolean {
    return this.read(sessionId).has(symbolId);
  }

  recordWarned(sessionId: string, symbolId: string): void {
    try {
      const set = this.read(sessionId);
      set.add(symbolId);
      const f = this.file(sessionId);
      mkdirSync(join(this.cacheDir, 'gate'), { recursive: true });
      writeFileSync(f, JSON.stringify([...set]), 'utf-8');
    } catch (err) {
      log.error(`${(err as Error).message}`);
    }
  }
}
