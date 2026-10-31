import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertBuilt, cleanupWorkspaces, type McpSession, requireSameTier, SampleWorkspace, type Variant } from './sample-workspace.js';

/**
 * The PR 4 acceptance tests (spec 12.4, 13.1, 13.2, Review Focus 5): the Deletion Test loop of the synthetic
 * library-lending sample, driven through the built CLI and the built MCP server. One indexed workspace per variant
 * is shared by the read-only tests; every test that changes files works on its own copy. Symbol IDs come from
 * `search_symbols` or from the payloads, never hard-coded C# IDs: the Roslyn and the tree-sitter tiers write
 * different ones. Rung, reach and cross-edge assertions need edges between files, so they are skipped when C# ran on
 * the syntax tier (and fail under CTXO_REQUIRE_DOTNET=1, W19).
 */

const VARIANTS: readonly Variant[] = ['csharp', 'typescript'];

type Payload = Record<string, unknown>;

const SHADOW_SPECS = 'docs/domain/lending/shadow-specs.yaml';
const CANDIDATES_ARTIFACT = '.ctxo/index/domain/shadow-candidates.json';
const MATURITY_ARTIFACT = '.ctxo/index/domain/maturity.json';
const NOT_A_RULE = 'input cleanup, not a business rule';

const MEMBER_DIRECTORY: Record<Variant, string> = {
  csharp: 'src/Lending/MemberDirectory.cs',
  typescript: 'src/lending/member-directory.ts',
};
const RENEWAL_POLICY: Record<Variant, string> = {
  csharp: 'src/Lending/RenewalPolicy.cs',
  typescript: 'src/lending/renewal-policy.ts',
};
const LOANS_CONTROLLER: Record<Variant, string> = {
  csharp: 'src/Lending/Api/LoansController.cs',
  typescript: 'src/lending/api/loans.controller.ts',
};
const LOWER_CASE: Record<Variant, string> = { csharp: 'ToLowerInvariant', typescript: 'toLowerCase' };
const TRIM: Record<Variant, string> = { csharp: 'Trim', typescript: 'trim' };
/** The last segment of the endpoint methods' names (the C# syntax tier appends a parameter count). */
const GET_NAME: Record<Variant, RegExp> = { csharp: /\.Get(\(\d+\))?$/, typescript: /\.find$/ };
const BORROW_NAME: Record<Variant, RegExp> = { csharp: /\.Borrow(\(\d+\))?$/, typescript: /\.borrow$/ };

interface Candidate {
  fingerprint: string;
  kind: string;
  file: string;
  line: number;
  symbolId?: string;
  ruleId?: string;
  text: string;
  source: string;
  resolution?: Payload;
}

interface ShadowSpecsPayload {
  context: { id: string; name: string; rung: string };
  counts: { open: number; resolved: number; byKind: Record<string, { open: number; resolved: number }> };
  shadowSpecs: Candidate[];
  resolutionFile: string;
  staleResolutions: { fingerprint: string; line: number }[];
  unknownRules: unknown[];
  resolutionProblems: unknown[];
  _meta?: Payload;
}

interface ContextMapEntry {
  id: string;
  rung: string;
  suggestedRung: string;
  tests: { characterization: number; contract: number };
  crossContextEdges: { in: number; out: number };
  criteria: {
    pinned: { met: boolean; mainPaths: number; reached: number; coverage: number | null; characterizationTests: number };
    named: { met: boolean; terms: number; inGlossary: number; missing: string[] };
    bounded: { met: boolean; contractSymbols: number; reached: number; boundaryViolations: number };
    boring: { met: boolean; rules: number; rulesWithoutTests: number; openCandidates: number };
  };
  boundariesKnown: boolean;
}

interface ContextMapPayload {
  contextMap: ContextMapEntry[];
  summary: { contexts: number; agree: number };
  _meta?: Payload;
}

beforeAll(assertBuilt);
afterAll(cleanupWorkspaces);

/** A fresh copy of the variant with its generated loader rules committed and the index built. */
function prepared(variant: Variant): SampleWorkspace {
  const ws = SampleWorkspace.create(variant);
  ws.commitLoaderRules();
  ws.index();
  return ws;
}

/** The response without `_meta`: the CLI prints the body the tool returns before the envelope adds it. */
function withoutMeta(response: Payload): Payload {
  const { _meta: _ignored, ...rest } = response;
  return rest;
}

/** The response without `_meta.workspace`, the only part that names the temp directory. */
function withoutRoot(response: Payload): Payload {
  const meta = { ...(response['_meta'] as Payload) };
  delete meta['workspace'];
  return { ...response, _meta: meta };
}

async function shadowSpecs(session: McpSession, args: Payload = {}): Promise<ShadowSpecsPayload> {
  const response = await session.call('find_shadow_specs', { context: 'lending', ...args });
  expect(response['error'], JSON.stringify(response)).toBeUndefined();
  return response as unknown as ShadowSpecsPayload;
}

async function contextMap(session: McpSession): Promise<ContextMapPayload> {
  const response = await session.call('get_context_map', {});
  expect(response['error'], JSON.stringify(response)).toBeUndefined();
  return response as unknown as ContextMapPayload;
}

function findCandidate(list: readonly Candidate[], what: string, predicate: (c: Candidate) => boolean): Candidate {
  const hit = list.find(predicate);
  if (hit === undefined) throw new Error(`no ${what} in ${JSON.stringify(list, null, 2)}`);
  return hit;
}

const nameOf = (symbolId: string | undefined): string => (symbolId ?? '').split('::')[1] ?? '';

function lowerCaseCandidate(list: readonly Candidate[], variant: Variant): Candidate {
  return findCandidate(list, 'lower-case candidate', (c) => c.kind === 'normalization' && c.file === MEMBER_DIRECTORY[variant] && c.text.includes(LOWER_CASE[variant]));
}

function trimCandidate(list: readonly Candidate[], variant: Variant): Candidate {
  return findCandidate(
    list,
    'trim candidate',
    (c) => c.kind === 'normalization' && c.file === MEMBER_DIRECTORY[variant] && c.text.includes(TRIM[variant]) && !c.text.includes(LOWER_CASE[variant]),
  );
}

function renewalCandidate(list: readonly Candidate[], variant: Variant): Candidate {
  return findCandidate(list, 'renewal comparison', (c) => c.kind === 'literal-comparison' && c.file === RENEWAL_POLICY[variant] && c.text === 'loanPeriods >= 2');
}

function endpointCandidate(list: readonly Candidate[], variant: Variant, name: RegExp): Candidate {
  return findCandidate(list, `endpoint ${String(name)}`, (c) => c.kind === 'endpoint' && c.file === LOANS_CONTROLLER[variant] && name.test(nameOf(c.symbolId)));
}

function expectLocated(candidate: Candidate, source: string): void {
  expect(candidate.source).toBe(source);
  expect(candidate.resolution).toBeUndefined();
  expect(Number.isInteger(candidate.line) && candidate.line >= 1, `line ${candidate.line}`).toBe(true);
  expect(candidate.symbolId).toEqual(expect.stringContaining('::'));
  expect(candidate.fingerprint.split(' | ')).toHaveLength(3);
}

interface Shared {
  ws: SampleWorkspace;
  session: McpSession;
}

describe.each(VARIANTS)('PR 4 acceptance, %s sample', (variant) => {
  let shared: Shared;

  beforeAll(async () => {
    const ws = prepared(variant);
    shared = { ws, session: await ws.connect() };
  }, 240_000);

  afterAll(async () => {
    await shared?.session.close();
  });

  it('the sample still has the PR 3 Lending terms and glossary and the PR 2B lending.contracts.billing', () => {
    // A checkout with core.autocrlf=true holds the fixtures with CRLF.
    const read = (file: string): string => shared.ws.read(file).replace(/\r\n/g, '\n');
    const registry = read('docs/domain/contexts.yaml');
    expect(registry).toMatch(/contracts:\n\s+billing:\n\s+- "src\/[Bb]illing\//);
    const glossary = read('docs/domain/glossary.md');
    expect(glossary).toContain('- **Account** (context: billing)');
    expect(glossary).toContain('- **Loan** (context: lending)');
    const card = read('docs/domain/lending/domain.md');
    for (const term of ['Loan', 'Member account', 'Account', 'Fine']) expect(card).toContain(`- **${term}**:`);
  });

  it('find_shadow_specs lending returns open candidates with locations and sources', async () => {
    const payload = await shadowSpecs(shared.session);
    expect(payload.context).toEqual({ id: 'lending', name: 'Lending', rung: 'pinned' });
    expect(payload.resolutionFile).toBe(SHADOW_SPECS);
    expect(payload.staleResolutions).toEqual([]);
    expect(payload.unknownRules).toEqual([]);
    expect(payload.resolutionProblems).toEqual([]);
    for (const candidate of payload.shadowSpecs) expect(candidate.resolution, candidate.fingerprint).toBeUndefined();

    expectLocated(lowerCaseCandidate(payload.shadowSpecs, variant), 'native');
    expectLocated(endpointCandidate(payload.shadowSpecs, variant, GET_NAME[variant]), 'native');
    const loans = findCandidate(payload.shadowSpecs, 'dbo.loans table', (c) => c.kind === 'data-resource' && c.text === 'table dbo.loans');
    expect(loans).toMatchObject({ source: 'index', file: 'db/migrations/lending/001_create_loans.sql', line: 1 });
    expect(payload.counts.open).toBe(payload.shadowSpecs.length);
  });

  it('includeResolved marks resolved candidates', async () => {
    const payload = await shadowSpecs(shared.session, { includeResolved: true });
    const all = payload.shadowSpecs;
    expect(renewalCandidate(all, variant).resolution).toEqual({ by: 'shadow-specs', rule: 'LEND-05' });
    expect(trimCandidate(all, variant).resolution).toEqual({ by: 'shadow-specs', notARule: NOT_A_RULE });
    expect(endpointCandidate(all, variant, BORROW_NAME[variant]).resolution).toEqual({ by: 'rule-link', rules: ['LEND-03'] });
    const lend04 = findCandidate(all, 'LEND-04', (c) => c.kind === 'rule-without-tests' && c.ruleId === 'LEND-04');
    expect(lend04).toMatchObject({ source: 'card', resolution: { by: 'untested', reason: 'the unpaid-fine check has no test yet' } });
    expect(payload.counts.open + payload.counts.resolved).toBe(all.length);
    expect(payload.counts.resolved).toBe(all.filter((c) => c.resolution !== undefined).length);
  });

  it('get_context_map returns per-context metrics, criteria and suggested rungs', async (context) => {
    const map = await contextMap(shared.session);
    expect(map.contextMap.map((e) => [e.id, e.rung])).toEqual([
      ['lending', 'pinned'],
      ['billing', 'bounded'],
      ['catalog', 'fear'],
    ]);
    const [lending, billing, catalog] = map.contextMap as [ContextMapEntry, ContextMapEntry, ContextMapEntry];

    // Tier-independent facts: the Language terms and the catalog without main paths.
    expect(lending.criteria.named).toMatchObject({ met: false, terms: 4, inGlossary: 1, missing: ['Member account', 'Account', 'Fine'] });
    expect(billing.criteria.named).toMatchObject({ met: true, terms: 1, inGlossary: 1, missing: [] });
    expect(billing.criteria.boring).toMatchObject({ met: false, rules: 3, rulesWithoutTests: 3 });
    expect(billing.criteria.boring.openCandidates).toBeGreaterThanOrEqual(2);
    expect(catalog.criteria.pinned.coverage).toBeNull();
    expect(catalog.suggestedRung).toBe('fear');
    expect(lending.criteria.pinned.mainPaths).toBe(2);
    for (const entry of map.contextMap) expect(entry.boundariesKnown, entry.id).toBe(true);

    shared.ws.requireEdges();
    if (!shared.ws.resolvesEdges) context.skip('C# needs the Roslyn tier (.NET SDK 8+) to resolve edges between files');
    expect(lending.criteria.pinned).toMatchObject({ met: true, mainPaths: 2, reached: 2, coverage: 1 });
    expect(lending.suggestedRung).toBe('pinned');
    expect(lending.crossContextEdges.out).toBeGreaterThanOrEqual(1);
    expect(billing.criteria.pinned.met).toBe(true);
    expect(billing.criteria.bounded).toMatchObject({ met: true, boundaryViolations: 0 });
    expect(billing.criteria.bounded.contractSymbols).toBeGreaterThanOrEqual(1);
    expect(billing.criteria.bounded.reached).toBe(billing.criteria.bounded.contractSymbols);
    expect(billing.suggestedRung).toBe('bounded');
    expect(map.summary).toMatchObject({ contexts: 3, agree: 3 });
    // W17: the C# Billing tests sit outside billing's paths and count for billing through the main path they reach.
    expect(lending.tests).toEqual({ characterization: 1, contract: 0 });
    expect(billing.tests).toEqual({ characterization: 1, contract: 1 });
    expect(catalog.tests).toEqual({ characterization: 0, contract: 0 });
    expect(lending.criteria.pinned.characterizationTests).toBe(1);
    expect(billing.criteria.pinned.characterizationTests).toBe(1);
  });

  it('ctxo domain map --json and ctxo domain shadow-specs lending --json print the tool bodies', async () => {
    const map = shared.ws.cli(['domain', 'map', '--json']);
    expect(map.status, map.stderr).toBe(0);
    expect(JSON.parse(map.stdout)).toEqual(withoutMeta((await contextMap(shared.session)) as unknown as Payload));

    const open = shared.ws.cli(['domain', 'shadow-specs', 'lending', '--json']);
    expect(open.status, open.stderr).toBe(0);
    expect(JSON.parse(open.stdout)).toEqual(withoutMeta((await shadowSpecs(shared.session)) as unknown as Payload));

    const all = shared.ws.cli(['domain', 'shadow-specs', 'lending', '--all', '--json']);
    expect(all.status, all.stderr).toBe(0);
    expect(JSON.parse(all.stdout)).toEqual(withoutMeta((await shadowSpecs(shared.session, { includeResolved: true })) as unknown as Payload));
  });

  it('the same input twice gives byte-identical shadow-candidates.json and maturity.json and identical tool payloads', async (context) => {
    const other = prepared(variant);
    // W20, E-M5: a cold Roslyn start can fall back to the syntax tier, whose symbol IDs differ; that is no
    // nondeterminism, so the comparison is skipped (and fails under CTXO_REQUIRE_DOTNET=1).
    requireSameTier(shared.ws, other, (note) => context.skip(note));
    expect(other.read(CANDIDATES_ARTIFACT)).toBe(shared.ws.read(CANDIDATES_ARTIFACT));
    expect(other.read(MATURITY_ARTIFACT)).toBe(shared.ws.read(MATURITY_ARTIFACT));
    const session = await other.connect();
    try {
      expect(withoutRoot((await contextMap(session)) as unknown as Payload)).toEqual(withoutRoot((await contextMap(shared.session)) as unknown as Payload));
      for (const args of [{}, { includeResolved: true }]) {
        expect(withoutRoot((await shadowSpecs(session, args)) as unknown as Payload)).toEqual(
          withoutRoot((await shadowSpecs(shared.session, args)) as unknown as Payload),
        );
      }
    } finally {
      await session.close();
    }
  });

  it('verify-domain warns about a stale resolution and still passes', () => {
    const ws = prepared(variant);
    const stale = 'literal-comparison | RenewalPolicy.gone | renewals > 9';
    ws.write(SHADOW_SPECS, `${ws.read(SHADOW_SPECS).replace(/\r\n/g, '\n')}- fingerprint: "${stale}"\n  resolution: { rule: LEND-05 }\n`);
    const result = ws.cli(['verify-domain', '--json']);
    expect(result.status, result.stdout).toBe(0);
    const report = JSON.parse(result.stdout) as { checks: { id: string; status: string; findings: { severity: string; message: string }[] }[] };
    const check12 = report.checks.find((c) => c.id === '12')!;
    expect(check12.status).toBe('warn');
    expect(check12.findings).toEqual([expect.objectContaining({ severity: 'warning', message: `stale resolution "${stale}" matches no candidate of lending` })]);
  });

  it('a resolution recorded for the inner call of a one-line chain turns stale (FC-4b)', () => {
    // Before FC-4b, `email.trim().toLowerCase()` gave two candidates and the sample resolved the inner `email.trim()`.
    const ws = SampleWorkspace.create(variant);
    const chain: Record<Variant, string> = {
      csharp: 'namespace LibraryLending.Lending;\n\npublic static class MemberDirectory\n{\n    public static string Key(string email) => email.Trim().ToLowerInvariant();\n}\n',
      typescript: 'export function memberKey(email: string): string {\n  return email.trim().toLowerCase();\n}\n',
    };
    const inner: Record<Variant, string> = {
      csharp: 'normalization | MemberDirectory.Key | email.Trim()',
      typescript: 'normalization | member-directory.memberKey | email.trim()',
    };
    ws.write(MEMBER_DIRECTORY[variant], chain[variant]);
    ws.commitLoaderRules();
    ws.index();
    const result = ws.cli(['verify-domain', '--json']);
    expect(result.status, result.stdout).toBe(0);
    const report = JSON.parse(result.stdout) as { checks: { id: string; status: string; findings: { severity: string; message: string }[] }[] };
    const check12 = report.checks.find((c) => c.id === '12')!;
    expect(check12.status).toBe('warn');
    expect(check12.findings).toEqual([
      expect.objectContaining({ severity: 'warning', message: `stale resolution "${inner[variant]}" matches no candidate of lending` }),
    ]);
  });

  it('a resolution written after the index takes effect on the next call', async () => {
    const ws = prepared(variant);
    const session = await ws.connect();
    try {
      const before = lowerCaseCandidate((await shadowSpecs(session)).shadowSpecs, variant);
      ws.write(
        SHADOW_SPECS,
        `${ws.read(SHADOW_SPECS).replace(/\r\n/g, '\n')}- fingerprint: "${before.fingerprint}"\n  resolution: { notARule: "${NOT_A_RULE}" }\n`,
      );
      const open = (await shadowSpecs(session)).shadowSpecs;
      expect(open.some((c) => c.fingerprint === before.fingerprint)).toBe(false);
      const resolved = lowerCaseCandidate((await shadowSpecs(session, { includeResolved: true })).shadowSpecs, variant);
      expect(resolved.resolution).toEqual({ by: 'shadow-specs', notARule: NOT_A_RULE });
    } finally {
      await session.close();
    }
  });

  it.skipIf(variant !== 'csharp')('tools/list holds 18 tools', async () => {
    const names = await shared.session.listTools();
    expect(names).toHaveLength(18);
    expect(names).toEqual(expect.arrayContaining(['find_shadow_specs', 'get_context_map', 'get_domain_context', 'get_rule']));
  });

  it.skipIf(variant !== 'csharp')('an unindexed Python file in a context gets file-level text facts', async () => {
    const billing = (await shared.session.call('find_shadow_specs', { context: 'billing' })) as unknown as ShadowSpecsPayload;
    const fees = billing.shadowSpecs.filter((c) => c.file === 'src/Billing/fees.py');
    for (const text of ['TIMEOUT_SECONDS = 30', 'days > 14']) {
      const hit = fees.find((c) => c.text === text);
      expect(hit, `${text} in ${JSON.stringify(fees)}`).toBeDefined();
      expect(hit).toMatchObject({ source: 'text', symbolId: 'src/Billing/fees.py::fees::variable' });
    }
  });

  it.skipIf(variant !== 'csharp')('candidate text passes the masking pipeline', async () => {
    const ws = SampleWorkspace.create(variant);
    ws.replace(RENEWAL_POLICY[variant], '        if (loanPeriods >= 2) return false;', '        if (loanPeriods >= 2) return false;\n        if (apiKey == "AKIAIOSFODNN7EXAMPLE") return false;');
    ws.replace(RENEWAL_POLICY[variant], 'CanRenew(int loanPeriods)', 'CanRenew(int loanPeriods, string apiKey = "")');
    ws.commit('feat: a key in a renewal check');
    ws.index();
    expect(ws.read(CANDIDATES_ARTIFACT)).toContain('AKIAIOSFODNN7EXAMPLE');
    const session = await ws.connect();
    try {
      const payload = await shadowSpecs(session);
      const keyed = payload.shadowSpecs.find((c) => c.file === RENEWAL_POLICY[variant] && c.text.startsWith('apiKey =='));
      expect(keyed, JSON.stringify(payload.shadowSpecs)).toBeDefined();
      expect(JSON.stringify(payload)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    } finally {
      await session.close();
    }
  });

  it.skipIf(variant !== 'typescript')('the text fallback works for a v1 plugin', async () => {
    const ws = SampleWorkspace.create(variant, { fixturePlugins: ['ctxo-lang-lendingscript'] });
    ws.write('src/lending/fees.lend', 'function lateFee {\n  if days > 14 then charge 2.5\n  retries = 3\n}\n');
    ws.commit('feat: late fees in LendingScript');
    const indexed = ws.index();
    expect(indexed.stderr).not.toContain('ctxo-lang-lendingscript');
    expect(ws.read('.ctxo/index/src/lending/fees.lend.json')).toContain('src/lending/fees.lend::lateFee::function');
    const session = await ws.connect();
    try {
      const fees = (await shadowSpecs(session)).shadowSpecs.filter((c) => c.file === 'src/lending/fees.lend');
      for (const [text, line] of [
        ['days > 14', 2],
        ['retries = 3', 3],
      ] as const) {
        const hit = fees.find((c) => c.text === text);
        expect(hit, `${text} in ${JSON.stringify(fees)}`).toBeDefined();
        expect(hit).toMatchObject({ source: 'text', line, symbolId: 'src/lending/fees.lend::lateFee::function' });
      }
    } finally {
      await session.close();
    }
  });
});
