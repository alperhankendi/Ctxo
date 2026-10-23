import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { SchemaManager } from '../../adapters/storage/schema-manager.js';
import { StatusCommand } from '../status-command.js';
import type { FileIndex } from '../../core/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function buildIndex(file: string): FileIndex {
  return {
    file,
    lastModified: 1711620000,
    symbols: [{ symbolId: `${file}::fn::function`, name: 'fn', kind: 'function', startLine: 0, endLine: 5 }],
    edges: [],
    intent: [],
    antiPatterns: [],
  };
}

describe('StatusCommand', () => {
  it('reports correct indexed file count', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-status-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/a.ts'));
    writer.write(buildIndex('src/b.ts'));
    new SchemaManager(ctxoRoot).writeVersion();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    new StatusCommand(tempDir).run();

    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Indexed files:  2');
    expect(output).toContain('Total symbols:  2');
    spy.mockRestore();
  });

  it('reports schema version', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-status2-'));
    tempDirs.push(tempDir);

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/a.ts'));
    new SchemaManager(ctxoRoot).writeVersion();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    new StatusCommand(tempDir).run();

    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Schema version: 1.0.0');
    spy.mockRestore();
  });

  it('does not badge the entry of a tracked file with a non-ASCII name as orphaned', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-status4-'));
    tempDirs.push(tempDir);
    // Without -z, git quotes such a name ("src/\303\266d\303\274n\303\247.ts") and the entry would never match it.
    execFileSync('git', ['init', '-q'], { cwd: tempDir });
    execFileSync('git', ['config', 'core.quotePath', 'true'], { cwd: tempDir });
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'ödünç kaydı.ts'), 'export const a = 1;\n', 'utf-8');
    writeFileSync(join(tempDir, 'src', 'plain.ts'), 'export const b = 1;\n', 'utf-8');

    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/ödünç kaydı.ts'));
    writer.write(buildIndex('src/plain.ts'));
    writer.write(buildIndex('src/gone.ts'));
    new SchemaManager(ctxoRoot).writeVersion();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    new StatusCommand(tempDir).run();

    const lines = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(lines.filter((line) => line.includes('[orphaned]')).map((line) => line.trim().split(/\s{2}/)[0])).toEqual([
      'src/gone.ts',
    ]);
  });

  it('handles empty index directory', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-status3-'));
    tempDirs.push(tempDir);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    new StatusCommand(tempDir).run();

    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No index found');
    spy.mockRestore();
  });
});
