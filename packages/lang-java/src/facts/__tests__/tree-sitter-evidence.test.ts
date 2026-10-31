import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import JavaLanguage from 'tree-sitter-java';
import { describe, expect, it } from 'vitest';
import type { CodeFact } from '@ctxo/plugin-api';
import { JDT_FIXTURE, LENDING_FIXTURE } from '../../__tests__/helpers/analyzer-jar.js';
import { JavaAdapter } from '../../java-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';
import { collectTreeSitterEvidence, overflowsInt } from '../tree-sitter-evidence.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(HERE, '../../../../plugin-api/conformance/fact-vectors.json');
const GOLDEN_PATH = join(HERE, '../../__tests__/fixtures/syntax-tier-facts-off.golden.json');

interface Vector { readonly input: string; readonly expected: boolean }
const JAVA_VECTORS = (JSON.parse(readFileSync(VECTORS_PATH, 'utf-8')) as {
  languageSpecific: { java: { overflowsInt: Vector[]; comparisonGivesEvidence: Vector[] } };
}).languageSpecific.java;

const parser = new Parser();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
parser.setLanguage(JavaLanguage as any);

const FILE = 'src/T.java';
const FACTS = 'src/main/java/lending/facts';

async function facts(source: string, file = FILE): Promise<CodeFact[]> {
  return new JavaAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(file, source);
}

/** `<owner> <line> <kind> <text>` per fact, the owner without the file prefix. */
async function rows(source: string, file = FILE): Promise<string[]> {
  return (await facts(source, file)).map((f) => `${f.symbolId.slice(file.length + 2)} ${f.line} ${f.kind} ${f.text}`);
}

function read(file: string): string {
  return readFileSync(resolve(LENDING_FIXTURE, file), 'utf-8');
}

/** The 0-based line of the only line of a fixture file that holds `needle`. */
function lineOf(file: string, needle: string): number {
  const hits = read(file).split(/\r?\n/).flatMap((line, i) => (line.includes(needle) ? [i] : []));
  expect(hits, needle).toHaveLength(1);
  return hits[0]!;
}

function find(node: SyntaxNode, type: string): SyntaxNode | undefined {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return undefined;
}

describe('collectTreeSitterEvidence (Java syntax tier)', () => {
  it('the syntax tier reports the Task 6 table', async () => {
    const rules = `${FACTS}/LoanRules.java`;
    const controller = `${FACTS}/LoanController.java`;
    const resource = `${FACTS}/HoldResource.java`;
    const out: string[] = [];
    for (const file of [rules, controller, resource]) {
      for (const f of await facts(read(file), file)) {
        out.push(`${f.symbolId.slice(file.length + 2)} ${f.line} ${f.kind} ${f.text} ${JSON.stringify(f.detail)}`);
      }
    }
    const method = (file: string, needle: string): number => lineOf(file, needle) - 1;
    expect(out).toEqual([
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
  });

  it('CRLF line endings give the same facts', async () => {
    for (const name of ['LoanRules.java', 'LoanController.java', 'HoldResource.java']) {
      const file = `${FACTS}/${name}`;
      const lf = read(file).replace(/\r\n/g, '\n');
      const crlf = lf.replace(/\n/g, '\r\n');
      const expected = await facts(lf, file);
      expect(expected.length).toBeGreaterThan(0);
      expect(await facts(crlf, file)).toEqual(expected);
    }
    // A multi-line literal: same line, text and value; detail.literal is the raw source slice in both
    // tiers (JDT keeps the CR too), so only its line breaks differ.
    const multiLine = 'class T {\n  boolean m(String s) {\n    return s\n      == """\n      gold\n      """ ? true : false;\n  }\n}\n';
    const lfFacts = await facts(multiLine);
    expect(lfFacts.map((f) => f.text)).toEqual(['s == """ gold """']);
    const crlfFacts = (await facts(multiLine.replace(/\n/g, '\r\n')))
      .map((f) => ({ ...f, detail: { ...f.detail, literal: f.detail!['literal']!.replace(/\r\n/g, '\n') } }));
    expect(crlfFacts).toEqual(lfFacts);
  });

  it('runs the languageSpecific.java overflowsInt vectors', () => {
    expect(JAVA_VECTORS.overflowsInt.length).toBeGreaterThan(0);
    for (const v of JAVA_VECTORS.overflowsInt) {
      const tree = parser.parse(`class T { void m(int x) { Object v = ${v.input}; } }`);
      const value = find(tree.rootNode, 'variable_declarator')!.childForFieldName('value')!;
      expect(value.text, v.input).toBe(v.input);
      expect(overflowsInt(value), v.input).toBe(v.expected);
    }
  });

  it('runs the languageSpecific.java comparisonGivesEvidence vectors', () => {
    expect(JAVA_VECTORS.comparisonGivesEvidence.length).toBeGreaterThan(0);
    for (const v of JAVA_VECTORS.comparisonGivesEvidence) {
      const tree = parser.parse(`class T { void m(int x) { if (${v.input}) {} } }`);
      const evidence = collectTreeSitterEvidence(tree.rootNode, FILE, [], DEFAULT_FACT_OPTIONS);
      expect(evidence.some((e) => e.kind === 'comparison'), v.input).toBe(v.expected);
    }
  });

  it('owners follow the JDT EmitVisitor ids', async () => {
    const source = [
      'interface I { int RETRY_LIMIT = 4; }',
      'record R(int a) { R { if (a == 7) {} } }',
      'enum E { A { void q(int x) { if (x == 8) {} } }; }',
      'class A {',
      '  int first = 0, retryDelay = 250;',
      '  { int initTimeout = 9; }',
      '  void m(int x) {',
      '    new Object() { void z(int y) { if (y == 10) {} } };',
      '    Runnable r = () -> { if (x == 11) {} };',
      '  }',
      '}',
    ].join('\n');
    expect(await rows(source)).toEqual([
      'RETRY_LIMIT::variable 0 retry-timeout RETRY_LIMIT = 4',
      'R::method 1 literal-comparison a == 7',
      'q::method 2 literal-comparison x == 8',
      'retryDelay::variable 4 retry-timeout retryDelay = 250',
      'A::class 5 retry-timeout initTimeout = 9',
      'z::method 7 literal-comparison y == 10',
      'm::method 8 literal-comparison x == 11',
    ]);
  });

  it('conditions, case labels and literal kinds follow the JDT collector', async () => {
    const source = [
      'class A {',
      '  int m(int x, String s, char c, Boolean b, Object o) {',
      '    while (!(x != 2) || s == "a") {}',
      '    do {} while (c == \'z\');',
      '    for (int i = 0; i < 3; i++) {}',
      '    if (b == true && o != null && x == -4 && x == +5 && x == 2 * 3) {}',
      '    if (x == y) {}',
      '    switch (s) { case "p", "q": break; default: break; }',
      '    int w = switch (x) { case 12 -> 1; case 0xFFFFFFFF -> 2; default -> 3; };',
      '    boolean plain = x == 13;',
      '    return 0;',
      '  }',
      '}',
    ].join('\n');
    expect(await rows(source)).toEqual([
      'm::method 2 literal-comparison s == "a"',
      'm::method 2 literal-comparison x != 2',
      "m::method 3 literal-comparison c == 'z'",
      'm::method 4 literal-comparison i < 3',
      'm::method 5 literal-comparison x == -4',
      'm::method 7 literal-comparison s case "p"',
      'm::method 7 literal-comparison s case "q"',
      'm::method 8 literal-comparison x case 12',
    ]);
  });

  it('calls match the patterns; super calls are not method invocations', async () => {
    const source = [
      'class A extends B {',
      '  String m(String s) {',
      '    super.trim(); A.super.trim();',
      '    return trim(s.toUpperCase()) + this.<String>trim() + s.trimStart() + s.normalize();',
      '  }',
      '}',
    ].join('\n');
    expect(await rows(source)).toEqual([
      'm::method 3 normalization this.<String>trim()',
      'm::method 3 normalization trim(s.toUpperCase())',
    ]);
  });

  it('FC-4b: a chain is one fact; message sinks, display text and formats give none', async () => {
    const source = [
      'package gen;',
      'import java.util.*;',
      'class Members {',
      '  interface Repo { String upsert(String v); void lookup(String k); void query(String q); }',
      '  interface Auth { void logIn(String v); }',
      '  static final org.slf4j.Logger log = null;',
      '  String save(String email, String name, char c, Map<String, String> store, List<String> items, Repo repo, Auth auth, StringBuilder sb) {',
      '    log.warn("unknown {}", email.toLowerCase());',
      '    store.put(email.toUpperCase(), name.trim());',
      '    log.info("saved " + repo.upsert(name.toLowerCase()));',
      '    auth.logIn(email.trim().toLowerCase());',
      '    log.info("Member: " + name.toUpperCase() + "!");',
      '    sb.append("Dear " + email.trim());',
      '    String caption = "Member: " + name.trim() + "!";',
      '    repo.query("SELECT id FROM members WHERE email = \'" + email.toUpperCase() + "\'");',
      '    repo.lookup(name.trim() + " " + email.toLowerCase());',
      '    if (email.trim().isEmpty()) throw new IllegalArgumentException(email.toUpperCase());',
      '    log.info(String.join(",", items.stream().map(i -> i.trim()).toList()));',
      '    String initial = String.valueOf(Character.toUpperCase(c));',
      '    String hex = HexFormat.of().formatHex(email.getBytes()).toUpperCase();',
      '    return caption + initial + hex + email.trim().toLowerCase();',
      '  }',
      '}',
    ].join('\n');
    expect((await rows(source)).filter((row) => row.includes(' normalization ')).map((row) => row.slice(row.indexOf(' ') + 1))).toEqual([
      '8 normalization email.toUpperCase()',
      '8 normalization name.trim()',
      '9 normalization name.toLowerCase()',
      '10 normalization email.trim().toLowerCase()',
      '13 normalization name.trim()',
      '14 normalization email.toUpperCase()',
      '15 normalization email.toLowerCase()',
      '15 normalization name.trim()',
      '16 normalization email.trim()',
      '17 normalization i.trim()',
      '20 normalization email.trim().toLowerCase()',
    ]);
  });

  it('bindings and durations by name; int overflow is not a constant', async () => {
    const source = [
      'import java.time.Duration;',
      'import java.time.temporal.ChronoUnit;',
      'class A {',
      '  static final Duration POLL_DELAY = Duration.ofSeconds(30);',
      '  long cacheTtl = 24 * 60 * 60 * 1000 * 365;',
      '  long cacheTtlMs = 24L * 60 * 60 * 1000 * 365;',
      '  @Retry(maxAttempts = 3) int attempts;',
      '  void m() {',
      '    int retryCount = 3;',
      '    this.timeoutMs = 500;',
      '    timeoutMs += 5;',
      '    Duration.of(5, ChronoUnit.MINUTES);',
      '    Duration.ofSeconds(1, 500);',
      '    Duration.ofMillis(100000 * 100000);',
      '    Other.ofSeconds(4);',
      '    backoff = (Duration.ofHours(2));',
      '    try (var lease = java.time.Duration.ofDays(1)) {}',
      '  }',
      '}',
    ].join('\n');
    expect(await rows(source)).toEqual([
      'POLL_DELAY::variable 3 retry-timeout POLL_DELAY = 30s',
      'cacheTtlMs::variable 5 retry-timeout cacheTtlMs = 31536000000',
      'attempts::variable 6 retry-timeout maxAttempts = 3',
      'm::method 8 retry-timeout retryCount = 3',
      'm::method 9 retry-timeout timeoutMs = 500',
      'm::method 11 retry-timeout Duration.of = 5min',
      'm::method 15 retry-timeout Duration.ofHours = 2h',
      'm::method 16 retry-timeout lease = 1d',
    ]);
  });

  it('text blocks go through the Java string decoder', async () => {
    const source = [
      'class A {',
      '  boolean m(String s) {',
      '    if (s == """',
      '        """) return true;',
      '    if (s == """',
      '        gold""") return false;',
      '    return s == "silver";',
      '  }',
      '}',
    ].join('\n');
    expect(await rows(source)).toEqual(['m::method 4 literal-comparison s == """ gold"""']);
  });

  it('code inside strings and comments gives nothing', async () => {
    expect(await rows('class A { String m() { /* if (x > 5) */ return "if (x > 5) timeout = 30"; } }')).toEqual([]);
  });

  it('evidence is capped at 2,000 records per file (routes come on top)', () => {
    const body = Array.from({ length: 2100 }, (_, i) => `if (x == ${i + 2}) {}`).join('\n');
    const tree = parser.parse(`class A { void m(int x) {\n${body}\n} }`);
    expect(collectTreeSitterEvidence(tree.rootNode, FILE, [], DEFAULT_FACT_OPTIONS)).toHaveLength(2000);
  });

  it('RequestMapping method enum values are annotation text, as in the JDT tier', async () => {
    const source = [
      '@RequestMapping("/h")',
      'class C {',
      '  @RequestMapping(value = "/a", method = {RequestMethod.GET, POST})',
      '  void a() {}',
      '}',
    ].join('\n');
    const symbols = await new JavaAdapter().extractSymbols(FILE, source);
    expect(symbols.find((s) => s.name === 'a')?.annotations).toEqual([
      { name: 'RequestMapping', args: ['/a'], named: { method: 'RequestMethod.GET,POST' } },
    ]);
    expect(await rows(source)).toEqual(['a::method 2 endpoint GET /h/a', 'a::method 2 endpoint POST /h/a']);
  });
});

describe('JavaAdapter facts option', () => {
  it('without the facts option extractFacts gives nothing', async () => {
    const adapter = new JavaAdapter();
    expect(adapter.facts).toBeUndefined();
    expect(await adapter.extractFacts(`${FACTS}/LoanRules.java`, read(`${FACTS}/LoanRules.java`))).toEqual([]);
  });

  it('facts off: symbols, edges and complexity of the synthetic samples are byte-identical to the tip golden', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as Record<string, { symbols: { symbolId: string; annotations?: { name: string; named?: Record<string, string> }[] }[] }>;
    // The one ruled change (Task 7 ledger): the syntax tier now keeps the enum text of `named.method`.
    const renew = golden['lending/src/main/java/lending/facts/LoanController.java']!.symbols
      .find((s) => s.symbolId.endsWith('::renew::method'))!.annotations!.find((a) => a.name === 'RequestMapping')!;
    renew.named = { ...renew.named, method: 'RequestMethod.POST' };
    const expected = JSON.stringify(golden, null, 2) + '\n';

    for (const options of [undefined, { facts: DEFAULT_FACT_OPTIONS }]) {
      const out: Record<string, unknown> = {};
      for (const [base, dir] of [['lending', LENDING_FIXTURE], ['fixture', JDT_FIXTURE]] as const) {
        for (const file of javaFiles(dir)) {
          const source = readFileSync(join(dir, file), 'utf-8').replace(/\r\n/g, '\n');
          const adapter = new JavaAdapter(options);
          out[`${base}/${file}`] = {
            symbols: await adapter.extractSymbols(file, source),
            edges: await adapter.extractEdges(file, source),
            complexity: await adapter.extractComplexity(file, source),
          };
        }
      }
      expect(JSON.stringify(out, null, 2) + '\n').toBe(expected);
    }
  });
});

function javaFiles(dir: string): string[] {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.java') ? [p] : [];
  });
  return walk(dir).map((p) => relative(dir, p).split('\\').join('/')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
