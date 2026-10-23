import { describe, it, expect } from 'vitest';
import {
  canonicalFromParts,
  canonicalSqlName,
  DEFAULT_SQL_SCHEMA,
  foldAsciiLower,
  SQL_DIALECT,
} from '../names.js';

describe('canonicalSqlName', () => {
  it('canonicalizes bracketed, bare and quoted names', () => {
    expect(canonicalSqlName('[dbo].[Loan Items]')).toBe('dbo.loan items');
    expect(canonicalSqlName('Loans')).toBe('dbo.loans');
    expect(canonicalSqlName('"Circulation"."Holds"')).toBe('circulation.holds');
  });

  it('skips 3- and 4-part names, temp tables, table variables and system schemas', () => {
    expect(canonicalSqlName('OtherDb.dbo.Loans')).toBeUndefined();
    expect(canonicalSqlName('srv.db.dbo.Loans')).toBeUndefined();
    expect(canonicalSqlName('#tmp')).toBeUndefined();
    expect(canonicalSqlName('##g')).toBeUndefined();
    expect(canonicalSqlName('@t')).toBeUndefined();
    expect(canonicalSqlName('sys.tables')).toBeUndefined();
    expect(canonicalSqlName('INFORMATION_SCHEMA.COLUMNS')).toBeUndefined();
  });

  it('folds ASCII A-Z only and keeps every other character', () => {
    expect(canonicalSqlName('[dbo].[Ödünç Kaydı]')).toBe('dbo.Ödünç kaydı');
    expect(canonicalSqlName('KİTAP')).toBe('dbo.kİtap');
    expect(canonicalSqlName('ÜYE')).toBe('dbo.Üye');
  });

  it('returns undefined for text that is not a plain multipart name', () => {
    expect(canonicalSqlName('')).toBeUndefined();
    expect(canonicalSqlName('a.')).toBeUndefined();
    expect(canonicalSqlName('.a')).toBeUndefined();
    expect(canonicalSqlName('a..b')).toBeUndefined();
    expect(canonicalSqlName('a b')).toBeUndefined();
    expect(canonicalSqlName("'a'")).toBeUndefined();
  });

  it('returns undefined for an unquoted reserved word in any part, while a delimited one is a name', () => {
    expect(canonicalSqlName('SELECT')).toBeUndefined();
    expect(canonicalSqlName('dbo.Table')).toBeUndefined();
    expect(canonicalSqlName('exec.usp_CloseLoan')).toBeUndefined();
    expect(canonicalSqlName('[dbo].[Table]')).toBe('dbo.table');
    expect(canonicalSqlName('"Exec".usp_CloseLoan')).toBe('exec.usp_closeloan');
  });
});

describe('canonicalFromParts', () => {
  it('applies the dbo default and skips empty parts', () => {
    expect(canonicalFromParts(['Loans'])).toBe('dbo.loans');
    expect(canonicalFromParts(['Lib', 'Loans'])).toBe('lib.loans');
    expect(canonicalFromParts([])).toBeUndefined();
    expect(canonicalFromParts(['a', ''])).toBeUndefined();
    expect(canonicalFromParts(['a', 'b', 'c'])).toBeUndefined();
  });

  it('skips a part containing "::" so it cannot collide with the symbol ID form', () => {
    expect(canonicalFromParts(['a::b'])).toBeUndefined();
    expect(canonicalFromParts(['x::y', 'Loans'])).toBeUndefined();
    expect(canonicalFromParts(['dbo', 'a::table'])).toBeUndefined();
  });

  it('skips a part that still contains "." after delimiter removal, so it cannot read as more parts', () => {
    expect(canonicalFromParts(['Loans.Archive'])).toBeUndefined();
    expect(canonicalFromParts(['dbo', 'Loans.Archive'])).toBeUndefined();
    expect(canonicalFromParts(['Lending.Desk', 'Loans'])).toBeUndefined();
    expect(canonicalSqlName('[dbo].[Loans.Archive]')).toBeUndefined();
    expect(canonicalSqlName('[Loans.Archive]')).toBeUndefined();
    expect(canonicalSqlName('"dbo"."Loans.Archive"')).toBeUndefined();
    expect(canonicalSqlName('[dbo].[Loans]')).toBe('dbo.loans');
  });

  it('exposes the dialect and default schema constants', () => {
    expect(SQL_DIALECT).toBe('tsql');
    expect(DEFAULT_SQL_SCHEMA).toBe('dbo');
    expect(foldAsciiLower('ABC xyz Ü İ')).toBe('abc xyz Ü İ');
  });
});

describe('foldAsciiLower', () => {
  it('keeps dotless ı and sharp ß, which locale or Unicode folding would change', () => {
    expect(foldAsciiLower('ı')).toBe('ı');
    expect(foldAsciiLower('ß')).toBe('ß');
    expect(foldAsciiLower('KİTAP ıI ßS')).toBe('kİtap ıi ßs');
    expect(canonicalSqlName('[Üye].[Ödünç Kaydı]')).toBe('Üye.Ödünç kaydı');
  });
});
