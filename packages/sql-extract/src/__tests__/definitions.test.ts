import { describe, it, expect } from 'vitest';
import { extractSqlDefinitions } from '../definitions.js';
import type { SqlDefinition } from '../types.js';

function only(source: string): SqlDefinition {
  const { definitions } = extractSqlDefinitions(source);
  expect(definitions).toHaveLength(1);
  return definitions[0]!;
}

function find(source: string, name: string): SqlDefinition {
  const def = extractSqlDefinitions(source).definitions.find((d) => d.name === name);
  expect(def, name).toBeDefined();
  return def!;
}

describe('extractSqlDefinitions', () => {
  it('keeps the declared spelling in declaredName and the canonical name in name', () => {
    const table = only('CREATE TABLE [Circulation].[BookCopies] (Id INT NOT NULL)');
    expect(table.kind).toBe('table');
    expect(table.declaredName).toBe('Circulation.BookCopies');
    expect(table.name).toBe('circulation.bookcopies');

    const proc = only('CREATE PROCEDURE usp_RenewLoan AS SELECT 1');
    expect(proc.kind).toBe('procedure');
    expect(proc.declaredName).toBe('usp_RenewLoan');
    expect(proc.name).toBe('dbo.usp_renewloan');

    const view = only('CREATE VIEW [dbo].[Ödünç Kaydı] AS SELECT 1 AS One');
    expect(view.declaredName).toBe('dbo.Ödünç Kaydı');
    expect(view.name).toBe('dbo.Ödünç kaydı');
  });

  it('recognizes every definition form with its kind', () => {
    const source = [
      'CREATE TABLE dbo.Books (Id INT)',
      'GO',
      'CREATE VIEW dbo.ShelfBooks AS SELECT Id FROM dbo.Books',
      'GO',
      'CREATE PROC dbo.usp_Shelve AS SELECT 1',
      'GO',
      'CREATE OR ALTER PROCEDURE dbo.usp_Lend AS SELECT 1',
      'GO',
      'CREATE FUNCTION dbo.fn_FineFor (@days INT) RETURNS INT AS BEGIN RETURN @days END',
      'GO',
      'ALTER VIEW dbo.LentBooks AS SELECT 1 AS One',
      'GO',
      'ALTER PROC dbo.usp_Return AS SELECT 1',
      'GO',
      'ALTER PROCEDURE dbo.usp_Renew AS SELECT 1',
      'GO',
      'ALTER FUNCTION dbo.fn_DueDate () RETURNS DATE AS BEGIN RETURN GETDATE() END',
      'GO',
      'create or alter view dbo.MemberBooks as select 1 as one',
    ].join('\n');
    expect(extractSqlDefinitions(source).definitions.map((d) => [d.kind, d.name])).toEqual([
      ['table', 'dbo.books'],
      ['view', 'dbo.shelfbooks'],
      ['procedure', 'dbo.usp_shelve'],
      ['procedure', 'dbo.usp_lend'],
      ['function', 'dbo.fn_finefor'],
      ['view', 'dbo.lentbooks'],
      ['procedure', 'dbo.usp_return'],
      ['procedure', 'dbo.usp_renew'],
      ['function', 'dbo.fn_duedate'],
      ['view', 'dbo.memberbooks'],
    ]);
  });

  it('definitions come in source order', () => {
    const source = 'CREATE VIEW dbo.Zeta AS SELECT 1 AS One\nGO\nCREATE TABLE dbo.Alpha (Id INT)\nGO\nCREATE PROC dbo.Mid AS SELECT 1';
    expect(extractSqlDefinitions(source).definitions.map((d) => d.name)).toEqual(['dbo.zeta', 'dbo.alpha', 'dbo.mid']);
  });

  it('table columns skip constraint elements and are sorted, unique and ASCII-folded', () => {
    const table = only(
      [
        'CREATE TABLE dbo.Fines (',
        '  [Id] INT NOT NULL,',
        '  MemberId INT NOT NULL,',
        '  Amount DECIMAL(9, 2) NOT NULL CHECK (Amount > 0),',
        '  [Üye Notu] NVARCHAR(100) NULL,',
        '  ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START,',
        '  ValidTo DATETIME2 GENERATED ALWAYS AS ROW END,',
        '  CONSTRAINT PK_Fines PRIMARY KEY (Id),',
        '  PRIMARY KEY NONCLUSTERED (MemberId),',
        '  UNIQUE (MemberId, Amount),',
        '  FOREIGN KEY (MemberId) REFERENCES dbo.Members (Id),',
        '  CHECK (Amount < 1000),',
        '  INDEX ix_Fines_Member (MemberId),',
        '  PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),',
        '  [ID] INT NULL',
        ')',
      ].join('\n'),
    );
    expect(table.columns).toEqual(['amount', 'id', 'memberid', 'validfrom', 'validto', 'Üye notu']);
    expect(table.accesses).toEqual([]);
  });

  it('adds ALTER TABLE ADD columns for a table defined in the same file', () => {
    const source = [
      'ALTER TABLE dbo.Books ADD Isbn CHAR(13) NULL',
      'GO',
      'CREATE TABLE dbo.Books (Id INT NOT NULL)',
      'GO',
      'ALTER TABLE dbo.Books WITH CHECK ADD CONSTRAINT CK_Books CHECK (Id > 0), Title NVARCHAR(200) NULL;',
      'ALTER TABLE dbo.Books ADD DEFAULT (0) FOR Id',
    ].join('\n');
    expect(only(source).columns).toEqual(['id', 'isbn', 'title']);
  });

  it('ignores ALTER TABLE ADD for a table defined elsewhere', () => {
    const source = [
      'CREATE TABLE dbo.Books (Id INT NOT NULL)',
      'GO',
      'ALTER TABLE dbo.Members ADD Email NVARCHAR(200) NULL',
      'GO',
      'ALTER TABLE Circulation.Books ADD Shelf INT NULL',
    ].join('\n');
    const { definitions } = extractSqlDefinitions(source);
    expect(definitions.map((d) => d.name)).toEqual(['dbo.books']);
    expect(definitions[0]!.columns).toEqual(['id']);
  });

  it('merges a CREATE and a later ALTER of the same view in one file', () => {
    const source = [
      'CREATE VIEW dbo.OpenLoans AS SELECT l.Id FROM dbo.Loans l WHERE l.ClosedAt IS NULL',
      'GO',
      'ALTER VIEW [dbo].[OPENLOANS] AS SELECT l.Id FROM dbo.Loans l JOIN dbo.Members m ON m.Id = l.MemberId',
      'GO',
    ].join('\n');
    const view = only(source);
    expect(view.kind).toBe('view');
    expect(view.declaredName).toBe('dbo.OpenLoans');
    expect(view.startLine).toBe(0);
    expect(view.endLine).toBe(0);
    expect(view.accesses).toEqual([
      { kind: 'reads', name: 'dbo.loans' },
      { kind: 'reads', name: 'dbo.members' },
    ]);
  });

  it('keeps a table and a view of the same name apart', () => {
    const source = 'CREATE TABLE dbo.Shelf (Id INT)\nGO\nCREATE VIEW dbo.Shelf AS SELECT 1 AS One';
    expect(extractSqlDefinitions(source).definitions.map((d) => d.kind)).toEqual(['table', 'view']);
  });

  it('ignores top-level DML outside definitions', () => {
    expect(extractSqlDefinitions('INSERT INTO dbo.Loans (Id) VALUES (1);\nUPDATE dbo.Members SET Blocked = 0;').definitions).toEqual([]);
    const source = [
      'SET NOCOUNT ON;',
      'INSERT INTO dbo.Loans (Id) VALUES (1);',
      'GO',
      'CREATE PROCEDURE dbo.usp_ListBooks AS SELECT * FROM dbo.Books',
      'GO',
      'DELETE FROM dbo.Fines;',
      'EXEC dbo.usp_ListBooks;',
      'GO',
    ].join('\n');
    expect(only(source).accesses).toEqual([{ kind: 'reads', name: 'dbo.books' }]);
  });

  it('a body ends at the next definition when GO is missing, but not at a temp table', () => {
    const source = [
      'CREATE PROCEDURE dbo.usp_Batch AS',
      'BEGIN',
      '  CREATE TABLE #work (Id INT);',
      '  INSERT INTO #work SELECT Id FROM dbo.Loans;',
      '  UPDATE dbo.Fines SET Paid = 1;',
      'END',
      'CREATE PROCEDURE dbo.usp_Next AS DELETE FROM dbo.Holds',
    ].join('\n');
    const { definitions } = extractSqlDefinitions(source);
    expect(definitions.map((d) => d.name)).toEqual(['dbo.usp_batch', 'dbo.usp_next']);
    expect(definitions[0]!.accesses).toEqual([
      { kind: 'reads', name: 'dbo.loans' },
      { kind: 'writes', name: 'dbo.fines' },
    ]);
    expect(definitions[0]!.endLine).toBe(5);
    expect(definitions[1]!.accesses).toEqual([{ kind: 'writes', name: 'dbo.holds' }]);
  });

  it('a permanent CREATE TABLE inside a procedure body is body text, not a definition', () => {
    const source = [
      'CREATE PROCEDURE dbo.usp_Setup AS',
      'BEGIN',
      '  CREATE TABLE dbo.LoanStaging (Id INT);',
      '  INSERT INTO dbo.LoanStaging SELECT Id FROM dbo.Loans;',
      '  UPDATE dbo.Members SET Blocked = 0;',
      'END',
    ].join('\n');
    const proc = only(source);
    expect([proc.kind, proc.name]).toEqual(['procedure', 'dbo.usp_setup']);
    expect(proc.columns).toEqual([]);
    expect(proc.accesses).toEqual([
      { kind: 'reads', name: 'dbo.loans' },
      { kind: 'writes', name: 'dbo.loanstaging' },
      { kind: 'writes', name: 'dbo.members' },
    ]);
    expect([proc.startLine, proc.endLine]).toEqual([0, 5]);
    expect(proc.endOffset).toBe(source.length);
  });

  it('table DDL in a view, procedure or function body adds no definition and no columns', () => {
    const source = [
      'CREATE TABLE dbo.LoanBatches (Id INT NOT NULL)',
      'GO',
      'CREATE PROCEDURE dbo.usp_Setup AS',
      'BEGIN',
      '  ALTER TABLE dbo.LoanBatches ADD Note NVARCHAR(100) NULL;',
      '  CREATE TABLE dbo.LoanBatches (Shelf INT);',
      '  CREATE TABLE dbo.LoanStaging (Id INT, LoanId INT REFERENCES dbo.Loans (Id) ON DELETE CASCADE ON UPDATE NO ACTION,',
      '    BatchId INT REFERENCES dbo.LoanBatches (Id) ON DELETE SET NULL);',
      '  UPDATE dbo.Members SET Blocked = 0;',
      'END',
      'GO',
      'CREATE FUNCTION dbo.fn_Batches () RETURNS INT AS BEGIN RETURN 1 END',
      'ALTER TABLE dbo.LoanBatches ADD Clerk INT NULL',
    ].join('\n');
    const { definitions } = extractSqlDefinitions(source);
    expect(definitions.map((d) => [d.kind, d.name])).toEqual([
      ['table', 'dbo.loanbatches'],
      ['procedure', 'dbo.usp_setup'],
      ['function', 'dbo.fn_batches'],
    ]);
    expect(definitions[0]!.columns).toEqual(['id']);
    // The foreign key actions in the body's CREATE TABLE are not writes.
    expect(definitions[1]!.accesses).toEqual([{ kind: 'writes', name: 'dbo.members' }]);
    expect(definitions[2]!.endLine).toBe(12);
  });

  it('a missing GO is still found after table DDL in a body', () => {
    const source = [
      'CREATE PROCEDURE dbo.usp_Setup AS',
      '  CREATE TABLE dbo.LoanStaging (Id INT)',
      '  INSERT INTO dbo.LoanStaging SELECT Id FROM dbo.Loans',
      'CREATE VIEW dbo.StagedLoans AS SELECT Id FROM dbo.LoanStaging',
    ].join('\n');
    const { definitions } = extractSqlDefinitions(source);
    expect(definitions.map((d) => [d.kind, d.name, d.endLine])).toEqual([
      ['procedure', 'dbo.usp_setup', 2],
      ['view', 'dbo.stagedloans', 3],
    ]);
  });

  it('SET NOCOUNT ON or SET XACT_ABORT ON without a semicolon keeps the DML after it in a body', () => {
    const source = [
      'CREATE PROCEDURE dbo.usp_CloseLoan @id INT',
      'AS',
      'BEGIN',
      '  SET NOCOUNT ON',
      '  UPDATE dbo.Loans SET ClosedAt = SYSUTCDATETIME() WHERE Id = @id',
      '  DELETE FROM dbo.Holds WHERE LoanId = @id',
      'END',
      'GO',
      'CREATE PROCEDURE dbo.usp_ExpireHolds',
      'AS',
      'SET XACT_ABORT ON',
      'DELETE dbo.Holds WHERE ExpiresAt < SYSUTCDATETIME()',
    ].join('\n');
    const [close, expire] = extractSqlDefinitions(source).definitions;
    expect(close!.accesses).toEqual([
      { kind: 'writes', name: 'dbo.holds' },
      { kind: 'writes', name: 'dbo.loans' },
    ]);
    expect(expire!.accesses).toEqual([{ kind: 'writes', name: 'dbo.holds' }]);
  });

  it('a foreign key action in ALTER TABLE ADD does not end the element list, while other DML does', () => {
    const source = [
      'CREATE TABLE dbo.Books (Id INT NOT NULL)',
      'GO',
      'ALTER TABLE dbo.Books ADD CONSTRAINT FK_Books_Shelves FOREIGN KEY (ShelfId) REFERENCES dbo.Shelves (Id)',
      '  ON DELETE SET NULL ON UPDATE NO ACTION, Isbn CHAR(13) NULL',
      'GO',
      'ALTER TABLE dbo.Books ADD Title NVARCHAR(200) NULL',
      'SET XACT_ABORT ON',
      "UPDATE dbo.Books SET Title = '', Shelf = 0",
    ].join('\n');
    expect(only(source).columns).toEqual(['id', 'isbn', 'title']);
  });

  it('skips definitions whose names the Names rule skips', () => {
    const source = [
      'CREATE TABLE #Scratch (Id INT)',
      'GO',
      'CREATE TABLE Library.dbo.Books (Id INT)',
      'GO',
      'CREATE VIEW sys.LoanView AS SELECT 1 AS One',
      'GO',
      'CREATE PROCEDURE [dbo].[usp.Dotted] AS SELECT 1',
    ].join('\n');
    expect(extractSqlDefinitions(source).definitions).toEqual([]);
  });

  it('spans run from CREATE to the end of the batch, 0-based', () => {
    const source = [
      'SET NOCOUNT ON;',
      'GO',
      '-- header comment',
      'CREATE PROCEDURE dbo.usp_A',
      'AS',
      'SELECT * FROM dbo.Loans;',
      '-- trailing comment',
      'GO',
      'CREATE VIEW dbo.V AS SELECT 1 AS One',
      'CREATE PROCEDURE dbo.usp_B AS SELECT 2',
    ].join('\n');
    const a = find(source, 'dbo.usp_a');
    expect([a.startLine, a.endLine]).toEqual([3, 5]);
    expect(a.startOffset).toBe(source.indexOf('CREATE PROCEDURE dbo.usp_A'));
    expect(a.endOffset).toBe(source.indexOf('Loans;') + 'Loans;'.length);
    expect(source.slice(a.startOffset, a.endOffset)).toBe('CREATE PROCEDURE dbo.usp_A\nAS\nSELECT * FROM dbo.Loans;');

    const v = find(source, 'dbo.v');
    expect([v.startLine, v.endLine]).toEqual([8, 8]);
    expect(source.slice(v.startOffset, v.endOffset)).toBe('CREATE VIEW dbo.V AS SELECT 1 AS One');

    const b = find(source, 'dbo.usp_b');
    expect([b.startLine, b.endLine]).toEqual([9, 9]);
    expect(b.endOffset).toBe(source.length);
  });

  it('a last token that spans lines sets the end line', () => {
    const def = only("CREATE VIEW dbo.Notes AS SELECT 'line one\r\nline two\nline three'");
    expect(def.startLine).toBe(0);
    expect(def.endLine).toBe(2);
  });

  it('tables have no accesses and bodies have no columns', () => {
    const source = 'CREATE TABLE dbo.Holds (Id INT, LoanId INT REFERENCES dbo.Loans (Id) ON DELETE CASCADE)\nGO\nCREATE VIEW dbo.H AS SELECT Id FROM dbo.Holds';
    const [table, view] = extractSqlDefinitions(source).definitions;
    expect(table!.accesses).toEqual([]);
    expect(table!.columns).toEqual(['id', 'loanid']);
    expect(view!.columns).toEqual([]);
    expect(view!.accesses).toEqual([{ kind: 'reads', name: 'dbo.holds' }]);
  });

  it('the same source twice gives deep-equal output', () => {
    const source = [
      'CREATE TABLE [dbo].[Loans] ([Id] INT, [MemberId] INT)',
      'GO',
      'CREATE PROCEDURE dbo.usp_X @id INT AS BEGIN UPDATE l SET l.Id = @id FROM dbo.Loans l; EXEC dbo.usp_Y; END',
    ].join('\r\n');
    expect(extractSqlDefinitions(source)).toEqual(extractSqlDefinitions(source));
    expect(JSON.stringify(extractSqlDefinitions(source))).toBe(JSON.stringify(extractSqlDefinitions(source)));
  });
});
