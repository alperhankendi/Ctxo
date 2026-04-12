import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiskUsageCheck } from '../checks/disk-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

let tempDir: string;
let ctxoRoot: string;
let ctx: CheckContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ctxo-disk-'));
  ctxoRoot = join(tempDir, '.ctxo');
  ctx = { projectRoot: tempDir, ctxoRoot };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('DiskUsageCheck', () => {
  it('returns pass when .ctxo/ does not exist', async () => {
    const check = new DiskUsageCheck();
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no .ctxo/');
  });

  it('returns pass for small directory (below warn threshold)', async () => {
    const check = new DiskUsageCheck();
    mkdirSync(ctxoRoot, { recursive: true });
    writeFileSync(join(ctxoRoot, 'test.json'), '{}');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.value).toBeTruthy();
  });

  it('reports size in KB for small directories', async () => {
    const check = new DiskUsageCheck();
    mkdirSync(ctxoRoot, { recursive: true });
    writeFileSync(join(ctxoRoot, 'test.json'), 'x'.repeat(500));
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/KB|MB/);
  });

  it('returns warn when size exceeds warn threshold', async () => {
    // Use tiny thresholds: warn at 0.0001MB (~100 bytes), fail at 0.001MB (~1KB)
    const check = new DiskUsageCheck({ warnMb: 0.0001, failMb: 0.001 });
    mkdirSync(ctxoRoot, { recursive: true });
    writeFileSync(join(ctxoRoot, 'data.bin'), Buffer.alloc(500)); // 500 bytes
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('consider pruning');
  });

  it('returns fail when size exceeds fail threshold', async () => {
    // Use tiny thresholds: warn at 0.00001MB, fail at 0.0001MB (~100 bytes)
    const check = new DiskUsageCheck({ warnMb: 0.00001, failMb: 0.0001 });
    mkdirSync(ctxoRoot, { recursive: true });
    writeFileSync(join(ctxoRoot, 'data.bin'), Buffer.alloc(500)); // 500 bytes > 100 bytes
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('unusually large');
    expect(result.fix).toBeTruthy();
  });

  it('returns correct id and title', () => {
    const check = new DiskUsageCheck();
    expect(check.id).toBe('disk_usage');
    expect(check.title).toBe('Disk usage');
  });

  it('formats size in MB when >= 1MB', async () => {
    // warnMb high so it stays pass
    const check = new DiskUsageCheck({ warnMb: 1000, failMb: 2000 });
    mkdirSync(ctxoRoot, { recursive: true });
    // Write a 1.1MB file
    writeFileSync(join(ctxoRoot, 'large.bin'), Buffer.alloc(1024 * 1024 + 100000));
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/MB/);
  });
});
