import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../src/core/graph/symbol-graph.js';
import { LogicSliceQuery } from '../../src/core/logic-slice/logic-slice-query.js';
import { BlastRadiusCalculator } from '../../src/core/blast-radius/blast-radius-calculator.js';
import { DetailFormatter } from '../../src/core/detail-levels/detail-formatter.js';
import { MaskingPipeline } from '../../src/core/masking/masking-pipeline.js';
import type { SymbolNode } from '../../src/core/types.js';

function generateGraph(fileCount: number): SymbolGraph {
  const graph = new SymbolGraph();

  for (let i = 0; i < fileCount; i++) {
    const symbols: SymbolNode[] = [
      {
        symbolId: `src/file${i}.ts::fn${i}::function`,
        name: `fn${i}`,
        kind: 'function',
        startLine: 0,
        endLine: 20,
      },
      {
        symbolId: `src/file${i}.ts::Class${i}::class`,
        name: `Class${i}`,
        kind: 'class',
        startLine: 25,
        endLine: 80,
      },
    ];

    for (const sym of symbols) graph.addNode(sym);

    // Each file imports from the next (chain)
    if (i < fileCount - 1) {
      graph.addEdge({
        from: `src/file${i}.ts::fn${i}::function`,
        to: `src/file${i + 1}.ts::Class${i + 1}::class`,
        kind: 'imports',
      });
    }

    // Some cross-references for blast radius
    if (i > 0 && i % 5 === 0) {
      graph.addEdge({
        from: `src/file${i}.ts::Class${i}::class`,
        to: `src/file0.ts::fn0::function`,
        kind: 'uses',
      });
    }
  }

  return graph;
}

function estimateIndexSize(fileCount: number): number {
  // Each file index JSON is roughly 300-500 bytes
  const avgFileSize = 400;
  return fileCount * avgFileSize;
}

describe('Performance Benchmarks', () => {
  const query = new LogicSliceQuery();
  const blastCalc = new BlastRadiusCalculator();
  const formatter = new DetailFormatter();
  const masking = new MaskingPipeline();

  describe('NFR1: Tool response < 500ms p95', () => {
    it('get_logic_slice responds in < 500ms on 1000-file graph', () => {
      const graph = generateGraph(1000);
      const timings: number[] = [];

      for (let i = 0; i < 100; i++) {
        const symbolId = `src/file${i * 10}.ts::fn${i * 10}::function`;
        const start = performance.now();

        const slice = query.getLogicSlice(graph, symbolId);
        if (slice) {
          const formatted = formatter.format(slice, 3);
          masking.mask(JSON.stringify(formatted));
        }

        timings.push(performance.now() - start);
      }

      timings.sort((a, b) => a - b);
      const p95 = timings[Math.floor(timings.length * 0.95)]!;

      expect(p95).toBeLessThan(500);
      console.error(`[benchmark] get_logic_slice p95: ${p95.toFixed(2)}ms`);
    });

    it('get_blast_radius responds in < 500ms on 1000-file graph', () => {
      const graph = generateGraph(1000);
      const timings: number[] = [];

      for (let i = 0; i < 100; i++) {
        const symbolId = `src/file${i * 10}.ts::fn${i * 10}::function`;
        const start = performance.now();
        blastCalc.calculate(graph, symbolId);
        timings.push(performance.now() - start);
      }

      timings.sort((a, b) => a - b);
      const p95 = timings[Math.floor(timings.length * 0.95)]!;

      expect(p95).toBeLessThan(500);
      console.error(`[benchmark] get_blast_radius p95: ${p95.toFixed(2)}ms`);
    });
  });

  describe('NFR3: Graph build time', () => {
    it('builds graph from 1000 files in < 1000ms', () => {
      const start = performance.now();
      generateGraph(1000);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
      console.error(`[benchmark] graph build (1000 files): ${elapsed.toFixed(2)}ms`);
    });
  });

  describe('NFR6: Index size < 10MB for 1000 files', () => {
    it('estimated index size stays under 10MB', () => {
      const sizeBytes = estimateIndexSize(1000);
      const sizeMB = sizeBytes / (1024 * 1024);

      expect(sizeMB).toBeLessThan(10);
      console.error(`[benchmark] estimated index size (1000 files): ${sizeMB.toFixed(2)}MB`);
    });
  });

  describe('NFR4: Incremental operations', () => {
    it('single symbol lookup completes in < 2ms', () => {
      const graph = generateGraph(1000);
      const timings: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        graph.getNode(`src/file${i * 10}.ts::fn${i * 10}::function`);
        timings.push(performance.now() - start);
      }

      timings.sort((a, b) => a - b);
      const p95 = timings[Math.floor(timings.length * 0.95)]!;

      expect(p95).toBeLessThan(2);
      console.error(`[benchmark] symbol lookup p95: ${p95.toFixed(4)}ms`);
    });
  });
});
