import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CodeFact } from '@ctxo/plugin-api';
import { CAN_RUN_JDT, JDT_FIXTURE, LENDING_FIXTURE, testAnalyzerJar } from './helpers/analyzer-jar.js';
import { JavaCompositeAdapter } from '../composite-adapter.js';
import { JavaAdapter } from '../java-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';
import type { FactOptions } from '../facts/fact-types.js';

// Review Focus 2: on the synthetic samples the JDT tier and the tree-sitter tier give the same facts.

const VECTORS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../plugin-api/conformance/fact-vectors.json');
interface Vector { readonly input: string; readonly expected: boolean }
const JAVA_VECTORS = (JSON.parse(readFileSync(VECTORS_PATH, 'utf-8')) as {
  languageSpecific: { java: { overflowsInt: Vector[]; comparisonGivesEvidence: Vector[] } };
}).languageSpecific.java;

/** Generated sources: every overflowsInt vector as a retry binding, every comparisonGivesEvidence vector as a condition, and the shapes the unit tests cover. */
function generatedSources(): Record<string, string> {
  const overflow = JAVA_VECTORS.overflowsInt
    .filter((v) => !v.input.includes('x'))
    .map((v, i) => `  double retryValue${i} = ${v.input};`);
  const comparisons = JAVA_VECTORS.comparisonGivesEvidence.map((v, i) => `  void c${i}(int x) { if (${v.input}) {} }`);
  return {
    'src/gen/Vectors.java': ['package gen;', 'class Vectors {', ...overflow, ...comparisons, '}', ''].join('\n'),
    'src/gen/Shapes.java': [
      'package gen;',
      'import java.time.Duration;',
      'import java.time.temporal.ChronoUnit;',
      'interface Limits { int RETRY_LIMIT = 4; }',
      'record Range(int a) { Range { if (a == 7) {} } }',
      'enum Tier { GOLD { void q(int x) { if (x == 8) {} } }; }',
      'class Shapes {',
      '  int first = 0, retryDelay = 250;',
      '  static final Duration POLL_DELAY = Duration.ofSeconds(30);',
      '  long cacheTtl = 24 * 60 * 60 * 1000 * 365;',
      '  long cacheTtlMs = 24L * 60 * 60 * 1000 * 365;',
      '  int timeoutMs;',
      '  Duration backoff;',
      '  { int initTimeout = 9; }',
      '  int m(int x, String s, char c, Boolean b, Object o) {',
      '    while (!(x != 2) || s == "a") {}',
      '    do {} while (c == \'z\');',
      '    for (int i = 0; i < 3; i++) {}',
      '    if (b == true && o != null && x == -4 && x == +5 && x == 2 * 3) {}',
    '    if (x == 1 == true || (x == 2) != false || s.isEmpty() == true) {}',
      '    switch (s) { case "p", "q": break; default: break; }',
      '    int w = switch (x) { case 12 -> 1; case 0xFFFFFFFF -> 2; default -> 3; };',
      '    new Object() { void z(int y) { if (y == 10) {} } };',
      '    Runnable r = () -> { if (x == 11) {} };',
      '    int retryCount = 3;',
      '    this.timeoutMs = 500;',
      '    timeoutMs += 5;',
      '    Duration.of(5, ChronoUnit.MINUTES);',
      '    Duration.ofSeconds(1, 500);',
      '    Duration.ofMillis(100000 * 100000);',
      '    backoff = (Duration.ofHours(2));',
      '    String t = s.trim().toUpperCase() + s.trimStart() + this.<String>id(s.toLowerCase());',
      '    if (s == """',
      '        """) return 1;',
      '    if (s == """',
      '        gold""") return 2;',
      '    return w;',
      '  }',
      '  <T> T id(T v) { return v; }',
      '}',
      '',
    ].join('\n'),
    // FC-4b: message sinks, display text, formats and chains; the slf4j stub gives JDT a known logger type.
    'src/org/slf4j/Logger.java': [
      'package org.slf4j;',
      'public interface Logger { void info(String m); void warn(String m, Object a); }',
      '',
    ].join('\n'),
    'src/gen/Members.java': [
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
      '',
    ].join('\n'),
  };
}

function javaFiles(dir: string): string[] {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.java') ? [p] : [];
  });
  return walk(dir).map((p) => relative(dir, p).split('\\').join('/')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The default options, and none trivial (so comparisons with trivial literals are compared too). */
const OPTION_SETS: [string, FactOptions][] = [
  ['default', DEFAULT_FACT_OPTIONS],
  ['strict', { trivialLiterals: [], normalizationMethods: DEFAULT_FACT_OPTIONS.normalizationMethods }],
];

/** Facts mapped to `{ kind, line, text, detail, symbolId }` and sorted. */
function shape(facts: readonly CodeFact[]): string[] {
  return facts
    .map((f) => JSON.stringify({ kind: f.kind, line: f.line, text: f.text, detail: f.detail, symbolId: f.symbolId }))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every sample: the fixture files as `[label, file, source]`, and the generated sources. */
function samples(): [string, string, string][] {
  const fromDir = (label: string, dir: string): [string, string, string][] =>
    javaFiles(dir).map((file) => [label, file, readFileSync(join(dir, file), 'utf-8')]);
  return [
    ...fromDir('lending', LENDING_FIXTURE),
    ...fromDir('fixture', JDT_FIXTURE),
    ...Object.entries(generatedSources()).map(([file, source]): [string, string, string] => ['generated', file, source]),
  ];
}

describe('Java syntax tier: fact owners are symbols', () => {
  it('every fact symbolId is a symbol extractSymbols returns for the same file', async () => {
    let total = 0;
    for (const [, options] of OPTION_SETS) {
      const syntax = new JavaAdapter({ facts: options });
      for (const [label, file, source] of samples()) {
        const ids = new Set((await syntax.extractSymbols(file, source)).map((s) => s.symbolId));
        for (const fact of await syntax.extractFacts(file, source)) {
          total++;
          expect(ids.has(fact.symbolId), `${label}/${file}: ${fact.symbolId} (${fact.text})`).toBe(true);
        }
      }
    }
    expect(total).toBeGreaterThan(30);
  });
});

describe.skipIf(!CAN_RUN_JDT)('Java fact tier agreement (JDT full tier vs tree-sitter syntax tier)', () => {
  const generated = mkdtempSync(join(tmpdir(), 'ctxo-java-facts-'));
  const roots: [string, string][] = [['lending', LENDING_FIXTURE], ['fixture', JDT_FIXTURE], ['generated', generated]];
  const full = new Map<string, JavaCompositeAdapter>();

  beforeAll(async () => {
    for (const [file, source] of Object.entries(generatedSources())) {
      mkdirSync(join(generated, file, '..'), { recursive: true });
      writeFileSync(join(generated, file), source);
    }
    vi.stubEnv('CTXO_JDT_ANALYZER_JAR', testAnalyzerJar()!);
    for (const [optionsName, options] of OPTION_SETS) {
      for (const [name, dir] of roots) {
        const adapter = new JavaCompositeAdapter({ facts: options });
        await adapter.initialize(dir);
        full.set(`${optionsName}:${name}`, adapter);
      }
    }
  }, 300_000);

  afterAll(async () => {
    for (const adapter of full.values()) await adapter.dispose();
    vi.unstubAllEnvs();
    rmSync(generated, { recursive: true, force: true });
  });

  it('both tiers give the same symbol ids', async () => {
    for (const [name, dir] of roots) {
      const jdt = full.get(`default:${name}`)!;
      for (const file of javaFiles(dir)) {
        const source = readFileSync(join(dir, file), 'utf-8');
        const ids = async (adapter: { extractSymbols(f: string, s: string): Promise<{ symbolId: string }[]> }) =>
          new Set((await adapter.extractSymbols(file, source)).map((s) => s.symbolId));
        const syntaxIds = await ids(new JavaAdapter());
        const jdtIds = await ids(jdt);
        expect([...jdtIds].filter((id) => !syntaxIds.has(id)), `${name}/${file} missing`).toEqual([]);
        expect([...syntaxIds].filter((id) => !jdtIds.has(id)), `${name}/${file} extra`).toEqual([]);
      }
    }
  }, 300_000);

  it('both tiers give the same facts', async () => {
    let total = 0;
    for (const [optionsName, options] of OPTION_SETS) {
      for (const [name, dir] of roots) {
        const jdt = full.get(`${optionsName}:${name}`)!;
        expect(jdt.getTier()).toBe('full');
        for (const file of javaFiles(dir)) {
          const source = readFileSync(join(dir, file), 'utf-8');
          const syntax = new JavaAdapter({ facts: options });
          const expected = shape(await jdt.extractFacts(file, source));
          total += expected.length;
          expect(shape(await syntax.extractFacts(file, source)), `${optionsName} ${name}/${file}`).toEqual(expected);
        }
      }
    }
    // A positive control: the samples do give facts.
    expect(total).toBeGreaterThan(30);
  }, 300_000);
});
