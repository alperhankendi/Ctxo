import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wrapResponse } from '../response-envelope.js';

describe('wrapResponse', () => {
  const originalEnv = process.env['CTXO_RESPONSE_LIMIT'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTXO_RESPONSE_LIMIT'];
    } else {
      process.env['CTXO_RESPONSE_LIMIT'] = originalEnv;
    }
  });

  it('adds _meta to small responses without truncation', () => {
    const data = {
      symbolId: 'src/foo.ts::bar::function',
      impactScore: 2,
      impactedSymbols: [
        { symbolId: 'a', name: 'a', kind: 'function' },
        { symbolId: 'b', name: 'b', kind: 'class' },
      ],
    };

    const result = wrapResponse(data);

    expect(result._meta).toBeDefined();
    const meta = result._meta as Record<string, unknown>;
    expect(meta.truncated).toBe(false);
    expect(meta.totalItems).toBe(2);
    expect(meta.returnedItems).toBe(2);
    expect(meta.totalBytes).toBeGreaterThan(0);
    expect(meta.hint).toBeUndefined();
    // Original data preserved
    expect(result.symbolId).toBe('src/foo.ts::bar::function');
    expect((result.impactedSymbols as unknown[]).length).toBe(2);
  });

  it('truncates large impactedSymbols array when over threshold', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '500';

    const symbols = Array.from({ length: 100 }, (_, i) => ({
      symbolId: `src/file${i}.ts::Sym${i}::class`,
      name: `Sym${i}`,
      kind: 'class',
      file: `src/file${i}.ts`,
      depth: 1,
      confidence: 'confirmed',
      riskScore: 1.0,
    }));

    const data = {
      symbolId: 'src/foo.ts::bar::function',
      impactScore: 100,
      impactedSymbols: symbols,
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;

    expect(meta.truncated).toBe(true);
    expect(meta.totalItems).toBe(100);
    expect(meta.returnedItems).toBeLessThan(100);
    expect(meta.returnedItems).toBeGreaterThan(0);
    expect(meta.hint).toContain('search_symbols');
    expect((result.impactedSymbols as unknown[]).length).toBe(meta.returnedItems);

    // Verify the truncated response fits within threshold
    const json = JSON.stringify(result);
    expect(Buffer.byteLength(json, 'utf-8')).toBeLessThanOrEqual(500);
  });

  it('truncates importers array', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '300';

    const data = {
      symbolId: 'src/types.ts::SymbolNode::type',
      importerCount: 50,
      importers: Array.from({ length: 50 }, (_, i) => ({
        symbolId: `src/f${i}.ts::X${i}::class`,
        name: `X${i}`,
        kind: 'class',
        file: `src/f${i}.ts`,
        edgeKind: 'imports',
        depth: 1,
      })),
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;

    expect(meta.truncated).toBe(true);
    expect(meta.totalItems).toBe(50);
    expect(meta.hint).toContain('find_importers');
  });

  it('truncates deadSymbols array', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '400';

    const data = {
      totalSymbols: 200,
      reachableSymbols: 100,
      deadCodePercentage: 50,
      deadSymbols: Array.from({ length: 100 }, (_, i) => ({
        symbolId: `src/dead${i}.ts::Dead${i}::function`,
        name: `Dead${i}`,
        kind: 'function',
        file: `src/dead${i}.ts`,
        confidence: 1.0,
        reason: 'Zero importers',
      })),
      deadFiles: [],
      unusedExports: [],
      scaffolding: [],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;

    expect(meta.truncated).toBe(true);
    expect(meta.totalItems).toBe(100);
    expect(meta.hint).toContain('search_symbols');
  });

  it('does not truncate when no truncatable array field exists', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '10';

    const data = {
      someField: 'a'.repeat(100),
      nonTruncatable: [1, 2, 3],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;

    expect(meta.truncated).toBe(false);
    expect(meta.totalItems).toBe(0);
  });

  it('respects CTXO_RESPONSE_LIMIT env variable', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '200';

    const data = {
      impactedSymbols: Array.from({ length: 50 }, (_, i) => ({
        symbolId: `src/f${i}.ts::S${i}::class`,
      })),
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    expect(meta.truncated).toBe(true);
  });

  it('uses default threshold when env is not set', () => {
    delete process.env['CTXO_RESPONSE_LIMIT'];

    const data = {
      symbolId: 'src/foo.ts::bar::function',
      impactedSymbols: [{ symbolId: 'a', name: 'a' }],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    expect(meta.truncated).toBe(false);
    // Default is 8192, our tiny payload is well under
  });

  it('picks the largest truncatable array when multiple exist', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '300';

    const data = {
      deadSymbols: Array.from({ length: 50 }, (_, i) => ({
        symbolId: `dead${i}`,
        name: `Dead${i}`,
      })),
      unusedExports: Array.from({ length: 5 }, (_, i) => ({
        symbolId: `unused${i}`,
      })),
      deadFiles: [],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;

    // Should truncate deadSymbols (50 items) not unusedExports (5 items)
    expect(meta.totalItems).toBe(50);
    expect(meta.truncated).toBe(true);
  });

  it('returns at least 1 item when truncating', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '50'; // Very small

    const data = {
      impactedSymbols: Array.from({ length: 10 }, (_, i) => ({
        symbolId: `src/very-long-path/file${i}.ts::VeryLongSymbolName${i}::class`,
      })),
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    expect((meta.returnedItems as number)).toBeGreaterThanOrEqual(1);
  });

  it('handles invalid CTXO_RESPONSE_LIMIT values gracefully', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = 'not-a-number';

    const data = {
      symbolId: 'test',
      impactedSymbols: [{ symbolId: 'a' }],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    // Should fall back to default (8192), so small payload is not truncated
    expect(meta.truncated).toBe(false);
  });

  it('handles zero CTXO_RESPONSE_LIMIT by falling back to default', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '0';

    const data = {
      symbolId: 'test',
      impactedSymbols: [{ symbolId: 'a' }],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    expect(meta.truncated).toBe(false);
  });

  it('handles negative CTXO_RESPONSE_LIMIT by falling back to default', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '-100';

    const data = {
      symbolId: 'test',
      impactedSymbols: [{ symbolId: 'a' }],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    expect(meta.truncated).toBe(false);
  });

  it('does not truncate single-element array even when over threshold', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '10';

    const data = {
      impactedSymbols: [{ symbolId: 'src/very-long-name.ts::VeryLongSymbol::class', extra: 'a'.repeat(200) }],
    };

    const result = wrapResponse(data);
    const meta = result._meta as Record<string, unknown>;
    // Single item array can't be truncated further
    expect(meta.returnedItems).toBe(1);
  });

  it('preserves non-array fields when truncating', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '400';

    const data = {
      symbolId: 'src/foo.ts::bar::function',
      impactScore: 50,
      overallRiskScore: 0.85,
      impactedSymbols: Array.from({ length: 50 }, (_, i) => ({
        symbolId: `src/f${i}.ts::S${i}::class`,
        name: `S${i}`,
        kind: 'class',
      })),
    };

    const result = wrapResponse(data);

    expect(result.symbolId).toBe('src/foo.ts::bar::function');
    expect(result.impactScore).toBe(50);
    expect(result.overallRiskScore).toBe(0.85);
  });
});
