import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { DoctorCommand } from '../doctor-command.js';
import { buildFileIndex } from '../../adapters/storage/__tests__/test-fixtures.js';

let tempDir: string;
let errorSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function setupHealthyProject(): void {
  const ctxoRoot = join(tempDir, '.ctxo');
  const indexDir = join(ctxoRoot, 'index');
  const cacheDir = join(ctxoRoot, '.cache');
  mkdirSync(indexDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(join(tempDir, '.git'));

  // Source file
  const srcDir = join(tempDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'foo.ts'), '// source');

  // Index file
  const idx = buildFileIndex({ file: 'src/foo.ts' });
  mkdirSync(join(indexDir, 'src'), { recursive: true });
  writeFileSync(join(indexDir, 'src', 'foo.ts.json'), JSON.stringify(idx));

  // Schema version
  writeFileSync(join(indexDir, 'schema-version'), '1.0.0');

  // Co-changes
  writeFileSync(join(indexDir, 'co-changes.json'), '{}');

  // Config
  writeFileSync(join(ctxoRoot, 'config.yaml'), 'stats:\n  enabled: true\n');
}

async function seedValidDb(): Promise<void> {
  const cacheDir = join(tempDir, '.ctxo', '.cache');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE symbols (id TEXT)');
  db.run('CREATE TABLE edges (id TEXT)');
  db.run('CREATE TABLE files (id TEXT)');
  const data = db.export();
  db.close();
  writeFileSync(join(cacheDir, 'symbols.db'), Buffer.from(data));
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ctxo-doctor-'));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  process.exitCode = undefined; // reset between tests
});

afterEach(() => {
  errorSpy.mockRestore();
  stdoutSpy.mockRestore();
  process.exitCode = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('DoctorCommand', () => {
  it('sets exitCode 1 on empty project (many checks fail)', async () => {
    const cmd = new DoctorCommand(tempDir);
    await cmd.run();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined; // cleanup
  });

  it('outputs human-readable format by default', async () => {
    setupHealthyProject();
    await seedValidDb();
    const cmd = new DoctorCommand(tempDir);
    try {
      await cmd.run();
    } catch {
      // may exit
    }
    const output = errorSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('ctxo doctor — Health Check');
    expect(output).toContain('Summary');
  });

  it('outputs JSON format with --json flag', async () => {
    setupHealthyProject();
    await seedValidDb();
    const cmd = new DoctorCommand(tempDir);
    try {
      await cmd.run({ json: true });
    } catch {
      // may exit
    }
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.checks).toBeInstanceOf(Array);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.pass + parsed.summary.warn + parsed.summary.fail).toBe(parsed.checks.length);
  });

  it('outputs quiet format with --quiet flag', async () => {
    setupHealthyProject();
    await seedValidDb();
    const cmd = new DoctorCommand(tempDir);
    try {
      await cmd.run({ quiet: true });
    } catch {
      // may exit
    }
    const output = errorSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Summary');
    // quiet mode should not show full header
    expect(output).not.toContain('ctxo doctor — Health Check');
  });

  it('sets exitCode 1 when any check fails', async () => {
    // Empty temp dir — no .git, no .ctxo — many checks will fail
    const cmd = new DoctorCommand(tempDir);
    await cmd.run();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined; // cleanup
  });

  it('does not exit when all checks pass or warn on healthy project', async () => {
    setupHealthyProject();
    await seedValidDb();
    const cmd = new DoctorCommand(tempDir);
    try {
      await cmd.run();
    } catch {
      // if it exits, check it's not exit(1) due to actual failures
    }
    // Verify JSON output to check for failures
    try {
      await cmd.run({ json: true });
    } catch {
      // may exit
    }
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    // Should have no hard failures on a healthy project (some warns are ok, like tree-sitter)
    expect(parsed.summary.fail).toBe(0);
  });
});
