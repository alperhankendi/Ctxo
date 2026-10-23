import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractSqlDefinitions } from '@ctxo/sql-extract';
import { MAX_SQL_SOURCE_BYTES, SqlAdapter } from '../sql-adapter.js';

// Wraps the real extractor in a spy that calls through, so tests can count extractions.
vi.mock('@ctxo/sql-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ctxo/sql-extract')>();
  return { ...actual, extractSqlDefinitions: vi.fn(actual.extractSqlDefinitions) };
});

const extractSpy = vi.mocked(extractSqlDefinitions);

const SCHEMA_SQL = [
  'CREATE TABLE [dbo].[Loans] (Id INT NOT NULL, MemberId INT NOT NULL)',
  'GO',
  'CREATE VIEW ActiveLoans AS SELECT l.Id FROM Loans l',
  'GO',
  'CREATE TABLE [Ödünç Kaydı] (Id INT NOT NULL)',
  'GO',
  'CREATE VIEW dbo.KİTAP AS SELECT 1 AS One',
  'GO',
  'CREATE FUNCTION [dbo].[fn_OpenLoanCount] (@memberId INT) RETURNS INT AS BEGIN RETURN 0 END',
  'GO',
  'CREATE PROCEDURE [dbo].[usp_CloseLoan] AS UPDATE dbo.Loans SET MemberId = 0',
  '',
].join('\n');

const BODIES_SQL = [
  'CREATE VIEW dbo.ActiveLoans AS',
  'SELECT l.Id FROM dbo.Loans AS l JOIN [dbo].[Members] m ON m.Id = l.MemberId',
  'GO',
  'CREATE PROCEDURE dbo.usp_CloseLoan @id INT AS',
  'BEGIN',
  '    UPDATE dbo.Loans SET ClosedAt = SYSUTCDATETIME() WHERE Id = @id;',
  '    INSERT INTO dbo.Fines (LoanId) SELECT Id FROM dbo.Loans WHERE Id = @id;',
  '    EXEC dbo.usp_NotifyMember @id;',
  'END',
  'GO',
  'CREATE FUNCTION dbo.fn_OpenLoanCount (@memberId INT) RETURNS INT AS',
  'BEGIN',
  '    RETURN (SELECT COUNT(*) FROM dbo.ActiveLoans WHERE MemberId = @memberId)',
  'END',
  '',
].join('\n');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SqlAdapter - symbols', () => {
  it('symbol ids use the canonical name and name keeps the declared spelling', async () => {
    const adapter = new SqlAdapter();
    const symbols = await adapter.extractSymbols('db/schema.sql', SCHEMA_SQL);

    expect(symbols.map((s) => [s.symbolId, s.name, s.kind])).toEqual([
      ['db/schema.sql::dbo.loans::table', 'dbo.Loans', 'table'],
      ['db/schema.sql::dbo.activeloans::view', 'ActiveLoans', 'view'],
      ['db/schema.sql::dbo.Ödünç kaydı::table', 'Ödünç Kaydı', 'table'],
      ['db/schema.sql::dbo.kİtap::view', 'dbo.KİTAP', 'view'],
      ['db/schema.sql::dbo.fn_openloancount::function', 'dbo.fn_OpenLoanCount', 'function'],
      ['db/schema.sql::dbo.usp_closeloan::procedure', 'dbo.usp_CloseLoan', 'procedure'],
    ]);
  });

  it('gives every symbol a 0-based line range and a source offset range', async () => {
    const adapter = new SqlAdapter();
    const symbols = await adapter.extractSymbols('db/schema.sql', SCHEMA_SQL);

    const loans = symbols[0]!;
    expect(loans.startLine).toBe(0);
    expect(loans.endLine).toBe(0);
    expect(SCHEMA_SQL.slice(loans.startOffset, loans.endOffset)).toBe('CREATE TABLE [dbo].[Loans] (Id INT NOT NULL, MemberId INT NOT NULL)');
    for (const s of symbols) {
      expect(s.endLine, s.symbolId).toBeGreaterThanOrEqual(s.startLine);
      expect(SCHEMA_SQL.slice(s.startOffset, s.endOffset), s.symbolId).toMatch(/^CREATE /);
    }
  });

  it('a table carries a sorted lowercase columns annotation', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE TABLE dbo.Loans (',
      '    [MemberId] INT NOT NULL,',
      '    Id INT NOT NULL,',
      '    ClosedAt DATETIME2 NULL,',
      '    CONSTRAINT PK_Loans PRIMARY KEY (Id),',
      '    UNIQUE (MemberId, ClosedAt)',
      ')',
      '',
    ].join('\n');
    const [loans] = await adapter.extractSymbols('db/loans.sql', source);

    expect(loans!.annotations).toEqual([{ name: 'columns', args: ['closedat', 'id', 'memberid'] }]);
  });

  it('lists every column without a cap', async () => {
    const adapter = new SqlAdapter();
    const names = Array.from({ length: 60 }, (_, i) => `Col_${String(60 - i).padStart(2, '0')}`);
    const source = `CREATE TABLE dbo.WideLoans (${names.map((n) => `${n} INT`).join(', ')})`;
    const [wide] = await adapter.extractSymbols('db/wide.sql', source);

    const args = wide!.annotations![0]!.args!;
    expect(args).toHaveLength(60);
    expect(args).toEqual(names.map((n) => n.toLowerCase()).sort());
  });

  it('views, procedures and functions carry no annotations key', async () => {
    const adapter = new SqlAdapter();
    const symbols = await adapter.extractSymbols('db/bodies.sql', BODIES_SQL);

    expect(symbols.map((s) => s.kind)).toEqual(['view', 'procedure', 'function']);
    for (const s of symbols) expect(Object.keys(s), s.symbolId).not.toContain('annotations');
  });

  it('a file with only top-level DML has no symbols', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'SELECT * FROM dbo.Loans;',
      "INSERT INTO dbo.Holds (Id) VALUES (1);",
      'EXEC dbo.usp_ExpireHolds;',
      '',
    ].join('\n');

    expect(await adapter.extractSymbols('scripts/adhoc.sql', source)).toEqual([]);
    expect(await adapter.extractEdges('scripts/adhoc.sql', source)).toEqual([]);
  });

  it('a table defined in one file with no body produces a symbol and no edges', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE TABLE dbo.Holds (',
      '    Id INT NOT NULL,',
      '    LoanId INT NOT NULL,',
      '    CONSTRAINT FK_Holds_Loans FOREIGN KEY (LoanId) REFERENCES dbo.Loans (Id)',
      ')',
      '',
    ].join('\n');

    expect(await adapter.extractSymbols('db/holds.sql', source)).toHaveLength(1);
    expect(await adapter.extractEdges('db/holds.sql', source)).toEqual([]);
  });

  it('body-local CREATE TABLE and ALTER TABLE ADD add no symbol and no columns', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE TABLE dbo.LoanBatches (Id INT NOT NULL)',
      'GO',
      'CREATE PROCEDURE dbo.usp_Setup',
      'AS',
      'BEGIN',
      '    CREATE TABLE dbo.LoanStaging (Id INT NOT NULL);',
      '    ALTER TABLE dbo.LoanBatches ADD Note NVARCHAR(100) NULL;',
      'END',
      '',
    ].join('\n');
    const symbols = await adapter.extractSymbols('db/setup.sql', source);

    expect(symbols.map((s) => s.symbolId)).toEqual([
      'db/setup.sql::dbo.loanbatches::table',
      'db/setup.sql::dbo.usp_setup::procedure',
    ]);
    expect(symbols[0]!.annotations).toEqual([{ name: 'columns', args: ['id'] }]);
  });

  it('ALTER TABLE ADD outside a body adds columns to a table defined in the same file', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE TABLE dbo.Holds (Id INT NOT NULL)',
      'GO',
      'ALTER TABLE dbo.Holds ADD ExpiresAt DATETIME2 NULL',
      'GO',
      '',
    ].join('\n');
    const [holds] = await adapter.extractSymbols('db/holds.sql', source);

    expect(holds!.annotations).toEqual([{ name: 'columns', args: ['expiresat', 'id'] }]);
  });
});

describe('SqlAdapter - edges', () => {
  it('procedure, view and function bodies become reads, writes and executes edges to 2-part references', async () => {
    const adapter = new SqlAdapter();
    const edges = await adapter.extractEdges('db/loans.sql', BODIES_SQL);

    expect(edges).toEqual([
      { from: 'db/loans.sql::dbo.activeloans::view', to: 'dbo.loans::table', kind: 'reads' },
      { from: 'db/loans.sql::dbo.activeloans::view', to: 'dbo.members::table', kind: 'reads' },
      { from: 'db/loans.sql::dbo.fn_openloancount::function', to: 'dbo.activeloans::table', kind: 'reads' },
      { from: 'db/loans.sql::dbo.usp_closeloan::procedure', to: 'dbo.usp_notifymember::procedure', kind: 'executes' },
      { from: 'db/loans.sql::dbo.usp_closeloan::procedure', to: 'dbo.loans::table', kind: 'reads' },
      { from: 'db/loans.sql::dbo.usp_closeloan::procedure', to: 'dbo.fines::table', kind: 'writes' },
      { from: 'db/loans.sql::dbo.usp_closeloan::procedure', to: 'dbo.loans::table', kind: 'writes' },
    ]);
  });

  it('a recursive procedure has no self edge', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE PROCEDURE dbo.usp_ProcessHolds @depth INT AS',
      'BEGIN',
      '    IF @depth > 0 EXEC dbo.usp_ProcessHolds @depth = 0;',
      '    EXEC dbo.usp_ExpireHolds;',
      '    DELETE FROM dbo.Holds WHERE Id = 0;',
      'END',
      '',
    ].join('\n');

    // The extractor reports the recursion, so the filter is what removes it.
    const [definition] = extractSqlDefinitions(source).definitions;
    expect(definition!.accesses).toContainEqual({ kind: 'executes', name: 'dbo.usp_processholds' });

    const edges = await adapter.extractEdges('db/holds.sql', source);
    expect(edges).toEqual([
      { from: 'db/holds.sql::dbo.usp_processholds::procedure', to: 'dbo.usp_expireholds::procedure', kind: 'executes' },
      { from: 'db/holds.sql::dbo.usp_processholds::procedure', to: 'dbo.holds::table', kind: 'writes' },
    ]);
  });

  it('names edge targets with the canonical 2-part form, folding only ASCII letters', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE VIEW dbo.OverdueLoans AS',
      'SELECT * FROM [dbo].[Ödünç Kaydı] AS o JOIN Üye u ON u.Id = o.UyeId JOIN KİTAP k ON k.Id = o.KitapId',
      '',
    ].join('\n');
    const edges = await adapter.extractEdges('db/overdue.sql', source);

    expect(edges.map((e) => e.to)).toEqual(['dbo.kİtap::table', 'dbo.Ödünç kaydı::table', 'dbo.Üye::table']);
  });

  it('skips temp tables, table variables, CTE names and system schemas', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE PROCEDURE dbo.usp_Report AS',
      'BEGIN',
      '    WITH recent AS (SELECT Id FROM dbo.Loans) SELECT Id FROM recent;',
      '    SELECT Id INTO #work FROM dbo.Holds;',
      '    SELECT * FROM #work, sys.objects, @members;',
      'END',
      '',
    ].join('\n');
    const edges = await adapter.extractEdges('db/report.sql', source);

    expect(edges.map((e) => `${e.kind} ${e.to}`)).toEqual(['reads dbo.holds::table', 'reads dbo.loans::table']);
  });

  it('orders edges by source symbol, kind and target by code point', async () => {
    const adapter = new SqlAdapter();
    const source = [
      'CREATE PROCEDURE dbo.usp_B AS SELECT 1 FROM dbo.Zeta, dbo.Alpha; EXEC dbo.usp_C; INSERT INTO dbo.Mid (Id) VALUES (1)',
      'GO',
      'CREATE PROCEDURE dbo.usp_A AS SELECT 1 FROM dbo.Alpha',
      'GO',
    ].join('\n');
    const edges = await adapter.extractEdges('db/order.sql', source);

    expect(edges.map((e) => `${e.from} ${e.kind} ${e.to}`)).toEqual([
      'db/order.sql::dbo.usp_a::procedure reads dbo.alpha::table',
      'db/order.sql::dbo.usp_b::procedure executes dbo.usp_c::procedure',
      'db/order.sql::dbo.usp_b::procedure reads dbo.alpha::table',
      'db/order.sql::dbo.usp_b::procedure reads dbo.zeta::table',
      'db/order.sql::dbo.usp_b::procedure writes dbo.mid::table',
    ]);
  });
});

describe('SqlAdapter - contract', () => {
  it('.SQL in upper case is supported', () => {
    const adapter = new SqlAdapter();

    expect(adapter.isSupported('db/schema.sql')).toBe(true);
    expect(adapter.isSupported('DB/SCHEMA.SQL')).toBe(true);
    expect(adapter.isSupported('db/Schema.Sql')).toBe(true);
    expect(adapter.isSupported('db/schema.sqlx')).toBe(false);
    expect(adapter.isSupported('src/loans.ts')).toBe(false);
    expect(adapter.isSupported('sql')).toBe(false);
  });

  it('complexity is empty', async () => {
    const adapter = new SqlAdapter();

    expect(await adapter.extractComplexity('db/loans.sql', BODIES_SQL)).toEqual([]);
    expect(await adapter.extractComplexity('db/schema.sql', SCHEMA_SQL)).toEqual([]);
  });

  it('extracting the same file twice gives deep-equal symbols and edges', async () => {
    const first = new SqlAdapter();
    const second = new SqlAdapter();

    const a = { symbols: await first.extractSymbols('db/loans.sql', BODIES_SQL), edges: await first.extractEdges('db/loans.sql', BODIES_SQL) };
    const b = { symbols: await second.extractSymbols('db/loans.sql', BODIES_SQL), edges: await second.extractEdges('db/loans.sql', BODIES_SQL) };
    const c = { symbols: await first.extractSymbols('db/loans.sql', BODIES_SQL), edges: await first.extractEdges('db/loans.sql', BODIES_SQL) };

    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('extractSymbols and extractEdges share one extraction per file and source', async () => {
    const adapter = new SqlAdapter();
    extractSpy.mockClear();

    await adapter.extractSymbols('db/loans.sql', BODIES_SQL);
    await adapter.extractEdges('db/loans.sql', BODIES_SQL);
    await adapter.extractComplexity('db/loans.sql', BODIES_SQL);
    expect(extractSpy).toHaveBeenCalledTimes(1);

    // The order of ctxo index: symbols for every file first, then edges for every file.
    extractSpy.mockClear();
    await adapter.extractSymbols('db/loans.sql', BODIES_SQL);
    await adapter.extractSymbols('db/schema.sql', SCHEMA_SQL);
    await adapter.extractEdges('db/loans.sql', BODIES_SQL);
    await adapter.extractEdges('db/schema.sql', SCHEMA_SQL);
    expect(extractSpy).toHaveBeenCalledTimes(2);
  });

  it('extractEdges releases the cached extraction of the file', async () => {
    const adapter = new SqlAdapter();
    extractSpy.mockClear();

    await adapter.extractSymbols('db/loans.sql', BODIES_SQL);
    await adapter.extractEdges('db/loans.sql', BODIES_SQL);
    expect(extractSpy).toHaveBeenCalledTimes(1);

    // The entry is gone: a later call extracts again instead of holding the source.
    await adapter.extractSymbols('db/loans.sql', BODIES_SQL);
    expect(extractSpy).toHaveBeenCalledTimes(2);
  });

  it('a changed source or a disposed adapter extracts again', async () => {
    const adapter = new SqlAdapter();
    extractSpy.mockClear();

    await adapter.extractSymbols('db/loans.sql', BODIES_SQL);
    const changed = BODIES_SQL.replace('dbo.Fines', 'dbo.Holds');
    const edges = await adapter.extractEdges('db/loans.sql', changed);
    expect(extractSpy).toHaveBeenCalledTimes(2);
    expect(edges.map((e) => e.to)).toContain('dbo.holds::table');
    expect(edges.map((e) => e.to)).not.toContain('dbo.fines::table');

    await adapter.extractSymbols('db/loans.sql', changed);
    expect(extractSpy).toHaveBeenCalledTimes(3);
    await adapter.dispose();
    await adapter.extractEdges('db/loans.sql', changed);
    expect(extractSpy).toHaveBeenCalledTimes(4);
  });

  it('a failing extraction yields no symbols or edges and logs to stderr once', async () => {
    const adapter = new SqlAdapter();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    extractSpy.mockClear();
    extractSpy.mockImplementationOnce(() => {
      throw new Error('tokenizer exploded');
    });

    expect(await adapter.extractSymbols('db/broken.sql', BODIES_SQL)).toEqual([]);
    // The empty result is cached for this file and source: edges neither extract nor log again.
    expect(await adapter.extractEdges('db/broken.sql', BODIES_SQL)).toEqual([]);
    expect(extractSpy).toHaveBeenCalledTimes(1);

    const written = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('[ctxo:lang-sql]');
    expect(written.split('tokenizer exploded')).toHaveLength(2);

    // A changed source is a new attempt and succeeds.
    expect(await adapter.extractSymbols('db/broken.sql', `${BODIES_SQL}\n`)).not.toEqual([]);
  });
});

describe('SqlAdapter - size limit', () => {
  /** A table definition padded with a line comment to exactly `bytes` UTF-8 bytes. */
  function sourceOfBytes(bytes: number, comment = 'x'): string {
    const head = 'CREATE TABLE dbo.Loans (Id INT NOT NULL)\n-- ';
    const padding = comment.repeat(Math.ceil((bytes - head.length) / Buffer.byteLength(comment)));
    const source = head + padding;
    // Trim back to the exact size when a multi-byte comment overshoots.
    return Buffer.from(source, 'utf8').subarray(0, bytes).toString('utf8');
  }

  function warnings(stderr: ReturnType<typeof vi.spyOn>): string[] {
    return stderr.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('SQL size limit'));
  }

  it('the limit is 5 MiB', () => {
    expect(MAX_SQL_SOURCE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('a .sql file over the size limit is skipped with one warning', async () => {
    const adapter = new SqlAdapter();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    extractSpy.mockClear();
    const source = sourceOfBytes(6 * 1024 * 1024);

    expect(await adapter.extractSymbols('db/seed.sql', source)).toEqual([]);
    expect(await adapter.extractEdges('db/seed.sql', source)).toEqual([]);
    expect(await adapter.extractComplexity('db/seed.sql', source)).toEqual([]);

    expect(extractSpy).not.toHaveBeenCalled();
    expect(warnings(stderr)).toEqual([
      '[ctxo:lang-sql] skipped db/seed.sql: 6.0 MiB is over the 5 MiB SQL size limit\n',
    ]);
  });

  it('a source of exactly 5 MiB is indexed and one byte more is skipped', async () => {
    const adapter = new SqlAdapter();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const atLimit = sourceOfBytes(MAX_SQL_SOURCE_BYTES);
    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(MAX_SQL_SOURCE_BYTES);
    expect((await adapter.extractSymbols('db/at-limit.sql', atLimit)).map((s) => s.symbolId)).toEqual([
      'db/at-limit.sql::dbo.loans::table',
    ]);

    const overLimit = `${atLimit}x`;
    expect(await adapter.extractSymbols('db/over-limit.sql', overLimit)).toEqual([]);
    expect(warnings(stderr)).toEqual([
      '[ctxo:lang-sql] skipped db/over-limit.sql: 5.1 MiB is over the 5 MiB SQL size limit\n',
    ]);
  });

  it('the limit counts UTF-8 bytes of the decoded text, not characters', async () => {
    const adapter = new SqlAdapter();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    extractSpy.mockClear();
    // 'Ödünç' is 5 characters and 8 UTF-8 bytes: under 5 Mi characters, over 5 MiB.
    const source = sourceOfBytes(MAX_SQL_SOURCE_BYTES + 2, 'Ödünç');
    expect(source.length).toBeLessThan(MAX_SQL_SOURCE_BYTES);

    expect(await adapter.extractSymbols('db/ödünç.sql', source)).toEqual([]);
    expect(extractSpy).not.toHaveBeenCalled();
    expect(warnings(stderr)).toHaveLength(1);
  });

  it('every changed oversized source warns again, once', async () => {
    const adapter = new SqlAdapter();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const first = sourceOfBytes(6 * 1024 * 1024);
    const second = `${first}y`;

    await adapter.extractSymbols('db/seed.sql', first);
    await adapter.extractEdges('db/seed.sql', first);
    await adapter.extractSymbols('db/seed.sql', second);
    await adapter.extractEdges('db/seed.sql', second);

    expect(warnings(stderr)).toHaveLength(2);
  });
});
