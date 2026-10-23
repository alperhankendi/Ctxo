import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSqlAccesses } from '../accesses.js';
import { extractSqlDefinitions } from '../definitions.js';
import type { SqlAccess } from '../types.js';

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus');

interface AccessLists { reads: string[]; writes: string[]; executes: string[] }
interface ExpectedDefinition { kind: string; name: string; columns?: string[] }
interface CorpusCase {
  name: string;
  description: string;
  mode: string;
  sides: string[];
  definitions?: ExpectedDefinition[];
  accesses: AccessLists;
}

const DEFAULT_SIDES: Record<string, string[]> = {
  statement: ['sql-extract', 'scriptdom'],
  file: ['sql-extract', 'lang-sql', 'scriptdom'],
};

/** Reads every case and keeps the statement and file modes (host-language modes default to no sides). */
function loadCorpus(): CorpusCase[] {
  return readdirSync(corpusDir)
    .filter((f) => f.endsWith('.expected.json'))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(corpusDir, f), 'utf8')) as Omit<CorpusCase, 'name' | 'sides'> & { sides?: string[] };
      return { ...raw, name: f.slice(0, -'.expected.json'.length), sides: raw.sides ?? DEFAULT_SIDES[raw.mode] ?? [] };
    })
    .filter((c) => c.mode === 'statement' || c.mode === 'file');
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sqlOf = (c: CorpusCase): string => readFileSync(join(corpusDir, `${c.name}.sql`), 'utf8');

function lists(accesses: readonly SqlAccess[]): AccessLists {
  const sets = { reads: new Set<string>(), writes: new Set<string>(), executes: new Set<string>() };
  for (const a of accesses) sets[a.kind].add(a.name);
  return { reads: [...sets.reads].sort(cmp), writes: [...sets.writes].sort(cmp), executes: [...sets.executes].sort(cmp) };
}

/** What sql-extract gives for a case, in the corpus shape. */
function actual(c: CorpusCase, text: string): Pick<CorpusCase, 'definitions' | 'accesses'> {
  if (c.mode === 'statement') return { accesses: lists(extractSqlAccesses(text)) };
  const defs = extractSqlDefinitions(text).definitions;
  return {
    definitions: defs
      .map((d) => (d.kind === 'table' ? { kind: d.kind, name: d.name, columns: [...d.columns] } : { kind: d.kind, name: d.name }))
      .sort((a, b) => cmp(a.name, b.name) || cmp(a.kind, b.kind)),
    accesses: lists(defs.flatMap((d) => d.accesses)),
  };
}

function expected(c: CorpusCase): Pick<CorpusCase, 'definitions' | 'accesses'> {
  return c.mode === 'statement' ? { accesses: c.accesses } : { definitions: c.definitions, accesses: c.accesses };
}

const cases = loadCorpus();
const ours = cases.filter((c) => c.sides.includes('sql-extract'));

describe('conformance corpus', () => {
  it('every corpus .sql file has an expected.json and the reverse', () => {
    const files = readdirSync(corpusDir);
    const sqlCases = files.filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -'.sql'.length));
    const expectedCases = new Set(files.filter((f) => f.endsWith('.expected.json')).map((f) => f.slice(0, -'.expected.json'.length)));
    for (const name of sqlCases) expect(expectedCases.has(name), `${name}.expected.json`).toBe(true);
    // Statement and file cases need their .sql; host-language cases (PR 1C) use other sources.
    for (const c of cases) expect(sqlCases, `${c.name}.sql`).toContain(c.name);
    expect(cases.length).toBeGreaterThan(0);
  });

  it('every case has a description, known sides, sorted lists and LF text', () => {
    for (const c of cases) {
      expect(typeof c.description, c.name).toBe('string');
      for (const side of c.sides) expect(['sql-extract', 'lang-sql', 'scriptdom'], c.name).toContain(side);
      expect(Object.keys(c.accesses).sort(), c.name).toEqual(['executes', 'reads', 'writes']);
      for (const list of [c.accesses.reads, c.accesses.writes, c.accesses.executes]) {
        expect(list, c.name).toEqual([...new Set(list)].sort(cmp));
      }
      if (c.mode === 'file') {
        const defs = c.definitions ?? [];
        expect(defs.length, c.name).toBeGreaterThan(0);
        expect(defs, c.name).toEqual([...defs].sort((a, b) => cmp(a.name, b.name) || cmp(a.kind, b.kind)));
        for (const d of defs) expect(d.columns !== undefined, `${c.name} ${d.name}`).toBe(d.kind === 'table');
      } else {
        expect(c.definitions, c.name).toBeUndefined();
      }
      const text = sqlOf(c);
      expect(text.includes('\r'), `${c.name}.sql has CR`).toBe(false);
      expect(text.charCodeAt(0), `${c.name}.sql has a BOM`).not.toBe(0xfeff);
    }
  });

  it.each(ours.filter((c) => c.mode === 'statement'))('$name: statement accesses match', (c) => {
    expect(actual(c, sqlOf(c))).toEqual(expected(c));
  });

  it.each(ours.filter((c) => c.mode === 'file'))('$name: definitions and body accesses match', (c) => {
    expect(actual(c, sqlOf(c))).toEqual(expected(c));
  });

  it.each(ours)('$name: CRLF line endings give the same result', (c) => {
    expect(actual(c, sqlOf(c).replace(/\n/g, '\r\n'))).toEqual(expected(c));
  });
});
