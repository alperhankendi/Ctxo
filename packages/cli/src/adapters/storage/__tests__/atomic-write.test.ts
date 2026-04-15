import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWrite, sweepStaleTmpFiles } from '../atomic-write.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctxo-atomic-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  it('writes content to the target path via rename', () => {
    const target = join(dir, 'snap.json');
    atomicWrite(target, '{"x":1}');
    expect(readFileSync(target, 'utf-8')).toBe('{"x":1}');
  });

  it('does not leave a .tmp file on successful write', () => {
    const target = join(dir, 'snap.json');
    atomicWrite(target, '{"x":1}');
    // Walk the dir — nothing matching the .<pid>.tmp suffix should remain.
    const files = require('node:fs').readdirSync(dir) as string[];
    expect(files.some((f) => /\.\d+\.tmp$/.test(f))).toBe(false);
  });
});

describe('sweepStaleTmpFiles', () => {
  const STALE_AGE = 120_000;
  const oldTime = Date.now() - STALE_AGE;

  it('returns 0 on a non-existent directory (no throw)', () => {
    const cleaned = sweepStaleTmpFiles(join(dir, 'missing'));
    expect(cleaned).toBe(0);
  });

  it('returns 0 when no .tmp files exist', () => {
    writeFileSync(join(dir, 'normal.json'), '{}');
    expect(sweepStaleTmpFiles(dir)).toBe(0);
  });

  it('removes stale <pid>.tmp files older than the threshold', () => {
    const orphan = join(dir, 'snap.json.12345.tmp');
    writeFileSync(orphan, 'partial');
    const oldSeconds = oldTime / 1000;
    utimesSync(orphan, oldSeconds, oldSeconds);

    const cleaned = sweepStaleTmpFiles(dir);
    expect(cleaned).toBe(1);
    expect(existsSync(orphan)).toBe(false);
  });

  it('leaves fresh .tmp files alone (race-safe)', () => {
    const fresh = join(dir, 'snap.json.99999.tmp');
    writeFileSync(fresh, 'in-flight');
    // Default threshold is 60 s; brand-new file should be under it.
    const cleaned = sweepStaleTmpFiles(dir);
    expect(cleaned).toBe(0);
    expect(existsSync(fresh)).toBe(true);
  });

  it('recurses into subdirectories (catches history/*.tmp)', () => {
    const sub = join(dir, 'history');
    mkdirSync(sub);
    const orphan = join(sub, 'snap.json.42.tmp');
    writeFileSync(orphan, 'partial');
    const oldSeconds = oldTime / 1000;
    utimesSync(orphan, oldSeconds, oldSeconds);

    expect(sweepStaleTmpFiles(dir)).toBe(1);
    expect(existsSync(orphan)).toBe(false);
  });

  it('does not touch files without the <pid>.tmp suffix pattern', () => {
    const misleading = join(dir, 'just.tmp');
    writeFileSync(misleading, 'not ours');
    const oldSeconds = oldTime / 1000;
    utimesSync(misleading, oldSeconds, oldSeconds);

    expect(sweepStaleTmpFiles(dir)).toBe(0);
    expect(existsSync(misleading)).toBe(true);
  });
});
