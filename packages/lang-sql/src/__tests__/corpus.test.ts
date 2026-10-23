import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlAdapter } from '../sql-adapter.js';

// The corpus lives with the rules in @ctxo/sql-extract; this side runs the file-mode cases that name lang-sql.
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'sql-extract', 'corpus');

interface AccessLists { reads: string[]; writes: string[]; executes: string[] }
interface ExpectedDefinition { kind: string; name: string; columns?: string[] }
interface CorpusCase {
  name: string;
  mode: string;
  sides: string[];
  definitions?: ExpectedDefinition[];
  accesses: AccessLists;
}

const DEFAULT_SIDES: Record<string, string[]> = {
  statement: ['sql-extract', 'scriptdom'],
  file: ['sql-extract', 'lang-sql', 'scriptdom'],
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every case that is a file-mode case with `lang-sql` among its sides (selected by mode and sides, never by extension). */
function loadCases(): CorpusCase[] {
  return readdirSync(corpusDir)
    .filter((f) => f.endsWith('.expected.json'))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(corpusDir, f), 'utf8')) as Omit<CorpusCase, 'name' | 'sides'> & { sides?: string[] };
      return { ...raw, name: f.slice(0, -'.expected.json'.length), sides: raw.sides ?? DEFAULT_SIDES[raw.mode] ?? [] };
    })
    .filter((c) => c.mode === 'file' && c.sides.includes('lang-sql'));
}

const cases = loadCases();
const sqlOf = (c: CorpusCase): string => readFileSync(join(corpusDir, `${c.name}.sql`), 'utf8');

/** The adapter's output in the corpus shape: symbols as definitions, edges grouped by kind. */
async function actual(c: CorpusCase, text: string): Promise<{ definitions: ExpectedDefinition[]; accesses: AccessLists }> {
  const file = `db/${c.name}.sql`;
  const adapter = new SqlAdapter();
  const symbols = await adapter.extractSymbols(file, text);
  const edges = await adapter.extractEdges(file, text);

  const definitions = symbols
    .map((s): ExpectedDefinition => {
      const name = s.symbolId.split('::')[1]!;
      const columns = s.annotations?.find((a) => a.name === 'columns')?.args;
      return columns === undefined && s.kind !== 'table' ? { kind: s.kind, name } : { kind: s.kind, name, columns: [...(columns ?? [])] };
    })
    .sort((a, b) => cmp(a.name, b.name) || cmp(a.kind, b.kind));

  const sets = { reads: new Set<string>(), writes: new Set<string>(), executes: new Set<string>() };
  for (const e of edges) {
    if (e.kind !== 'reads' && e.kind !== 'writes' && e.kind !== 'executes') throw new Error(`unexpected edge kind ${e.kind}`);
    expect(e.to.endsWith(e.kind === 'executes' ? '::procedure' : '::table'), `${c.name}: ${e.kind} target ${e.to}`).toBe(true);
    sets[e.kind].add(e.to.split('::')[0]!);
  }
  const accesses = { reads: [...sets.reads].sort(cmp), writes: [...sets.writes].sort(cmp), executes: [...sets.executes].sort(cmp) };
  return { definitions, accesses };
}

describe('conformance corpus (lang-sql side)', () => {
  it('runs the file-mode cases that name lang-sql', () => {
    const names = cases.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['body-local-create-table', 'create-or-alter-and-alter', 'definitions-ssdt', 'missing-go']));
    for (const c of cases) expect(c.definitions?.length, c.name).toBeGreaterThan(0);
  });

  it.each(cases)('$name: adapter symbols and edges match', async (c) => {
    expect(await actual(c, sqlOf(c))).toEqual({ definitions: c.definitions, accesses: c.accesses });
  });

  it.each(cases)('$name: CRLF line endings give the same result', async (c) => {
    expect(await actual(c, sqlOf(c).replace(/\n/g, '\r\n'))).toEqual({ definitions: c.definitions, accesses: c.accesses });
  });
});
