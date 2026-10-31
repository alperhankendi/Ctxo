import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CodeFact } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import type { RoslynBatchResult } from '../roslyn/roslyn-process.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';
import type { FactOptions } from '../facts/fact-types.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-v2-sample');
const FACTS_DIR = 'CsharpV2Sample/Facts';
const HELPER_DIR = resolve(import.meta.dirname, '../../tools/ctxo-roslyn');
const FILES = ['LoanPolicy.cs', 'LoansController.cs', 'Endpoints.cs', 'MemberDirectory.cs'] as const;
type FactFile = (typeof FILES)[number];

/** [file, full-tier member name, symbol kind, fact kind, text, detail, a needle on the evidence's first line] */
type Row = readonly [FactFile, string, 'method' | 'variable', CodeFact['kind'], string, Record<string, string>, string];

const POLICY = 'Lending.Facts.LoanPolicy';
const CONTROLLER = 'Lending.Facts.LoansController';
const ENDPOINTS = 'Lending.Facts.Endpoints';
const MEMBERS = 'Lending.Facts.MemberDirectory';

const ROWS: readonly Row[] = [
  ['LoanPolicy.cs', `${POLICY}.MaxRetries`, 'variable', 'retry-timeout', 'MaxRetries = 3', { name: 'MaxRetries', value: '3' }, 'MaxRetries = 3'],
  ['LoanPolicy.cs', `${POLICY}.HoldTimeout`, 'variable', 'retry-timeout', 'HoldTimeout = 90min', { name: 'HoldTimeout', value: '90min' }, 'FromMinutes(90)'],
  ['LoanPolicy.cs', `${POLICY}.CanBorrow`, 'method', 'literal-comparison', 'openLoans >= 5', { operator: '>=', literal: '5' }, 'openLoans >= 5'],
  ['LoanPolicy.cs', `${POLICY}.Fee`, 'method', 'literal-comparison', 'tier case "gold"', { operator: 'case', literal: '"gold"' }, 'case "gold"'],
  ['LoanPolicy.cs', `${POLICY}.Key`, 'method', 'normalization', 'email.Trim().ToLowerInvariant()', { method: 'ToLowerInvariant' }, 'ToLowerInvariant()'],
  ['LoanPolicy.cs', `${POLICY}.Label`, 'method', 'literal-comparison', 'days is > 14', { operator: '>', literal: '14' }, 'days is > 14'],
  ['LoanPolicy.cs', `${POLICY}.Remind`, 'method', 'retry-timeout', 'TimeSpan.FromSeconds = 30s', { name: 'TimeSpan.FromSeconds', value: '30s' }, 'FromSeconds(30)'],
  ['LoansController.cs', `${CONTROLLER}.Get`, 'method', 'endpoint', 'GET /api/Loans/{id}', { verb: 'GET', route: '/api/Loans/{id}' }, '[HttpGet("{id}")]'],
  ['LoansController.cs', `${CONTROLLER}.Borrow`, 'method', 'endpoint', 'POST /api/Loans', { verb: 'POST', route: '/api/Loans' }, '[HttpPost]'],
  ['LoansController.cs', `${CONTROLLER}.Health`, 'method', 'endpoint', 'GET /health', { verb: 'GET', route: '/health' }, '[HttpGet("/health")]'],
  ['Endpoints.cs', `${ENDPOINTS}.Map`, 'method', 'endpoint', 'GET /holds/{id}', { verb: 'GET', route: '/holds/{id}' }, 'MapGet('],
  ['Endpoints.cs', `${ENDPOINTS}.Map`, 'method', 'endpoint', 'POST /holds', { verb: 'POST', route: '/holds' }, 'MapPost('],
  // FC-4b: a chain is one fact (the outermost call); text for people, message sinks and formats give none.
  ['MemberDirectory.cs', `${MEMBERS}.Key`, 'method', 'normalization', 'email.Trim().ToLowerInvariant()', { method: 'ToLowerInvariant' }, 'Key(string email)'],
  ['MemberDirectory.cs', `${MEMBERS}.Branch`, 'method', 'normalization', '.Trim().ToUpperInvariant()', { method: 'ToUpperInvariant' }, 'Branch(string code)'],
  ['MemberDirectory.cs', `${MEMBERS}.SameMember`, 'method', 'normalization', 'a.Trim()', { method: 'Trim' }, 'SameMember('],
  ['MemberDirectory.cs', `${MEMBERS}.SameMember`, 'method', 'normalization', 'b.Trim()', { method: 'Trim' }, 'SameMember('],
  ['MemberDirectory.cs', `${MEMBERS}.Slug`, 'method', 'normalization', 'name.Trim()', { method: 'Trim' }, 'Slug(string name)'],
  ['MemberDirectory.cs', `${MEMBERS}.MemberId`, 'method', 'normalization', 'id.ToString("D").ToLowerInvariant()', { method: 'ToLowerInvariant' }, 'MemberId(Guid id)'],
  // Prose that goes to no sink or display API stays a fact (recall over precision).
  ['MemberDirectory.cs', `${MEMBERS}.Greeting`, 'method', 'normalization', 'guest.Trim()', { method: 'Trim' }, 'Greeting(string guest)'],
  // Only the nearest call counts: the value goes to Upsert, not to the logger around it.
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'email.ToUpperInvariant()', { method: 'ToUpperInvariant' }, 'members.Upsert('],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'email.TrimStart()', { method: 'TrimStart' }, 'auth.LogIn('],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'first.TrimStart()', { method: 'TrimStart' }, 'writer.WriteLine('],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'email.ToLowerInvariant()', { method: 'ToLowerInvariant' }, 'members.Query('],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'first.Trim()', { method: 'Trim' }, 'members.Lookup('],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'last.TrimEnd()', { method: 'TrimEnd' }, 'members.Lookup('],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'i.Trim()', { method: 'Trim' }, 'i => i.Trim()'],
  ['MemberDirectory.cs', `${MEMBERS}.Save`, 'method', 'normalization', 'first.ToLowerInvariant()', { method: 'ToLowerInvariant' }, 'members.Format('],
];

function path(file: FactFile): string {
  return `${FACTS_DIR}/${file}`;
}

/** The 0-based index of the first fixture line that holds the needle. */
function lineOf(file: FactFile, needle: string): number {
  const lines = readFileSync(resolve(FIXTURE_DIR, path(file)), 'utf-8').split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  expect(index, `${file}: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

/** A batch-indexed adapter over the fixture, or null without .NET. */
async function indexedAdapter(facts?: FactOptions): Promise<{ adapter: RoslynAdapter; batch: RoslynBatchResult | null }> {
  const adapter = new RoslynAdapter(facts ? { facts } : {});
  await adapter.initialize(FIXTURE_DIR);
  const batch = adapter.isReady() ? await adapter.batchIndex() : null;
  return { adapter, batch };
}

async function factsOf(adapter: RoslynAdapter): Promise<Map<FactFile, CodeFact[]>> {
  const byFile = new Map<FactFile, CodeFact[]>();
  for (const file of FILES) byFile.set(file, await adapter.extractFacts(path(file), ''));
  return byFile;
}

describe.skipIf(!HAS_DOTNET)('Roslyn facts', () => {
  let adapter: RoslynAdapter;
  let batch: RoslynBatchResult | null;
  let facts: Map<FactFile, CodeFact[]>;

  beforeAll(async () => {
    ({ adapter, batch } = await indexedAdapter(DEFAULT_FACT_OPTIONS));
    facts = await factsOf(adapter);
  }, 120_000);

  afterAll(async () => {
    await adapter.dispose();
  });

  it.each(ROWS.map(row => [`${row[1]}: ${row[4]}`, row] as const))('%s', (_name, row) => {
    const [file, member, symbolKind, kind, text, detail, needle] = row;
    const match = facts.get(file)!.filter(f => f.kind === kind && f.text === text);
    expect(match, JSON.stringify(facts.get(file))).toHaveLength(1);
    expect(match[0]!.symbolId.endsWith(`::${member}::${symbolKind}`)).toBe(true);
    expect(match[0]!.symbolId.startsWith(`${path(file)}::`)).toBe(true);
    expect(match[0]!.detail).toEqual(detail);
    expect(match[0]!.line).toBe(lineOf(file, needle));
  });

  it('every fact of the fixture is in the table', () => {
    const all = FILES.flatMap(file => facts.get(file)!.map(f => `${file} ${f.kind} ${f.text}`));
    expect(all.sort()).toEqual(ROWS.map(row => `${row[0]} ${row[3]} ${row[4]}`).sort());
  });

  it('trivial literals, a non-fragment constant and code in strings give no facts', () => {
    const texts = FILES.flatMap(file => facts.get(file)!.map(f => f.text));
    for (const absent of ['member == null', 'member != ""', 'case ""', 'SettlementDays', 'x > 5']) {
      expect(texts.some(text => text.includes(absent)), absent).toBe(false);
    }
  });

  it('the batch carries fact evidence for the Facts files', () => {
    const file = batch!.files.find(f => f.file === path('LoanPolicy.cs'));
    expect(file?.factEvidence?.length).toBeGreaterThan(0);
  });

  it('a custom normalization list replaces the defaults', async () => {
    const custom = await indexedAdapter({ ...DEFAULT_FACT_OPTIONS, normalizationMethods: ['Trim'] });
    try {
      const normalizations = (await custom.adapter.extractFacts(path('LoanPolicy.cs'), '')).filter(f => f.kind === 'normalization');
      // The outer ToLowerInvariant is not on the list, so the Trim it receives is the outermost normalization.
      expect(normalizations.map(f => f.text)).toEqual(['email.Trim()']);
    } finally {
      await custom.adapter.dispose();
    }
  }, 120_000);

  it('a custom trivial list drops 5', async () => {
    const custom = await indexedAdapter({ ...DEFAULT_FACT_OPTIONS, trivialLiterals: [5] });
    try {
      const texts = (await custom.adapter.extractFacts(path('LoanPolicy.cs'), '')).map(f => f.text);
      expect(texts).not.toContain('openLoans >= 5');
      expect(texts).toContain('days is > 14');
    } finally {
      await custom.adapter.dispose();
    }
  }, 120_000);

  it('without the facts option the batch has no evidence and extractFacts returns []', async () => {
    const plain = await indexedAdapter();
    try {
      expect(plain.batch?.ok).toBe(true);
      for (const file of plain.batch!.files) expect(file).not.toHaveProperty('factEvidence');
      for (const file of FILES) expect(await plain.adapter.extractFacts(path(file), '')).toEqual([]);

      // Facts off is the output before facts existed: the same files, symbols, edges and complexity
      // as the facts run, without the evidence key and the symbols' facts-only inheritedRoute.
      const withoutEvidence = batch!.files.map(({ factEvidence: _evidence, ...rest }) => ({
        ...rest,
        symbols: rest.symbols.map(({ inheritedRoute: _route, ...symbol }) => symbol),
      }));
      expect(batch!.files.some(f => f.symbols.some(s => s.inheritedRoute !== undefined))).toBe(true);
      expect(JSON.stringify(plain.batch!.files)).toBe(JSON.stringify(withoutEvidence));
    } finally {
      await plain.adapter.dispose();
    }
  }, 120_000);

  it('every FC-5 vector name that is a C# identifier gives a retry-timeout fact, and no other name does', async () => {
    const names = (await adapter.extractFacts(`${FACTS_DIR}/RetryNames.cs`, '')).map(f => {
      expect(f.kind).toBe('retry-timeout');
      expect(f.symbolId).toBe(`${FACTS_DIR}/RetryNames.cs::Lending.Facts.RetryNames.${f.detail['name']}::variable`);
      return f.detail['name'];
    });
    expect(names.sort()).toEqual([
      'MaxRetries', 'MAX_RETRIES', 'retryCount', 'attempts', 'TimeOut', 'requestTimeoutMs', 'tokenTTL', 'ExpiryDays',
      'backoffFactor', 'delayMs', 'HOLD_TIMEOUT', 'délaiRetry', 'retry2x', 'HTTPTimeout', 'ñretry',
    ].sort());
  });

  it('top-level statements give evidence that belongs to the module symbol', async () => {
    const program = `${FACTS_DIR}/Program.cs`;
    const lines = readFileSync(resolve(FIXTURE_DIR, program), 'utf-8').split(/\r?\n/);
    expect(await adapter.extractFacts(program, '')).toEqual([{
      kind: 'endpoint',
      symbolId: `${program}::Program::variable`,
      line: lines.findIndex(line => line.includes('MapGet(')),
      text: 'GET /loans',
      detail: { verb: 'GET', route: '/loans' },
    }]);
  });

  it('a bad --facts= value gives no evidence and one helper stderr line', () => {
    const run = spawnSync('dotnet', [
      'run', '--project', HELPER_DIR, '--', resolve(FIXTURE_DIR, 'CsharpV2Sample.sln'), '--facts=not-base64!',
    ], { encoding: 'utf-8', timeout: 120_000 });
    expect(run.status).toBe(0);
    const files = run.stdout.split(/\r?\n/).filter(line => line.startsWith('{"type":"file"'));
    expect(files.length).toBeGreaterThan(0);
    for (const line of files) expect(line).not.toContain('"factEvidence"');
    // Only the helper's own lines count; the .NET SDK may add notices of its own.
    const stderr = run.stderr.split(/\r?\n/).filter(line => line.startsWith('[ctxo-roslyn]'));
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/^\[ctxo-roslyn\] --facts= ignored: /);
  }, 120_000);

  it('the keep-alive reindex returns the batch\'s facts', async () => {
    const before = facts.get('LoanPolicy.cs')!;
    expect(await adapter.startKeepAlive()).toBe(true);
    const result = await adapter.reindexFile(path('LoanPolicy.cs'));
    expect(result).not.toBeNull();
    expect(await adapter.extractFacts(path('LoanPolicy.cs'), '')).toEqual(before);
  }, 120_000);
});
