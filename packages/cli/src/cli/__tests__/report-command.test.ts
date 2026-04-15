import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { CommunitySnapshotWriter } from '../../adapters/storage/community-snapshot-writer.js';
import type { CommunitySnapshot, FileIndex } from '../../core/types.js';
import { ReportCommand } from '../report-command.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function buildIndex(file: string, deps: string[] = []): FileIndex {
  return {
    file,
    lastModified: 1711620000,
    symbols: [
      { symbolId: `${file}::Alpha::class`, name: 'Alpha', kind: 'class', startLine: 1, endLine: 20 },
      { symbolId: `${file}::helper::function`, name: 'helper', kind: 'function', startLine: 22, endLine: 30 },
    ],
    edges: deps.map((dep) => ({
      from: `${file}::Alpha::class`,
      to: `${dep}::Alpha::class`,
      kind: 'imports' as const,
    })),
    intent: [],
    antiPatterns: [],
  };
}

function snapshotFor(indices: FileIndex[]): CommunitySnapshot {
  const assignments: CommunitySnapshot['communities'] = indices.flatMap((fi, idx) =>
    fi.symbols.map((s) => ({
      symbolId: s.symbolId,
      communityId: idx,
      communityLabel: `community-${idx}`,
    })),
  );
  return {
    version: 1,
    computedAt: new Date().toISOString(),
    commitSha: 'testcommit',
    modularity: 0.5,
    communities: assignments,
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
  };
}

describe('ReportCommand', () => {
  it('fails fast when no index is present', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-report-'));
    tempDirs.push(tempDir);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(new ReportCommand(tempDir).run({ noBrowser: true })).rejects.toThrow('exit');
    expect(errSpy.mock.calls.flat().some((m) => String(m).includes('No index found'))).toBe(true);

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('fails fast when community snapshot is missing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-report-'));
    tempDirs.push(tempDir);
    const ctxoRoot = join(tempDir, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    writer.write(buildIndex('src/a.ts'));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(new ReportCommand(tempDir).run({ noBrowser: true })).rejects.toThrow('exit');
    expect(errSpy.mock.calls.flat().some((m) => String(m).includes('No community snapshot'))).toBe(
      true,
    );

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('generates a report HTML with embedded payload', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-report-'));
    tempDirs.push(tempDir);
    const ctxoRoot = join(tempDir, '.ctxo');

    const writer = new JsonIndexWriter(ctxoRoot);
    const idx1 = buildIndex('src/a.ts');
    const idx2 = buildIndex('src/b.ts', ['src/a.ts']);
    writer.write(idx1);
    writer.write(idx2);

    const snapshotWriter = new CommunitySnapshotWriter(ctxoRoot, { allowProductionPath: true });
    snapshotWriter.writeSnapshot(snapshotFor([idx1, idx2]));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new ReportCommand(tempDir).run({ noBrowser: true });
    errSpy.mockRestore();

    const outputPath = join(ctxoRoot, 'report.html');
    expect(existsSync(outputPath)).toBe(true);

    const html = readFileSync(outputPath, 'utf-8');
    expect(html).toContain('Ctxo Report');
    expect(html).not.toContain('/*__CTXO_REPORT_DATA__*/null');
    // Extract embedded payload
    const match = html.match(/window\.CTXO_REPORT_DATA\s*=\s*(\{[\s\S]*?\});/);
    expect(match).toBeTruthy();
    const payload = JSON.parse(match![1]!);
    expect(payload.kpi.totalSymbols).toBe(4);
    expect(payload.kpi.modularity).toBe(0.5);
    expect(payload.nodes.length).toBe(4);
    expect(payload.communities.length).toBe(4);
  });

  it('respects --max-nodes truncation', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-report-'));
    tempDirs.push(tempDir);
    const ctxoRoot = join(tempDir, '.ctxo');

    const writer = new JsonIndexWriter(ctxoRoot);
    const idx1 = buildIndex('src/a.ts');
    const idx2 = buildIndex('src/b.ts', ['src/a.ts']);
    writer.write(idx1);
    writer.write(idx2);

    const snapshotWriter = new CommunitySnapshotWriter(ctxoRoot, { allowProductionPath: true });
    snapshotWriter.writeSnapshot(snapshotFor([idx1, idx2]));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new ReportCommand(tempDir).run({ noBrowser: true, maxNodes: 2 });
    errSpy.mockRestore();

    const html = readFileSync(join(ctxoRoot, 'report.html'), 'utf-8');
    const match = html.match(/window\.CTXO_REPORT_DATA\s*=\s*(\{[\s\S]*?\});/);
    const payload = JSON.parse(match![1]!);
    expect(payload.nodes.length).toBe(2);
    expect(payload.kpi.totalSymbols).toBe(4); // full count preserved
    expect(payload.hints.some((h: string) => h.includes('truncated'))).toBe(true);
  });
});
