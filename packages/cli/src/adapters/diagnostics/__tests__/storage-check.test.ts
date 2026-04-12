import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { SqliteCacheCheck } from '../checks/storage-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

let tempDir: string;
let ctxoRoot: string;
let ctx: CheckContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ctxo-store-'));
  ctxoRoot = join(tempDir, '.ctxo');
  ctx = { projectRoot: tempDir, ctxoRoot };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SqliteCacheCheck', () => {
  const check = new SqliteCacheCheck();

  it('returns warn when DB file is missing', async () => {
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('missing');
    expect(result.fix).toContain('ctxo sync');
  });

  it('returns pass when DB is valid', async () => {
    const cacheDir = join(ctxoRoot, '.cache');
    mkdirSync(cacheDir, { recursive: true });

    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE symbols (id TEXT)');
    db.run('CREATE TABLE edges (id TEXT)');
    db.run('CREATE TABLE files (id TEXT)');
    const data = db.export();
    db.close();
    writeFileSync(join(cacheDir, 'symbols.db'), Buffer.from(data));

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('integrity_check passed');
  });

  it('returns fail when DB file is corrupt', async () => {
    const cacheDir = join(ctxoRoot, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'symbols.db'), 'not-a-sqlite-database');

    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.fix).toContain('ctxo sync');
  });
});
