import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { SyncCommand } from '../sync-command.js';
import type { FileIndex } from '../../core/types.js';

const tempDirs: string[] = [];

function buildIndex(): FileIndex {
  return {
    file: 'src/foo.ts',
    lastModified: 1711620000,
    symbols: [{ symbolId: 'src/foo.ts::fn::function', name: 'fn', kind: 'function', startLine: 0, endLine: 5 }],
    edges: [],
    intent: [],
    antiPatterns: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('SyncCommand', () => {
  it('rebuilds SQLite from committed JSON index files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-sync-'));
    tempDirs.push(tempDir);

    // Write JSON index
    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex());

    // Run sync
    const cmd = new SyncCommand(tempDir);
    await cmd.run();

    // SQLite cache should exist
    expect(existsSync(join(ctxoRoot, '.cache', 'symbols.db'))).toBe(true);
  });

  it('handles empty index directory gracefully', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-sync-empty-'));
    tempDirs.push(tempDir);

    const cmd = new SyncCommand(tempDir);
    await cmd.run();

    // Should not crash
    expect(existsSync(join(tempDir, '.ctxo', '.cache', 'symbols.db'))).toBe(true);
  });
});
