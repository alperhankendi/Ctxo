import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { JsonIndexWriter } from '../../storage/json-index-writer.js';
import { handleFindDeadCode } from '../get-dead-code.js';
import type { FileIndex } from '../../../core/types.js';

function buildTestIndices(): FileIndex[] {
  return [
    {
      file: 'src/main.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/main.ts::main::function', name: 'main', kind: 'function', startLine: 0, endLine: 10 }],
      edges: [{ from: 'src/main.ts::main::function', to: 'src/utils.ts::helper::function', kind: 'calls' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/utils.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/utils.ts::helper::function', name: 'helper', kind: 'function', startLine: 0, endLine: 5 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/orphan.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/orphan.ts::unused::function', name: 'unused', kind: 'function', startLine: 0, endLine: 3 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('FindDeadCodeHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-dead-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();

    // Write JSON index for buildGraphFromJsonIndex
    const writer = new JsonIndexWriter(tempDir);
    for (const idx of buildTestIndices()) {
      writer.write(idx);
      storage.writeSymbolFile(idx);
    }
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns MCP response with dead code analysis', () => {
    const handler = handleFindDeadCode(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.totalSymbols).toBe(3);
    expect(payload.deadSymbols.length).toBeGreaterThanOrEqual(1);
    expect(payload.deadCodePercentage).toBeGreaterThan(0);

    const deadNames = payload.deadSymbols.map((s: { name: string }) => s.name);
    expect(deadNames).toContain('unused');
  });

  it('returns empty deadSymbols for fully connected graph', () => {
    // Override with connected graph
    const connectedDir = mkdtempSync(join(tmpdir(), 'ctxo-connected-'));
    const connectedStorage = new SqliteStorageAdapter(connectedDir);

    const writer = new JsonIndexWriter(connectedDir);
    const indices: FileIndex[] = [
      {
        file: 'src/a.ts',
        lastModified: 1,
        symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 0, endLine: 5 }],
        edges: [{ from: 'src/a.ts::A::function', to: 'src/b.ts::B::function', kind: 'calls' }],
        intent: [],
        antiPatterns: [],
      },
      {
        file: 'src/b.ts',
        lastModified: 1,
        symbols: [{ symbolId: 'src/b.ts::B::function', name: 'B', kind: 'function', startLine: 0, endLine: 5 }],
        edges: [],
        intent: [],
        antiPatterns: [],
      },
    ];
    for (const idx of indices) writer.write(idx);

    const handler = handleFindDeadCode(connectedStorage, new MaskingPipeline(), undefined, connectedDir);
    const result = handler({});
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.deadSymbols).toEqual([]);
    expect(payload.deadCodePercentage).toBe(0);

    rmSync(connectedDir, { recursive: true, force: true });
  });

  it('applies masking to response', () => {
    // Add symbol with sensitive name
    const writer = new JsonIndexWriter(tempDir);
    writer.write({
      file: 'src/secret.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/secret.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    });

    const handler = handleFindDeadCode(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});

    expect(result.content[result.content.length - 1]!.text).toContain('[REDACTED:AWS_KEY]');
  });

  it('includes deadFiles in response', () => {
    const handler = handleFindDeadCode(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.deadFiles).toContain('src/orphan.ts');
  });

  it('supports includeTests parameter', () => {
    const handler = handleFindDeadCode(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ includeTests: true });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.totalSymbols).toBeGreaterThanOrEqual(0);
  });

  it('returns error for invalid input type', () => {
    const handler = handleFindDeadCode(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ includeTests: 'not-boolean' });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.error).toBe(true);
  });

  it('includes unusedExports in response', () => {
    const handler = handleFindDeadCode(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(Array.isArray(payload.unusedExports)).toBe(true);
  });

  it('works with staleness check (no crash)', () => {
    const mockStaleness = { check: () => ({ message: 'Index is stale for 1 file(s)' }) };
    const handler = handleFindDeadCode(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({});

    // Should have staleness warning prepended
    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });
});
