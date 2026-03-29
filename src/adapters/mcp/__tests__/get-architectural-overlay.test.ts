import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetArchitecturalOverlay } from '../get-architectural-overlay.js';
import type { FileIndex } from '../../../core/types.js';

function buildHexagonalIndices(): FileIndex[] {
  return [
    { file: 'src/core/types.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/adapters/mcp/handler.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/ports/i-storage.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/cli/index-cmd.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/utils/format.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
  ];
}

describe('GetArchitecturalOverlayHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-overlay-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildHexagonalIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns MCP response with layer map', () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layers).toBeDefined();
    expect(payload.layers['Domain']).toContain('src/core/types.ts');
    expect(payload.layers['Domain']).toContain('src/ports/i-storage.ts');
    expect(payload.layers['Adapter']).toContain('src/adapters/mcp/handler.ts');
    expect(payload.layers['Adapter']).toContain('src/cli/index-cmd.ts');
    expect(payload.layers['Unknown']).toContain('src/utils/format.ts');
  });

  it('filters by specific layer when parameter provided', () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = handler({ layer: 'Domain' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layer).toBe('Domain');
    expect(payload.files).toContain('src/core/types.ts');
    expect(payload.files).not.toContain('src/utils/format.ts');
  });

  it('returns empty files array for non-existent layer', () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = handler({ layer: 'NonExistent' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.files).toEqual([]);
  });

  it('returns all layers when no filter specified', () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(Object.keys(payload.layers)).toContain('Domain');
    expect(Object.keys(payload.layers)).toContain('Adapter');
    expect(Object.keys(payload.layers)).toContain('Unknown');
  });

  it('handles empty index gracefully', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ctxo-empty-'));
    const emptyStorage = new SqliteStorageAdapter(emptyDir);
    await emptyStorage.initEmpty();

    const handler = handleGetArchitecturalOverlay(emptyStorage, new MaskingPipeline());
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layers).toEqual({});

    emptyStorage.close();
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
