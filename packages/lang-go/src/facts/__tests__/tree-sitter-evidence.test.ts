import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import Parser from 'tree-sitter';
import GoLanguage from 'tree-sitter-go';
import type { CodeFact } from '@ctxo/plugin-api';
import { GoAdapter } from '../../go-adapter.js';
import { GoCompositeAdapter } from '../../composite-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';
import { collectTreeSitterEvidence } from '../tree-sitter-evidence.js';
import { AGREEING_SAMPLES, DIFFERING_SAMPLES } from '../../__tests__/fixtures/go-fact-samples.js';

const LENDING = join(import.meta.dirname, '..', '..', '..', 'test-fixtures', 'lending-module');
const FACTS = 'loans/facts.go';
const factId = (name: string, kind: string) => `${FACTS}::${name}::${kind}`;

/** The Task 8 table: the facts of loans/facts.go in the full tier (lending-module.integration.test.ts). */
const EXPECTED_FACTS = [
  { kind: 'retry-timeout', symbolId: factId('maxRetries', 'variable'), line: 10, text: 'maxRetries = 3', detail: { name: 'maxRetries', value: '3' } },
  { kind: 'retry-timeout', symbolId: factId('holdTimeout', 'variable'), line: 14, text: 'holdTimeout = 90min', detail: { name: 'holdTimeout', value: '90min' } },
  { kind: 'literal-comparison', symbolId: factId('MayBorrow', 'function'), line: 22, text: 'openLoans >= 5', detail: { operator: '>=', literal: '5' } },
  { kind: 'literal-comparison', symbolId: factId('Fee', 'function'), line: 31, text: 'tier case "gold"', detail: { operator: 'case', literal: '"gold"' } },
  { kind: 'normalization', symbolId: factId('Key', 'function'), line: 41, text: 'strings.ToLower(strings.TrimSpace(email))', detail: { method: 'ToLower' } },
  { kind: 'normalization', symbolId: factId('Key', 'function'), line: 41, text: 'strings.TrimSpace(email)', detail: { method: 'TrimSpace' } },
  { kind: 'endpoint', symbolId: factId('Routes', 'function'), line: 46, text: 'GET /holds/{id}', detail: { verb: 'GET', route: '/holds/{id}' } },
  { kind: 'endpoint', symbolId: factId('Routes', 'function'), line: 47, text: 'ANY /health', detail: { verb: 'ANY', route: '/health' } },
  { kind: 'endpoint', symbolId: factId('Routes', 'function'), line: 48, text: 'GET /loans/:id', detail: { verb: 'GET', route: '/loans/:id' } },
];

const lf = (s: string) => s.replace(/\r\n/g, '\n');
const crlf = (s: string) => lf(s).replace(/\n/g, '\r\n');
const factsSource = () => lf(readFileSync(join(LENDING, 'loans', 'facts.go'), 'utf-8'));

function syntaxFacts(file: string, source: string): Promise<CodeFact[]> {
  return new GoAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(file, source);
}

type Row = [line: number, kind: string, text: string, symbol: string];
const rows = (facts: readonly CodeFact[]): Row[] => facts.map((f) => [f.line, f.kind, f.text, f.symbolId.slice(f.symbolId.indexOf('::') + 2)]);

function evidenceOf(source: string) {
  const parser = new Parser();
  parser.setLanguage(GoLanguage as never);
  return collectTreeSitterEvidence(parser.parse(source).rootNode, 'app.go', [], DEFAULT_FACT_OPTIONS);
}

describe('Go syntax-tier facts', () => {
  it('the syntax tier reports the Task 8 table', async () => {
    expect(await syntaxFacts(FACTS, factsSource())).toEqual(EXPECTED_FACTS);
  });

  it('package-level constants use the analyzer\'s variable ids', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['packageLevel']!))).toEqual([
      [5, 'retry-timeout', 'retryLimit = 4', 'retryLimit::variable'],
      [9, 'retry-timeout', 'renewalBackoff = 1s', 'renewalBackoff::variable'],
      [12, 'literal-comparison', 'n >= 10', 'checker::variable'],
    ]);
  });

  it('CRLF line endings give the same facts', async () => {
    expect(await syntaxFacts(FACTS, crlf(factsSource()))).toEqual(EXPECTED_FACTS);
    for (const [name, source] of Object.entries({ ...AGREEING_SAMPLES, ...DIFFERING_SAMPLES })) {
      expect(await syntaxFacts('app.go', crlf(source)), name).toEqual(await syntaxFacts('app.go', lf(source)));
    }
  });

  it('without the facts option extractFacts returns []', async () => {
    expect(await new GoAdapter().extractFacts(FACTS, factsSource())).toEqual([]);
    expect(new GoAdapter().facts).toBeUndefined();
  });

  it('trivial comparisons and code inside strings give nothing, but the evidence is collected', async () => {
    const source = AGREEING_SAMPLES['nilAndStrings']!;
    expect(await syntaxFacts('app.go', source)).toEqual([]);
    expect(evidenceOf(source)).toEqual([
      { kind: 'comparison', symbolId: 'app.go::Check::function', line: 3, text: 'member != nil', operator: '!=', literal: 'nil', literalKind: 'null' },
      { kind: 'comparison', symbolId: 'app.go::Check::function', line: 3, text: 'ok == true', operator: '==', literal: 'true', literalKind: 'boolean' },
      { kind: 'comparison', symbolId: 'app.go::Check::function', line: 6, text: 'nil == member', operator: '==', literal: 'nil', literalKind: 'null' },
    ]);
  });

  it('shadowed nil and true are not literals', () => {
    expect(evidenceOf(AGREEING_SAMPLES['shadow']!)).toEqual([]);
  });

  it('closures belong to the enclosing declaration', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['closures']!))).toEqual([
      [8, 'literal-comparison', 'days > 14', 'Desk.Renew::method'],
    ]);
  });

  it('conditions, cases, bindings, struct fields and durations through the time import alias', async () => {
    const facts = await syntaxFacts('app.go', AGREEING_SAMPLES['rules']!);
    expect(rows(facts).map(([line, kind, text]) => [line, kind, text])).toEqual([
      [13, 'literal-comparison', 'i < 3'],
      [18, 'literal-comparison', 'n > 100'],
      [18, 'literal-comparison', 'tier == "x"'],
      [21, 'literal-comparison', "code case 'a'"],
      [21, 'literal-comparison', "code case 'b'"],
      [24, 'retry-timeout', 'maxAttempts = 5'],
      [25, 'retry-timeout', 'renewTimeout = 30s'],
      [26, 'retry-timeout', 'time.Millisecond = 2ms'],
      [27, 'retry-timeout', 'RetryCount = 2'],
      [27, 'retry-timeout', 'Window = 48h'],
      [28, 'retry-timeout', 'RetryCount = 7'],
      [29, 'normalization', 'strings.ToUpper(tier)'],
    ]);
    expect(new Set(facts.map((f) => f.symbolId))).toEqual(new Set(['app.go::Rules::function']));
  });

  it('literal forms, map keys, nested struct literals and products of two units', async () => {
    const facts = await syntaxFacts('app.go', AGREEING_SAMPLES['literals']!);
    expect(facts.map((f) => [f.line, f.kind, f.text, f.detail])).toEqual([
      [10, 'literal-comparison', 'n <= -3', { operator: '<=', literal: '-3' }],
      [10, 'literal-comparison', 'ratio > 0.75', { operator: '>', literal: '0.75' }],
      [12, 'literal-comparison', 'name != "\\x41"', { operator: '!=', literal: '"\\x41"' }],
      [12, 'literal-comparison', 'name == `gold`', { operator: '==', literal: '`gold`' }],
      [14, 'literal-comparison', 'n == 017', { operator: '==', literal: '017' }],
      [14, 'literal-comparison', 'n == 0x10', { operator: '==', literal: '0x10' }],
      [14, 'literal-comparison', 'n > 1_000', { operator: '>', literal: '1_000' }],
      [16, 'literal-comparison', 'n > 2', { operator: '>', literal: '2' }],
      [20, 'retry-timeout', 'DelayMs = 250', { name: 'DelayMs', value: '250' }],
      [21, 'retry-timeout', 'DelayMs = 120000', { name: 'DelayMs', value: '120000' }],
      [22, 'retry-timeout', 'backoffFactor = 1.5', { name: 'backoffFactor', value: '1.5' }],
      [22, 'retry-timeout', 'ttlSeconds = 3600', { name: 'ttlSeconds', value: '3600' }],
      [25, 'retry-timeout', 'time.Hour = 3h', { name: 'time.Hour', value: '3h' }],
      [26, 'retry-timeout', 'time.Minute = 5min', { name: 'time.Minute', value: '5min' }],
    ]);
  });

  it('a chained duration is reported once', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['chained']!))).toEqual([
      [5, 'retry-timeout', 'time.Second = 6s', 'Wait::function'],
      [6, 'retry-timeout', 'graceTimeout = 60min', 'Wait::function'],
    ]);
  });

  it('a product chain of 10,000 terms is linear and keeps the file\'s other facts (B-M2)', async () => {
    const product = Array.from({ length: 10_000 }, (_, i) => `x${i % 7}`).join(' * ');
    const source = `package p\n\nimport "time"\n\nfunc F(x int) {\n\ty := ${product}\n\t_ = y\n\tif x == 5 {\n\t}\n\tw := 2 * time.Second\n\t_ = w\n}\n`;
    const started = Date.now();
    const facts = await syntaxFacts('p.go', source);
    // The old code took 1.8 s for 1,000 terms (quadratic) and overflowed the stack at 10,000.
    // The bound leaves room for a slow CI runner (about 2.5 s on ubuntu-latest).
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(rows(facts).map(([line, kind, text]) => [line, kind, text])).toEqual([
      [7, 'literal-comparison', 'x == 5'],
      [9, 'retry-timeout', 'w = 2s'],
    ]);
  });

  it('a long matched duration chain is one duration with the nested amount', async () => {
    const source = (n: number) => `package p\n\nimport "time"\n\nfunc F() {\n\tw := 2 * time.Second${' * 1'.repeat(n)} * 3\n\t_ = w\n}\n`;
    const tree = new Parser();
    tree.setLanguage(GoLanguage as never);
    const short = collectTreeSitterEvidence(tree.parse(source(2)).rootNode, 'p.go', [], DEFAULT_FACT_OPTIONS);
    expect(short).toEqual([
      { kind: 'duration', symbolId: 'p.go::F::function', line: 5, name: 'w', constructor: 'time.Second', unit: 's', amount: '(((2) * (1)) * (1)) * (3)' },
    ]);
    const started = Date.now();
    expect(rows(await syntaxFacts('p.go', source(1_000)))).toEqual([[5, 'retry-timeout', 'w = 6s', 'F::function']]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('net/http, ServeMux and gin routes; a Group prefix is joined', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['routes']!)).map(([line, , text]) => [line, text])).toEqual([
      [11, 'POST /renew/{id}'],
      [12, 'ANY /holds'],
      [13, 'POST /loans'],
      [14, 'ANY /ping'],
      [15, 'DELETE /loans/:id'],
      [16, 'PUT /v2/members/:id'],
      [19, 'DELETE /holds/{id}'],
      [20, 'POST /café/menu'],
    ]);
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['ginInterfaces']!)).map(([line, , text]) => [line, text])).toEqual([
      [5, 'GET /loans/:id'],
      [6, 'POST /v2/holds'],
      [7, 'ANY /ping'],
      [8, 'PATCH /members/:id'],
    ]);
  });

  it('gin groups compose; dynamic, reassigned and parameter groups keep the route as written', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['ginGroups']!)).map(([line, , text]) => [line, text])).toEqual([
      [7, 'GET /api/v1/loans/:id'],
      [8, 'POST /api/holds'],
      [9, 'GET /param'],
      [11, 'GET /dyn'],
      [13, 'GET /deep'],
      [16, 'GET /t'],
      [17, 'PATCH /x/y/z'],
    ]);
  });

  it('echo routes and groups', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['echoRoutes']!)).map(([line, , text]) => [line, text])).toEqual([
      [6, 'GET /health'],
      [7, 'ANY /ping'],
      [8, 'PUT /members/:id'],
      [10, 'GET /api/loans/:id'],
      [11, 'DELETE /api/admin/users/:id'],
    ]);
  });

  it('chi routes, Route and Group closures, With and Mount; a dynamic mount keeps the route as written', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['chiRoutes']!)).map(([line, , text]) => [line, text])).toEqual([
      [8, 'GET /health'],
      [10, 'GET /api/loans/{id}'],
      [12, 'POST /api/v1/holds'],
      [15, 'PATCH /api/members/{id}'],
      [17, 'ANY /api/any'],
      [19, 'DELETE /admin/users/{id}'],
      [22, 'GET /x'],
    ]);
  });

  it('chi and echo method names give nothing without their import', async () => {
    const source = `package app

type cache struct{}

func (cache) Get(k string, v func()) {}
func (cache) Group(p string) cache   { return cache{} }
func (cache) GET(k string, v func()) {}

func Register(c cache) {
	c.Get("/x", nil)
	c.Group("/api").GET("/y", nil)
}
`;
    expect(await syntaxFacts('app.go', source)).toEqual([]);
  });

  it('routes by name need the framework import and a receiver that is not another package', async () => {
    const source = `package app

import "example.com/echo"

func Register(e *echo.Echo) {
	e.GET("/x", nil)
	e.HandleFunc("/y", nil)
	echo.GET("/z", nil)
}
`;
    expect(await syntaxFacts('app.go', source)).toEqual([]);
  });

  it('normalization calls follow the options', async () => {
    const source = AGREEING_SAMPLES['normalization']!;
    const methods = async (normalizationMethods: readonly string[]) =>
      (await new GoAdapter({ facts: { ...DEFAULT_FACT_OPTIONS, normalizationMethods } }).extractFacts('app.go', source)).map((f) => f.detail['method']);
    expect(await methods(DEFAULT_FACT_OPTIONS.normalizationMethods)).toEqual(['Normalize', 'TrimLeft']);
    expect(await methods(['strings.Title'])).toEqual(['Title']);
    expect(await methods([])).toEqual([]);
  });

  it('generic receivers drop their type parameters from the method ID', async () => {
    expect(rows(await syntaxFacts('app.go', AGREEING_SAMPLES['generic']!))).toEqual([
      [5, 'literal-comparison', 'i > 9', 'List.Get::method'],
      [17, 'literal-comparison', 'n == 42', 'Pair.Swap::method'],
    ]);
  });

  it('the accepted differences give the syntax tier\'s facts', async () => {
    expect(rows(await syntaxFacts('app.go', DIFFERING_SAMPLES['fakeMux']!))).toEqual([[9, 'endpoint', 'ANY /fake', 'Register::function']]);
    expect(await syntaxFacts('app.go', DIFFERING_SAMPLES['elsewhere']!)).toEqual([]);
    expect(rows(await syntaxFacts('app.go', DIFFERING_SAMPLES['namedMap']!))).toEqual([[7, 'retry-timeout', 'retryKey = 3', 'Build::function']]);
  });

  it('evidence stops at 2,000 records per file and facts at 500', async () => {
    const source = `package app\n\nfunc Many(n int) {\n${'\tif n == 42 {\n\t}\n'.repeat(2050)}}\n`;
    expect(evidenceOf(source)).toHaveLength(2000);
    const facts = await syntaxFacts('app.go', source);
    expect(facts).toHaveLength(500);
    expect(facts[499]!.line).toBe(3 + 2 * 499);
    expect(await syntaxFacts('app.go', source)).toEqual(facts);
  });

  it('a file that does not parse cleanly still gives the facts of its valid parts', async () => {
    const facts = await syntaxFacts('app.go', 'package app\n\nfunc F(n int) {\n\tif n > 7 {\n\t}\n}\n\nfunc G( {\n');
    expect(rows(facts)).toContainEqual([3, 'literal-comparison', 'n > 7', 'F::function']);
  });
});

describe('Go syntax tier with facts off', () => {
  it('symbols, edges and complexity are byte-identical to the pre-facts output', async () => {
    const golden = readFileSync(join(import.meta.dirname, '..', '..', '__tests__', 'fixtures', 'syntax-tier-facts-off.golden.json'), 'utf-8');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.go')) files.push(p);
      }
    };
    walk(LENDING);
    files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const adapter of [new GoAdapter(), new GoAdapter({ facts: DEFAULT_FACT_OPTIONS })]) {
      const out: Record<string, unknown> = {};
      for (const f of files) {
        const rel = relative(LENDING, f).replace(/\\/g, '/');
        const src = lf(readFileSync(f, 'utf-8'));
        out[rel] = {
          symbols: await adapter.extractSymbols(rel, src),
          edges: await adapter.extractEdges(rel, src),
          complexity: await adapter.extractComplexity(rel, src),
        };
      }
      expect(JSON.stringify(out, null, 2) + '\n').toBe(lf(golden));
    }
  });

  it('the composite without facts gives [] in the syntax tier, with facts the syntax tier\'s facts', async () => {
    expect(await new GoCompositeAdapter().extractFacts(FACTS, factsSource())).toEqual([]);
    const composite = new GoCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS });
    expect(composite.getTier()).toBe('syntax');
    expect(await composite.extractFacts(FACTS, factsSource())).toEqual(EXPECTED_FACTS);
  });
});
