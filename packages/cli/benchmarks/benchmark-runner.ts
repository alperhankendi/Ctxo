/* eslint-disable no-console */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { SqliteStorageAdapter } from '../src/adapters/storage/sqlite-storage-adapter.js';
import { JsonIndexWriter } from '../src/adapters/storage/json-index-writer.js';
import { MaskingPipeline } from '../src/core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from '../src/adapters/mcp/get-logic-slice.js';
import { handleGetBlastRadius } from '../src/adapters/mcp/get-blast-radius.js';
import { handleGetContextForTask } from '../src/adapters/mcp/get-context-for-task.js';
import { handleFindImporters } from '../src/adapters/mcp/find-importers.js';
import { handleSearchSymbols } from '../src/adapters/mcp/search-symbols.js';
import { handleGetSymbolImportance } from '../src/adapters/mcp/get-symbol-importance.js';
import type { FileIndex } from '../src/core/types.js';
import type { IStoragePort } from '../src/ports/i-storage-port.js';

// PRD NFR-1 budgets for MCP tool responses (ms). Rough per-tool SLOs.
const BUDGET_MS = {
  get_logic_slice: 200,
  get_blast_radius: 200,
  get_context_for_task: 300,
  find_importers: 200,
  search_symbols: 100,
  get_symbol_importance: 500,
  doctor: 500,
  version_verbose: 200,
} as const;

const ITERATIONS = 50;
const WARMUP = 5;

function quantile(sortedMs: number[], q: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.ceil(q * sortedMs.length) - 1);
  return Math.round((sortedMs[idx] ?? 0) * 100) / 100;
}

function synthesizeIndex(symbolCount: number): FileIndex[] {
  const filesPerIndex = 10;
  const fileCount = Math.ceil(symbolCount / filesPerIndex);
  const indices: FileIndex[] = [];

  for (let f = 0; f < fileCount; f++) {
    const file = `src/module-${f}/file-${f}.ts`;
    const fileSymbols = [];
    const fileEdges = [];

    for (let s = 0; s < filesPerIndex; s++) {
      const globalIdx = f * filesPerIndex + s;
      if (globalIdx >= symbolCount) break;
      const name = `Symbol${globalIdx}`;
      const kind = (['function', 'class', 'interface', 'method'] as const)[globalIdx % 4]!;
      const symbolId = `${file}::${name}::${kind}`;
      fileSymbols.push({
        symbolId,
        name,
        kind,
        startLine: s * 20,
        endLine: s * 20 + 18,
      });

      // Each symbol has 2 outgoing imports to create a connected graph
      if (globalIdx > 1) {
        const targetFile = `src/module-${(f + 1) % fileCount}/file-${(f + 1) % fileCount}.ts`;
        const targetName = `Symbol${(globalIdx + 3) % symbolCount}`;
        const targetKind = (['function', 'class', 'interface', 'method'] as const)[(globalIdx + 3) % 4]!;
        fileEdges.push({
          from: symbolId,
          to: `${targetFile}::${targetName}::${targetKind}`,
          kind: 'imports' as const,
        });
      }
    }

    indices.push({
      file,
      lastModified: 1,
      symbols: fileSymbols,
      edges: fileEdges,
      complexity: fileSymbols.map((s) => ({ symbolId: s.symbolId, cyclomatic: 5 })),
      intent: [],
      antiPatterns: [],
    });
  }
  return indices;
}

async function time(label: string, fn: () => unknown | Promise<unknown>): Promise<{ label: string; samples: number[] }> {
  // Warmup
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { label, samples };
}

function report(label: string, samples: number[], budget: number): {
  label: string;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  budget: number;
  pass: boolean;
} {
  const p50 = quantile(samples, 0.5);
  const p95 = quantile(samples, 0.95);
  const p99 = quantile(samples, 0.99);
  const max = Math.round(Math.max(...samples) * 100) / 100;
  const pass = p95 <= budget;
  return { label, p50, p95, p99, max, budget, pass };
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-bench-'));
  const size = parseInt(process.env['BENCH_SIZE'] ?? '1000', 10);
  console.log(`Generating ${size}-symbol fixture in ${tempDir}...`);

  const indices = synthesizeIndex(size);
  const writer = new JsonIndexWriter(tempDir);
  const storage = new SqliteStorageAdapter(tempDir);
  await storage.initEmpty();

  for (const idx of indices) {
    writer.write(idx);
    storage.writeSymbolFile(idx);
  }
  execFileSync('git', ['init', '-q'], { cwd: tempDir });

  // Pick a representative "hot" symbol for per-symbol queries
  const hotSymbolId = indices[Math.floor(indices.length / 2)]!.symbols[0]!.symbolId;

  console.log(`Warmup: ${WARMUP}, Iterations: ${ITERATIONS}, HotSymbol: ${hotSymbolId}\n`);

  const masking = new MaskingPipeline();
  const results: ReturnType<typeof report>[] = [];

  const logicSlice = handleGetLogicSlice(storage, masking, undefined, tempDir);
  results.push(report('get_logic_slice', (await time('get_logic_slice', () => logicSlice({ symbolId: hotSymbolId }))).samples, BUDGET_MS.get_logic_slice));

  const blastRadius = handleGetBlastRadius(storage, masking, undefined, tempDir);
  results.push(report('get_blast_radius', (await time('get_blast_radius', () => blastRadius({ symbolId: hotSymbolId }))).samples, BUDGET_MS.get_blast_radius));

  const contextForTask = handleGetContextForTask(storage, masking, undefined, tempDir);
  results.push(report('get_context_for_task', (await time('get_context_for_task', () => contextForTask({ symbolId: hotSymbolId, taskType: 'understand' }))).samples, BUDGET_MS.get_context_for_task));

  const findImporters = handleFindImporters(storage, masking, undefined, tempDir);
  results.push(report('find_importers', (await time('find_importers', () => findImporters({ symbolId: hotSymbolId }))).samples, BUDGET_MS.find_importers));

  const searchSymbols = handleSearchSymbols(storage as IStoragePort, masking, undefined, tempDir);
  results.push(report('search_symbols', (await time('search_symbols', () => searchSymbols({ pattern: 'Symbol' }))).samples, BUDGET_MS.search_symbols));

  const symbolImportance = handleGetSymbolImportance(storage, masking, undefined, tempDir);
  results.push(report('get_symbol_importance', (await time('get_symbol_importance', () => symbolImportance({}))).samples, BUDGET_MS.get_symbol_importance));

  // CLI version --verbose (spawn real process, not in-process)
  const cliBin = join(process.cwd(), 'packages/cli/dist/index.js');
  const versionSamples: number[] = [];
  for (let i = 0; i < WARMUP; i++) spawnSync('node', [cliBin, '--version', '--verbose'], { cwd: tempDir });
  for (let i = 0; i < Math.min(20, ITERATIONS); i++) {
    const t0 = performance.now();
    spawnSync('node', [cliBin, '--version', '--verbose'], { cwd: tempDir });
    versionSamples.push(performance.now() - t0);
  }
  versionSamples.sort((a, b) => a - b);
  results.push(report('version --verbose', versionSamples, BUDGET_MS.version_verbose));

  // Print markdown table
  console.log('| Tool | p50 | p95 | p99 | max | Budget | Result |');
  console.log('|---|---:|---:|---:|---:|---:|---|');
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`| ${r.label} | ${r.p50}ms | ${r.p95}ms | ${r.p99}ms | ${r.max}ms | ${r.budget}ms | ${icon} |`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('');
  if (failed.length === 0) {
    console.log(`All ${results.length} benchmarks within budget.`);
  } else {
    console.log(`${failed.length} / ${results.length} benchmarks exceeded budget:`);
    for (const f of failed) console.log(`  - ${f.label}: p95 ${f.p95}ms > ${f.budget}ms budget`);
  }

  // Optional JSON output for CI consumption
  if (process.env['BENCH_JSON']) {
    mkdirSync(join(process.cwd(), 'benchmark-results'), { recursive: true });
    writeFileSync(
      join(process.cwd(), 'benchmark-results', 'latest.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), size, results }, null, 2),
    );
  }

  storage.close();
  rmSync(tempDir, { recursive: true, force: true });

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
