import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodeFact } from '@ctxo/plugin-api';
import { CSharpAdapter } from '../../csharp-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';

const FACTS_DIR = resolve(import.meta.dirname, '../../__tests__/fixtures/csharp-v2-sample/CsharpV2Sample/Facts');
const PREFIX = 'CsharpV2Sample/Facts';

type FactFile = 'LoanPolicy.cs' | 'LoansController.cs' | 'Endpoints.cs';

/** [file, syntax-tier member name, symbol kind, fact kind, text, detail, a needle on the evidence's first line] */
type Row = readonly [FactFile, string, 'method' | 'variable', CodeFact['kind'], string, Record<string, string>, string];

const POLICY = 'Lending.Facts.LoanPolicy';
const CONTROLLER = 'Lending.Facts.LoansController';
const ENDPOINTS = 'Lending.Facts.Endpoints';

// The Task 3 table; public methods carry the syntax tier's `(n)` parameter count.
const ROWS: readonly Row[] = [
  ['LoanPolicy.cs', `${POLICY}.MaxRetries`, 'variable', 'retry-timeout', 'MaxRetries = 3', { name: 'MaxRetries', value: '3' }, 'MaxRetries = 3'],
  ['LoanPolicy.cs', `${POLICY}.HoldTimeout`, 'variable', 'retry-timeout', 'HoldTimeout = 90min', { name: 'HoldTimeout', value: '90min' }, 'FromMinutes(90)'],
  ['LoanPolicy.cs', `${POLICY}.CanBorrow(2)`, 'method', 'literal-comparison', 'openLoans >= 5', { operator: '>=', literal: '5' }, 'openLoans >= 5'],
  ['LoanPolicy.cs', `${POLICY}.Fee(1)`, 'method', 'literal-comparison', 'tier case "gold"', { operator: 'case', literal: '"gold"' }, 'case "gold"'],
  ['LoanPolicy.cs', `${POLICY}.Key(1)`, 'method', 'normalization', 'email.Trim().ToLowerInvariant()', { method: 'ToLowerInvariant' }, 'ToLowerInvariant()'],
  ['LoanPolicy.cs', `${POLICY}.Label(1)`, 'method', 'literal-comparison', 'days is > 14', { operator: '>', literal: '14' }, 'days is > 14'],
  ['LoanPolicy.cs', `${POLICY}.Remind`, 'method', 'retry-timeout', 'TimeSpan.FromSeconds = 30s', { name: 'TimeSpan.FromSeconds', value: '30s' }, 'FromSeconds(30)'],
  ['LoansController.cs', `${CONTROLLER}.Get(1)`, 'method', 'endpoint', 'GET /api/Loans/{id}', { verb: 'GET', route: '/api/Loans/{id}' }, '[HttpGet("{id}")]'],
  ['LoansController.cs', `${CONTROLLER}.Borrow(1)`, 'method', 'endpoint', 'POST /api/Loans', { verb: 'POST', route: '/api/Loans' }, '[HttpPost]'],
  ['LoansController.cs', `${CONTROLLER}.Health(0)`, 'method', 'endpoint', 'GET /health', { verb: 'GET', route: '/health' }, '[HttpGet("/health")]'],
  ['Endpoints.cs', `${ENDPOINTS}.Map(1)`, 'method', 'endpoint', 'GET /holds/{id}', { verb: 'GET', route: '/holds/{id}' }, 'MapGet('],
  ['Endpoints.cs', `${ENDPOINTS}.Map(1)`, 'method', 'endpoint', 'POST /holds', { verb: 'POST', route: '/holds' }, 'MapPost('],
];

// The FC-5 vectors that are C# identifiers (RetryNames.cs): positives first, then negatives.
const RETRY_NAMES = [
  'MaxRetries', 'MAX_RETRIES', 'retryCount', 'attempts', 'TimeOut', 'requestTimeoutMs', 'tokenTTL', 'ExpiryDays',
  'backoffFactor', 'delayMs', 'HOLD_TIMEOUT', 'délaiRetry', 'retry2x', 'HTTPTimeout', 'ñretry',
] as const;
const NOT_RETRY_NAMES = ['settlementDays', 'relay', 'delta', 'count', 'maxRétries'] as const;

function source(file: string): string {
  return readFileSync(resolve(FACTS_DIR, file), 'utf-8');
}

function lineOf(text: string, needle: string): number {
  const index = text.split(/\r?\n/).findIndex(line => line.includes(needle));
  expect(index, needle).toBeGreaterThanOrEqual(0);
  return index;
}

async function syntaxFacts(file: string, text = source(file)): Promise<CodeFact[]> {
  return new CSharpAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(`${PREFIX}/${file}`, text);
}

describe('C# tree-sitter facts', () => {
  it('the syntax tier reports the Task 3 table', async () => {
    const files: FactFile[] = ['LoanPolicy.cs', 'LoansController.cs', 'Endpoints.cs'];
    const all: string[] = [];
    for (const file of files) {
      const facts = await syntaxFacts(file);
      all.push(...facts.map(f => `${file} ${f.kind} ${f.text}`));
      for (const [rowFile, member, symbolKind, kind, text, detail, needle] of ROWS.filter(row => row[0] === file)) {
        const match = facts.filter(f => f.kind === kind && f.text === text);
        expect(match, `${rowFile} ${text}: ${JSON.stringify(facts)}`).toHaveLength(1);
        expect(match[0]!.symbolId).toBe(`${PREFIX}/${rowFile}::${member}::${symbolKind}`);
        expect(match[0]!.detail).toEqual(detail);
        expect(match[0]!.line).toBe(lineOf(source(rowFile), needle));
      }
    }
    expect(all.sort()).toEqual(ROWS.map(row => `${row[0]} ${row[3]} ${row[4]}`).sort());
  });

  it('fields and private members use the full-tier ID shape', async () => {
    const ids = new Set((await syntaxFacts('LoanPolicy.cs')).map(f => f.symbolId));
    expect(ids).toContain(`${PREFIX}/LoanPolicy.cs::Lending.Facts.LoanPolicy.MaxRetries::variable`);
    expect(ids).toContain(`${PREFIX}/LoanPolicy.cs::Lending.Facts.LoanPolicy.Remind::method`);
  });

  it('trivial literals, a non-fragment constant and code in strings give no facts', async () => {
    const texts = (await syntaxFacts('LoanPolicy.cs')).map(f => f.text);
    for (const absent of ['member == null', 'member != ""', 'case ""', 'SettlementDays', 'x > 5']) {
      expect(texts.some(text => text.includes(absent)), absent).toBe(false);
    }
  });

  it('CRLF line endings give the same facts', async () => {
    for (const file of ['LoanPolicy.cs', 'LoansController.cs', 'Endpoints.cs', 'RenewalRules.cs']) {
      const lf = source(file).replace(/\r\n/g, '\n');
      const crlf = lf.replace(/\n/g, '\r\n');
      const facts = await syntaxFacts(file, lf);
      expect(facts.length, file).toBeGreaterThan(0);
      expect(await syntaxFacts(file, crlf), file).toEqual(facts);
    }
  });

  it('a generated file with 2,000 case labels gives 500 facts', async () => {
    const labels = Array.from({ length: 2000 }, (_, i) => `            case ${1000 + i}: return ${i};`);
    const text = [
      'namespace Lending.Generated;',
      'public static class Codes',
      '{',
      '    public static int Of(int code)',
      '    {',
      '        switch (code)',
      '        {',
      ...labels,
      '        }',
      '        return -1;',
      '    }',
      '}',
      '',
    ].join('\n');
    const adapter = new CSharpAdapter({ facts: DEFAULT_FACT_OPTIONS });
    const facts = await adapter.extractFacts('Generated/Codes.cs', text);
    expect(facts).toHaveLength(500);
    expect(facts.map(f => f.line)).toEqual(Array.from({ length: 500 }, (_, i) => 7 + i));
    expect(facts[0]).toEqual({
      kind: 'literal-comparison',
      symbolId: 'Generated/Codes.cs::Lending.Generated.Codes.Of(1)::method',
      line: 7,
      text: 'code case 1000',
      detail: { operator: 'case', literal: '1000' },
    });
    expect(await adapter.extractFacts('Generated/Codes.cs', text)).toEqual(facts);
  });

  it('without the facts option extractFacts returns []', async () => {
    expect(await new CSharpAdapter().extractFacts(`${PREFIX}/LoanPolicy.cs`, source('LoanPolicy.cs'))).toEqual([]);
  });

  it('attribute routes in a file-scoped namespace carry the same namespaced ID as the other facts of the method', async () => {
    const facts = await syntaxFacts('ShelfController.cs');
    const id = `${PREFIX}/ShelfController.cs::Lending.Facts.Shelves.ShelfController.Get(1)::method`;
    expect(facts.map(f => `${f.kind} ${f.text} ${f.symbolId}`)).toEqual([
      `endpoint GET /api/Shelf/{id} ${id}`,
      `literal-comparison id > 40 ${id}`,
    ]);
  });

  it('an explicit interface implementation is named after its interface, as in Roslyn', async () => {
    const facts = await syntaxFacts('RenewalRules.cs');
    expect(facts.find(f => f.text === 'days > 30')?.symbolId)
      .toBe(`${PREFIX}/RenewalRules.cs::Lending.Facts.ShelfRenewal.Lending.Facts.IRenewable.CanRenew::method`);
  });

  it('top-level statements belong to the module symbol', async () => {
    const facts = await syntaxFacts('Program.cs');
    expect(facts).toEqual([{
      kind: 'endpoint',
      symbolId: `${PREFIX}/Program.cs::Program::variable`,
      line: lineOf(source('Program.cs'), 'MapGet('),
      text: 'GET /loans',
      detail: { verb: 'GET', route: '/loans' },
    }]);
  });

  it('every FC-5 vector name that is a C# identifier gives a retry-timeout fact, and no other name does', async () => {
    const facts = await syntaxFacts('RetryNames.cs');
    expect(facts.map(f => f.detail['name']).sort()).toEqual([...RETRY_NAMES].sort());
    for (const name of NOT_RETRY_NAMES) expect(facts.some(f => f.text.startsWith(`${name} `)), name).toBe(false);
    for (const fact of facts) {
      expect(fact.kind).toBe('retry-timeout');
      expect(fact.symbolId).toBe(`${PREFIX}/RetryNames.cs::Lending.Facts.RetryNames.${fact.detail['name']}::variable`);
    }
  });

  it('indexers, operators, conversion operators, destructors and enum values give no evidence', async () => {
    const texts = (await syntaxFacts('RenewalRules.cs')).map(f => f.text);
    for (const absent of ['index > 90', 'a.holdDelay > 91', 'r.holdDelay > 92', 'holdDelay > 93', '94', '95']) {
      expect(texts.some(text => text.includes(absent)), absent).toBe(false);
    }
  });

  it('a relational or constant pattern before && or ?: reads as C# does, not as tree-sitter parses it', async () => {
    const facts = await syntaxFacts('RenewalRules.cs');
    const texts = facts.map(f => f.text);
    expect(texts).toEqual(expect.arrayContaining(['holdDelay is > 30', 'days is > 21', 'code != "LATE"', 'limit is 3', 'attemptLimit > 2']));
    expect(texts.some(text => text.includes('30 ? 2'))).toBe(false);
  });

  it('`not` binds to the first pattern of an and/or chain, as in C#', async () => {
    const facts = await syntaxFacts('RenewalRules.cs');
    const chain = facts.filter(f => f.text === 'code is not "LOST" and not "DAMAGED"');
    expect(chain.map(f => `${f.detail['operator']} ${f.detail['literal']}`).sort()).toEqual(['!= "DAMAGED"', '!= "LOST"']);
    const labels = facts.filter(f => f.text.startsWith('days case')).map(f => f.text);
    expect(labels).toContain('days case < 45');
    expect(labels).not.toContain('days case 0');
  });

  it('a parenthesized switch subject reads without its parentheses, and an indexer target names no duration', async () => {
    const texts = (await syntaxFacts('RenewalRules.cs')).map(f => f.text);
    expect(texts).toContain('code case "REF"');
    expect(texts).toContain('TimeSpan.FromHours = 3h');
  });

  it('FC-4b: a chain is one fact, and message sinks, display text and formats give none (MemberDirectory.cs)', async () => {
    const facts = (await syntaxFacts('MemberDirectory.cs')).filter(f => f.kind === 'normalization');
    expect(facts.map(f => f.text)).toEqual([
      'email.Trim().ToLowerInvariant()',
      '.Trim().ToUpperInvariant()',
      'a.Trim()',
      'b.Trim()',
      'name.Trim()',
      'id.ToString("D").ToLowerInvariant()',
      'guest.Trim()',
      'email.ToUpperInvariant()',
      'email.TrimStart()',
      'first.TrimStart()',
      'email.ToLowerInvariant()',
      'first.Trim()',
      'last.TrimEnd()',
      'i.Trim()',
      'first.ToLowerInvariant()',
    ]);
  });

  it('FC-4b: only the nearest call that receives the value counts; logger receivers by name in the syntax tier', async () => {
    const text = [
      'class Members {',
      '    void Save(string email, string name, Store store, Auth auth, Tracker tracker) {',
      '        _logger.LogWarning("unknown {0}", email.ToLowerInvariant());',
      '        _logger.LogInformation("saved {0}", store.Upsert(name.Trim()));',
      '        auth.LogIn(email.Trim().ToLowerInvariant());',
      '        tracker.TraceParcel(name.ToUpperInvariant());',
      '        Log.Information($"Created {name.TrimEnd()}");',
      '        store.Lookup($"{email.TrimStart()} {name.TrimStart()}");',
      '        store.Query($"SELECT id FROM members WHERE email = \'{email.ToUpperInvariant()}\'");',
      '        html.AppendLine($"<b>Dear</b> {name.ToLowerInvariant()}");',
      '        if (email.Trim() == "") throw new InvalidOperationException($"bad {email.Trim()}");',
      '    }',
      '}',
    ].join('\n');
    const facts = (await syntaxFacts('Inline.cs', text)).filter(f => f.kind === 'normalization');
    expect(facts.map(f => `${f.line} ${f.text}`)).toEqual([
      '3 name.Trim()',
      '4 email.Trim().ToLowerInvariant()',
      '5 name.ToUpperInvariant()',
      '7 email.TrimStart()',
      '7 name.TrimStart()',
      '8 email.ToUpperInvariant()',
      '10 email.Trim()',
    ]);
  });
});
