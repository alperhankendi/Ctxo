import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { SessionRecorderAdapter } from '../session-recorder-adapter.js';
import type { SessionEvent } from '../../../ports/i-session-recorder-port.js';

function makeEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    tool: 'get_logic_slice',
    symbolId: 'src/foo.ts::myFn::function',
    detailLevel: 'L2',
    responseTokens: 820,
    responseBytes: 3280,
    latencyMs: 14.5,
    truncated: false,
    ...overrides,
  };
}

describe('SessionRecorderAdapter', () => {
  let db: Database;
  let adapter: SessionRecorderAdapter;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    adapter = new SessionRecorderAdapter(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── record() ───────────────────────────────────────────────

  it('records a session event and persists it', () => {
    adapter.record(makeEvent());

    const result = db.exec('SELECT tool, symbol_id, detail_level, response_tokens, response_bytes, truncated FROM session_events');
    expect(result[0]?.values).toHaveLength(1);
    const row = result[0]!.values[0]!;
    expect(row[0]).toBe('get_logic_slice');
    expect(row[1]).toBe('src/foo.ts::myFn::function');
    expect(row[2]).toBe('L2');
    expect(row[3]).toBe(820);
    expect(row[4]).toBe(3280);
    expect(row[5]).toBe(0);
  });

  it('records event with null symbolId and detailLevel', () => {
    adapter.record(makeEvent({ symbolId: null, detailLevel: null }));

    const result = db.exec('SELECT symbol_id, detail_level FROM session_events');
    const row = result[0]!.values[0]!;
    expect(row[0]).toBeNull();
    expect(row[1]).toBeNull();
  });

  it('records truncated event correctly', () => {
    adapter.record(makeEvent({ truncated: true }));

    const result = db.exec('SELECT truncated FROM session_events');
    expect(result[0]!.values[0]![0]).toBe(1);
  });

  it('swallows errors and never throws', () => {
    db.close();
    const brokenAdapter = new SessionRecorderAdapter(db);
    expect(() => brokenAdapter.record(makeEvent())).not.toThrow();
  });

  it('auto-creates table on first record()', () => {
    const before = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='session_events'");
    expect(before).toHaveLength(0);

    adapter.record(makeEvent());

    const after = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='session_events'");
    expect(after[0]?.values).toHaveLength(1);
  });

  it('creates indexes on the table', () => {
    adapter.record(makeEvent());

    const indexes = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_session_%'");
    const names = indexes[0]?.values.map((r) => r[0]) ?? [];
    expect(names).toContain('idx_session_timestamp');
    expect(names).toContain('idx_session_tool');
  });

  // ── queryStats() ───────────────────────────────────────────

  it('returns zeros for empty database', () => {
    const stats = adapter.queryStats();

    expect(stats.totalCalls).toBe(0);
    expect(stats.totalTokensServed).toBe(0);
    expect(stats.topTools).toHaveLength(0);
    expect(stats.topSymbols).toHaveLength(0);
    expect(stats.detailLevelDistribution).toHaveLength(0);
  });

  it('returns correct totals', () => {
    adapter.record(makeEvent({ responseTokens: 100 }));
    adapter.record(makeEvent({ responseTokens: 200 }));
    adapter.record(makeEvent({ responseTokens: 300 }));

    const stats = adapter.queryStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.totalTokensServed).toBe(600);
  });

  it('returns top tools sorted by call count', () => {
    for (let i = 0; i < 5; i++) adapter.record(makeEvent({ tool: 'get_logic_slice' }));
    for (let i = 0; i < 3; i++) adapter.record(makeEvent({ tool: 'get_blast_radius' }));
    adapter.record(makeEvent({ tool: 'search_symbols' }));

    const stats = adapter.queryStats();
    expect(stats.topTools[0]!.tool).toBe('get_logic_slice');
    expect(stats.topTools[0]!.calls).toBe(5);
    expect(stats.topTools[1]!.tool).toBe('get_blast_radius');
    expect(stats.topTools[1]!.calls).toBe(3);
    expect(stats.topTools[2]!.tool).toBe('search_symbols');
    expect(stats.topTools[2]!.calls).toBe(1);
  });

  it('limits top tools to 5', () => {
    for (let i = 0; i < 7; i++) {
      adapter.record(makeEvent({ tool: `tool_${i}` }));
    }

    const stats = adapter.queryStats();
    expect(stats.topTools).toHaveLength(5);
  });

  it('returns top symbols sorted by query count', () => {
    for (let i = 0; i < 4; i++) adapter.record(makeEvent({ symbolId: 'a::B::class' }));
    for (let i = 0; i < 2; i++) adapter.record(makeEvent({ symbolId: 'c::D::function' }));
    adapter.record(makeEvent({ symbolId: null }));

    const stats = adapter.queryStats();
    expect(stats.topSymbols).toHaveLength(2);
    expect(stats.topSymbols[0]!.symbolId).toBe('a::B::class');
    expect(stats.topSymbols[0]!.name).toBe('B');
    expect(stats.topSymbols[0]!.queries).toBe(4);
    expect(stats.topSymbols[1]!.name).toBe('D');
  });

  it('returns detail level distribution with percentages', () => {
    for (let i = 0; i < 6; i++) adapter.record(makeEvent({ detailLevel: 'L2' }));
    for (let i = 0; i < 3; i++) adapter.record(makeEvent({ detailLevel: 'L3' }));
    adapter.record(makeEvent({ detailLevel: 'L1' }));
    adapter.record(makeEvent({ detailLevel: null }));

    const stats = adapter.queryStats();
    expect(stats.detailLevelDistribution).toHaveLength(3);

    const l1 = stats.detailLevelDistribution.find((d) => d.level === 'L1');
    const l2 = stats.detailLevelDistribution.find((d) => d.level === 'L2');
    const l3 = stats.detailLevelDistribution.find((d) => d.level === 'L3');
    expect(l1!.count).toBe(1);
    expect(l1!.percentage).toBe(10);
    expect(l2!.count).toBe(6);
    expect(l2!.percentage).toBe(60);
    expect(l3!.count).toBe(3);
    expect(l3!.percentage).toBe(30);
  });

  it('computes avg tokens per tool', () => {
    adapter.record(makeEvent({ tool: 'get_logic_slice', responseTokens: 100 }));
    adapter.record(makeEvent({ tool: 'get_logic_slice', responseTokens: 200 }));
    adapter.record(makeEvent({ tool: 'get_logic_slice', responseTokens: 300 }));

    const stats = adapter.queryStats();
    expect(stats.topTools[0]!.avgTokens).toBe(200);
  });

  // ── queryStats(days) ───────────────────────────────────────

  it('filters by days when provided', () => {
    adapter.record(makeEvent());
    adapter.record(makeEvent());

    const stats = adapter.queryStats(7);
    expect(stats.totalCalls).toBe(2);
  });

  // ── clear() ────────────────────────────────────────────────

  it('deletes all session data', () => {
    adapter.record(makeEvent());
    adapter.record(makeEvent());
    adapter.record(makeEvent());
    expect(adapter.queryStats().totalCalls).toBe(3);

    adapter.clear();
    expect(adapter.queryStats().totalCalls).toBe(0);
  });

  // ── Table coexistence ──────────────────────────────────────

  it('coexists with symbols and edges tables', () => {
    db.run('CREATE TABLE symbols (symbol_id TEXT PRIMARY KEY, name TEXT)');
    db.run('CREATE TABLE edges (id INTEGER PRIMARY KEY, from_symbol TEXT, to_symbol TEXT)');
    db.run("INSERT INTO symbols VALUES ('a::b::class', 'b')");

    adapter.record(makeEvent());

    const stats = adapter.queryStats();
    expect(stats.totalCalls).toBe(1);

    const symbols = db.exec('SELECT COUNT(*) FROM symbols');
    expect(symbols[0]!.values[0]![0]).toBe(1);
  });

  // ── Edge cases ─────────────────────────────────────────────

  it('handles symbolId without :: separator gracefully', () => {
    adapter.record(makeEvent({ symbolId: 'plain-symbol-id' }));

    const stats = adapter.queryStats();
    expect(stats.topSymbols[0]!.name).toBe('plain-symbol-id');
    expect(stats.topSymbols[0]!.symbolId).toBe('plain-symbol-id');
  });

  it('returns percentage 0 when levelTotal is 0 (all null levels)', () => {
    adapter.record(makeEvent({ detailLevel: null }));
    adapter.record(makeEvent({ detailLevel: null }));

    const stats = adapter.queryStats();
    expect(stats.detailLevelDistribution).toHaveLength(0);
  });

  // ── Round-trip ─────────────────────────────────────────────

  it('round-trip: record many events then verify aggregation', () => {
    const tools = ['get_logic_slice', 'get_blast_radius', 'search_symbols'];
    for (let i = 0; i < 50; i++) {
      adapter.record(makeEvent({
        tool: tools[i % 3]!,
        symbolId: i % 5 === 0 ? null : `src/f${i % 5}.ts::fn${i % 5}::function`,
        detailLevel: ['L1', 'L2', 'L3', 'L4'][i % 4] as SessionEvent['detailLevel'],
        responseTokens: 100 + i * 10,
      }));
    }

    const stats = adapter.queryStats();
    expect(stats.totalCalls).toBe(50);
    expect(stats.topTools.length).toBeGreaterThan(0);
    expect(stats.topTools.length).toBeLessThanOrEqual(5);
    expect(stats.topSymbols.length).toBeGreaterThan(0);
    expect(stats.detailLevelDistribution.length).toBe(4);

    const pctSum = stats.detailLevelDistribution.reduce((s, d) => s + d.percentage, 0);
    expect(pctSum).toBeGreaterThanOrEqual(98);
    expect(pctSum).toBeLessThanOrEqual(102);
  });
});
