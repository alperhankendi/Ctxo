import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleToolDefinition } from '@ctxo/cli/internal';
import { createDomainState, STALE_CARDS_HINT } from '../domain-state.js';
import { NO_BOUNDARIES_HINT, STALE_LOOP_HINT } from '../loop-state.js';
import { DEFAULT_CONVENTIONS_HINT, FIND_SHADOW_SPECS, GET_CONTEXT_MAP, loopTools } from '../loop-tools.js';
import { CARD, createLoopProject, POLICY_FILE, type LoopProject } from './loop-fixture.js';

let project: LoopProject;

beforeEach(() => {
  project = createLoopProject();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  project.dispose();
});

type Obj = Record<string, unknown>;

function tools(): Map<string, ModuleToolDefinition> {
  const host = project.host();
  return new Map(loopTools(host, createDomainState(host)).map((tool) => [tool.name, tool]));
}

async function call(tool: ModuleToolDefinition | undefined, args: Obj = {}): Promise<Obj> {
  return (await tool!.handler(args)) as Obj;
}

const LITERAL = 'literal-comparison | LoanPolicy.canBorrow | loans.length >= 5';
const UNTESTED = 'rule-without-tests | LEND-04 | A loan lasts three weeks';

const LITERAL_CANDIDATE = {
  fingerprint: LITERAL,
  kind: 'literal-comparison',
  file: POLICY_FILE,
  line: 3,
  symbolId: `${POLICY_FILE}::LoanPolicy.canBorrow::method`,
  text: 'loans.length >= 5',
  detail: { operator: '>=', literal: '5' },
  source: 'text',
};

const UNTESTED_CANDIDATE = {
  fingerprint: UNTESTED,
  kind: 'rule-without-tests',
  file: 'docs/domain/lending/domain.md',
  line: 13,
  ruleId: 'LEND-04',
  text: 'LEND-04 A loan lasts three weeks',
  source: 'card',
};

function resolve(yaml: string): void {
  project.write('docs/domain/lending/shadow-specs.yaml', yaml);
}

const shadowSpecsOf = (payload: Obj): Obj[] => payload['shadowSpecs'] as Obj[];

const FIND_DESCRIPTION =
  'Find shadow-spec candidates in a named context: business-looking logic that no card rule pins yet. Candidates are literal comparisons in conditions, string normalization, retry and timeout values and public endpoints in the context\'s code, the SQL tables, views and procedures it owns, and its rules without tests. Each has its file, line, symbol, a line-independent fingerprint, its source (native analysis, text scan, the index or the card) and its resolution: linked to a rule, marked Untested in the card, or resolved in the context\'s shadow-specs.yaml (the response names the file) with { rule: <ID> } or { notARule: "<reason>" }. Use this for the Deletion Test: for each open candidate, find or write the rule that pins it, or record why it is not a rule. Resolved candidates are hidden unless includeResolved is true. Copy each fingerprint verbatim into shadow-specs.yaml as a YAML single-quoted scalar (fingerprint: \'...\', with a \' inside written as \'\'); %7C and %25 in the symbol part are an encoded | and %. Under ctxo watch, candidates refresh shortly after a card, glossary or registry edit, and after watch.snapshotMinFileChanges re-indexed source files. Large results are truncated with _meta.hint.';

const MAP_DESCRIPTION =
  "Get the map of named contexts: for each context its card, rule count and share of rules with tests, characterization and contract test counts, cross-context edges in and out, co-change with other contexts, drift, boundary violations and open shadow-spec candidates, plus the owner's rung from the registry, a suggested rung and the status of each criterion (pinned, named, bounded, boring). Use this to see how mature each context is and what blocks its next rung. The suggestion never changes the registry. Under ctxo watch, the map refreshes shortly after a card, glossary or registry edit, and after watch.snapshotMinFileChanges re-indexed source files. Large results are truncated with _meta.hint; run \"ctxo domain map\" for the full map. Needs a domain registry (docs/domain/contexts.yaml). While the domain conventions are at their defaults and discovery has something to propose, the hint says to run \"ctxo domain discover\", which proposes tracker prefixes, rule trait keys and test-kind markers from the repository.";

describe('loop tools', () => {
  it('names the two tools with their descriptions', () => {
    const all = [...tools().values()];

    expect(all.map((tool) => tool.name)).toEqual([FIND_SHADOW_SPECS, GET_CONTEXT_MAP]);
    expect(FIND_SHADOW_SPECS).toBe('find_shadow_specs');
    expect(GET_CONTEXT_MAP).toBe('get_context_map');
    expect(all[0]!.description).toBe(FIND_DESCRIPTION);
    expect(all[1]!.description).toBe(MAP_DESCRIPTION);
  });

  it('find_shadow_specs returns open candidates with file, line, symbol, fingerprint and source', async () => {
    await project.index();

    const payload = await call(tools().get(FIND_SHADOW_SPECS), { context: 'lending' });
    expect(payload).toEqual({
      context: { id: 'lending', name: 'Lending', rung: 'bounded' },
      counts: {
        open: 2,
        resolved: 0,
        byKind: { 'literal-comparison': { open: 1, resolved: 0 }, 'rule-without-tests': { open: 1, resolved: 0 } },
      },
      // compareCandidates order: by file first.
      shadowSpecs: [UNTESTED_CANDIDATE, LITERAL_CANDIDATE],
      resolutionFile: 'docs/domain/lending/shadow-specs.yaml',
      staleResolutions: [],
      unknownRules: [],
      resolutionProblems: [],
    });
    expect(await call(tools().get(FIND_SHADOW_SPECS), { context: ' lending ' })).toEqual(payload);
    // Billing owns no code with facts.
    expect(await call(tools().get(FIND_SHADOW_SPECS), { context: 'billing' })).toMatchObject({
      counts: { open: 0, resolved: 0, byKind: {} },
      shadowSpecs: [],
      resolutionFile: 'docs/domain/billing/shadow-specs.yaml',
    });
  });

  it('includeResolved adds resolved candidates with their resolution', async () => {
    await project.index();
    resolve(`- fingerprint: "${LITERAL}"\n  resolution: { notARule: "a paging limit" }\n`);
    const tool = tools().get(FIND_SHADOW_SPECS);

    const open = await call(tool, { context: 'lending' });
    expect(open['counts']).toEqual({
      open: 1,
      resolved: 1,
      byKind: { 'literal-comparison': { open: 0, resolved: 1 }, 'rule-without-tests': { open: 1, resolved: 0 } },
    });
    expect(shadowSpecsOf(open)).toEqual([UNTESTED_CANDIDATE]);

    const all = await call(tool, { context: 'lending', includeResolved: true });
    expect(all['counts']).toEqual(open['counts']);
    expect(shadowSpecsOf(all)).toEqual([
      UNTESTED_CANDIDATE,
      { ...LITERAL_CANDIDATE, resolution: { by: 'shadow-specs', notARule: 'a paging limit' } },
    ]);

    // A rule resolution is canonicalized.
    resolve(`- fingerprint: "${LITERAL}"\n  resolution: { rule: lend03 }\n`);
    const byRule = await call(tool, { context: 'lending', includeResolved: true });
    expect(shadowSpecsOf(byRule)[1]!['resolution']).toEqual({ by: 'shadow-specs', rule: 'LEND-03' });
  });

  it('reports stale entries, unknown rules and file problems as they are', async () => {
    await project.index();
    resolve(
      [
        '- fingerprint: "endpoint | Gone.handler | GET /gone"',
        '  resolution: { notARule: "removed" }',
        `- fingerprint: "${LITERAL}"`,
        '  resolution: { rule: LEND-99 }',
        '- fingerprint: "no separators"',
        '  resolution: { rule: LEND-03 }',
        '',
      ].join('\n'),
    );

    const payload = await call(tools().get(FIND_SHADOW_SPECS), { context: 'lending' });
    expect(payload['staleResolutions']).toEqual([{ fingerprint: 'endpoint | Gone.handler | GET /gone', line: 1 }]);
    expect(payload['unknownRules']).toEqual([{ fingerprint: LITERAL, rule: 'LEND-99', line: 3 }]);
    expect(payload['resolutionProblems']).toEqual([
      { line: 5, severity: 'error', message: 'fingerprint must read "<kind> | <symbol> | <text>"' },
    ]);
    // The unknown rule resolves nothing.
    expect(payload['counts']).toMatchObject({ open: 2, resolved: 0 });
  });

  it('kinds filters candidates and counts', async () => {
    await project.index();
    const tool = tools().get(FIND_SHADOW_SPECS);

    const literal = await call(tool, { context: 'lending', kinds: ['literal-comparison'] });
    expect(literal['counts']).toEqual({ open: 1, resolved: 0, byKind: { 'literal-comparison': { open: 1, resolved: 0 } } });
    expect(shadowSpecsOf(literal)).toEqual([LITERAL_CANDIDATE]);

    const none = await call(tool, { context: 'lending', kinds: ['endpoint', 'procedure'] });
    expect(none['counts']).toEqual({ open: 0, resolved: 0, byKind: {} });

    // An empty list means every kind.
    expect(await call(tool, { context: 'lending', kinds: [] })).toEqual(await call(tool, { context: 'lending' }));
  });

  it('an unknown context gives a graceful hint', async () => {
    await project.index();
    const tool = tools().get(FIND_SHADOW_SPECS);

    expect(await call(tool, { context: 'shipping' })).toEqual({
      found: false,
      hint: 'No context shipping in the registry; get_context_map lists the contexts.',
    });
    // The schema trims and rejects a blank context; a handler called without the schema still answers cleanly.
    const blank = { found: false, hint: 'Pass a context ID from the registry; get_context_map lists the contexts.' };
    for (const args of [{}, { context: '' }, { context: '   ' }, { context: 42 }]) expect(await call(tool, args), JSON.stringify(args)).toEqual(blank);
  });

  it('no registry gives found false, never an error', async () => {
    const all = tools();
    const hint = 'No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain". To propose the domain config from this repository, run "ctxo domain discover".';

    expect(await call(all.get(FIND_SHADOW_SPECS), { context: 'lending' })).toEqual({ found: false, hint });
    expect(await call(all.get(GET_CONTEXT_MAP))).toEqual({ found: false, hint });
  });

  it('missing loop artifacts give the run-ctxo-index hint', async () => {
    await project.index();
    rmSync(join(project.ctxoRoot, 'index', 'domain', 'maturity.json'));
    const all = tools();
    const hint = 'No shadow-spec data yet; run "ctxo index".';

    expect(await call(all.get(FIND_SHADOW_SPECS), { context: 'lending' })).toEqual({ found: false, hint });
    expect(await call(all.get(GET_CONTEXT_MAP))).toEqual({ found: false, hint });
  });

  it('an unexpected failure is an error, not a miss', async () => {
    const throwing = { load: () => { throw new Error('disk on fire'); } };
    const all = new Map(loopTools(project.host(), throwing).map((tool) => [tool.name, tool]));
    const expected = { error: true, message: 'The shadow-spec data could not be read: disk on fire' };

    expect(await call(all.get(FIND_SHADOW_SPECS), { context: 'lending' })).toEqual(expected);
    expect(await call(all.get(GET_CONTEXT_MAP))).toEqual(expected);
  });

  it('get_context_map returns metrics, criteria and a suggested rung per context', async () => {
    await project.index();
    const tool = tools().get(GET_CONTEXT_MAP);

    const payload = await call(tool);
    const map = payload['contextMap'] as Obj[];
    expect(map.map((e) => e['id'])).toEqual(['lending', 'billing']);
    const lending = map[0]!;
    expect(lending).toMatchObject({
      id: 'lending',
      name: 'Lending',
      rung: 'bounded',
      suggestedRung: 'fear',
      card: { path: 'docs/domain/lending/domain.md', present: true },
      rules: { count: 2, withTests: 1, share: 0.5 },
      tests: { characterization: 0, contract: 0 },
      crossContextEdges: { in: 0, out: 0 },
      boundaryViolations: { total: 0, errors: 0, warnings: 0 },
      shadowSpecs: { open: 2, resolved: 0 },
      boundariesKnown: true,
    });
    expect(lending['criteria']).toMatchObject({
      pinned: { met: false, mainPaths: 0, characterizationTests: 0 },
      named: { met: false, card: true, terms: 1, inGlossary: 0, missing: ['Loan'] },
      bounded: { met: true, boundaryViolations: 0 },
      boring: { met: false, rules: 2, rulesWithoutTests: 1, openCandidates: 2 },
    });
    expect(map[1]).toMatchObject({ id: 'billing', card: { present: false }, rules: { count: 0, share: null } });
    expect(payload['summary']).toEqual({ contexts: 2, agree: 0, suggestedAbove: 0, suggestedBelow: 2 });
    expect(payload['settings']).toEqual({ pinnedCoverage: 0.8 });
    expect(payload['stale']).toBeUndefined();
    expect(payload['hint']).toBeUndefined();

    // File resolutions count as resolved.
    resolve(`- fingerprint: "${LITERAL}"\n  resolution: { rule: LEND-03 }\n`);
    const resolved = (await call(tool))['contextMap'] as Obj[];
    expect(resolved[0]!['shadowSpecs']).toEqual({ open: 1, resolved: 1 });
  });

  it('a card that is gone is not present', async () => {
    await project.index();
    rmSync(join(project.root, 'docs', 'domain', 'lending', 'domain.md'));

    const map = (await call(tools().get(GET_CONTEXT_MAP)))['contextMap'] as Obj[];
    expect(map[0]!['card']).toEqual({ path: 'docs/domain/lending/domain.md', present: false });
  });

  it('a missing boundaries artifact still gives the map, with a hint', async () => {
    await project.index();
    rmSync(join(project.ctxoRoot, 'index', 'domain', 'boundaries.json'));

    const payload = await call(tools().get(GET_CONTEXT_MAP));
    const map = payload['contextMap'] as Obj[];
    expect(map.map((e) => e['boundariesKnown'])).toEqual([false, false]);
    expect(payload['hint']).toBe(NO_BOUNDARIES_HINT);
    expect(NO_BOUNDARIES_HINT).toBe(
      'No boundary data yet, so cross-context edges and violations are unknown and bounded is not met; run "ctxo index".',
    );
  });

  /** Records the index pass's discovery result in maturity.json, as `ctxo index` does with a change log. */
  function recordDiscovery(addsSomething: boolean | undefined): void {
    const path = join(project.ctxoRoot, 'index', 'domain', 'maturity.json');
    const { discovery: _old, ...value } = JSON.parse(readFileSync(path, 'utf-8')) as Obj;
    writeFileSync(path, `${JSON.stringify(addsSomething === undefined ? value : { ...value, discovery: { addsSomething } }, null, 2)}\n`, 'utf-8');
    project.age('.ctxo/index/domain/maturity.json', 5);
  }

  function useDefaults(): void {
    project.write('.ctxo/config.yaml', 'version: "1.0"\n');
    project.age('.ctxo/config.yaml');
  }

  it('defaults and a discovery that adds something give the discover hint and change nothing else (#191)', async () => {
    await project.index();
    recordDiscovery(true);
    const tuned = await call(tools().get(GET_CONTEXT_MAP));
    expect(tuned['hint']).toBeUndefined();

    useDefaults();
    const defaults = await call(tools().get(GET_CONTEXT_MAP));
    expect(defaults['hint']).toBe(DEFAULT_CONVENTIONS_HINT);
    expect(DEFAULT_CONVENTIONS_HINT).toBe(
      'The domain conventions are still at their defaults; run "ctxo domain discover" to propose them from this repository.',
    );
    const { hint: _hint, ...rest } = defaults;
    expect(rest).toEqual(tuned);

    // After the view's own hint.
    rmSync(join(project.ctxoRoot, 'index', 'domain', 'boundaries.json'));
    expect((await call(tools().get(GET_CONTEXT_MAP)))['hint']).toBe(`${NO_BOUNDARIES_HINT} ${DEFAULT_CONVENTIONS_HINT}`);
  });

  it('defaults with a discovery that adds nothing, or with no recorded discovery, give no hint', async () => {
    await project.index();
    useDefaults();
    recordDiscovery(false);
    expect((await call(tools().get(GET_CONTEXT_MAP)))['hint']).toBeUndefined();
    recordDiscovery(undefined);
    expect((await call(tools().get(GET_CONTEXT_MAP)))['hint']).toBeUndefined();
  });

  it('any one convention off its default drops the hint', async () => {
    await project.index();
    recordDiscovery(true);
    for (const yaml of [
      'domain:\n  tests:\n    ruleTraitKeys: [Rule, Req]\n',
      'domain:\n  tests:\n    characterization:\n      paths: ["golden/**"]\n',
      'domain:\n  tests:\n    contract:\n      annotations: [StorageContractFact]\n',
    ]) {
      project.write('.ctxo/config.yaml', yaml);
      project.age('.ctxo/config.yaml');
      expect((await call(tools().get(GET_CONTEXT_MAP)))['hint'], yaml).toBeUndefined();
    }
  });

  it('the tool description names ctxo domain discover', () => {
    expect(tools().get(GET_CONTEXT_MAP)!.description).toContain('"ctxo domain discover"');
  });

  it('stale maturity gives the map with stale and the stale hint', async () => {
    await project.index();
    const path = join(project.ctxoRoot, 'index', 'domain', 'maturity.json');
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Obj;
    writeFileSync(path, `${JSON.stringify({ ...value, registryHash: 'another' }, null, 2)}\n`, 'utf-8');
    project.age('.ctxo/index/domain/maturity.json', 5);

    const payload = await call(tools().get(GET_CONTEXT_MAP));
    expect(payload['stale']).toBe(true);
    expect(payload['hint']).toBe(STALE_LOOP_HINT);
    expect((payload['contextMap'] as Obj[]).map((e) => e['id'])).toEqual(['lending', 'billing']);

    // Both hints when the boundaries are missing too, the view's hint first.
    rmSync(join(project.ctxoRoot, 'index', 'domain', 'boundaries.json'));
    expect((await call(tools().get(GET_CONTEXT_MAP)))['hint']).toBe(`${NO_BOUNDARIES_HINT} ${STALE_LOOP_HINT}`);
  });

  it('a card edit adds stale and the cards hint to both tools', async () => {
    await project.index();
    project.write('docs/domain/lending/domain.md', `${CARD}\nAn edit after indexing.\n`);
    project.age('docs/domain/lending/domain.md', 5);
    const all = tools();

    for (const [name, args] of [[FIND_SHADOW_SPECS, { context: 'lending' }], [GET_CONTEXT_MAP, {}]] as const) {
      const payload = await call(all.get(name), args);
      expect(payload['stale'], name).toBe(true);
      expect(payload['hint'], name).toBe(STALE_CARDS_HINT);
    }
  });

  it('the same call twice gives identical payloads', async () => {
    await project.index();
    resolve(`- fingerprint: "${LITERAL}"\n  resolution: { notARule: "a paging limit" }\n`);
    const first = tools();
    const second = tools();

    for (const [name, args] of [
      [FIND_SHADOW_SPECS, { context: 'lending' }],
      [FIND_SHADOW_SPECS, { context: 'lending', includeResolved: true }],
      [GET_CONTEXT_MAP, {}],
    ] as const) {
      const a = JSON.stringify(await call(first.get(name), args));
      expect(JSON.stringify(await call(first.get(name), args))).toBe(a);
      expect(JSON.stringify(await call(second.get(name), args))).toBe(a);
    }
  });

  it("input schemas are built with the host's zod", () => {
    const calls: string[] = [];
    const show = (a: unknown): string => (typeof a === 'string' || typeof a === 'number' || Array.isArray(a) ? JSON.stringify(a) : '<schema>');
    const chain = (label: string): Obj =>
      new Proxy(
        {},
        {
          get: (_target, prop) => (...args: unknown[]) => {
            calls.push(`${label}.${String(prop)}(${args.map(show).join(',')})`);
            return chain(label);
          },
        },
      );
    const zod = new Proxy(
      {},
      {
        get: (_target, prop) => (...args: unknown[]) => {
          calls.push(`z.${String(prop)}(${args.map(show).join(',')})`);
          return chain(String(prop));
        },
      },
    ) as never;

    const all = [...tools().values()];
    expect(Object.keys(all[0]!.inputSchema(zod))).toEqual(['context', 'kinds', 'includeResolved']);
    expect(Object.keys(all[1]!.inputSchema(zod))).toEqual([]);
    expect(calls).toEqual([
      'z.string()',
      // Trimmed before the length check, so a whitespace-only context is rejected.
      'string.trim()',
      'string.min(1)',
      'string.describe("Context ID from the registry, e.g. lending")',
      'z.enum(["literal-comparison","normalization","retry-timeout","endpoint","data-resource","procedure","rule-without-tests"])',
      'z.array(<schema>)',
      'array.optional()',
      'array.describe("Candidate kinds to return (default: all): literal-comparison, normalization, retry-timeout, endpoint, data-resource, procedure, rule-without-tests. An empty list also returns all kinds.")',
      'z.boolean()',
      'boolean.optional()',
      'boolean.describe("Also return resolved candidates with their resolution (default false)")',
    ]);
  });
});
