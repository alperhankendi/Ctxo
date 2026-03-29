import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from '../get-logic-slice.js';
import type { FileIndex } from '../../../core/types.js';

function buildTestFileIndex(): FileIndex {
  return {
    file: 'src/foo.ts',
    lastModified: 1711620000,
    symbols: [
      {
        symbolId: 'src/foo.ts::processPayment::function',
        name: 'processPayment',
        kind: 'function',
        startLine: 0,
        endLine: 10,
      },
    ],
    edges: [
      {
        from: 'src/foo.ts::processPayment::function',
        to: 'src/bar.ts::TokenValidator::class',
        kind: 'imports',
      },
    ],
    intent: [],
    antiPatterns: [],
  };
}

function buildDepFileIndex(): FileIndex {
  return {
    file: 'src/bar.ts',
    lastModified: 1711620000,
    symbols: [
      {
        symbolId: 'src/bar.ts::TokenValidator::class',
        name: 'TokenValidator',
        kind: 'class',
        startLine: 0,
        endLine: 50,
      },
    ],
    edges: [],
    intent: [],
    antiPatterns: [],
  };
}

describe('GetLogicSliceHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;
  let handler: ReturnType<typeof handleGetLogicSlice>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-mcp-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.init();
    storage.bulkWrite([buildTestFileIndex(), buildDepFileIndex()]);

    const masking = new MaskingPipeline();
    handler = handleGetLogicSlice(storage, masking, undefined, tempDir);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns MCP response with content array for valid symbolId', () => {
    const result = handler({ symbolId: 'src/foo.ts::processPayment::function' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.root.symbolId).toBe('src/foo.ts::processPayment::function');
    expect(payload.dependencies).toHaveLength(1);
  });

  it('returns { found: false, hint } for missing symbol', () => {
    const result = handler({ symbolId: 'src/missing.ts::nothing::function' });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.found).toBe(false);
    expect(payload.hint).toContain('ctxo index');
  });

  it('returns { error: true, message } for invalid params (Zod rejection)', () => {
    const result = handler({ symbolId: '' });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBe(true);
    expect(payload.message).toBeDefined();
  });

  it('returns correct shape for detail level 1', () => {
    const result = handler({ symbolId: 'src/foo.ts::processPayment::function', level: 1 });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.level).toBe(1);
    expect(payload.dependencies).toEqual([]);
  });

  it('returns correct shape for detail level 3', () => {
    const result = handler({ symbolId: 'src/foo.ts::processPayment::function', level: 3 });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.level).toBe(3);
    expect(payload.dependencies).toHaveLength(1);
  });

  it('applies masking — planted AWS key in fixture is redacted', () => {
    // Add a symbol with AWS key in its name (simulates sensitive data in response)
    const sensitiveIndex: FileIndex = {
      file: 'src/config.ts',
      lastModified: 1711620000,
      symbols: [
        {
          symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable',
          name: 'AKIAIOSFODNN7EXAMPLE',
          kind: 'variable',
          startLine: 0,
          endLine: 1,
        },
      ],
      edges: [],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);

    const result = handler({ symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable' });
    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
    expect(result.content[0]!.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('never throws — returns error shape on internal failure', () => {
    // Pass completely invalid args
    const result = handler({ symbolId: 123 as unknown as string });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBe(true);
  });

  it('rejects detail level outside 1-4 range', () => {
    const result = handler({ symbolId: 'src/foo.ts::processPayment::function', level: 5 });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBe(true);
  });
});
