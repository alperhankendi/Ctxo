import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndexCommand } from '../../src/cli/index-command.js';
import { loadGraph } from '../../src/cli/graph-loader.js';
import { BlastRadiusCalculator } from '../../src/core/blast-radius/blast-radius-calculator.js';
import { JsonIndexReader } from '../../src/adapters/storage/json-index-reader.js';
import type { ContextsView } from '../../src/core/contexts-view/contexts-view-builder.js';
import type { FileIndex } from '../../src/core/types.js';
import { isolateGitEnv, type IsolatedGitEnv } from '../../src/cli/__tests__/git-test-env.js';

/**
 * End to end, C# call site to SQL table: `ctxo index` loads the real @ctxo/lang-csharp and @ctxo/lang-sql
 * from the CLI's own manifest, the host grants `sqlCallSites` because a `.sql` plugin is present, the
 * Roslyn helper turns a Dapper call's constant SQL into a reads edge, and the edge resolves to the table
 * that lang-sql indexed.
 *
 * Opt-in: it builds the Roslyn helper and restores NuGet packages, so it runs only with
 * CTXO_DOTNET_E2E=1 and a .NET 8+ SDK, and skips otherwise. CI runs it in the dotnet-tests job only.
 * To run it locally after `pnpm -r build`:
 *
 *   bash:        CTXO_DOTNET_E2E=1 pnpm --filter @ctxo/cli test:e2e tests/e2e/csharp-sql-call-site.test.ts
 *   PowerShell:  $env:CTXO_DOTNET_E2E = '1'; pnpm --filter @ctxo/cli test:e2e tests/e2e/csharp-sql-call-site.test.ts
 */
const ENABLED = process.env['CTXO_DOTNET_E2E'] === '1';

const HAS_DOTNET = ENABLED && (() => {
  try {
    const version = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(version.split('.')[0]!, 10) >= 8;
  } catch {
    return false;
  }
})();

const here = dirname(fileURLToPath(import.meta.url));
const HELPER_CSPROJ = resolve(here, '../../../lang-csharp/tools/ctxo-roslyn/ctxo-roslyn.csproj');

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

const LOANS_SQL_FILE = 'db/tables/Loans.sql';
const READER_FILE = 'Loans/LoanReader.cs';
const LOANS_TABLE = `${LOANS_SQL_FILE}::dbo.loans::table`;
const OPEN_LOANS = `${READER_FILE}::Lending.Loans.LoanReader.OpenLoans::method`;

// A small synthetic library-lending project: one table script and a Dapper call that reads it.
const FILES: Record<string, string> = {
  'Lending.csproj': [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <TargetFramework>net8.0</TargetFramework>',
    '    <Nullable>enable</Nullable>',
    '    <ImplicitUsings>enable</ImplicitUsings>',
    '  </PropertyGroup>',
    '</Project>',
    '',
  ].join('\n'),
  // A stand-in for Dapper's SqlMapper: only the type, member and parameter names match the library.
  'Stubs/Dapper.cs': [
    'using System.Data;',
    '',
    'namespace Dapper;',
    '',
    'public static class SqlMapper',
    '{',
    '    public static IEnumerable<T> Query<T>(this IDbConnection cnn, string sql, object? param = null) =>',
    '        throw new NotSupportedException();',
    '}',
    '',
  ].join('\n'),
  'Loans/Loan.cs': [
    'namespace Lending.Loans;',
    '',
    'public sealed class Loan',
    '{',
    '    public int Id { get; set; }',
    '',
    '    public int MemberId { get; set; }',
    '}',
    '',
  ].join('\n'),
  [READER_FILE]: [
    'using System.Data;',
    'using Dapper;',
    '',
    'namespace Lending.Loans;',
    '',
    'public sealed class LoanReader',
    '{',
    '    private readonly IDbConnection _db;',
    '',
    '    public LoanReader(IDbConnection db) => _db = db;',
    '',
    '    public IEnumerable<Loan> OpenLoans() =>',
    '        _db.Query<Loan>("SELECT l.Id, l.MemberId FROM dbo.Loans AS l WHERE l.ReturnedOn IS NULL");',
    '}',
    '',
  ].join('\n'),
  'Loans/LoanDesk.cs': [
    'namespace Lending.Loans;',
    '',
    'public sealed class LoanDesk',
    '{',
    '    private readonly LoanReader _reader;',
    '',
    '    public LoanDesk(LoanReader reader) => _reader = reader;',
    '',
    '    public int OpenLoanCount() => _reader.OpenLoans().Count();',
    '',
    '    public Loan? FirstOpenLoan() => _reader.OpenLoans().FirstOrDefault();',
    '}',
    '',
  ].join('\n'),
  [LOANS_SQL_FILE]: [
    'CREATE TABLE dbo.Loans (',
    '    Id INT NOT NULL PRIMARY KEY,',
    '    MemberId INT NOT NULL,',
    '    ReturnedOn DATE NULL',
    ');',
    '',
  ].join('\n'),
};

function dotnet(args: string[], cwd?: string): void {
  execFileSync('dotnet', [...args, '--nologo', '-v', 'q'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000,
  });
}

describe.skipIf(!ENABLED || !HAS_DOTNET)('C# call site to SQL table, end to end', () => {
  let dir: string;
  let gitEnv: IsolatedGitEnv;
  /** What the index run wrote to stderr. */
  let indexOutput = '';

  beforeAll(async () => {
    // Built up front: the index's batch run has its own 120 s limit, which a cold helper build can exceed.
    dotnet(['build', HELPER_CSPROJ]);

    gitEnv = isolateGitEnv();
    dir = mkdtempSync(join(tmpdir(), 'ctxo-csharp-sql-'));
    for (const [file, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content, 'utf-8');
    }
    // Restored so the framework types (IDbConnection, IEnumerable<T>) resolve in the helper.
    dotnet(['restore', join(dir, 'Lending.csproj')]);
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    // The restore output and the index's own files stay out of the commit.
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'bin/\nobj/\n.ctxo/\n.gitignore\n', 'utf-8');
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', [...IDENTITY, 'commit', '-q', '-m', 'add the lending project'], { cwd: dir, stdio: 'ignore' });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await new IndexCommand(dir).run({ skipHistory: true });
      indexOutput = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      errorSpy.mockRestore();
    }
  }, 900_000);

  afterAll(() => {
    gitEnv?.restore();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function entryFor(file: string): FileIndex {
    const entry = new JsonIndexReader(join(dir, '.ctxo')).readAll().find((e) => e.file === file);
    if (!entry) throw new Error(`no index entry for ${file}`);
    return entry;
  }

  it('indexes C# on the full tier and the table script with lang-sql', () => {
    expect(indexOutput).toMatch(/\[ctxo\] {3}C#: \d+ files \(full tier/);
    expect(indexOutput).toContain('[ctxo]   SQL: 1 files (syntax tier)');
    expect(entryFor(LOANS_SQL_FILE).symbols.map((s) => s.symbolId)).toEqual([LOANS_TABLE]);
  });

  it('the Dapper call site gives a reads edge that resolves to the lang-sql table node', () => {
    expect(entryFor(READER_FILE).edges).toContainEqual({ from: OPEN_LOANS, to: 'dbo.loans::table', kind: 'reads' });

    const { graph } = loadGraph(join(dir, '.ctxo'));
    expect(graph.getForwardEdges(OPEN_LOANS)).toContainEqual({ from: OPEN_LOANS, to: LOANS_TABLE, kind: 'reads' });
  });

  it('the C# method is a confirmed dependent in the blast radius of the table', () => {
    const { graph } = loadGraph(join(dir, '.ctxo'));
    const result = new BlastRadiusCalculator().calculate(graph, LOANS_TABLE);

    expect(result.impactedSymbols).toContainEqual(
      expect.objectContaining({ symbolId: OPEN_LOANS, depth: 1, confidence: 'confirmed', edgeKinds: ['reads'] }),
    );
  });

  it('the contexts view lists the table among the data resources, read by the C# reader candidate', () => {
    const view = JSON.parse(readFileSync(join(dir, '.ctxo', 'index', 'contexts-view.json'), 'utf-8')) as ContextsView;
    const readerCandidate = view.candidates.find((c) => c.files.includes(READER_FILE));
    expect(readerCandidate, 'the reader file belongs to a candidate').toBeDefined();

    const loans = view.dataResources.find((r) => r.name === 'dbo.loans');
    expect(loans).toEqual({
      name: 'dbo.loans',
      kind: 'table',
      external: false,
      accesses: [{ candidate: readerCandidate!.id, modes: ['reads'] }],
      writers: [],
    });
  });
});
