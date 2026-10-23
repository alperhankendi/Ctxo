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

  it('warns on an invalid index.ignore glob and names the index globs in the fix hint', async () => {
    // picomatch refuses patterns above 65536 characters, the one way a non-empty string fails.
    const tooLong = 'a'.repeat(65_537);
    writeFileSync(join(ctxoRoot, 'config.yaml'), `index:\n  ignore:\n    - "${tooLong}"\n`);
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('index.ignore:');
    expect(result.fix).toContain('index.ignore');
    expect(result.fix).toContain('index.ignoreProjects');
  });

  it('warns on invalid cochange.include / cochange.exclude globs and names them in the fix hint', async () => {
    const tooLong = 'a'.repeat(65_537);
    writeFileSync(
      join(ctxoRoot, 'config.yaml'),
      `cochange:\n  include:\n    - "${tooLong}"\n  exclude:\n    - "${tooLong}"\n`,
    );
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('2 invalid glob pattern(s)');
    expect(result.message).toContain('cochange.include:');
    expect(result.message).toContain('cochange.exclude:');
    expect(result.fix).toContain('cochange.include');
    expect(result.fix).toContain('cochange.exclude');
  });

  it('fails and names the key for a typo under contextsView.hubs', async () => {
    writeFileSync(join(ctxoRoot, 'config.yaml'), 'contextsView:\n  hubs:\n    minDependent: 5\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('contextsView.hubs');
  });

  it('returns pass with unknown keys (no schema validation)', async () => {
    writeFileSync(join(ctxoRoot, 'config.yaml'), 'unknown_key: value\nfoo: bar\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });
});
