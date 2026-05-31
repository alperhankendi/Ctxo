import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateSessionStore } from '../gate-session-store.js';

let cacheDir: string;
beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'ctxo-gate-')); });

describe('GateSessionStore', () => {
  it('records and recalls warned symbols per session', () => {
    const store = new GateSessionStore(cacheDir);
    expect(store.hasWarned('sess1', 'src/a.ts::A::class')).toBe(false);
    store.recordWarned('sess1', 'src/a.ts::A::class');
    expect(store.hasWarned('sess1', 'src/a.ts::A::class')).toBe(true);
    expect(store.hasWarned('sess2', 'src/a.ts::A::class')).toBe(false);
    rmSync(cacheDir, { recursive: true, force: true });
  });
});
