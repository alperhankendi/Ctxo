import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { SessionRecorderAdapter } from '../../adapters/stats/session-recorder-adapter.js';
import { StatsCommand } from '../stats-command.js';

describe('StatsCommand', () => {
  let tempDir: string;
  let ctxoDir: string;
  let cacheDir: string;
  let dbPath: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-stats-'));
    ctxoDir = join(tempDir, '.ctxo');
    cacheDir = join(ctxoDir, '.cache');
    dbPath = join(cacheDir, 'symbols.db');
    mkdirSync(cacheDir, { recursive: true });

    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function seedEvents(count: number): Promise<void> {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const recorder = new SessionRecorderAdapter(db);

    const tools = ['get_logic_slice', 'get_blast_radius', 'search_symbols'];
    for (let i = 0; i < count; i++) {
      recorder.record({
        tool: tools[i % 3]!,
        symbolId: `src/f.ts::fn${i % 3}::function`,
        detailLevel: ['L1', 'L2', 'L3', 'L4'][i % 4] as 'L1' | 'L2' | 'L3' | 'L4',
        responseTokens: 100 + i * 10,
        responseBytes: 400 + i * 40,
        latencyMs: 5 + i,
        truncated: false,
      });
    }

    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();
  }

  it('shows friendly message when no DB exists', async () => {
    // Remove the DB if it exists
    if (existsSync(dbPath)) rmSync(dbPath);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No usage data yet');
  });

  it('shows friendly message when DB has no events', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No usage data yet');
  });

  it('shows human-readable output with events', async () => {
    await seedEvents(10);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage Summary');
    expect(output).toContain('Top Tools');
    expect(output).toContain('get_logic_slice');
    expect(output).toContain('Top Queried Symbols');
    expect(output).toContain('Detail Level Distribution');
  });

  it('outputs valid JSON with --json flag', async () => {
    await seedEvents(10);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({ json: true });

    expect(logSpy).toHaveBeenCalled();
    const jsonOutput = logSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(jsonOutput);

    expect(parsed.summary.totalCalls).toBe(10);
    expect(parsed.topTools).toBeInstanceOf(Array);
    expect(parsed.topSymbols).toBeInstanceOf(Array);
    expect(parsed.detailLevelDistribution).toBeInstanceOf(Array);
    expect(parsed.timeRange).toBeDefined();
    expect(parsed.timeRange.daysFilter).toBeNull();
  });

  it('passes --days filter correctly', async () => {
    await seedEvents(10);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({ json: true, days: 7 });

    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.timeRange.daysFilter).toBe(7);
    expect(parsed.summary.totalCalls).toBe(10); // all recent
  });

  it('clears session data with --clear', async () => {
    await seedEvents(10);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({ clear: true });

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Session data cleared');

    // Verify cleared
    errorSpy.mockClear();
    logSpy.mockClear();
    await cmd.run({});
    const afterOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(afterOutput).toContain('No usage data yet');
  });

  it('rejects --days with zero value', async () => {
    await seedEvents(5);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = new StatsCommand(tempDir);
    await expect(cmd.run({ days: 0 })).rejects.toThrow('exit');

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('--days must be a positive integer');
    exitSpy.mockRestore();
  });

  it('rejects --days with negative value', async () => {
    await seedEvents(5);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = new StatsCommand(tempDir);
    await expect(cmd.run({ days: -5 })).rejects.toThrow('exit');

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('--days must be a positive integer');
    exitSpy.mockRestore();
  });

  it('shows empty JSON when DB has no events and --json flag', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    // Create table but no events
    new SessionRecorderAdapter(db).clear();
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();

    const cmd = new StatsCommand(tempDir);
    await cmd.run({ json: true });

    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.summary.totalCalls).toBe(0);
  });

  it('shows disabled message when stats.enabled is false', async () => {
    writeFileSync(join(ctxoDir, 'config.yaml'), 'stats:\n  enabled: false\n');

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Stats collection is disabled');
  });

  it('handles config.yaml without stats section', async () => {
    writeFileSync(join(ctxoDir, 'config.yaml'), 'indexing:\n  maxFiles: 100\n');
    await seedEvents(5);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage Summary');
  });

  it('handles corrupt config.yaml gracefully', async () => {
    writeFileSync(join(ctxoDir, 'config.yaml'), '{{invalid yaml:::');
    await seedEvents(5);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    // Should default to enabled and show stats
    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage Summary');
  });

  it('formats large token counts with M suffix', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const recorder = new SessionRecorderAdapter(db);
    recorder.record({
      tool: 'get_logic_slice',
      symbolId: 'a::b::class',
      detailLevel: 'L2',
      responseTokens: 1_500_000,
      responseBytes: 6_000_000,
      latencyMs: 10,
      truncated: false,
    });
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('1.5M');
  });

  it('formats medium token counts with K suffix', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const recorder = new SessionRecorderAdapter(db);
    recorder.record({
      tool: 'get_logic_slice',
      symbolId: 'a::b::class',
      detailLevel: 'L2',
      responseTokens: 5_500,
      responseBytes: 22_000,
      latencyMs: 10,
      truncated: false,
    });
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('5.5K');
  });

  it('formats small token counts as plain number', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const recorder = new SessionRecorderAdapter(db);
    recorder.record({
      tool: 'get_logic_slice',
      symbolId: 'a::b::class',
      detailLevel: 'L2',
      responseTokens: 42,
      responseBytes: 168,
      latencyMs: 10,
      truncated: false,
    });
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();

    const cmd = new StatsCommand(tempDir);
    await cmd.run({});

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('42');
  });

  it('outputs empty JSON report when no DB exists and --json flag', async () => {
    if (existsSync(dbPath)) rmSync(dbPath);

    const cmd = new StatsCommand(tempDir);
    await cmd.run({ json: true });

    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.summary.totalCalls).toBe(0);
    expect(parsed.topTools).toEqual([]);
  });
});
