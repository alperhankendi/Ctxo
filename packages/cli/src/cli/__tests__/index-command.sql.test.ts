import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileChangeHandler } from '../../ports/i-watcher-port.js';

// The real file watcher would hold the process open; the test feeds change events through this one.
const watcherHandlers = vi.hoisted(() => [] as Array<(event: 'add' | 'change' | 'unlink', filePath: string) => void>);
vi.mock('../../adapters/watcher/chokidar-watcher-adapter.js', () => ({
  ChokidarWatcherAdapter: class {
    start(handler: FileChangeHandler): void {
      watcherHandlers.push(handler);
    }
    async stop(): Promise<void> {}
  },
}));

import { IndexCommand } from '../index-command.js';
import { WatchCommand } from '../watch-command.js';
import { JsonIndexReader } from '../../adapters/storage/json-index-reader.js';
import { loadGraph } from '../graph-loader.js';
import { BlastRadiusCalculator } from '../../core/blast-radius/blast-radius-calculator.js';
import { ContentHasher } from '../../core/staleness/content-hasher.js';
import type { FileIndex } from '../../core/types.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';
import { cleanupTempProjects, createProject, type TempProject } from './helpers/temp-project.js';

// Synthetic library-lending schema. The two tables are saved the way SSMS saves a script: UTF-16 LE
// with a BOM and CRLF line ends. The procedure is plain UTF-8.
const LOANS_SQL = [
  'CREATE TABLE dbo.Loans (',
  '  LoanId int NOT NULL PRIMARY KEY,',
  '  MemberId int NOT NULL,',
  '  BookId int NOT NULL,',
  '  ReturnedOn date NULL',
  ');',
  '',
].join('\r\n');

const MEMBERS_SQL = [
  'CREATE TABLE dbo.Members (',
  '  MemberId int NOT NULL PRIMARY KEY,',
  '  FullName nvarchar(100) NOT NULL,',
  '  Active bit NOT NULL',
  ');',
  '',
].join('\r\n');

const CLOSE_LOAN_SQL = [
  'CREATE PROCEDURE dbo.usp_CloseLoan @LoanId int',
  'AS',
  'BEGIN',
  '  UPDATE dbo.Loans SET ReturnedOn = GETDATE() WHERE LoanId = @LoanId;',
  '  SELECT m.FullName FROM dbo.Members AS m WHERE m.Active = 1;',
  'END',
  '',
].join('\n');

const LOANS_FILE = 'db/tables/Loans.sql';
const MEMBERS_FILE = 'db/tables/Members.sql';
const CLOSE_LOAN_FILE = 'db/procs/usp_CloseLoan.sql';

const LOANS_ID = `${LOANS_FILE}::dbo.loans::table`;
const MEMBERS_ID = `${MEMBERS_FILE}::dbo.members::table`;
const CLOSE_LOAN_ID = `${CLOSE_LOAN_FILE}::dbo.usp_closeloan::procedure`;

function utf16leWithBom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function writeBytes(project: TempProject, file: string, bytes: Buffer | string): void {
  const full = join(project.dir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

function entryFor(dir: string, file: string): FileIndex {
  const entry = new JsonIndexReader(join(dir, '.ctxo')).readAll().find((e) => e.file === file);
  if (!entry) throw new Error(`no index entry for ${file}`);
  return entry;
}

describe('IndexCommand with the real @ctxo/lang-sql plugin', () => {
  let project: TempProject;
  let errorSpy: MockInstance<typeof console.error>;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    project = createProject();
    writeBytes(project, LOANS_FILE, utf16leWithBom(LOANS_SQL));
    writeBytes(project, MEMBERS_FILE, utf16leWithBom(MEMBERS_SQL));
    writeBytes(project, CLOSE_LOAN_FILE, CLOSE_LOAN_SQL);
    project.commit('add library schema');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    cleanupTempProjects();
  });

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  it('indexes .sql definitions as table and procedure symbols with a columns annotation', async () => {
    await new IndexCommand(project.dir).run({ skipHistory: true });

    const loans = entryFor(project.dir, LOANS_FILE);
    expect(loans.symbols).toEqual([
      {
        symbolId: LOANS_ID,
        name: 'dbo.Loans',
        kind: 'table',
        startLine: 0,
        endLine: 5,
        startOffset: 0,
        endOffset: 138,
        annotations: [{ name: 'columns', args: ['bookid', 'loanid', 'memberid', 'returnedon'] }],
      },
    ]);

    const members = entryFor(project.dir, MEMBERS_FILE);
    expect(members.symbols).toHaveLength(1);
    expect(members.symbols[0]).toMatchObject({
      symbolId: MEMBERS_ID,
      name: 'dbo.Members',
      kind: 'table',
      annotations: [{ name: 'columns', args: ['active', 'fullname', 'memberid'] }],
    });

    const closeLoan = entryFor(project.dir, CLOSE_LOAN_FILE);
    expect(closeLoan.symbols).toHaveLength(1);
    expect(closeLoan.symbols[0]).toMatchObject({ symbolId: CLOSE_LOAN_ID, name: 'dbo.usp_CloseLoan', kind: 'procedure' });
    expect(closeLoan.symbols[0]!.annotations).toBeUndefined();
  });

  it('procedure accesses resolve to the table nodes and make the procedure a confirmed dependent', async () => {
    await new IndexCommand(project.dir).run({ skipHistory: true });

    // The index keeps the canonical 2-part names; the graph resolves them to the table nodes.
    const closeLoan = entryFor(project.dir, CLOSE_LOAN_FILE);
    expect(closeLoan.edges).toEqual([
      { from: CLOSE_LOAN_ID, to: 'dbo.members::table', kind: 'reads' },
      { from: CLOSE_LOAN_ID, to: 'dbo.loans::table', kind: 'writes' },
    ]);

    const { graph } = loadGraph(join(project.dir, '.ctxo'));
    expect(graph.getForwardEdges(CLOSE_LOAN_ID)).toEqual(
      expect.arrayContaining([
        { from: CLOSE_LOAN_ID, to: MEMBERS_ID, kind: 'reads' },
        { from: CLOSE_LOAN_ID, to: LOANS_ID, kind: 'writes' },
      ]),
    );
    const result = new BlastRadiusCalculator().calculate(graph, LOANS_ID);
    expect(result.confirmedCount).toBe(1);
    expect(result.impactedSymbols).toHaveLength(1);
    expect(result.impactedSymbols[0]).toMatchObject({
      symbolId: CLOSE_LOAN_ID,
      confidence: 'confirmed',
      depth: 1,
      edgeKinds: ['writes'],
    });
  });

  it('a UTF-16 LE file indexes like UTF-8 and ctxo index --check reports it fresh', async () => {
    await new IndexCommand(project.dir).run({ skipHistory: true });

    // The BOM is not part of the text: the hash and the offsets are those of the decoded script.
    const hasher = new ContentHasher();
    expect(entryFor(project.dir, LOANS_FILE).contentHash).toBe(hasher.hash(LOANS_SQL));
    expect(entryFor(project.dir, MEMBERS_FILE).contentHash).toBe(hasher.hash(MEMBERS_SQL));
    expect(entryFor(project.dir, CLOSE_LOAN_FILE).contentHash).toBe(hasher.hash(CLOSE_LOAN_SQL));
    expect(entryFor(project.dir, LOANS_FILE).symbols[0]).toMatchObject({ startOffset: 0 });

    // A newer mtime sends --check down the hash path, which must decode the file the same way.
    const later = new Date(Date.now() + 120_000);
    for (const file of [LOANS_FILE, MEMBERS_FILE, CLOSE_LOAN_FILE]) utimesSync(join(project.dir, file), later, later);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy.mockClear();
    await new IndexCommand(project.dir).run({ check: true });

    expect(stderr()).toContain('Index is up to date');
    expect(stderr()).not.toContain('STALE');
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('a UTF-8 file with a BOM indexes and ctxo index --check reports it fresh', async () => {
    const FINES_FILE = 'db/tables/Fines.sql';
    const FINES_SQL = ['CREATE TABLE dbo.Fines (', '  FineId int NOT NULL,', '  LoanId int NOT NULL', ');', ''].join('\n');
    writeBytes(project, FINES_FILE, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(FINES_SQL, 'utf-8')]));
    project.commit('add fines');
    await new IndexCommand(project.dir).run({ skipHistory: true });

    const fines = entryFor(project.dir, FINES_FILE);
    expect(fines.symbols).toHaveLength(1);
    expect(fines.symbols[0]).toMatchObject({
      symbolId: `${FINES_FILE}::dbo.fines::table`,
      kind: 'table',
      annotations: [{ name: 'columns', args: ['fineid', 'loanid'] }],
    });
    // A UTF-8 BOM stays in the text, as readFileSync gives it, so the hash is that of the BOM and the script.
    expect(fines.contentHash).toBe(new ContentHasher().hash(String.fromCharCode(0xfeff) + FINES_SQL));

    // A newer mtime sends --check down the hash path, which must read the file the same way.
    const later = new Date(Date.now() + 120_000);
    utimesSync(join(project.dir, FINES_FILE), later, later);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy.mockClear();
    await new IndexCommand(project.dir).run({ check: true });

    expect(stderr()).toContain('Index is up to date');
    expect(stderr()).not.toContain('STALE');
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('the same script saved as UTF-16 LE and as UTF-8 gives the same symbols', async () => {
    const UTF8_FILE = 'db/utf8/Loans.sql';
    writeBytes(project, UTF8_FILE, LOANS_SQL);
    project.commit('add the UTF-8 copy');
    await new IndexCommand(project.dir).run({ skipHistory: true });

    const withoutId = ({ symbolId: _symbolId, ...rest }: FileIndex['symbols'][number]) => rest;
    const utf16 = entryFor(project.dir, LOANS_FILE);
    const utf8 = entryFor(project.dir, UTF8_FILE);
    expect(utf8.symbols.map(withoutId)).toEqual(utf16.symbols.map(withoutId));
    expect(utf8.symbols).toHaveLength(1);
    expect(utf8.contentHash).toBe(utf16.contentHash);
  });

  it('the summary reports the SQL files', async () => {
    await new IndexCommand(project.dir).run({ skipHistory: true });

    expect(stderr()).toContain('[ctxo]   SQL: 3 files (syntax tier)');
  });

  it('an incremental run decodes a UTF-16 LE file the same way', async () => {
    await new IndexCommand(project.dir).run({ skipHistory: true });

    const edited = LOANS_SQL.replace('  ReturnedOn date NULL', '  ReturnedOn date NULL,\r\n  FineCents int NULL');
    expect(edited).not.toBe(LOANS_SQL);
    writeBytes(project, LOANS_FILE, utf16leWithBom(edited));
    await new IndexCommand(project.dir).run({ files: [LOANS_FILE], skipHistory: true });

    const loans = entryFor(project.dir, LOANS_FILE);
    expect(loans.contentHash).toBe(new ContentHasher().hash(edited));
    expect(loans.symbols[0]!.annotations).toEqual([
      { name: 'columns', args: ['bookid', 'finecents', 'loanid', 'memberid', 'returnedon'] },
    ]);
    // The untouched procedure keeps its committed entry and its edge to the re-indexed table.
    expect(entryFor(project.dir, CLOSE_LOAN_FILE).edges).toContainEqual({ from: CLOSE_LOAN_ID, to: 'dbo.loans::table', kind: 'writes' });
  });
});

describe('WatchCommand with the real @ctxo/lang-sql plugin', () => {
  let project: TempProject;
  let errorSpy: MockInstance<typeof console.error>;
  let gitEnv: IsolatedGitEnv;
  let sigintBefore: NodeJS.SignalsListener[];
  let sigtermBefore: NodeJS.SignalsListener[];

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    watcherHandlers.length = 0;
    project = createProject();
    writeBytes(project, LOANS_FILE, utf16leWithBom(LOANS_SQL));
    writeBytes(project, MEMBERS_FILE, utf16leWithBom(MEMBERS_SQL));
    writeBytes(project, CLOSE_LOAN_FILE, CLOSE_LOAN_SQL);
    project.commit('add library schema');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sigintBefore = process.listeners('SIGINT');
    sigtermBefore = process.listeners('SIGTERM');
  });

  afterEach(() => {
    // WatchCommand.run registers shutdown handlers that would call process.exit.
    for (const listener of process.listeners('SIGINT')) if (!sigintBefore.includes(listener)) process.removeListener('SIGINT', listener);
    for (const listener of process.listeners('SIGTERM')) if (!sigtermBefore.includes(listener)) process.removeListener('SIGTERM', listener);
    vi.restoreAllMocks();
    gitEnv.restore();
    cleanupTempProjects();
  });

  it('a watch re-index decodes a UTF-16 LE file like the full index does', async () => {
    await new IndexCommand(project.dir).run({ skipHistory: true });
    await new WatchCommand(project.dir).run();
    expect(watcherHandlers).toHaveLength(1);

    const edited = MEMBERS_SQL.replace('  Active bit NOT NULL', '  Active bit NOT NULL,\r\n  JoinedOn date NULL');
    expect(edited).not.toBe(MEMBERS_SQL);
    writeBytes(project, MEMBERS_FILE, utf16leWithBom(edited));
    watcherHandlers[0]!('change', join(project.dir, 'db', 'tables', 'Members.sql'));

    // The re-index runs after a 300ms debounce.
    await vi.waitFor(() => expect(errorSpy.mock.calls.flat().join('\n')).toContain('Re-indexed: db/tables/Members.sql'), {
      timeout: 10_000,
      interval: 50,
    });

    const members = entryFor(project.dir, MEMBERS_FILE);
    expect(members.contentHash).toBe(new ContentHasher().hash(edited));
    expect(members.symbols[0]!.annotations).toEqual([
      { name: 'columns', args: ['active', 'fullname', 'joinedon', 'memberid'] },
    ]);
  });
});
