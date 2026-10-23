import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const HELPER_DIR = resolve(import.meta.dirname, '../../tools/ctxo-roslyn');
const CORPUS_DIR = resolve(import.meta.dirname, '../../../sql-extract/corpus');

interface AccessLists { reads: string[]; writes: string[]; executes: string[] }
interface CorpusCase { name: string; mode: string; sides: string[]; accesses: AccessLists }
interface SqlExtractLine extends AccessLists { type: 'sqlExtract'; file: string; errors: number }
interface SqlNameLine { type: 'sqlName'; file: string; name: string | null }

const DEFAULT_SIDES: Record<string, string[]> = {
  statement: ['sql-extract', 'scriptdom'],
  file: ['sql-extract', 'lang-sql', 'scriptdom'],
};

/**
 * The statement and file cases whose sides include scriptdom. Host-language cases (PR 1C) have
 * other modes, no sides and no .sql file, so the selection reads `mode` and `sides`, never the
 * file extension alone.
 */
function scriptDomCases(): CorpusCase[] {
  return readdirSync(CORPUS_DIR)
    .filter(f => f.endsWith('.expected.json'))
    .sort()
    .map(f => {
      const raw = JSON.parse(readFileSync(join(CORPUS_DIR, f), 'utf-8')) as Omit<CorpusCase, 'name' | 'sides'> & { sides?: string[] };
      return { ...raw, name: f.slice(0, -'.expected.json'.length), sides: raw.sides ?? DEFAULT_SIDES[raw.mode] ?? [] };
    })
    .filter(c => (c.mode === 'statement' || c.mode === 'file') && c.sides.includes('scriptdom'));
}

/** Runs the helper once in the given mode and returns its JSON lines of that type, keyed by file as given. */
function runHelper<T extends { type: string; file: string }>(mode: string, files: string[], type: T['type']): Map<string, T> {
  const stdout = execFileSync('dotnet', ['run', '--project', HELPER_DIR, '--', mode, ...files], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const lines = new Map<string, T>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    const parsed = JSON.parse(line) as T;
    if (parsed.type === type) lines.set(parsed.file, parsed);
  }
  return lines;
}

const accessesOf = (line: SqlExtractLine | undefined) =>
  line && { errors: line.errors, reads: line.reads, writes: line.writes, executes: line.executes };

const cases = scriptDomCases();
const caseFile = (c: CorpusCase) => join(CORPUS_DIR, `${c.name}.sql`);

describe.skipIf(!HAS_DOTNET)('ScriptDom side of the SQL conformance corpus', () => {
  let tempDir: string;
  let lines: Map<string, SqlExtractLine>;
  const crlfFile = (c: CorpusCase) => join(tempDir, 'crlf', `${c.name}.sql`);
  const extra = {
    utf16le: () => join(tempDir, 'non-ascii-names.utf16le.sql'),
    utf16be: () => join(tempDir, 'non-ascii-names.utf16be.sql'),
    utf8bom: () => join(tempDir, 'non-ascii-names.utf8bom.sql'),
    dapper: () => join(tempDir, 'dapper-boundaries.sql'),
    reserved: () => join(tempDir, 'reserved-words.sql'),
    bareProcedure: () => join(tempDir, 'bare-procedure.sql'),
    unparsable: () => join(tempDir, 'unparsable.sql'),
  };

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-sql-corpus-'));
    mkdirSync(join(tempDir, 'crlf'));
    for (const c of cases) writeFileSync(crlfFile(c), readFileSync(caseFile(c), 'utf-8').replace(/\n/g, '\r\n'));

    const nonAscii = readFileSync(join(CORPUS_DIR, 'non-ascii-names.sql'), 'utf-8');
    const le = Buffer.from(`\uFEFF${nonAscii}`, 'utf16le');
    writeFileSync(extra.utf16le(), le);
    writeFileSync(extra.utf16be(), Buffer.from(le).swap16());
    writeFileSync(extra.utf8bom(), `\uFEFF${nonAscii}`, 'utf-8');
    writeFileSync(extra.dapper(), [
      // JOIN ends in IN and a table variable follows it: only the IN predicates are rewritten.
      'SELECT * FROM dbo.Loans AS l JOIN @Ids AS i ON i.Id = l.Id',
      'WHERE l.MemberId NOT IN @members AND l.BookId in @books',
      // A delimited name is not code, so its text is kept as written, with or without the space.
      'SELECT * FROM [Holds IN @branch]',
      'SELECT * FROM [Fines IN@branch]',
      // A word that only starts with IN is not the keyword.
      'SELECT * FROM dbo.Members AS m WHERE m.Id = 1 OR INDEXED@x = 1',
    ].join('\n'));
    // ScriptDom accepts a few reserved words (DISK, DUMP, LOAD, PRECISION, SECURITYAUDIT, WITHIN)
    // as unquoted names; sql-extract never starts a name with a reserved word.
    writeFileSync(extra.reserved(), [
      'SELECT * FROM Within;',
      'SELECT * FROM dbo.Within;',
      'EXEC Load.usp_Renew;',
      'EXEC dbo.Load;',
      'UPDATE Disk SET Id = 1 FROM dbo.Loans AS Disk;',
      'INSERT INTO dbo.Dump (Id) VALUES (1)',
    ].join('\n'));
    // ScriptDom also parses a bare procedure name at the start of a batch as an execute.
    writeFileSync(extra.bareProcedure(), 'usp_Audit @id = 1');
    writeFileSync(extra.unparsable(), 'SELECT * FROM dbo.Loans WHERE (');

    const files = [
      ...cases.map(caseFile),
      ...cases.map(crlfFile),
      ...Object.values(extra).map(f => f()),
    ];
    lines = runHelper<SqlExtractLine>('--sql-extract', files, 'sqlExtract');
  }, 180_000);

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('the corpus has ScriptDom cases and the helper prints one line per file', () => {
    expect(cases.length).toBeGreaterThan(20);
    expect(cases.map(c => c.name)).not.toContain('missing-go');
    expect(lines.size).toBe(cases.length * 2 + Object.keys(extra).length);
  });

  it.each(cases)('$name: ScriptDom accesses match the corpus', (c) => {
    expect(accessesOf(lines.get(caseFile(c)))).toEqual({ errors: 0, ...c.accesses });
  });

  it.each(cases)('$name: CRLF line endings give the same ScriptDom accesses', (c) => {
    expect(accessesOf(lines.get(crlfFile(c)))).toEqual({ errors: 0, ...c.accesses });
  });

  it('UTF-16 LE, UTF-16 BE and UTF-8 files with a byte order mark read like plain UTF-8', () => {
    const plain = cases.find(c => c.name === 'non-ascii-names')!;
    for (const file of [extra.utf16le(), extra.utf16be(), extra.utf8bom()]) {
      expect(accessesOf(lines.get(file)), file).toEqual({ errors: 0, ...plain.accesses });
    }
  });

  it('Dapper IN @p is rewritten only after the IN keyword and only outside delimited names', () => {
    expect(accessesOf(lines.get(extra.dapper()))).toEqual({
      errors: 0,
      reads: ['dbo.fines in@branch', 'dbo.holds in @branch', 'dbo.loans', 'dbo.members'],
      writes: [],
      executes: [],
    });
  });

  it('a name never starts with an unquoted reserved word, as in sql-extract', () => {
    expect(accessesOf(lines.get(extra.reserved()))).toEqual({
      errors: 0,
      reads: ['dbo.loans', 'dbo.within'],
      writes: ['dbo.dump'],
      executes: ['dbo.load'],
    });
  });

  it('a bare procedure name without EXEC is not an access', () => {
    expect(accessesOf(lines.get(extra.bareProcedure()))).toEqual({ errors: 0, reads: [], writes: [], executes: [] });
  });

  it('unparsable text reports its parser errors and no accesses, and the run goes on', () => {
    const line = lines.get(extra.unparsable());
    expect(line?.errors).toBeGreaterThan(0);
    expect(accessesOf(line)).toMatchObject({ reads: [], writes: [], executes: [] });
  });
});

/**
 * Name texts and their canonical form in sql-extract (`canonicalSqlName` in names.test.ts and
 * procedureName mode in accesses.test.ts): ScriptDom's side must give the same bytes.
 */
const NAME_CASES: Array<[string, string | null]> = [
  ['[dbo].[Loan Items]', 'dbo.loan items'],
  ['Loans', 'dbo.loans'],
  ['"Circulation"."Holds"', 'circulation.holds'],
  ['[dbo].[usp_CloseLoan]', 'dbo.usp_closeloan'],
  ['usp_RenewLoan', 'dbo.usp_renewloan'],
  ['[dbo].[usp Close Loan]', 'dbo.usp close loan'],
  ['\uFEFF[dbo].[usp_CloseLoan]', 'dbo.usp_closeloan'],
  ['OtherDb.dbo.Loans', null],
  ['srv.db.dbo.Loans', null],
  ['Library.dbo.usp_CloseLoan', null],
  ['srv.Library.dbo.usp_CloseLoan', null],
  ['#tmp', null],
  ['##g', null],
  ['#usp_Temp', null],
  ['@t', null],
  ['sys.tables', null],
  ['INFORMATION_SCHEMA.COLUMNS', null],
  ['[SYS].[Objects]', null],
  ['[dbo].[Ödünç Kaydı]', 'dbo.Ödünç kaydı'],
  ['KİTAP', 'dbo.kİtap'],
  ['ÜYE', 'dbo.Üye'],
  ['[Üye].[Ödünç Kaydı]', 'Üye.Ödünç kaydı'],
  ['[KİTAP ıI ßS]', 'dbo.kİtap ıi ßs'],
  ['', null],
  ['a.', null],
  ['.a', null],
  ['a..b', null],
  ['a b', null],
  ["'a'", null],
  ['usp Close Loan', null],
  ['dbo.usp_CloseLoan @id', null],
  ['EXEC dbo.usp_CloseLoan', null],
  ['SELECT', null],
  ['dbo.Table', null],
  ['dbo.Select', null],
  ['exec.usp_CloseLoan', null],
  ['[dbo].[Table]', 'dbo.table'],
  ['[dbo].[Select]', 'dbo.select'],
  ['"Exec".usp_CloseLoan', 'exec.usp_closeloan'],
  ['[dbo].[Loans.Archive]', null],
  ['[Loans.Archive]', null],
  ['"dbo"."Loans.Archive"', null],
  ['[dbo].[Loans]', 'dbo.loans'],
  ['[dbo].[a::table]', null],
  ['[x::y].Loans', null],
  // Reserved words ScriptDom would accept as names.
  ['DISK', null],
  ['dbo.Within', null],
  ['dbo.Dump', null],
  ['Load.usp_Renew', null],
  ['[Disk]', 'dbo.disk'],
  ['dbo.[Precision]', 'dbo.precision'],
  // GO separates batches only alone on its line; elsewhere it is a word.
  ['GO', null],
  ['GO 2', null],
  ['GO -- end', null],
  ['dbo.\nGO', null],
  ['GO\n.Loans', null],
  ['GO.Loans', 'go.loans'],
  ['go .Loans', 'go.loans'],
  ['/* c */ GO.Loans', 'go.loans'],
  ['dbo.GO', 'dbo.go'],
];

describe('SQL reserved words', () => {
  /** Every quoted word in the first block of `source` that `pattern` captures. */
  function wordsIn(path: string, pattern: RegExp): string[] {
    const block = pattern.exec(readFileSync(path, 'utf-8'))?.[1] ?? '';
    return [...block.matchAll(/['"]([A-Z_]+)['"]/g)].map(m => m[1]!).sort();
  }

  it('SqlText.cs carries the same reserved words as sql-extract', () => {
    const ts = wordsIn(resolve(CORPUS_DIR, '../src/keywords.ts'), /RESERVED_WORDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
    const cs = wordsIn(resolve(HELPER_DIR, 'SqlText.cs'), /ReservedWords\s*=\s*new\(StringComparer\.Ordinal\)\s*\{([\s\S]*?)\};/);
    expect(ts.length).toBeGreaterThan(150);
    expect(cs).toEqual(ts);
  });
});

describe.skipIf(!HAS_DOTNET)('ScriptDom side of the SQL name rules', () => {
  let tempDir: string;
  let lines: Map<string, SqlNameLine>;
  const nameFile = (i: number) => join(tempDir, `name-${i}.txt`);

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-sql-names-'));
    NAME_CASES.forEach(([text], i) => writeFileSync(nameFile(i), text, 'utf-8'));
    lines = runHelper<SqlNameLine>('--sql-name', NAME_CASES.map((_, i) => nameFile(i)), 'sqlName');
  }, 180_000);

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('CanonicalName gives the sql-extract canonical name, byte for byte, for every name text', () => {
    const actual = Object.fromEntries(NAME_CASES.map(([text], i) => [text, lines.get(nameFile(i))?.name]));
    const expected = Object.fromEntries(NAME_CASES);
    expect(actual).toEqual(expected);
  });
});
