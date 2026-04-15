import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileCheck } from '../checks/config-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

let tempDir: string;
let ctxoRoot: string;
let ctx: CheckContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ctxo-cfg-'));
  ctxoRoot = join(tempDir, '.ctxo');
  mkdirSync(ctxoRoot, { recursive: true });
  ctx = { projectRoot: tempDir, ctxoRoot };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('ConfigFileCheck', () => {
  const check = new ConfigFileCheck();

  it('returns warn when config.yaml is missing', async () => {
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('using defaults');
  });

  it('returns pass when config.yaml has valid content', async () => {
    writeFileSync(join(ctxoRoot, 'config.yaml'), 'stats:\n  enabled: true\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('valid');
  });

  it('returns warn when config.yaml is empty', async () => {
    writeFileSync(join(ctxoRoot, 'config.yaml'), '');
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('empty');
  });

  it('returns fail when config.yaml contains tabs', async () => {
    writeFileSync(join(ctxoRoot, 'config.yaml'), 'stats:\n\tenabled: true\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('tabs');
  });

  it('returns pass with unknown keys (no schema validation)', async () => {
    writeFileSync(join(ctxoRoot, 'config.yaml'), 'unknown_key: value\nfoo: bar\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });
});
