import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CAN_RUN_JDT, LENDING_FIXTURE, testAnalyzerJar } from './helpers/analyzer-jar.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JavaCompositeAdapter } from '../composite-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';

const TEST_FILE = 'src/test/java/lending/LoanPolicyTest.java';
const LOAN_FILE = 'src/main/java/lending/domain/Loan.java';

describe.skipIf(!CAN_RUN_JDT)('lending sample (JDT full tier, real jar)', () => {
  const composite = new JavaCompositeAdapter();

  beforeAll(async () => {
    vi.stubEnv('CTXO_JDT_ANALYZER_JAR', testAnalyzerJar()!);
    await composite.initialize(LENDING_FIXTURE);
  }, 130_000);

  afterAll(async () => {
    await composite.dispose();
    vi.unstubAllEnvs();
  });

  it('test methods under src/test/java are method symbols with their JUnit annotations', async () => {
    expect(composite.getTier()).toBe('full');
    const symbols = await composite.extractSymbols(TEST_FILE, '');
    const test = symbols.find((s) => s.symbolId === `${TEST_FILE}::memberHoldsAtMostFiveLoans::method`);
    expect(test).toBeDefined();
    expect(test!.kind).toBe('method');
    expect(test!.annotations).toEqual([
      { name: 'Test' },
      { name: 'Tag', args: ['LEND-03'] },
      { name: 'DisplayName', args: ['a member holds at most five loans'] },
    ]);
    const cls = symbols.find((s) => s.symbolId === `${TEST_FILE}::LoanPolicyTest::class`);
    expect(cls).toBeDefined();
    expect(cls).not.toHaveProperty('annotations');
  }, 130_000);

  it('the entity class and its field carry their annotations', async () => {
    const symbols = await composite.extractSymbols(LOAN_FILE, '');
    const byId = new Map(symbols.map((s) => [s.symbolId, s]));
    expect(byId.get(`${LOAN_FILE}::Loan::class`)?.annotations).toEqual([
      { name: 'Entity' },
      { name: 'Table', named: { name: 'Loans' } },
    ]);
    expect(byId.get(`${LOAN_FILE}::memberId::variable`)?.annotations).toEqual([
      { name: 'Column', named: { name: 'member_id', nullable: 'false' } },
    ]);
    expect(byId.get(`${LOAN_FILE}::renew::method`)?.annotations).toEqual([
      {
        name: 'Retry',
        args: ['renewal'],
        named: { times: '3', unit: 'TimeUnit.SECONDS', on: 'java.lang.IllegalStateException' },
      },
    ]);
    expect(byId.get(`${LOAN_FILE}::audited::method`)?.annotations).toEqual([
      { name: 'Unknown', args: ['x'], named: { level: '2' } },
    ]);
    expect(byId.get(`${LOAN_FILE}::memberId::method`)).not.toHaveProperty('annotations');
  }, 130_000);
});

const FACTS = 'src/main/java/lending/facts';

/** The 0-based line of the only line of a fixture file that holds `needle`. */
function lineOf(file: string, needle: string): number {
  const lines = readFileSync(resolve(LENDING_FIXTURE, file), 'utf-8').split(/\r?\n/);
  const hits = lines.flatMap((line, i) => (line.includes(needle) ? [i] : []));
  expect(hits, needle).toHaveLength(1);
  return hits[0]!;
}

describe.skipIf(!CAN_RUN_JDT)('lending sample facts (JDT full tier, real jar)', () => {
  const withFacts = new JavaCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS });
  const withoutFacts = new JavaCompositeAdapter();

  beforeAll(async () => {
    vi.stubEnv('CTXO_JDT_ANALYZER_JAR', testAnalyzerJar()!);
    await withFacts.initialize(LENDING_FIXTURE);
    await withoutFacts.initialize(LENDING_FIXTURE);
  }, 130_000);

  afterAll(async () => {
    await withFacts.dispose();
    await withoutFacts.dispose();
    vi.unstubAllEnvs();
  });

  it('the facts fixture gives the expected facts in the JDT tier', async () => {
    expect(withFacts.getTier()).toBe('full');
    const rules = `${FACTS}/LoanRules.java`;
    const controller = `${FACTS}/LoanController.java`;
    const resource = `${FACTS}/HoldResource.java`;
    const facts: string[] = [];
    for (const file of [rules, controller, resource]) {
      for (const f of await withFacts.extractFacts(file, '')) {
        facts.push(`${f.symbolId.slice(file.length + 2)} ${f.line} ${f.kind} ${f.text} ${JSON.stringify(f.detail)}`);
      }
    }
    const method = (file: string, needle: string): number => lineOf(file, needle) - 1;
    expect(facts).toEqual([
      `MAX_RETRIES::variable ${lineOf(rules, 'MAX_RETRIES')} retry-timeout MAX_RETRIES = 3 {"name":"MAX_RETRIES","value":"3"}`,
      `HOLD_TIMEOUT::variable ${lineOf(rules, 'HOLD_TIMEOUT')} retry-timeout HOLD_TIMEOUT = 90min {"name":"HOLD_TIMEOUT","value":"90min"}`,
      `canBorrow::method ${lineOf(rules, 'openLoans >= 5')} literal-comparison openLoans >= 5 {"operator":">=","literal":"5"}`,
      `fee::method ${lineOf(rules, 'case "gold"')} literal-comparison tier case "gold" {"operator":"case","literal":"\\"gold\\""}`,
      `key::method ${lineOf(rules, 'email.trim()')} normalization email.trim().toLowerCase() {"method":"toLowerCase"}`,
      `same::method ${lineOf(rules, 'equalsIgnoreCase')} normalization a.equalsIgnoreCase(b) {"method":"equalsIgnoreCase"}`,
      `label::method ${lineOf(rules, 'days > 14')} literal-comparison days > 14 {"operator":">","literal":"14"}`,
      `get::method ${method(controller, 'get(long id)')} endpoint GET /api/loans/{id} {"verb":"GET","route":"/api/loans/{id}"}`,
      `borrow::method ${method(controller, 'borrow()')} endpoint POST /api/loans {"verb":"POST","route":"/api/loans"}`,
      `renew::method ${method(controller, 'renew()')} endpoint POST /api/loans/renew {"verb":"POST","route":"/api/loans/renew"}`,
      `get::method ${lineOf(resource, '@GET')} endpoint GET /holds/{id} {"verb":"GET","route":"/holds/{id}"}`,
    ]);
  }, 130_000);

  it('without facts extractFacts gives nothing and symbols and edges are the same', async () => {
    const file = `${FACTS}/LoanRules.java`;
    expect(withoutFacts.facts).toBeUndefined();
    expect(await withoutFacts.extractFacts(file, '')).toEqual([]);
    expect(await withFacts.extractSymbols(file, '')).toEqual(await withoutFacts.extractSymbols(file, ''));
    expect(await withFacts.extractEdges(file, '')).toEqual(await withoutFacts.extractEdges(file, ''));
  }, 130_000);
});

const DATA = 'src/main/java/lending/data';
const DATA_FILES = [`${DATA}/LoanRepository.java`, `${DATA}/LoanJpaRepository.java`, `${DATA}/LoanMapper.java`];

/** The data edges (`reads`, `writes`, `executes`) of the data files as `symbolId -> ["kind target", ...]`. */
async function dataEdges(adapter: JavaCompositeAdapter): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const file of DATA_FILES) {
    for (const e of await adapter.extractEdges(file, '')) {
      if (e.kind !== 'reads' && e.kind !== 'writes' && e.kind !== 'executes') continue;
      (out[e.from] ??= []).push(`${e.kind} ${e.to}`);
    }
  }
  return out;
}

const EXPECTED_DATA_EDGES: Record<string, string[]> = {
  [`${DATA}/LoanRepository.java::findActive::method`]: ['reads dbo.loans::table', 'reads dbo.members::table'],
  [`${DATA}/LoanRepository.java::close::method`]: ['executes dbo.usp_closeloan::procedure'],
  [`${DATA}/LoanRepository.java::archive::method`]: ['reads dbo.loans::table', 'writes dbo.loanarchive::table'],
  [`${DATA}/LoanRepository.java::holdsFor::method`]: ['reads dbo.holds::table'],
  [`${DATA}/LoanRepository.java::purge::method`]: ['writes dbo.holds::table'],
  [`${DATA}/LoanRepository.java::flagAll::method`]: ['writes dbo.loans::table', 'writes dbo.members::table'],
  [`${DATA}/LoanRepository.java::later::method`]: ['writes dbo.holds::table'],
  [`${DATA}/LoanJpaRepository.java::findOverdue::method`]: ['reads dbo.loans::table'],
  [`${DATA}/LoanMapper.java::active::method`]: ['reads dbo.loans::table'],
  [`${DATA}/LoanMapper.java::add::method`]: ['writes dbo.loans::table'],
  [`${DATA}/LoanMapper.java::renew::method`]: ['writes dbo.loans::table'],
  [`${DATA}/LoanMapper.java::remove::method`]: ['writes dbo.loans::table'],
};

describe.skipIf(!CAN_RUN_JDT)('lending sample SQL call sites (JDT full tier, real jar)', () => {
  const withSql = new JavaCompositeAdapter({ sqlCallSites: true });
  const withoutSql = new JavaCompositeAdapter();

  beforeAll(async () => {
    vi.stubEnv('CTXO_JDT_ANALYZER_JAR', testAnalyzerJar()!);
    await withSql.initialize(LENDING_FIXTURE);
    await withoutSql.initialize(LENDING_FIXTURE);
  }, 130_000);

  afterAll(async () => {
    await withSql.dispose();
    await withoutSql.dispose();
    vi.unstubAllEnvs();
  });

  it('repository, JPA and MyBatis methods have the expected data edges', async () => {
    expect(withSql.sqlCallSites).toBe(true);
    expect(await dataEdges(withSql)).toEqual(EXPECTED_DATA_EDGES);
  }, 130_000);

  it('getSqlStats reports 13 constant and 1 non-constant texts', async () => {
    await withSql.extractEdges(DATA_FILES[0]!, '');
    expect(withSql.getAnalyzerDelegate()!.getSqlStats()).toEqual({ constant: 13, nonConstant: 1 });
  }, 130_000);

  it('without sqlCallSites there are no data edges and no stats', async () => {
    expect(withoutSql.sqlCallSites).toBe(false);
    expect(await dataEdges(withoutSql)).toEqual({});
    expect(withoutSql.getAnalyzerDelegate()!.getSqlStats()).toBeUndefined();
  }, 130_000);

  it('the keep-alive reindex of LoanRepository.java returns the batch data edges and annotations', async () => {
    const cap = withSql.getIncrementalReindex();
    expect(cap).not.toBeNull();
    expect(await cap!.startKeepAlive!()).toBe(true);
    const isData = (e: { kind: string }): boolean => e.kind === 'reads' || e.kind === 'writes' || e.kind === 'executes';
    const file = DATA_FILES[0]!;
    const result = await cap!.reindexFile(file);
    expect(result).not.toBeNull();

    const batchEdges = (await withSql.extractEdges(file, '')).filter(isData);
    expect(batchEdges.length).toBeGreaterThan(0);
    expect(result!.edges.filter(isData)).toEqual(batchEdges);

    // Annotations come with the same reindex (the JPA interface carries @Query).
    const jpa = await cap!.reindexFile(DATA_FILES[1]!);
    expect(jpa!.symbols).toEqual(await withSql.extractSymbols(DATA_FILES[1]!, ''));
    expect(jpa!.symbols.find((s) => s.name === 'findOverdue')?.annotations?.[0]?.name).toBe('Query');
    expect(jpa!.edges.filter(isData)).toEqual([
      { from: `${DATA}/LoanJpaRepository.java::findOverdue::method`, to: 'dbo.loans::table', kind: 'reads' },
    ]);
  }, 130_000);
});
