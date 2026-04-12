import { describe, it, expect } from 'vitest';
import { SymbolTokenizer } from '../symbol-tokenizer.js';

describe('SymbolTokenizer', () => {
  describe('splitName — static', () => {
    it('splits camelCase', () => {
      expect(SymbolTokenizer.splitName('getCoChangeMetrics')).toEqual([
        'get', 'Co', 'Change', 'Metrics',
      ]);
    });

    it('splits PascalCase', () => {
      expect(SymbolTokenizer.splitName('BlastRadiusCalculator')).toEqual([
        'Blast', 'Radius', 'Calculator',
      ]);
    });

    it('splits snake_case', () => {
      expect(SymbolTokenizer.splitName('i_storage_port')).toEqual([
        'i', 'storage', 'port',
      ]);
    });

    it('splits kebab-case', () => {
      expect(SymbolTokenizer.splitName('blast-radius-calculator')).toEqual([
        'blast', 'radius', 'calculator',
      ]);
    });

    it('splits digit boundaries', () => {
      expect(SymbolTokenizer.splitName('BM25Scorer')).toEqual([
        'BM', '25', 'Scorer',
      ]);
    });

    it('splits acronyms followed by words', () => {
      expect(SymbolTokenizer.splitName('HTMLParser')).toEqual([
        'HTML', 'Parser',
      ]);
    });

    it('splits all-caps with digits', () => {
      expect(SymbolTokenizer.splitName('DB_PASSWORD')).toEqual([
        'DB', 'PASSWORD',
      ]);
    });

    it('splits mixed conventions', () => {
      expect(SymbolTokenizer.splitName('SqliteStorageAdapter')).toEqual([
        'Sqlite', 'Storage', 'Adapter',
      ]);
    });

    it('handles single word', () => {
      expect(SymbolTokenizer.splitName('index')).toEqual(['index']);
    });

    it('handles empty string', () => {
      expect(SymbolTokenizer.splitName('')).toEqual([]);
    });

    it('handles single character', () => {
      expect(SymbolTokenizer.splitName('x')).toEqual(['x']);
    });

    it('splits IPascalCase (port interfaces)', () => {
      expect(SymbolTokenizer.splitName('IStoragePort')).toEqual([
        'I', 'Storage', 'Port',
      ]);
    });

    it('splits TsMorphAdapter', () => {
      expect(SymbolTokenizer.splitName('TsMorphAdapter')).toEqual([
        'Ts', 'Morph', 'Adapter',
      ]);
    });

    it('handles dotted names', () => {
      expect(SymbolTokenizer.splitName('TsMorphAdapter.buildSymbolId')).toEqual([
        'Ts', 'Morph', 'Adapter', 'build', 'Symbol', 'Id',
      ]);
    });

    it('splits FTS5 (all caps + digit)', () => {
      expect(SymbolTokenizer.splitName('FTS5')).toEqual(['FTS', '5']);
    });

    it('handles consecutive digits', () => {
      expect(SymbolTokenizer.splitName('version2Update')).toEqual([
        'version', '2', 'Update',
      ]);
    });

    it('handles leading digits', () => {
      expect(SymbolTokenizer.splitName('3DRenderer')).toEqual([
        '3', 'D', 'Renderer',
      ]);
    });
  });

  describe('tokenize — instance method', () => {
    const tokenizer = new SymbolTokenizer();

    it('lowercases all tokens', () => {
      const tokens = tokenizer.tokenize('BlastRadiusCalculator');
      expect(tokens.every((t) => t === t.toLowerCase())).toBe(true);
    });

    it('includes original name as first token', () => {
      const tokens = tokenizer.tokenize('BlastRadiusCalculator');
      expect(tokens[0]).toBe('blastradiuscalculator');
    });

    it('excludes stop words by default', () => {
      const tokens = tokenizer.tokenize('getCoChangeMetrics');
      expect(tokens).not.toContain('get');
      expect(tokens).toContain('co');
      expect(tokens).toContain('change');
      expect(tokens).toContain('metrics');
    });

    it('includes stop words when configured', () => {
      const t = new SymbolTokenizer({ includeStopWords: true });
      const tokens = t.tokenize('getCoChangeMetrics');
      expect(tokens).toContain('get');
    });

    it('includes file path segments when configured', () => {
      const t = new SymbolTokenizer({ includeFilePath: true });
      const tokens = t.tokenize('BlastRadiusCalculator', 'src/core/blast-radius/blast-radius-calculator.ts');
      expect(tokens).toContain('src');
      expect(tokens).toContain('core');
      expect(tokens).toContain('blast');
      expect(tokens).toContain('radius');
    });

    it('deduplicates tokens', () => {
      const t = new SymbolTokenizer({ includeFilePath: true });
      const tokens = t.tokenize('BlastRadiusCalculator', 'src/core/blast-radius/blast-radius-calculator.ts');
      const unique = new Set(tokens);
      expect(tokens.length).toBe(unique.size);
    });

    it('handles snake_case symbol', () => {
      const tokens = tokenizer.tokenize('i_storage_port');
      expect(tokens).toContain('i_storage_port');
      expect(tokens).toContain('storage');
      expect(tokens).toContain('port');
    });

    it('handles acronym symbol', () => {
      const tokens = tokenizer.tokenize('DB_PASSWORD');
      expect(tokens).toContain('db_password');
      expect(tokens).toContain('db');
      expect(tokens).toContain('password');
    });
  });

  describe('tokenizeQuery', () => {
    const tokenizer = new SymbolTokenizer();

    it('tokenizes single word', () => {
      expect(tokenizer.tokenizeQuery('blast')).toEqual(['blast']);
    });

    it('tokenizes multi-word query', () => {
      expect(tokenizer.tokenizeQuery('blast radius')).toEqual(['blast', 'radius']);
    });

    it('splits camelCase in query', () => {
      expect(tokenizer.tokenizeQuery('BlastRadiusCalculator')).toEqual([
        'blast', 'radius', 'calculator',
      ]);
    });

    it('handles mixed query', () => {
      const tokens = tokenizer.tokenizeQuery('dead code detector');
      expect(tokens).toEqual(['dead', 'code', 'detector']);
    });

    it('deduplicates query tokens', () => {
      const tokens = tokenizer.tokenizeQuery('blast blast');
      expect(tokens).toEqual(['blast']);
    });

    it('handles empty query', () => {
      expect(tokenizer.tokenizeQuery('')).toEqual([]);
    });

    it('lowercases query tokens', () => {
      const tokens = tokenizer.tokenizeQuery('PageRank');
      expect(tokens).toEqual(['page', 'rank']);
    });
  });

  describe('tokenizeFilePath', () => {
    it('extracts path segments', () => {
      const tokens = SymbolTokenizer.tokenizeFilePath('src/core/search/symbol-tokenizer.ts');
      expect(tokens).toEqual(['src', 'core', 'search', 'symbol', 'tokenizer']);
    });

    it('handles Windows paths', () => {
      const tokens = SymbolTokenizer.tokenizeFilePath('src\\adapters\\mcp\\get-ranked-context.ts');
      expect(tokens).toEqual(['src', 'adapters', 'mcp', 'get', 'ranked', 'context']);
    });

    it('deduplicates path tokens', () => {
      const tokens = SymbolTokenizer.tokenizeFilePath('src/core/core-utils.ts');
      expect(tokens.filter((t) => t === 'core').length).toBe(1);
    });
  });

  describe('isStopWord', () => {
    it('identifies stop words', () => {
      expect(SymbolTokenizer.isStopWord('get')).toBe(true);
      expect(SymbolTokenizer.isStopWord('set')).toBe(true);
      expect(SymbolTokenizer.isStopWord('is')).toBe(true);
      expect(SymbolTokenizer.isStopWord('has')).toBe(true);
    });

    it('rejects non-stop words', () => {
      expect(SymbolTokenizer.isStopWord('blast')).toBe(false);
      expect(SymbolTokenizer.isStopWord('radius')).toBe(false);
      expect(SymbolTokenizer.isStopWord('calculator')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(SymbolTokenizer.isStopWord('GET')).toBe(true);
      expect(SymbolTokenizer.isStopWord('Set')).toBe(true);
    });
  });

  describe('PRD examples — exact requirements', () => {
    const tokenizer = new SymbolTokenizer({ includeStopWords: true });

    it('FR-1.1: camelCase split', () => {
      const tokens = tokenizer.tokenize('getCoChangeMetrics');
      expect(tokens).toContain('change');
      expect(tokens).toContain('metrics');
    });

    it('FR-1.2: snake_case split', () => {
      const tokens = tokenizer.tokenize('i_storage_port');
      expect(tokens).toContain('storage');
      expect(tokens).toContain('port');
    });

    it('FR-1.3: PascalCase split', () => {
      const tokens = tokenizer.tokenize('SqliteStorageAdapter');
      expect(tokens).toContain('sqlite');
      expect(tokens).toContain('storage');
      expect(tokens).toContain('adapter');
    });

    it('FR-1.4: digit boundaries', () => {
      const tokens = tokenizer.tokenize('BM25Scorer');
      expect(tokens).toContain('bm');
      expect(tokens).toContain('25');
      expect(tokens).toContain('scorer');
    });

    it('FR-1.5: preserves original name', () => {
      const tokens = tokenizer.tokenize('BlastRadiusCalculator');
      expect(tokens[0]).toBe('blastradiuscalculator');
    });

    it('FR-1.7: lowercases all tokens', () => {
      const tokens = tokenizer.tokenize('IStoragePort');
      expect(tokens.every((t) => t === t.toLowerCase())).toBe(true);
    });

    it('FR-1.9: original name included for exact match priority', () => {
      const tokens = tokenizer.tokenize('ContextAssembler');
      expect(tokens).toContain('contextassembler');
    });
  });
});
