import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { GraphEdge } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import type { RoslynBatchResult } from '../roslyn/roslyn-process.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-v2-sample');
const REPOSITORY_FILE = 'CsharpV2Sample/Data/LoanRepository.cs';
const REPOSITORY = `${REPOSITORY_FILE}::Lending.Data.LoanRepository`;
const DAPPER = 'CsharpV2Sample/Stubs/Dapper.cs::Dapper.SqlMapper';
const SQL_CLIENT = 'CsharpV2Sample/Stubs/SqlClient.cs::Microsoft.Data.SqlClient';
const EF_CORE = 'CsharpV2Sample/Stubs/EntityFrameworkCore.cs::Microsoft.EntityFrameworkCore';

const DATA_EDGE_KINDS = new Set(['reads', 'writes', 'executes']);

/** The fixture's LoanRepository methods and their data edges, as `<kind> <target>`. */
const CALL_SITE_ROWS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['GetActive', ['reads dbo.loans::table', 'reads dbo.members::table']],
  ['GetByIds', ['reads dbo.loans::table']],
  ['Close', ['executes dbo.usp_closeloan::procedure']],
  ['Archive', ['reads dbo.loans::table', 'writes dbo.loanarchive::table']],
  ['Notify', ['executes dbo.usp_notifymember::procedure']],
  ['ByDefinition', ['reads dbo.loans::table']],
  ['ProcByDefinition', ['executes dbo.usp_renewloan::procedure']],
  ['BulkLoad', ['writes dbo.loanstaging::table']],
  ['RawEf', ['reads dbo.loans::table', 'writes dbo.holds::table']],
  ['DefinitionInVariable', ['reads dbo.members::table']],
  ['PositionalCommandType', ['executes dbo.usp_extendloan::procedure']],
  ['WaiveFines', ['writes dbo.fines::table']],
  ['FormatItemInDapper', []],
  ['ReusedCommand', ['executes dbo.usp_waivefines::procedure', 'reads dbo.fines::table']],
  ['PlaceHold', ['executes dbo.usp_placehold::procedure']],
  ['CancelHold', ['executes dbo.usp_cancelhold::procedure']],
  ['ExpireHolds', []],
  ['AppendedText', ['reads dbo.holds::table']],
  ['Dynamic', []],
  ['StaticReadonly', []],
  ['Broken', []],
];

/**
 * The calls and implements edges of LoanRepository.cs, with or without SQL call sites.
 * Archive, ReusedCommand and AppendedText call framework members only, which give no edges.
 */
const CODE_EDGES: readonly string[] = [
  `calls ${REPOSITORY}.Broken::method -> ${DAPPER}.Execute::method`,
  `calls ${REPOSITORY}.ByDefinition::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.BulkLoad::method -> ${SQL_CLIENT}.SqlBulkCopy.WriteToServer::method`,
  `calls ${REPOSITORY}.CancelHold::method -> ${SQL_CLIENT}.SqlCommand.ExecuteNonQuery::method`,
  `calls ${REPOSITORY}.Close::method -> ${SQL_CLIENT}.SqlCommand.ExecuteNonQuery::method`,
  `calls ${REPOSITORY}.DefinitionInVariable::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.Dynamic::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.ExpireHolds::method -> ${SQL_CLIENT}.SqlCommand.ExecuteNonQuery::method`,
  `calls ${REPOSITORY}.FormatItemInDapper::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.GetActive::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.GetByIds::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.Notify::method -> ${DAPPER}.Execute::method`,
  `calls ${REPOSITORY}.PlaceHold::method -> ${SQL_CLIENT}.SqlCommand.ExecuteNonQuery::method`,
  `calls ${REPOSITORY}.PositionalCommandType::method -> ${DAPPER}.Execute::method`,
  `calls ${REPOSITORY}.ProcByDefinition::method -> ${DAPPER}.Execute::method`,
  `calls ${REPOSITORY}.RawEf::method -> ${EF_CORE}.DbContext.Set::method`,
  `calls ${REPOSITORY}.RawEf::method -> ${EF_CORE}.RelationalDatabaseFacadeExtensions.ExecuteSqlRaw::method`,
  `calls ${REPOSITORY}.RawEf::method -> ${EF_CORE}.RelationalQueryableExtensions.FromSqlRaw::method`,
  `calls ${REPOSITORY}.StaticReadonly::method -> ${DAPPER}.Query::method`,
  `calls ${REPOSITORY}.WaiveFines::method -> ${EF_CORE}.RelationalDatabaseFacadeExtensions.ExecuteSqlRaw::method`,
  `implements ${REPOSITORY}::class -> ${REPOSITORY_FILE}::Lending.Data.ILoanRepository::interface`,
];

function codeEdges(edges: readonly GraphEdge[]): string[] {
  return edges
    .filter(e => e.kind === 'calls' || e.kind === 'implements')
    .map(e => `${e.kind} ${e.from} -> ${e.to}`)
    .sort();
}

function dataEdgesOf(edges: readonly GraphEdge[], method: string): string[] {
  return edges
    .filter(e => e.from === `${REPOSITORY}.${method}::method` && DATA_EDGE_KINDS.has(e.kind))
    .map(e => `${e.kind} ${e.to}`)
    .sort();
}

async function batchIndexFixture(sqlCallSites: boolean): Promise<{
  adapter: RoslynAdapter;
  batch: RoslynBatchResult | null;
  edges: GraphEdge[];
}> {
  const adapter = new RoslynAdapter({ sqlCallSites });
  await adapter.initialize(FIXTURE_DIR);
  const batch = adapter.isReady() ? await adapter.batchIndex() : null;
  const edges = await adapter.extractEdges(REPOSITORY_FILE, '');
  return { adapter, batch, edges };
}

describe.skipIf(!HAS_DOTNET)('Roslyn SQL call sites with the capability', () => {
  let adapter: RoslynAdapter;
  let batch: RoslynBatchResult | null = null;
  let edges: GraphEdge[] = [];

  beforeAll(async () => {
    ({ adapter, batch, edges } = await batchIndexFixture(true));
  }, 120_000);

  afterAll(async () => {
    await adapter.dispose();
  });

  it.each(CALL_SITE_ROWS)('%s: data edges match', (method, expected) => {
    expect(dataEdgesOf(edges, method)).toEqual([...expected].sort());
  });

  it('every data edge of the file comes from a listed method', () => {
    const all = edges.filter(e => DATA_EDGE_KINDS.has(e.kind)).map(e => `${e.from} ${e.kind} ${e.to}`).sort();
    const listed = CALL_SITE_ROWS.flatMap(([method, expected]) => expected.map(edge => `${REPOSITORY}.${method}::method ${edge}`)).sort();
    expect(all).toEqual(listed);
  });

  it('the batch reports 21 constant, 3 non-constant and 2 unparsable SQL texts', () => {
    expect(batch?.ok).toBe(true);
    expect(batch?.sql).toEqual({ constant: 21, nonConstant: 3, unparsable: 2 });
  });

  it('existing calls and implements edges are unchanged', () => {
    expect(codeEdges(edges)).toEqual([...CODE_EDGES].sort());
  });
});

describe.skipIf(!HAS_DOTNET)('Roslyn SQL call sites without the capability', () => {
  let adapter: RoslynAdapter;
  let batch: RoslynBatchResult | null = null;
  let edges: GraphEdge[] = [];

  beforeAll(async () => {
    ({ adapter, batch, edges } = await batchIndexFixture(false));
  }, 120_000);

  afterAll(async () => {
    await adapter.dispose();
  });

  it('no reads, writes or executes edge appears without the capability', () => {
    expect(edges.filter(e => DATA_EDGE_KINDS.has(e.kind))).toEqual([]);
    expect(codeEdges(edges)).toEqual([...CODE_EDGES].sort());
  });

  it('the batch reports no sql stats', () => {
    expect(batch?.ok).toBe(true);
    expect(batch).not.toHaveProperty('sql');
  });
});
