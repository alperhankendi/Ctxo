import { describe, it, expect, afterAll } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { CodeFact } from '@ctxo/plugin-api';
import { GoCompositeAdapter } from '../composite-adapter.js';
import { GoAdapter } from '../go-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';
import { detectGoToolchain } from '../analyzer/toolchain-detect.js';
import { AGREEING_SAMPLES, APP_GO_MOD, CHI_STUB, DIFFERING_SAMPLES, ECHO_STUB, GIN_STUB } from './fixtures/go-fact-samples.js';

const LENDING = join(import.meta.dirname, '..', '..', 'test-fixtures', 'lending-module');

const sampleFile = (name: string) => `samples/${name}/app.go`;

/**
 * Agreeing samples that are meant to give no facts: `nilAndStrings` holds only trivial comparisons (with nil and
 * true) and code inside string literals; `shadow` declares its own nil and true, so nothing is a literal.
 */
const EMPTY_SAMPLES: ReadonlySet<string> = new Set(['nilAndStrings', 'shadow']);

function write(root: string, rel: string, body: string): void {
  const path = join(root, ...rel.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A module with the gin stub and every sample in its own package, LF line endings. */
function writeSampleModule(root: string): void {
  write(root, 'go.mod', APP_GO_MOD);
  write(root, 'stubs/gin/go.mod', 'module github.com/gin-gonic/gin\n\ngo 1.22\n');
  write(root, 'stubs/gin/gin.go', GIN_STUB);
  write(root, 'stubs/echo/go.mod', 'module github.com/labstack/echo/v4\n\ngo 1.22\n');
  write(root, 'stubs/echo/echo.go', ECHO_STUB);
  write(root, 'stubs/chi/go.mod', 'module github.com/go-chi/chi/v5\n\ngo 1.22\n');
  write(root, 'stubs/chi/chi.go', CHI_STUB);
  for (const [name, body] of Object.entries(AGREEING_SAMPLES)) write(root, sampleFile(name), body);
  write(root, sampleFile('fakeMux'), DIFFERING_SAMPLES['fakeMux']!);
  write(root, sampleFile('namedMap'), DIFFERING_SAMPLES['namedMap']!);
  write(root, 'samples/elsewhere/app.go', DIFFERING_SAMPLES['elsewhere']!);
  write(root, 'samples/elsewhere/decls.go', DIFFERING_SAMPLES['elsewhereDecls']!);
}

function copyLendingLf(target: string): void {
  cpSync(LENDING, target, { recursive: true });
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else writeFileSync(path, readFileSync(path, 'utf-8').replace(/\r\n/g, '\n'));
    }
  };
  walk(target);
}

type Row = { kind: string; line: number; text: string; detail: Readonly<Record<string, string>>; symbolId: string };
const compareRows = (a: Row, b: Row) => {
  const ka = JSON.stringify(a);
  const kb = JSON.stringify(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};
const normalize = (facts: readonly CodeFact[]): Row[] =>
  facts.map((f) => ({ kind: f.kind, line: f.line, text: f.text, detail: f.detail, symbolId: f.symbolId })).sort(compareRows);

async function bothTiers(root: string, files: readonly string[]): Promise<Map<string, { full: Row[]; syntax: Row[] }>> {
  const composite = new GoCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS });
  await composite.initialize(root);
  const syntax = new GoAdapter({ facts: DEFAULT_FACT_OPTIONS });
  const out = new Map<string, { full: Row[]; syntax: Row[] }>();
  try {
    expect(composite.getTier()).toBe('full');
    for (const file of files) {
      const source = readFileSync(join(root, ...file.split('/')), 'utf-8');
      out.set(file, { full: normalize(await composite.extractFacts(file, source)), syntax: normalize(await syntax.extractFacts(file, source)) });
    }
  } finally {
    await composite.dispose();
  }
  return out;
}

describe.skipIf(!detectGoToolchain().available)('Go fact tier agreement', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('both tiers give the same facts', async () => {
    const lending = mkdtempSync(join(tmpdir(), 'ctxo-go-agree-lending-'));
    dirs.push(lending);
    copyLendingLf(lending);
    const lendingFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'stubs') walk(path);
        } else if (entry.name.endsWith('.go')) {
          lendingFiles.push(relative(lending, path).replace(/\\/g, '/'));
        }
      }
    };
    walk(lending);
    const lendingResults = await bothTiers(lending, lendingFiles);
    expect(lendingResults.get('loans/facts.go')!.full.length).toBeGreaterThan(0);
    for (const [file, { full, syntax }] of lendingResults) expect(syntax, file).toEqual(full);

    const samples = mkdtempSync(join(tmpdir(), 'ctxo-go-agree-samples-'));
    dirs.push(samples);
    writeSampleModule(samples);
    const names = Object.keys(AGREEING_SAMPLES);
    const results = await bothTiers(samples, names.map(sampleFile));
    let total = 0;
    for (const name of names) {
      const { full, syntax } = results.get(sampleFile(name))!;
      total += full.length;
      // An empty agreement proves nothing: every sample must give facts in the full tier, except the ones that
      // are meant to be empty.
      if (EMPTY_SAMPLES.has(name)) expect(full, name).toEqual([]);
      else expect(full.length, name).toBeGreaterThan(0);
      expect(syntax, name).toEqual(full);
    }
    expect(total).toBeGreaterThan(40);
  }, 300_000);

  it('the accepted differences are exactly the documented ones', async () => {
    const samples = mkdtempSync(join(tmpdir(), 'ctxo-go-differ-'));
    dirs.push(samples);
    writeSampleModule(samples);
    const files = [sampleFile('fakeMux'), sampleFile('elsewhere'), sampleFile('namedMap')];
    const results = await bothTiers(samples, files);
    const texts = (rowsOf: Row[]) => rowsOf.map((r) => `${r.line} ${r.text} @${r.symbolId.slice(r.symbolId.indexOf('::') + 2)}`);

    // 1. A HandleFunc on a non-ServeMux type: by name in the syntax tier only.
    expect(texts(results.get(sampleFile('fakeMux'))!.full)).toEqual([]);
    expect(texts(results.get(sampleFile('fakeMux'))!.syntax)).toEqual(['9 ANY /fake @Register::function']);
    // 2. A gin router and a path constant declared in another file: the analyzer only.
    expect(texts(results.get(sampleFile('elsewhere'))!.full)).toEqual(['3 GET /far @Register::function', '4 ANY /remote @Register::function']);
    expect(texts(results.get(sampleFile('elsewhere'))!.syntax)).toEqual([]);
    // 3. Identifier keys of a named map type: taken for struct fields in the syntax tier.
    expect(texts(results.get(sampleFile('namedMap'))!.full)).toEqual([]);
    expect(texts(results.get(sampleFile('namedMap'))!.syntax)).toEqual(['7 retryKey = 3 @Build::function']);
  }, 300_000);
});
