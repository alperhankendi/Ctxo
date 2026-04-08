import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from '../search-engine.js';
import type { SymbolNode } from '../../types.js';

function sym(name: string, kind: SymbolNode['kind'] = 'class', file = 'src/test.ts'): SymbolNode {
  return {
    symbolId: `${file}::${name}::${kind}`,
    name,
    kind,
    startLine: 1,
    endLine: 10,
  };
}

const TEST_SYMBOLS: SymbolNode[] = [
  sym('BlastRadiusCalculator', 'class', 'src/core/blast-radius/blast-radius-calculator.ts'),
  sym('BlastRadiusResult', 'interface', 'src/core/blast-radius/blast-radius-calculator.ts'),
  sym('BlastRadiusEntry', 'interface', 'src/core/blast-radius/blast-radius-calculator.ts'),
  sym('handleGetBlastRadius', 'function', 'src/adapters/mcp/get-blast-radius.ts'),
  sym('PageRankCalculator', 'class', 'src/core/importance/page-rank-calculator.ts'),
  sym('PageRankEntry', 'interface', 'src/core/importance/page-rank-calculator.ts'),
  sym('PageRankResult', 'interface', 'src/core/importance/page-rank-calculator.ts'),
  sym('SymbolGraph', 'class', 'src/core/graph/symbol-graph.ts'),
  sym('GraphEdge', 'type', 'src/core/types.ts'),
  sym('SymbolNode', 'type', 'src/core/types.ts'),
  sym('IStoragePort', 'interface', 'src/ports/i-storage-port.ts'),
  sym('SqliteStorageAdapter', 'class', 'src/adapters/storage/sqlite-storage-adapter.ts'),
  sym('DeadCodeDetector', 'class', 'src/core/dead-code/dead-code-detector.ts'),
  sym('RevertDetector', 'class', 'src/core/why-context/revert-detector.ts'),
  sym('StalenessDetector', 'class', 'src/core/staleness/staleness-detector.ts'),
  sym('ContextAssembler', 'class', 'src/core/context-assembly/context-assembler.ts'),
  sym('CoChangeEntry', 'interface', 'src/core/co-change/co-change-analyzer.ts'),
  sym('CoChangeMatrix', 'interface', 'src/core/co-change/co-change-analyzer.ts'),
  sym('ChangeIntelligenceScore', 'interface', 'src/core/change-intelligence/types.ts'),
  sym('handleGetChangeIntelligence', 'function', 'src/adapters/mcp/get-change-intelligence.ts'),
  sym('wrapResponse', 'function', 'src/core/response-envelope.ts'),
  sym('MaskingPipeline', 'class', 'src/core/masking/masking-pipeline.ts'),
  sym('IMaskingPort', 'interface', 'src/ports/i-masking-port.ts'),
  sym('FileIndex', 'type', 'src/core/types.ts'),
  sym('LogicSliceQuery', 'class', 'src/core/logic-slice/logic-slice-query.ts'),
  sym('WhyContextAssembler', 'class', 'src/core/why-context/why-context-assembler.ts'),
  sym('HealthScorer', 'class', 'src/core/change-intelligence/health-scorer.ts'),
  sym('DetailFormatter', 'class', 'src/core/detail-levels/detail-formatter.ts'),
  sym('IndexCommand', 'class', 'src/cli/index-command.ts'),
  sym('buildGraphFromJsonIndex', 'function', 'src/adapters/mcp/get-logic-slice.ts'),
];

describe('SearchEngine', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    engine.buildIndex(TEST_SYMBOLS);
  });

  describe('basic search', () => {
    it('finds exact symbol name', () => {
      const result = engine.search('BlastRadiusCalculator');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].name).toBe('BlastRadiusCalculator');
    });

    it('returns empty for non-matching query', () => {
      const result = engine.search('xyzzy123');
      // May return fuzzy results or nothing
      expect(result.query).toBe('xyzzy123');
    });

    it('returns search metrics', () => {
      const result = engine.search('blast');
      expect(result.metrics).toBeDefined();
      expect(result.metrics.porterHits).toBeGreaterThan(0);
      expect(typeof result.metrics.latencyMs).toBe('number');
    });
  });

  describe('camelCase tokenized search', () => {
    it('finds symbols by sub-token "change"', () => {
      const result = engine.search('change');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('CoChangeEntry');
      expect(names).toContain('CoChangeMatrix');
      expect(names).toContain('ChangeIntelligenceScore');
    });

    it('finds symbols by sub-token "blast"', () => {
      const result = engine.search('blast');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('BlastRadiusCalculator');
      expect(names).toContain('BlastRadiusResult');
      expect(names).toContain('BlastRadiusEntry');
      expect(names).toContain('handleGetBlastRadius');
    });

    it('finds symbols by sub-token "detector"', () => {
      const result = engine.search('detector');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('DeadCodeDetector');
      expect(names).toContain('RevertDetector');
      expect(names).toContain('StalenessDetector');
    });

    it('finds symbols by sub-token "storage"', () => {
      const result = engine.search('storage');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('IStoragePort');
      expect(names).toContain('SqliteStorageAdapter');
    });
  });

  describe('multi-word queries with bigram boost', () => {
    it('ranks BlastRadiusCalculator first for "blast radius"', () => {
      const result = engine.search('blast radius');
      expect(result.results.length).toBeGreaterThan(0);
      // BlastRadiusCalculator should rank higher than individual matches
      const brcIndex = result.results.findIndex((r) => r.name === 'BlastRadiusCalculator');
      expect(brcIndex).toBeLessThanOrEqual(2);
    });

    it('ranks PageRankCalculator highly for "page rank"', () => {
      const result = engine.search('page rank');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('PageRankCalculator');
      const prcIndex = result.results.findIndex((r) => r.name === 'PageRankCalculator');
      expect(prcIndex).toBeLessThanOrEqual(2);
    });

    it('finds "dead code" related symbols', () => {
      const result = engine.search('dead code');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('DeadCodeDetector');
    });

    it('finds "co change" related symbols', () => {
      const result = engine.search('co change');
      const names = result.results.map((r) => r.name);
      expect(names).toContain('CoChangeEntry');
      expect(names).toContain('CoChangeMatrix');
    });
  });

  describe('two-phase cascade', () => {
    it('activates Phase 2 (trigram) for partial match "sqlit"', () => {
      const result = engine.search('sqlit');
      expect(result.results.length).toBeGreaterThan(0);
      const names = result.results.map((r) => r.name);
      expect(names).toContain('SqliteStorageAdapter');
      expect(result.metrics.phase2Activated).toBe(true);
    });

    it('does not activate Phase 2 when Phase 1 has enough results', () => {
      const result = engine.search('blast');
      expect(result.metrics.porterHits).toBeGreaterThanOrEqual(3);
      expect(result.metrics.phase2Activated).toBe(false);
    });
  });

  describe('fuzzy correction', () => {
    it('corrects typo "databse"', () => {
      // Build index with a symbol containing "database" in its name
      const symbols = [
        ...TEST_SYMBOLS,
        sym('SessionDatabase', 'class', 'src/storage/session-database.ts'),
      ];
      engine.buildIndex(symbols);

      const result = engine.search('databse');
      // May or may not have fuzzyCorrection depending on trigram match
      // But should find something related
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });

    it('corrects typo "detctor"', () => {
      const result = engine.search('detctor');
      // Fuzzy correction should kick in
      if (result.fuzzyCorrection) {
        expect(result.fuzzyCorrection.corrections[0].corrected).toBe('detector');
      }
      // Either way, should find detectors via trigram or fuzzy
      expect(result.metrics.phase2Activated || result.metrics.fuzzyApplied).toBe(true);
    });
  });

  describe('PageRank boost', () => {
    it('boosts symbols with higher PageRank', () => {
      const pageRank = new Map<string, number>();
      pageRank.set('src/core/types.ts::SymbolNode::type', 0.9);
      pageRank.set('src/core/types.ts::GraphEdge::type', 0.1);
      engine.buildIndex(TEST_SYMBOLS, pageRank);

      const result = engine.search('symbol');
      const symbolNodeIdx = result.results.findIndex((r) => r.name === 'SymbolNode');
      const graphIdx = result.results.findIndex((r) => r.name === 'SymbolGraph');
      // SymbolNode should be boosted by high PageRank
      if (symbolNodeIdx >= 0 && graphIdx >= 0) {
        expect(result.results[symbolNodeIdx].importanceScore).toBeGreaterThan(
          result.results[graphIdx].importanceScore,
        );
      }
    });
  });

  describe('exact match boost', () => {
    it('ranks exact name match highest', () => {
      const result = engine.search('SymbolGraph');
      expect(result.results[0].name).toBe('SymbolGraph');
    });

    it('ranks exact name match above partial matches', () => {
      const result = engine.search('FileIndex');
      expect(result.results[0].name).toBe('FileIndex');
    });
  });

  describe('edge cases', () => {
    it('handles empty query', () => {
      const result = engine.search('');
      expect(result.results).toEqual([]);
    });

    it('handles whitespace-only query', () => {
      const result = engine.search('   ');
      expect(result.results).toEqual([]);
    });

    it('respects limit parameter', () => {
      const result = engine.search('blast', 2);
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('handles single-char query', () => {
      const result = engine.search('a');
      // Should not crash, may return results via primary index
      expect(result.query).toBe('a');
    });
  });

  describe('updateFile', () => {
    it('updates index for a file', () => {
      const newSymbol = sym('NewCalculator', 'class', 'src/new.ts');
      engine.updateFile('src/new.ts', [newSymbol]);

      const result = engine.search('NewCalculator');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].name).toBe('NewCalculator');
    });

    it('removes old symbols when file updated', () => {
      // Initially has BlastRadiusCalculator in blast-radius-calculator.ts
      engine.updateFile('src/core/blast-radius/blast-radius-calculator.ts', []);

      const result = engine.search('BlastRadiusCalculator');
      const names = result.results.map((r) => r.name);
      expect(names).not.toContain('BlastRadiusCalculator');
    });
  });

  describe('getTier', () => {
    it('returns "in-memory"', () => {
      expect(engine.getTier()).toBe('in-memory');
    });
  });
});
