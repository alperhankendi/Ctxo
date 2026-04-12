import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
