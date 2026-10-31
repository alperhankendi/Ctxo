import { describe, expect, it, vi } from 'vitest';
import { Project } from 'ts-morph';
import type { CodeFact, FactKind } from '@ctxo/plugin-api';
import { TsMorphAdapter } from '../../ts-morph-adapter.js';
import { ModuleResolver } from '../../sql/module-resolver.js';
import { readLendingSample } from '../../__tests__/helpers/lending-sample.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';
import { ROUTE_MODULES, collectTsEvidence } from '../ts-evidence.js';

const RULES = 'src/facts/loan-rules.ts';
const HTTP = 'src/facts/http.ts';
const FASTIFY = 'src/facts/fastify-routes.ts';
const CONTROLLER = 'src/loan.controller.ts';

interface Row {
  readonly file: string;
  readonly symbol: string;
  readonly kind: FactKind;
  readonly text: string;
  readonly detail: Record<string, string>;
  /** The fixture text on the evidence's first line. */
  readonly needle: string;
}

const ROWS: readonly Row[] = [
  { file: RULES, symbol: 'MAX_RETRIES::variable', kind: 'retry-timeout', text: 'MAX_RETRIES = 3', detail: { name: 'MAX_RETRIES', value: '3' }, needle: 'MAX_RETRIES = 3' },
  { file: RULES, symbol: 'canBorrow::function', kind: 'literal-comparison', text: 'openLoans >= 5', detail: { operator: '>=', literal: '5' }, needle: 'openLoans >= 5' },
  { file: RULES, symbol: 'fee::function', kind: 'literal-comparison', text: "tier case 'gold'", detail: { operator: 'case', literal: "'gold'" }, needle: "case 'gold'" },
  { file: RULES, symbol: 'key::function', kind: 'normalization', text: 'email.trim().toLowerCase()', detail: { method: 'toLowerCase' }, needle: 'email.trim().toLowerCase()' },
  { file: RULES, symbol: 'remind::function', kind: 'retry-timeout', text: 'setTimeout = 30000ms', detail: { name: 'setTimeout', value: '30000ms' }, needle: 'setTimeout(send' },
  { file: RULES, symbol: 'client::variable', kind: 'retry-timeout', text: 'timeout = 5000', detail: { name: 'timeout', value: '5000' }, needle: 'timeout: 5000' },
  { file: RULES, symbol: 'label::function', kind: 'literal-comparison', text: 'days > 14', detail: { operator: '>', literal: '14' }, needle: 'days > 14' },
  { file: HTTP, symbol: 'http::variable', kind: 'endpoint', text: 'GET /holds/:id', detail: { verb: 'GET', route: '/holds/:id' }, needle: "router.get('/holds/:id'" },
  { file: FASTIFY, symbol: 'routes::function', kind: 'endpoint', text: 'GET /members/:id', detail: { verb: 'GET', route: '/members/:id' }, needle: "app.get('/members/:id'" },
  { file: FASTIFY, symbol: 'routes::function', kind: 'endpoint', text: 'POST /members', detail: { verb: 'POST', route: '/members' }, needle: 'app.route(' },
  { file: FASTIFY, symbol: 'routes::function', kind: 'endpoint', text: 'PUT /members', detail: { verb: 'PUT', route: '/members' }, needle: 'app.route(' },
  { file: CONTROLLER, symbol: 'LoanController.find::method', kind: 'endpoint', text: 'GET /loans/:id', detail: { verb: 'GET', route: '/loans/:id' }, needle: "@Get(':id')" },
];

const FILES = [...new Set(ROWS.map((row) => row.file))];

function lineOf(source: string, needle: string): number {
  const line = source.split(/\r?\n/).findIndex((text) => text.includes(needle));
  if (line < 0) throw new Error(`needle not found: ${needle}`);
  return line;
}

function expectedFacts(file: string, sample: Map<string, string>): CodeFact[] {
  return ROWS.filter((row) => row.file === file).map((row) => ({
    kind: row.kind,
    symbolId: `${file}::${row.symbol}`,
    line: lineOf(sample.get(file)!, row.needle),
    text: row.text,
    detail: row.detail,
  }));
}

async function sampleFacts(): Promise<Map<string, CodeFact[]>> {
  const sample = readLendingSample();
  const adapter = new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS });
  adapter.loadProjectSources(sample);
  const out = new Map<string, CodeFact[]>();
  for (const [file, source] of sample) out.set(file, await adapter.extractFacts(file, source));
  adapter.clearProjectSources();
  return out;
}

async function factsOf(file: string, source: string): Promise<CodeFact[]> {
  return new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(file, source);
}

describe('TypeScript fact evidence', () => {
  it.each(FILES)('the fixtures give the expected facts: %s', async (file) => {
    const sample = readLendingSample();
    const facts = await sampleFacts();
    expect(facts.get(file)).toEqual(expectedFacts(file, sample));
  });

  it('receiver tracing keeps Map.get and axios.get out', async () => {
    const facts = (await sampleFacts()).get(HTTP)!;
    expect(facts.map((f) => f.text)).toEqual(['GET /holds/:id']);
    expect(ROUTE_MODULES).toEqual(new Set(['express', 'fastify', '@koa/router', 'koa-router', 'hono']));
  });

  it('a route call on an untraced receiver or with a non-literal path gives nothing', async () => {
    const source = [
      "import express from 'express';",
      'const app = express();',
      'declare const other: { get(path: string): void };',
      "other.get('/x');",
      'const path = "/y";',
      'app.get(path, () => {});',
      "app.route('/z').get(() => {});",
      "app.post(`/t${1}`, () => {});",
      "app.all(`/any`, () => {});",
    ].join('\n');
    expect((await factsOf('src/app.ts', source)).map((f) => f.text)).toEqual(['ANY /any']);
  });

  it('a verb call without a handler argument is not a route', async () => {
    const source = [
      "import express from 'express';",
      "import Fastify from 'fastify';",
      'const app = express();',
      "const env = app.get('env');",
      'const server = Fastify();',
      "server.get('/only-path');",
      "app.get('/ok', (_req, res) => res.end());",
      "server.post('/ok2', async () => ({}));",
    ].join('\n');
    expect((await factsOf('src/settings.ts', source)).map((f) => f.text)).toEqual(['GET /ok', 'POST /ok2']);
  });

  it('top-level registrations attach to the module symbol', async () => {
    const source = ["import express from 'express';", 'const app = express();', "app.delete('/holds/:id', () => {});"].join('\n');
    expect(await factsOf('src/server.ts', source)).toEqual([
      { kind: 'endpoint', symbolId: 'src/server.ts::server::variable', line: 2, text: 'DELETE /holds/:id', detail: { verb: 'DELETE', route: '/holds/:id' } },
    ]);
  });

  it('a non-exported function gets its own symbol id', async () => {
    const facts = (await sampleFacts()).get(RULES)!;
    expect(facts.find((f) => f.text === 'days > 14')?.symbolId).toBe(`${RULES}::label::function`);

    const source = [
      'class Policy {',
      '  check(n: number) { if (n > 7) return 1; return 2; }',
      '  limit = 9;',
      '  get retryDelay() { return n > 8; }',
      '}',
      'export class Shown {',
      '  ctor(n: number) { if (n > 3) {} }',
      '  constructor(n: number) { if (n < 4) {} }',
      '}',
    ].join('\n');
    const ids = (await factsOf('src/policy.ts', source)).map((f) => [f.text, f.symbolId]);
    expect(ids).toEqual([
      ['n > 7', 'src/policy.ts::Policy.check::method'],
      ['n > 3', 'src/policy.ts::Shown.ctor::method'],
      ['n < 4', 'src/policy.ts::Shown::class'],
    ]);
  });

  it('facts in test files carry test-block ids', async () => {
    const file = 'src/__tests__/x.test.ts';
    const source = "describe('limits', () => { it('five', () => { if (n >= 5) {} }) })";
    expect(await factsOf(file, source)).toEqual([
      { kind: 'literal-comparison', symbolId: `${file}::limits > five::function`, line: 0, text: 'n >= 5', detail: { operator: '>=', literal: '5' } },
    ]);
  });

  it('trivial literals and strings give nothing', async () => {
    const texts = [...(await sampleFacts()).values()].flat().map((f) => f.text);
    for (const forbidden of ['member === null', "member !== ''", "case ''", 'settlementDays', 'x > 5', 'cache.get', 'axios']) {
      expect(texts.some((t) => t.includes(forbidden)), forbidden).toBe(false);
    }

    const source = [
      'export function f(a: number, s: string, b: boolean) {',
      '  if (a === 0 || a !== -1 || a < 1) {}',
      "  while (s !== '' && s != \"\" && s === ``) {}",
      '  if (b === true || b !== false || s == null) {}',
      '  if (a > 0.0 || a >= 1e0 || a == 0x1) {}',
      '}',
    ].join('\n');
    expect(await factsOf('src/f.ts', source)).toEqual([]);
  });

  it('comparisons are found in every condition form, through &&, || and !', async () => {
    const source = [
      'export function g(a: number, s: string) {',
      '  while (!(a > 2)) {}',
      '  do {} while (a < 3 || s === `t`);',
      '  for (let i = 0; i < 10; i++) {}',
      "  const r = s !== 'z' ? 1 : 2;",
      '  if (-5 < a) {}',
      '  const notACondition = a > 99;',
      '  if (a > b) {}',
      '}',
    ].join('\n');
    expect((await factsOf('src/g.ts', source)).map((f) => [f.text, f.detail])).toEqual([
      ['a > 2', { operator: '>', literal: '2' }],
      ['a < 3', { operator: '<', literal: '3' }],
      ['s === `t`', { operator: '===', literal: '`t`' }],
      ['i < 10', { operator: '<', literal: '10' }],
      ["s !== 'z'", { operator: '!==', literal: "'z'" }],
      ['-5 < a', { operator: '<', literal: '-5' }],
    ]);
  });

  it('bindings need a retry or timeout name and a numeric constant; setTimeout needs a second argument', async () => {
    const source = [
      'export class Client {',
      '  requestTimeout = 30 * 1000;',
      "  'retry-count' = 4;",
      '  name = 7;',
      '}',
      'export function h(o: { backoffMs: number }, run: () => void) {',
      '  let maxAttempts = 5;',
      '  o.backoffMs = 250;',
      '  const cfg = { ttlSeconds: 60, label: 3, delay: x };',
      '  window.setTimeout(run, 2 * 1000);',
      '  globalThis.setTimeout(run, 10);',
      '  setTimeout(run);',
      '  setTimeout(run, delayMs);',
      '}',
    ].join('\n');
    expect((await factsOf('src/h.ts', source)).map((f) => f.text)).toEqual([
      'requestTimeout = 30000',
      'retry-count = 4',
      'maxAttempts = 5',
      'backoffMs = 250',
      'ttlSeconds = 60',
      'setTimeout = 2000ms',
      'setTimeout = 10ms',
    ]);
  });

  it('FC-4b: a chain is one fact; message sinks, display text and formats give none', async () => {
    const source = [
      "import { createHash } from 'node:crypto';",
      "import * as path from 'node:path';",
      'export async function members(email: string, name: string, file: string, store: Map<string, string>, items: string[], db: Db, auth: Auth) {',
      '  store.set(email.trim().toLowerCase(), name.trim());',
      '  const id = `${email.toUpperCase()}:${name.length}`;',
      '  console.warn(email.toLowerCase());',
      '  console.log(`member ${name.trim()} saved`);',
      "  const caption = 'Member: ' + name.trim();",
      '  if (!email.trim()) throw new Error(email.toUpperCase());',
      "  const hash = createHash('sha256').update(email).digest('hex').toUpperCase();",
      '  const kind = path.extname(file).toLowerCase();',
      "  const folder = file.trim().replace(/\\/+$/, '');",
      '  console.info(items.map((i) => i.trim()).join());',
      '  const query = sql`SELECT * FROM members WHERE email = ${email.toLowerCase()}`;',
      '  console.log("saved", await db.upsert(email.toLowerCase()));',
      '  await auth.logIn(email.trim().toLowerCase());',
      '  await db.query(`SELECT id FROM members WHERE email = ${email.toUpperCase()}`);',
      '  db.lookup(`${name.toLowerCase()} ${file.toLowerCase()}`);',
      '  return { id, caption, hash, kind, folder, query };',
      '}',
      'declare function sql(parts: TemplateStringsArray, ...values: unknown[]): string;',
      'interface Db { upsert(v: string): Promise<string>; query(q: string): Promise<void>; lookup(k: string): void }',
      'interface Auth { logIn(email: string): Promise<void> }',
    ].join('\n');
    const facts = (await factsOf('src/members.ts', source)).filter((f) => f.kind === 'normalization');
    expect(facts.map((f) => `${f.line} ${f.text}`)).toEqual([
      '3 email.trim().toLowerCase()',
      '3 name.trim()',
      '4 email.toUpperCase()',
      '7 name.trim()',
      '8 email.trim()',
      '11 file.trim()',
      '12 i.trim()',
      '13 email.toLowerCase()',
      '14 email.toLowerCase()',
      '15 email.trim().toLowerCase()',
      '16 email.toUpperCase()',
      '17 file.toLowerCase()',
      '17 name.toLowerCase()',
    ]);
  });

  it('FC-4b: a logger is known by its type; without one, by a logger-like receiver name', async () => {
    const source = [
      'export function f(email: string, log: any, tracker: { traceParcel(v: string): void }) {',
      '  log.warn(email.toLowerCase());',
      '  tracker.traceParcel(email.toUpperCase());',
      '}',
    ].join('\n');
    const facts = (await factsOf('src/f.ts', source)).filter((f) => f.kind === 'normalization');
    expect(facts.map((f) => `${f.line} ${f.text}`)).toEqual(['2 email.toUpperCase()']);
  });

  it('FC-4b: typed loggers of the common TypeScript libraries are sinks; an unknown type with a logger name too', async () => {
    const stubs = [
      "declare module 'pino' { export interface Logger { warn(m: string): void } }",
      "declare module 'winston' { export interface Logger { warn(m: string): void } }",
      "declare module '@nestjs/common' { export class Logger { warn(m: string): void } export interface LoggerService { warn(m: string): void } }",
      "declare module 'bunyan' { class Logger { warn(m: string): void } export = Logger; }",
      "declare module 'log4js' { export interface Logger { warn(m: string): void } }",
      "declare module 'tslog' { export class Logger<T> { warn(m: string): void } }",
    ].join('\n');
    const source = [
      "import type { Logger as Pino } from 'pino';",
      "import type { Logger as Winston } from 'winston';",
      "import { Logger as Nest, type LoggerService } from '@nestjs/common';",
      "import type Bunyan from 'bunyan';",
      "import type { Logger as Log4js } from 'log4js';",
      "import type { Logger as TsLog } from 'tslog';",
      'interface Notifier { warn(m: string): void }',
      'export class Members {',
      '  constructor(private readonly logger: Pino, private readonly a: Winston, private readonly b: Nest, private readonly c: LoggerService,',
      '    private readonly d: Bunyan, private readonly e: Log4js, private readonly f: TsLog<unknown>, private readonly notifier: Notifier,',
      '    private readonly log: Notifier) {}',
      '  save(email: string): void {',
      '    this.logger.warn(email.trim());',
      '    this.a.warn(email.trim());',
      '    this.b.warn(email.trim());',
      '    this.c.warn(email.trim());',
      '    this.d.warn(email.trim());',
      '    this.e.warn(email.trim());',
      '    this.f.warn(email.trim());',
      '    this.notifier.warn(email.toLowerCase());',
      '    this.log.warn(email.toUpperCase());',
      '  }',
      '}',
    ].join('\n');
    const adapter = new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS });
    adapter.loadProjectSources(new Map([['src/types/loggers.d.ts', stubs], ['src/members.ts', source]]));
    const facts = (await adapter.extractFacts('src/members.ts', source)).filter((f) => f.kind === 'normalization');
    adapter.clearProjectSources();
    expect(facts.map((f) => `${f.line} ${f.text}`)).toEqual(['19 email.toLowerCase()']);
  });

  it('FC-4b: a Console-typed field under another name is a sink by its lib type', async () => {
    const source = [
      'export class Members {',
      '  private readonly out: Console = console;',
      '  private readonly seen = new Map<string, string>();',
      '  save(email: string): void {',
      '    this.out.warn(email.trim());',
      '    this.seen.set(email.toLowerCase(), email);',
      '  }',
      '}',
    ].join('\n');
    const facts = (await factsOf('src/members.ts', source)).filter((f) => f.kind === 'normalization');
    expect(facts.map((f) => `${f.line} ${f.text}`)).toEqual(['5 email.toLowerCase()']);
  });

  it('a custom normalization list replaces the defaults', async () => {
    const source = 'export function k(e: string) { return e.trim().toLowerCase().normalize(); }';
    const adapter = new TsMorphAdapter({ facts: { ...DEFAULT_FACT_OPTIONS, normalizationMethods: ['normalize'] } });
    expect((await adapter.extractFacts('src/k.ts', source)).map((f) => f.detail)).toEqual([{ method: 'normalize' }]);
  });

  it('extracting the same file twice gives deep-equal facts', async () => {
    const sample = readLendingSample();
    const adapter = new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS });
    const first = await adapter.extractFacts(RULES, sample.get(RULES)!);
    const second = await adapter.extractFacts(RULES, sample.get(RULES)!);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('typeof checks are type guards, not literal comparisons', async () => {
    const source = [
      'export function t(x: unknown, n: number) {',
      "  if (typeof x === 'string' || typeof x !== 'undefined') {}",
      "  if ('number' == typeof x && (typeof (x) != 'bigint')) {}",
      "  const kind = typeof x === 'object' ? 1 : 2;",
      "  switch (typeof x) { case 'boolean': break; }",
      '  if (n > 5) {}',
      '}',
    ].join('\n');
    expect((await factsOf('src/t.ts', source)).map((f) => f.text)).toEqual(['n > 5']);
  });

  it('fact owners stay linear in file size (scale)', async () => {
    const methods = 4_000;
    let source = 'export class Big {\n';
    for (let i = 0; i < methods; i++) {
      source += `  m${i}(x: number, s: string) { if (x === ${i + 2} && s === 'k${i}') return 1; const retryDelay = ${i}; return 0; }\n`;
    }
    source += '}\n';
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('/src/big.ts', source);
    const started = Date.now();
    const evidence = collectTsEvidence(sourceFile, 'src/big.ts', new ModuleResolver(project), DEFAULT_FACT_OPTIONS);
    const elapsed = Date.now() - started;
    // Three records per method, each owned by the method on its line.
    expect(evidence.length).toBe(methods * 3);
    expect(evidence.every((e) => e.symbolId === `src/big.ts::Big.m${e.line - 1}::method`)).toBe(true);
    // The old code checked every scope for every record and counted lines from the file start: over 10 s here.
    // The bound leaves room for a slow CI runner (about 3.7 s on ubuntu-latest).
    expect(elapsed).toBeLessThan(8_000);
  }, 120_000);

  it('owners: the smallest scope wins and nested test blocks are excluded', async () => {
    const file = 'src/__tests__/o.test.ts';
    const source = [
      "describe('outer', () => {",
      '  if (a > 2) {}',
      "  it('inner', () => { if (b > 3) {} });",
      '  if (c > 4) {}',
      '});',
      'export function after(d: number) { if (d > 6) {} }',
      'export class K { run(e: number) { if (e > 7) {} } }',
      'if (f > 8) {}',
    ].join('\n');
    expect((await factsOf(file, source)).map((f) => [f.text, f.symbolId])).toEqual([
      ['a > 2', `${file}::outer::function`],
      ['b > 3', `${file}::outer > inner::function`],
      ['c > 4', `${file}::outer::function`],
      ['d > 6', `${file}::after::function`],
      ['e > 7', `${file}::K.run::method`],
      ['f > 8', expect.stringMatching(/^src\/__tests__\/o\.test\.ts::/)],
    ]);
  });

  it('a failing fact extraction warns and returns no facts (warn-and-continue)', async () => {
    const options = { ...DEFAULT_FACT_OPTIONS };
    Object.defineProperty(options, 'normalizationMethods', {
      get() {
        throw new Error('detector exploded');
      },
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const adapter = new TsMorphAdapter({ facts: options });
      await expect(adapter.extractFacts('src/boom.ts', 'export function f(e: string) { return e.trim(); }')).resolves.toEqual([]);
      const lines = stderr.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes('[ctxo:lang-typescript]') && line.includes('src/boom.ts') && line.includes('detector exploded'))).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });

  it('collectTsEvidence works on a bare source file', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('/src/a.ts', 'export function a(n: number) { if (n > 5) {} }');
    const resolver = new ModuleResolver(project);
    expect(collectTsEvidence(sourceFile, 'src/a.ts', resolver, DEFAULT_FACT_OPTIONS)).toEqual([
      { kind: 'comparison', symbolId: 'src/a.ts::a::function', line: 0, text: 'n > 5', operator: '>', literal: '5', literalKind: 'number' },
    ]);
  });
});
