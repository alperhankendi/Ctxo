import { describe, it, expect } from 'vitest';
import { tokenizeSql } from '../tokenizer.js';

const texts = (src: string) => tokenizeSql(src).map((t) => t.text);
const batches = (src: string) => tokenizeSql(src).filter((t) => t.kind === 'batch');

describe('tokenizeSql', () => {
  it('drops line comments and nested block comments', () => {
    expect(texts('SELECT 1 /* a /* b */ c */ -- d')).toEqual(['SELECT', '1']);
  });

  it('reads doubled quotes and N-prefixed strings as one string token', () => {
    const toks = tokenizeSql("SELECT 'it''s', N'x''y'");
    const strings = toks.filter((t) => t.kind === 'string');
    expect(strings.map((t) => t.value)).toEqual(["it's", "x'y"]);
    expect(strings.map((t) => t.text)).toEqual(["'it''s'", "N'x''y'"]);
  });

  it('reads bracketed and double-quoted identifiers with escaped closers', () => {
    const toks = tokenizeSql('[a]]b] "x""y"');
    expect(toks.map((t) => [t.kind, t.value])).toEqual([
      ['quoted', 'a]b'],
      ['quoted', 'x"y'],
    ]);
  });

  it('emits a batch token for GO alone on a line, with a count or a trailing comment, in any case', () => {
    expect(batches('SELECT 1\nGO\nSELECT 2')).toHaveLength(1);
    expect(batches('SELECT 1\n  go 5\nSELECT 2')).toHaveLength(1);
    expect(batches('SELECT 1\nGo -- done\nSELECT 2')).toHaveLength(1);
    expect(batches('SELECT 1\r\nGO\r\nSELECT 2')).toHaveLength(1);
    expect(batches('GO')).toHaveLength(1);
    expect(batches('SELECT 1\nGO 3 -- x\n')[0]!.text).toBe('GO 3');
  });

  it('does not treat GO inside a string, a comment or a bracket, or GOTO, as a batch', () => {
    expect(batches("SELECT 'a\nGO\nb'")).toHaveLength(0);
    expect(batches('/*\nGO\n*/ SELECT 1')).toHaveLength(0);
    expect(batches('-- x\n-- GO\nSELECT 1')).toHaveLength(0);
    expect(batches('SELECT [a\nGO\nb]')).toHaveLength(0);
    expect(batches('GOTO done')).toHaveLength(0);
    expect(batches('SELECT 1 GO')).toHaveLength(0);
    expect(batches('GO x')).toHaveLength(0);
  });

  it('numbers lines from 0 across LF and CRLF', () => {
    const toks = tokenizeSql('a\nb\r\nc\n\nd');
    expect(toks.map((t) => t.line)).toEqual([0, 1, 2, 4]);
  });

  it('ignores a leading byte order mark', () => {
    const toks = tokenizeSql('\uFEFFSELECT 1');
    expect(toks.map((t) => t.text)).toEqual(['SELECT', '1']);
    expect(tokenizeSql('\uFEFFGO')[0]!.kind).toBe('batch');
  });

  it('does not throw on an unterminated string, comment or bracket', () => {
    expect(() => tokenizeSql("SELECT 'abc")).not.toThrow();
    expect(() => tokenizeSql('SELECT /* abc')).not.toThrow();
    expect(() => tokenizeSql('SELECT [abc')).not.toThrow();
    expect(() => tokenizeSql('SELECT "abc')).not.toThrow();
    expect(tokenizeSql('SELECT [abc').map((t) => t.kind)).toEqual(['word', 'quoted']);
  });

  it('reports offsets that slice back to each token\'s text', () => {
    const src = "\uFEFFSELECT [Ödünç Kaydı].x, N'a''b', @p, #t, 12 /* c */\nGO 2\nEXEC dbo.Üye;";
    const toks = tokenizeSql(src);
    expect(toks.length).toBeGreaterThan(10);
    for (const t of toks) expect(src.slice(t.start, t.end)).toBe(t.text);
  });

  it('classifies variables, temp names, numbers and punctuation', () => {
    const toks = tokenizeSql('@p @@ROWCOUNT #tmp ##g 1.5 . ,');
    expect(toks.map((t) => [t.kind, t.value])).toEqual([
      ['variable', '@p'],
      ['variable', '@@ROWCOUNT'],
      ['word', '#tmp'],
      ['word', '##g'],
      ['number', '1.5'],
      ['punct', '.'],
      ['punct', ','],
    ]);
  });
});
