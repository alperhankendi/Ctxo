import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetBlastRadius } from '../get-blast-radius.js';
import type { FileIndex } from '../../../core/types.js';

function buildGraphIndices(): FileIndex[] {
  return [
    {
      file: 'src/a.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 0, endLine: 5 }],
      edges: [{ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/b.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/b.ts::B::class', name: 'B', kind: 'class', startLine: 0, endLine: 20 }],
      edges: [{ from: 'src/b.ts::B::class', to: 'src/c.ts::C::interface', kind: 'implements' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/c.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/c.ts::C::interface', name: 'C', kind: 'interface', startLine: 0, endLine: 10 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('GetBlastRadiusHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-br-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildGraphIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns MCP response with ranked dependents', () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);

    const result = handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.symbolId).toBe('src/c.ts::C::interface');
    expect(payload.impactScore).toBeGreaterThanOrEqual(1);
    expect(payload.directDependentsCount).toBeGreaterThanOrEqual(1);
    expect(payload.overallRiskScore).toBeGreaterThan(0);
    expect(payload.impactedSymbols.length).toBeGreaterThanOrEqual(1);
    expect(payload.impactedSymbols[0].symbolId).toBe('src/b.ts::B::class');
    expect(payload.impactedSymbols[0].riskScore).toBeDefined();
  });

  it('returns transitive blast radius', () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);

    const result = handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    const depIds = payload.impactedSymbols.map((d: { symbolId: string }) => d.symbolId);
    expect(depIds).toContain('src/b.ts::B::class');
    expect(depIds).toContain('src/a.ts::A::function');
  });

  it('returns { found: false } for missing symbol', () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);

    const result = handler({ symbolId: 'src/missing.ts::X::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.found).toBe(false);
  });

  it('applies masking to response', () => {
    // Add a symbol with sensitive name
    const sensitiveIndex: FileIndex = {
      file: 'src/config.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [{ from: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', to: 'src/c.ts::C::interface', kind: 'uses' }],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);

    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface' });

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
  });

  it('returns error for empty symbolId', () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: '' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });
});
