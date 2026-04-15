import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  IndexDirectoryCheck,
  IndexFreshnessCheck,
  SymbolCountCheck,
  EdgeCountCheck,
  OrphanedFilesCheck,
  CoChangesCacheCheck,
  SchemaVersionCheck,
} from '../checks/index-check.js';
import { buildFileIndex, buildSecondFileIndex } from '../../storage/__tests__/test-fixtures.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

let tempDir: string;
let ctxoRoot: string;
let ctx: CheckContext;

function seedIndex(files: { file: string; symbols?: unknown[]; edges?: unknown[] }[]): void {
  const indexDir = join(ctxoRoot, 'index');
  mkdirSync(indexDir, { recursive: true });
  for (const f of files) {
    const idx = buildFileIndex({
      file: f.file,
      symbols: (f.symbols as never[]) ?? buildFileIndex().symbols,
      edges: (f.edges as never[]) ?? buildFileIndex().edges,
    });
    const jsonPath = join(indexDir, `${f.file}.json`);
    mkdirSync(join(jsonPath, '..'), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(idx));
  }
  // Write schema version
  writeFileSync(join(indexDir, 'schema-version'), '1.0.0');
}

function createSourceFile(name: string): void {
  const srcPath = join(tempDir, name);
  mkdirSync(join(srcPath, '..'), { recursive: true });
  writeFileSync(srcPath, '// source');
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ctxo-idx-'));
  ctxoRoot = join(tempDir, '.ctxo');
  ctx = { projectRoot: tempDir, ctxoRoot };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('IndexDirectoryCheck', () => {
  const check = new IndexDirectoryCheck();

  it('returns fail when index directory is missing', async () => {
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('No index directory');
  });

  it('returns fail when index directory is empty', async () => {
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('empty');
  });

  it('returns pass with file count when index has files', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts' }]);
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('1 files indexed');
  });
});

describe('IndexFreshnessCheck', () => {
  const check = new IndexFreshnessCheck();

  it('returns fail when no indexed files', async () => {
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
  });

  it('returns pass when all files are fresh', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts' }]);
    // Make source file older than index
    const past = new Date(Date.now() - 10000);
    utimesSync(join(tempDir, 'src/foo.ts'), past, past);
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('fresh');
  });

  it('returns warn when <=10% stale', async () => {
    // Create 20 files, make 1 stale (5%)
    const files = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`);
    for (const f of files) createSourceFile(f);
    seedIndex(files.map(f => ({ file: f })));
    // Make all source files older than index
    const past = new Date(Date.now() - 10000);
    for (const f of files) utimesSync(join(tempDir, f), past, past);
    // Now make one source file newer than its index
    const future = new Date(Date.now() + 10000);
    utimesSync(join(tempDir, files[0]!), future, future);

    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('stale');
  });

  it('returns fail when >10% stale', async () => {
    // Create 5 files, make 3 stale (60%)
    const files = Array.from({ length: 5 }, (_, i) => `src/g${i}.ts`);
    for (const f of files) createSourceFile(f);
    seedIndex(files.map(f => ({ file: f })));
    // Make all source files older than index
    const past = new Date(Date.now() - 10000);
    for (const f of files) utimesSync(join(tempDir, f), past, past);
    // Now make 3 source files newer than their index
    const future = new Date(Date.now() + 10000);
    utimesSync(join(tempDir, files[0]!), future, future);
    utimesSync(join(tempDir, files[1]!), future, future);
    utimesSync(join(tempDir, files[2]!), future, future);

    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('60%');
  });
});

describe('SymbolCountCheck', () => {
  const check = new SymbolCountCheck();

  it('returns pass when symbols exist', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts' }]);
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('symbols');
  });

  it('returns fail when no symbols', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts', symbols: [] }]);
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('0 symbols');
  });
});

describe('EdgeCountCheck', () => {
  const check = new EdgeCountCheck();

  it('returns pass when edges exist', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts' }]);
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('returns warn when no edges', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts', edges: [] }]);
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('0 edges');
  });
});

describe('OrphanedFilesCheck', () => {
  const check = new OrphanedFilesCheck();

  it('returns pass when no index files', async () => {
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('returns pass when all index files have matching source files', async () => {
    createSourceFile('src/foo.ts');
    seedIndex([{ file: 'src/foo.ts' }]);
    const result = await check.run(ctx);
    // git ls-files won't work in temp dir without git init, so it falls back gracefully
    expect(['pass']).toContain(result.status);
  });
});

describe('CoChangesCacheCheck', () => {
  const check = new CoChangesCacheCheck();

  it('returns pass when co-changes.json exists', async () => {
    const indexDir = join(ctxoRoot, 'index');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'co-changes.json'), '{}');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('returns warn when co-changes.json is missing', async () => {
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
  });
});

describe('SchemaVersionCheck', () => {
  const check = new SchemaVersionCheck();

  it('returns pass when schema version matches', async () => {
    const indexDir = join(ctxoRoot, 'index');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'schema-version'), '1.0.0');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.value).toBe('1.0.0');
  });

  it('returns fail when no schema version', async () => {
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
  });

  it('returns fail when schema version mismatches', async () => {
    const indexDir = join(ctxoRoot, 'index');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'schema-version'), '0.1.0');
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('expected');
  });
});
