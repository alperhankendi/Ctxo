import { describe, it, expect } from 'vitest';
import { extractSqlAccesses } from '../accesses.js';
import type { SqlAccess } from '../types.js';

/** Access lists by kind, in the order the extractor returns them. */
function byKind(accesses: readonly SqlAccess[]): Record<string, string[]> {
  const out: Record<string, string[]> = { reads: [], writes: [], executes: [] };
  for (const a of accesses) out[a.kind]!.push(a.name);
  return out;
}

describe('extractSqlAccesses in procedureName mode', () => {
  it('a procedure name gives one executes access', () => {
    expect(extractSqlAccesses('[dbo].[usp_CloseLoan]', 'procedureName')).toEqual([
      { kind: 'executes', name: 'dbo.usp_closeloan' },
    ]);
    expect(extractSqlAccesses('usp_RenewLoan', 'procedureName')).toEqual([
      { kind: 'executes', name: 'dbo.usp_renewloan' },
    ]);
    expect(extractSqlAccesses('[dbo].[usp Close Loan]', 'procedureName')).toEqual([
      { kind: 'executes', name: 'dbo.usp close loan' },
    ]);
  });

  it('a procedure name with spaces outside brackets or more than two parts gives nothing', () => {
    expect(extractSqlAccesses('usp Close Loan', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('dbo.usp_CloseLoan @id', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('EXEC dbo.usp_CloseLoan', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('Library.dbo.usp_CloseLoan', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('srv.Library.dbo.usp_CloseLoan', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('#usp_Temp', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('', 'procedureName')).toEqual([]);
  });

  it('an unquoted reserved word is not a procedure name, while a delimited one is', () => {
    expect(extractSqlAccesses('SELECT', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('dbo.Select', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('exec.usp_CloseLoan', 'procedureName')).toEqual([]);
    expect(extractSqlAccesses('[dbo].[Select]', 'procedureName')).toEqual([{ kind: 'executes', name: 'dbo.select' }]);
  });

  it('statement is the default mode', () => {
    expect(extractSqlAccesses('dbo.usp_CloseLoan')).toEqual([]);
    expect(extractSqlAccesses('EXEC dbo.usp_CloseLoan')).toEqual(
      extractSqlAccesses('EXEC dbo.usp_CloseLoan', 'statement'),
    );
  });
});

describe('extractSqlAccesses in statement mode', () => {
  it('accesses are unique and sorted by kind, then name', () => {
    const sql = [
      'EXEC dbo.usp_RenewLoan;',
      'UPDATE dbo.Members SET Blocked = 1;',
      'SELECT * FROM dbo.Loans JOIN dbo.Books ON Books.Id = Loans.BookId;',
      'SELECT * FROM DBO.LOANS;',
      'INSERT INTO dbo.Fines (Id) VALUES (1);',
      'EXEC [dbo].[usp_AddFine];',
      'EXEC dbo.usp_RenewLoan;',
    ].join('\n');
    expect(extractSqlAccesses(sql)).toEqual([
      { kind: 'executes', name: 'dbo.usp_addfine' },
      { kind: 'executes', name: 'dbo.usp_renewloan' },
      { kind: 'reads', name: 'dbo.books' },
      { kind: 'reads', name: 'dbo.loans' },
      { kind: 'writes', name: 'dbo.fines' },
      { kind: 'writes', name: 'dbo.members' },
    ]);
  });

  it('malformed SQL (unbalanced parentheses) returns what it found without throwing', () => {
    expect(byKind(extractSqlAccesses('SELECT * FROM dbo.Loans WHERE Id IN (SELECT LoanId FROM dbo.Holds'))).toEqual({
      reads: ['dbo.holds', 'dbo.loans'],
      writes: [],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('SELECT * FROM dbo.Loans)) WHERE ((Id = 1'))).toEqual({
      reads: ['dbo.loans'],
      writes: [],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('EXEC dbo.usp_CloseLoan (((; DELETE FROM dbo.Fines'))).toEqual({
      reads: [],
      writes: ['dbo.fines'],
      executes: ['dbo.usp_closeloan'],
    });
    const garbage = [
      '(', ')', ';', ',', 'FROM', 'JOIN (', 'FROM (', 'UPDATE', 'DELETE TOP (1', 'INSERT TOP (', 'MERGE INTO',
      'EXEC @', 'EXEC @rc =', 'WITH x AS (', 'WITH x (a', 'TRUNCATE TABLE', 'SELECT * INTO', "SELECT 'x",
      'SELECT * FROM [dbo].[Loans', 'FETCH NEXT', 'FROM dbo.', 'FROM a..', ')))(((',
    ];
    for (const sql of garbage) expect(() => extractSqlAccesses(sql), sql).not.toThrow();
  });

  it('a cursor FOR UPDATE is not a DML target', () => {
    // The label after FOR UPDATE is not a reserved word, so only the FOR rule keeps it from being a target.
    const sql = ['DECLARE c CURSOR FOR SELECT Id FROM dbo.Loans FOR UPDATE', 'NextLoan:', 'FETCH NEXT FROM c INTO @id'].join('\n');
    expect(byKind(extractSqlAccesses(sql))).toEqual({ reads: ['dbo.loans'], writes: [], executes: [] });
    expect(byKind(extractSqlAccesses('DECLARE c CURSOR FOR SELECT Id FROM dbo.Loans FOR UPDATE OF ClosedAt'))).toEqual({
      reads: ['dbo.loans'],
      writes: [],
      executes: [],
    });
  });

  it('INSERT, UPDATE and DELETE after AFTER, INSTEAD OF or FOR in a trigger header are not DML targets', () => {
    // A real header puts a comma or a reserved word (AS, WITH, NOT) after the action, which already
    // stops a target. These headers end in a name instead, so only the AFTER, OF and FOR rules stop a write.
    expect(extractSqlAccesses('CREATE TRIGGER dbo.trg_LoanTouched ON dbo.Loans AFTER UPDATE LoanAudit')).toEqual([]);
    expect(extractSqlAccesses('CREATE TRIGGER dbo.trg_LoanKept ON dbo.Loans INSTEAD OF DELETE LoanAudit')).toEqual([]);
    expect(extractSqlAccesses('CREATE TRIGGER dbo.trg_LoanAny ON dbo.Loans FOR INSERT LoanAudit')).toEqual([]);
    // The usual header forms.
    expect(extractSqlAccesses('CREATE TRIGGER dbo.trg_LoanTouched ON dbo.Loans AFTER INSERT, UPDATE AS SELECT 1')).toEqual([]);
    expect(extractSqlAccesses('CREATE TRIGGER dbo.trg_LoanKept ON dbo.Loans INSTEAD OF DELETE AS SELECT 1')).toEqual([]);
    expect(extractSqlAccesses('CREATE TRIGGER dbo.trg_LoanAny ON dbo.Loans FOR INSERT, UPDATE, DELETE AS SELECT 1')).toEqual([]);
  });

  it('a MERGE action after THEN is not a separate DML statement', () => {
    // OUTPUT is not a reserved word, so only the THEN rule keeps it from being a DELETE target.
    const sql =
      'MERGE dbo.Holds AS t USING dbo.HoldStaging AS s ON t.Id = s.Id ' +
      'WHEN NOT MATCHED BY SOURCE THEN DELETE OUTPUT deleted.Id INTO dbo.HoldArchive (Id);';
    expect(byKind(extractSqlAccesses(sql))).toEqual({
      reads: ['dbo.holdstaging'],
      writes: ['dbo.holdarchive', 'dbo.holds'],
      executes: [],
    });
  });

  it('UPDATE(column) is a trigger function, not a DML statement', () => {
    // As a statement, UPDATE( would end the open UPDATE before its FROM clause, and l would read as dbo.l.
    const sql = 'UPDATE l SET l.Flagged = CASE WHEN UPDATE(ClosedAt) THEN 1 ELSE 0 END FROM dbo.Loans AS l';
    expect(byKind(extractSqlAccesses(sql))).toEqual({ reads: ['dbo.loans'], writes: ['dbo.loans'], executes: [] });
    expect(extractSqlAccesses("IF UPDATE(ClosedAt) PRINT 'closed'")).toEqual([]);
  });

  it('UPDATE STATISTICS is not a DML target, while a delimited [Statistics] table is', () => {
    expect(extractSqlAccesses('UPDATE STATISTICS dbo.Loans WITH FULLSCAN')).toEqual([]);
    expect(byKind(extractSqlAccesses('UPDATE [Statistics] SET LoanCount = 0'))).toEqual({
      reads: [],
      writes: ['dbo.statistics'],
      executes: [],
    });
  });

  it('ON DELETE and ON UPDATE foreign key actions are not DML targets', () => {
    // NO is not a reserved word, so without the foreign key rule ON UPDATE NO ACTION would write dbo.no.
    expect(
      extractSqlAccesses(
        'CREATE TABLE dbo.Fines (Id INT, ' +
          'LoanId INT REFERENCES dbo.Loans (Id) ON DELETE CASCADE ON UPDATE NO ACTION, ' +
          'MemberId INT REFERENCES dbo.Members (Id) ON DELETE SET NULL ON UPDATE SET DEFAULT)',
      ),
    ).toEqual([]);
    expect(
      extractSqlAccesses(
        'ALTER TABLE dbo.Fines ADD CONSTRAINT FK_Fines_Loans FOREIGN KEY (LoanId) REFERENCES dbo.Loans (Id) ON DELETE NO ACTION',
      ),
    ).toEqual([]);
    expect(extractSqlAccesses('GRANT INSERT, UPDATE, DELETE ON dbo.Fines TO librarian')).toEqual([]);
    expect(extractSqlAccesses('GRANT EXECUTE ON dbo.usp_CloseLoan TO librarian')).toEqual([]);
  });

  it('DML after a SET option that ends in ON is still DML', () => {
    const cases: Array<[string, string]> = [
      ['SET NOCOUNT ON\nUPDATE dbo.Loans SET ClosedAt = GETDATE() WHERE Id = @id', 'dbo.loans'],
      ['SET NOCOUNT ON\nDELETE FROM dbo.Holds WHERE LoanId = @id', 'dbo.holds'],
      ['SET XACT_ABORT ON\nDELETE dbo.Holds WHERE LoanId = @id', 'dbo.holds'],
      ['SET NOCOUNT ON\nINSERT dbo.LoanEvents (LoanId) VALUES (@id)', 'dbo.loanevents'],
      ['SET IDENTITY_INSERT dbo.Loans ON\nINSERT INTO dbo.Loans (Id) VALUES (1)\nSET IDENTITY_INSERT dbo.Loans OFF', 'dbo.loans'],
      ['SET XACT_ABORT ON\nUPDATE l SET l.Flagged = 1 FROM dbo.Loans AS l', 'dbo.loans'],
    ];
    for (const [sql, table] of cases) expect(byKind(extractSqlAccesses(sql)).writes, sql).toEqual([table]);
  });

  it('TOP (n), TOP (n) PERCENT and TOP (expression) may precede the DML target', () => {
    const cases: Array<[string, Record<string, string[]>]> = [
      ['DELETE TOP (10) FROM dbo.Holds WHERE ExpiresAt < @now', { reads: [], writes: ['dbo.holds'], executes: [] }],
      ['DELETE TOP (10) dbo.Holds WHERE ExpiresAt < @now', { reads: [], writes: ['dbo.holds'], executes: [] }],
      ['DELETE TOP (@batch) FROM dbo.Holds', { reads: [], writes: ['dbo.holds'], executes: [] }],
      ['UPDATE TOP (5) PERCENT dbo.Fines SET Paid = 1', { reads: [], writes: ['dbo.fines'], executes: [] }],
      [
        'INSERT TOP (1) INTO dbo.LoanArchive (Id) SELECT Id FROM dbo.Loans',
        { reads: ['dbo.loans'], writes: ['dbo.loanarchive'], executes: [] },
      ],
      [
        'DELETE TOP (SELECT COUNT(*) FROM dbo.Members) FROM dbo.Books',
        { reads: ['dbo.members'], writes: ['dbo.books'], executes: [] },
      ],
    ];
    for (const [sql, want] of cases) expect(byKind(extractSqlAccesses(sql)), sql).toEqual(want);
  });

  it('a one-part UPDATE or DELETE target that is not an alias gets the dbo schema', () => {
    expect(byKind(extractSqlAccesses('UPDATE Fines SET Paid = 1 FROM dbo.Members m WHERE m.Id = Fines.MemberId'))).toEqual({
      reads: ['dbo.members'],
      writes: ['dbo.fines'],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('DELETE f FROM dbo.Fines AS F WHERE F.Paid = 1'))).toEqual({
      reads: ['dbo.fines'],
      writes: ['dbo.fines'],
      executes: [],
    });
  });

  it('an alias of a derived table, temp table or table variable gives no write', () => {
    expect(byKind(extractSqlAccesses('UPDATE x SET Paid = 1 FROM (SELECT * FROM dbo.Fines) AS x'))).toEqual({
      reads: ['dbo.fines'],
      writes: [],
      executes: [],
    });
    expect(extractSqlAccesses('DELETE t FROM #LateLoans t; UPDATE v SET Paid = 1 FROM @Fines v')).toEqual([]);
  });

  it('a comma list in FROM is read, while commas in other clauses are not tables', () => {
    expect(byKind(extractSqlAccesses('SELECT l.Id, m.Name FROM dbo.Loans l, dbo.Members AS m, dbo.Books WHERE l.MemberId = m.Id ORDER BY l.Id, m.Name'))).toEqual({
      reads: ['dbo.books', 'dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('SELECT Kind, COUNT(*) FROM dbo.Loans GROUP BY Kind, MemberId'))).toEqual({
      reads: ['dbo.loans'],
      writes: [],
      executes: [],
    });
  });

  it('a parenthesized join reads every table in it', () => {
    expect(byKind(extractSqlAccesses('SELECT * FROM (dbo.Loans l JOIN dbo.Members m ON m.Id = l.MemberId) JOIN dbo.Books b ON b.Id = l.BookId'))).toEqual({
      reads: ['dbo.books', 'dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('a nested parenthesized join after FROM reads its first table', () => {
    const sql =
      'SELECT l.Id FROM ((dbo.Loans l INNER JOIN dbo.Members m ON m.Id = l.MemberId) ' +
      'INNER JOIN dbo.Books b ON b.Id = l.BookId)';
    expect(byKind(extractSqlAccesses(sql))).toEqual({
      reads: ['dbo.books', 'dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('an UPDATE alias defined in a nested parenthesized join is the aliased table', () => {
    const sql =
      'UPDATE l SET l.Flagged = 1 FROM ((dbo.Loans l JOIN dbo.Members m ON m.Id = l.MemberId) ' +
      'JOIN dbo.Books b ON b.Id = l.BookId)';
    expect(byKind(extractSqlAccesses(sql))).toEqual({
      reads: ['dbo.books', 'dbo.loans', 'dbo.members'],
      writes: ['dbo.loans'],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('DELETE h FROM (((dbo.Holds h JOIN dbo.Loans l ON l.Id = h.LoanId)))'))).toEqual({
      reads: ['dbo.holds', 'dbo.loans'],
      writes: ['dbo.holds'],
      executes: [],
    });
  });

  it('a doubly parenthesized join after JOIN reads every table in it', () => {
    const sql =
      'SELECT * FROM dbo.Loans l JOIN ((dbo.Members m JOIN dbo.Books b ON b.Id = m.FavoriteBookId)) ON m.Id = l.MemberId';
    expect(byKind(extractSqlAccesses(sql))).toEqual({
      reads: ['dbo.books', 'dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('a derived table inside a parenthesized join is still a derived table', () => {
    const sql = 'UPDATE l SET Flagged = 1 FROM ((SELECT Id, MemberId FROM dbo.Loans) AS l JOIN dbo.Members m ON m.Id = l.MemberId)';
    expect(byKind(extractSqlAccesses(sql))).toEqual({
      reads: ['dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('FETCH ... FROM a cursor is not a read', () => {
    expect(extractSqlAccesses('FETCH NEXT FROM loan_cursor INTO @id')).toEqual([]);
    expect(extractSqlAccesses('FETCH ABSOLUTE 3 FROM loan_cursor INTO @id')).toEqual([]);
    expect(byKind(extractSqlAccesses('SELECT * FROM dbo.Loans ORDER BY Id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY'))).toEqual({
      reads: ['dbo.loans'],
      writes: [],
      executes: [],
    });
  });

  it('a CTE name is skipped up to the next top-level semicolon or the end of the batch', () => {
    expect(byKind(extractSqlAccesses('WITH Active AS (SELECT * FROM dbo.Loans) SELECT * FROM Active; SELECT * FROM Active'))).toEqual({
      reads: ['dbo.active', 'dbo.loans'],
      writes: [],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('WITH Active (Id) AS (SELECT Id FROM dbo.Loans) SELECT * FROM [ACTIVE]\nGO\nSELECT * FROM Active'))).toEqual({
      reads: ['dbo.active', 'dbo.loans'],
      writes: [],
      executes: [],
    });
    expect(byKind(extractSqlAccesses('WITH Late AS (SELECT * FROM dbo.Loans) UPDATE Late SET Flag = 1; DELETE Late'))).toEqual({
      reads: ['dbo.loans'],
      writes: ['dbo.late'],
      executes: [],
    });
  });

  it('table options and hints after WITH are not CTEs', () => {
    expect(byKind(extractSqlAccesses('SELECT * FROM dbo.Loans AS l WITH (NOLOCK, INDEX(ix_Loans_Member)), dbo.Members m WITH (NOLOCK)'))).toEqual({
      reads: ['dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('a MERGE join hint is not a MERGE statement', () => {
    expect(byKind(extractSqlAccesses('SELECT * FROM dbo.Loans l INNER MERGE JOIN dbo.Members m ON m.Id = l.MemberId OPTION (MERGE JOIN)'))).toEqual({
      reads: ['dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('MERGE INTO with TOP and a USING derived table', () => {
    const sql =
      'MERGE TOP (100) INTO dbo.Fines AS f USING (SELECT LoanId FROM dbo.Loans WHERE Late = 1) AS s ON f.LoanId = s.LoanId ' +
      'WHEN NOT MATCHED BY TARGET THEN INSERT (LoanId) VALUES (s.LoanId) WHEN NOT MATCHED BY SOURCE THEN DELETE;';
    expect(byKind(extractSqlAccesses(sql))).toEqual({
      reads: ['dbo.loans'],
      writes: ['dbo.fines'],
      executes: [],
    });
  });

  it('a leading UTF-8 byte order mark is ignored in both modes', () => {
    expect(extractSqlAccesses('\uFEFFUPDATE dbo.Loans SET ClosedAt = GETDATE()')).toEqual([{ kind: 'writes', name: 'dbo.loans' }]);
    // In procedureName mode the whole text must be one name, so a byte order mark read as a token would leave none.
    expect(extractSqlAccesses('\uFEFF[dbo].[usp_CloseLoan]', 'procedureName')).toEqual([
      { kind: 'executes', name: 'dbo.usp_closeloan' },
    ]);
  });
});
