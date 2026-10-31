import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertBuilt, cleanupWorkspaces, type McpSession, requireSameTier, SampleWorkspace, type Variant } from './sample-workspace.js';

/**
 * The PR 3 acceptance tests (spec 11.5, 13.1, Review Focus 1 to 5): the domain graph of the synthetic
 * library-lending sample, driven through the built CLI and the built MCP server. One indexed workspace per variant
 * is shared by the read-only tests; every test that changes files works on its own copy. Symbol IDs come from
 * `search_symbols`, never hard-coded C# IDs: the Roslyn and the tree-sitter tiers write different ones.
 */

const VARIANTS: readonly Variant[] = ['csharp', 'typescript'];

type Payload = Record<string, unknown>;

const CARD = 'docs/domain/lending/domain.md';
const GRAPH = '.ctxo/index/domain/graph.json';
const STALE_CARDS_HINT = 'Cards or the glossary changed since the domain graph was built; run "ctxo index" to refresh rule links (a running "ctxo watch" does this shortly after the edit).';

const LOAN_LIMIT: Record<Variant, string> = {
  csharp: 'src/Lending/LoanLimit.cs',
  typescript: 'src/lending/loan-limit.ts',
};
const LOAN_LIMIT_TEST: Record<Variant, string> = {
  csharp: 'tests/Lending.Tests/LoanLimitTests.cs',
  typescript: 'src/lending/__tests__/loan-limit.test.ts',
};
const FINE_CHECK: Record<Variant, string> = {
  csharp: 'src/Lending/FineCheck.cs',
  typescript: 'src/lending/fine-check.ts',
};
const BORROW_CHECK_NAME: Record<Variant, RegExp> = { csharp: /CanBorrow/, typescript: /^canBorrow$/ };
const CHARGE_SERVICE: Record<Variant, string> = {
  csharp: 'src/Billing/IChargeService.cs',
  typescript: 'src/billing/charge-service.ts',
};

beforeAll(assertBuilt);
afterAll(cleanupWorkspaces);

/** A fresh copy of the variant with its generated loader rules committed and the index built. */
function prepared(variant: Variant): SampleWorkspace {
  const ws = SampleWorkspace.create(variant);
  ws.commitLoaderRules();
  ws.index();
  return ws;
}

/** The Lending borrow check, found through `search_symbols` (C# IDs differ between the analysis tiers). */
async function borrowCheck(session: McpSession, variant: Variant): Promise<string> {
  const found = (await session.call('search_symbols', { pattern: 'CanBorrow|canBorrow' })) as {
    results: { symbolId: string; name: string; kind: string; file: string }[];
  };
  const hit = found.results.find(
    (r) => r.file === LOAN_LIMIT[variant] && ['method', 'function'].includes(r.kind) && BORROW_CHECK_NAME[variant].test(r.name.split('.').pop()!),
  );
  if (hit === undefined) throw new Error(`no borrow check in ${JSON.stringify(found.results)}`);
  return hit.symbolId;
}

/** The response without `_meta.workspace`, the only part that names the temp directory. */
function withoutRoot(response: Payload): Payload {
  const meta = { ...(response['_meta'] as Payload) };
  delete meta['workspace'];
  return { ...response, _meta: meta };
}

interface LinkSource {
  source: string;
  annotation?: string;
  file: string;
  line: number;
}
interface RulePayload {
  rule: { ruleId: string; card: string };
  tests: { file: string; symbolId?: string; testName?: string; sources: LinkSource[] }[];
  symbols: { file: string; symbolId?: string; fallback?: true; sources: LinkSource[] }[];
  decisions: { id: string; date: string; text: string; rules: string[]; provenance: Payload[] }[];
  provenance: Payload[];
  stale?: true;
  hint?: string;
}

interface Shared {
  ws: SampleWorkspace;
  session: McpSession;
  borrowCheck: string;
}

describe.each(VARIANTS)('PR 3 acceptance, %s sample', (variant) => {
  let shared: Shared;

  beforeAll(async () => {
    const ws = prepared(variant);
    const session = await ws.connect();
    shared = { ws, session, borrowCheck: await borrowCheck(session, variant) };
  }, 240_000);

  afterAll(async () => {
    await shared?.session.close();
  });

  it('get_blast_radius on the Lending borrow check lists LEND-03 and the Lending card', async () => {
    const response = await shared.session.call('get_blast_radius', { symbolId: shared.borrowCheck });
    expect(response['error']).toBeUndefined();
    expect(response['rulesAffected']).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'LEND-03', card: CARD })]));
    expect(response['cardsToUpdate']).toEqual(expect.arrayContaining([{ context: 'lending', card: CARD }]));
  });

  it('get_rule LEND-03 returns the linked tests with the source of each link', async () => {
    const rule = (await shared.session.call('get_rule', { ruleId: 'LEND-03' })) as unknown as RulePayload;
    expect(rule.rule).toMatchObject({ ruleId: 'LEND-03', card: CARD });
    const fileEntry = rule.tests.find((t) => t.file === LOAN_LIMIT_TEST[variant] && t.symbolId === undefined);
    expect(fileEntry?.sources.map((s) => s.source)).toContain('card-tests');
    if (variant === 'csharp') {
      const trait = rule.tests.find((t) => t.symbolId?.includes('LoanLimitTests') === true);
      expect(trait, JSON.stringify(rule.tests)).toBeDefined();
      expect(trait!.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'annotation', annotation: 'Trait' })]));
    } else {
      const titled = rule.tests.find((t) => t.testName === 'LEND-03 rejects the sixth loan');
      expect(titled, JSON.stringify(rule.tests)).toBeDefined();
      expect(titled!.file).toBe(LOAN_LIMIT_TEST[variant]);
      expect(titled!.sources.map((s) => s.source)).toContain('test-title');
    }
    // The card's Code: line links the borrow check.
    expect(rule.symbols.map((s) => s.file)).toContain(LOAN_LIMIT[variant]);
  });

  it('get_rule LEND-04 lists the rule: comment link to the unpaid-fine check and the 2026-10-01 decision with its external URL', async () => {
    const rule = (await shared.session.call('get_rule', { ruleId: 'LEND-04' })) as unknown as RulePayload;
    // Review Focus 4: the comment sits above the method, and the link goes to the method, not the class.
    const linked = rule.symbols.find((s) => s.file === FINE_CHECK[variant]);
    expect(linked, JSON.stringify(rule.symbols)).toBeDefined();
    expect(linked!.symbolId).toMatch(/BlocksBorrowing|blocksBorrowing/);
    expect(linked!.symbolId).toMatch(/::(method|function)$/);
    expect(linked!.sources).toEqual([expect.objectContaining({ source: 'rule-comment', file: FINE_CHECK[variant] })]);
    expect(rule.decisions.map((d) => d.date)).toEqual(['2026-10-01']);
    expect(rule.decisions[0]!.text).toContain('unpaid fine');
    expect(rule.provenance).toEqual([expect.objectContaining({ kind: 'external', value: 'https://example.com/issues/45' })]);
  });

  it('get_domain_context for the Lending policy file returns terms, rules, contracts, decisions and open questions', async () => {
    const card = (await shared.session.call('get_domain_context', { path: LOAN_LIMIT[variant] })) as {
      context: Payload;
      terms: { term: string; definitions: { origin: string; file: string }[] }[];
      rules: { ruleId: string }[];
      contracts: { outbound: { target: string; files: string[] }[]; text?: string; references: string[] };
      decisions: { date: string }[];
      openQuestions: { text: string }[];
    };
    expect(card.context).toMatchObject({ id: 'lending', card: CARD });
    expect(card.terms.map((t) => t.term)).toEqual(['Loan', 'Member account', 'Account', 'Fine']);
    // The glossary's `Loan (context: lending)` joins the card's term.
    expect(card.terms[0]!.definitions.map((d) => d.origin)).toEqual(['card', 'glossary']);
    expect(card.rules.map((r) => r.ruleId)).toEqual(['LEND-01', 'LEND-02', 'LEND-03', 'LEND-04', 'LEND-05']);
    expect(card.contracts.outbound).toEqual([{ target: 'billing', files: [CHARGE_SERVICE[variant]] }]);
    expect(card.contracts.references).toContain(CHARGE_SERVICE[variant]);
    expect(card.decisions.map((d) => d.date)).toEqual(['2026-10-01', '2026-09-12']);
    expect(card.openQuestions.map((q) => q.text)).toContain('Should renewals count as new loans?');
  });

  it('get_why_context lists the Lending decisions, LEND-03 first, with resolved provenance', async () => {
    const why = (await shared.session.call('get_why_context', { symbolId: shared.borrowCheck })) as {
      decisions: { date: string; rules: string[]; provenance: Payload[] }[];
    };
    // LEND-03's decision is older, but it names a rule linked to the symbol, so it comes first (F9).
    expect(why.decisions.map((d) => d.date)).toEqual(['2026-09-12', '2026-10-01']);
    expect(why.decisions[0]!.rules).toEqual(['LEND-03']);
    expect(why.decisions[0]!.provenance).toEqual([
      { kind: 'file', path: 'docs/specs/loan-limit.md', exists: true, label: 'spec' },
      { kind: 'external', value: '#123' },
      { kind: 'file', path: 'docs/adr/adr-007-loan-limit.md', exists: true, label: 'ADR-007' },
    ]);
  });

  it('get_context_for_task carries a card excerpt within the token budget', async () => {
    const task = (await shared.session.call('get_context_for_task', { symbolId: shared.borrowCheck, taskType: 'understand', tokenBudget: 4000 })) as {
      tokenBudget: number;
      totalTokens: number;
      cardExcerpt: { context: string; card: string; rules: { ruleId: string; linkedTo: string }[]; tokens: number };
    };
    expect(task.tokenBudget).toBe(4000);
    expect(task.cardExcerpt).toMatchObject({ context: 'lending', card: CARD });
    expect(task.cardExcerpt.rules[0]).toMatchObject({ ruleId: 'LEND-03', linkedTo: 'target' });
    expect(task.totalTokens + task.cardExcerpt.tokens).toBeLessThanOrEqual(4000);
  });

  it('get_ranked_context with scope domain finds LEND-03 by "five loans" and the spec file by "renewal study"', async () => {
    const byWords = (await shared.session.call('get_ranked_context', { query: 'five loans', scope: 'domain' })) as {
      scope: string;
      results: { id: string; kind: string; path: string }[];
    };
    expect(byWords.scope).toBe('domain');
    expect(byWords.results.find((r) => r.kind === 'rule')?.id).toBe('rule:LEND-03');

    const bySpec = (await shared.session.call('get_ranked_context', { query: 'renewal study', scope: 'domain' })) as {
      results: { id: string; kind: string; path: string }[];
    };
    // LEND-05 ("renewed") and the open question ("renewals") also match "renewal"; only the spec has both words in a
    // row, so the engine's bigram boost puts it first.
    expect(bySpec.results[0]).toMatchObject({ kind: 'provenance', path: 'docs/specs/loan-limit.md' });
  });

  it('generic terms: a two-context term stays in its context and a plural table name matches', async () => {
    const lending = (await shared.session.call('get_domain_context', { path: LOAN_LIMIT[variant] })) as {
      terms: { term: string; identifiers: string[]; identifierCount: number }[];
    };
    const billing = (await shared.session.call('get_domain_context', { path: CHARGE_SERVICE[variant] })) as {
      terms: { term: string; identifiers: string[]; identifierCount: number }[];
    };
    const lendingDir = variant === 'csharp' ? 'src/Lending/' : 'src/lending/';
    const billingDir = variant === 'csharp' ? 'src/Billing/' : 'src/billing/';

    // `Account` is a Lending term on the card and a Billing term in the glossary: each matches only its own symbols.
    const lendingAccount = lending.terms.find((t) => t.term === 'Account')!;
    expect(lendingAccount.identifiers.length).toBeGreaterThan(0);
    expect(lendingAccount.identifiers.some((id) => id.startsWith(`${lendingDir}account.`) || id.startsWith(`${lendingDir}Account.`))).toBe(true);
    expect(lendingAccount.identifiers.every((id) => id.startsWith(lendingDir))).toBe(true);
    const billingAccount = billing.terms.find((t) => t.term === 'Account')!;
    expect(billingAccount.identifiers.length).toBeGreaterThan(0);
    expect(billingAccount.identifiers.every((id) => id.startsWith(billingDir))).toBe(true);

    // `Loan` matches the plural table `dbo.loans` of the Lending migration; no test symbol ever matches.
    const loan = lending.terms.find((t) => t.term === 'Loan')!;
    expect(loan.identifiers.some((id) => id.startsWith('db/migrations/lending/'))).toBe(true);
    for (const term of lending.terms) expect(term.identifiers.some((id) => id.startsWith(LOAN_LIMIT_TEST[variant]))).toBe(false);
  });

  it('generic terms: a namespace segment and a term of short tokens link nothing', async () => {
    // Review Focus 5: C# names its namespace LibraryLending.Lending, and MemberId splits into member and id.
    const ws = SampleWorkspace.create(variant);
    ws.replace(CARD, '- **Fine**:', '- **Lending**: the desk that lends books.\n- **ID**: the number a member is known by.\n- **Fine**:');
    ws.commit('docs: two generic terms');
    ws.index();
    const session = await ws.connect();
    try {
      const card = (await session.call('get_domain_context', { path: LOAN_LIMIT[variant] })) as {
        terms: { term: string; identifiers: string[]; identifierCount: number }[];
      };
      for (const name of ['Lending', 'ID']) {
        expect(card.terms.find((t) => t.term === name), name).toMatchObject({ identifiers: [], identifierCount: 0 });
      }
      expect(card.terms.find((t) => t.term === 'Account')!.identifierCount).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it('the same input twice gives a byte-identical graph.json and identical get_rule responses', async (context) => {
    const other = prepared(variant);
    // W20, E-M5: a cold Roslyn start can fall back to the syntax tier, whose symbol IDs differ; that is no
    // nondeterminism, so the comparison is skipped (and fails under CTXO_REQUIRE_DOTNET=1).
    requireSameTier(shared.ws, other, (note) => context.skip(note));
    expect(other.read(GRAPH)).toBe(shared.ws.read(GRAPH));
    const session = await other.connect();
    try {
      for (const ruleId of ['LEND-03', 'LEND-04']) {
        expect(withoutRoot(await session.call('get_rule', { ruleId }))).toEqual(withoutRoot(await shared.session.call('get_rule', { ruleId })));
      }
    } finally {
      await session.close();
    }
  });

  it('stale cards: a card edit after the last index answers from the graph with stale: true and the hint', async () => {
    const ws = prepared(variant);
    ws.replace(CARD, '### LEND-05 A loan can be renewed once', '### LEND-05 A loan can be renewed twice');
    let session = await ws.connect();
    try {
      const rule = (await session.call('get_rule', { ruleId: 'LEND-05' })) as unknown as RulePayload & { rule: { title: string } };
      expect(rule.rule.title).toBe('A loan can be renewed once');
      expect(rule).toMatchObject({ stale: true, hint: STALE_CARDS_HINT });
    } finally {
      await session.close();
    }
    ws.index();
    session = await ws.connect();
    try {
      const rule = (await session.call('get_rule', { ruleId: 'LEND-05' })) as unknown as RulePayload & { rule: { title: string } };
      expect(rule.rule.title).toBe('A loan can be renewed twice');
      expect(rule.stale).toBeUndefined();
    } finally {
      await session.close();
    }
  });

  it('the extended sample has no check 6 finding; a Code: file that is gone is a check 6 error', () => {
    const ws = prepared(variant);
    const result = ws.cli(['verify-domain', '--json']);
    const report = JSON.parse(result.stdout) as { summary: { errors: number }; checks: { id: string; findings: { severity: string; message: string }[] }[] };
    expect(result.status, result.stdout).toBe(0);
    expect(report.summary.errors).toBe(0);
    const check6 = report.checks.find((c) => c.id === '6')!;
    expect(check6.findings).toEqual([]);

    ws.replace(CARD, `Code: \``, `Code: \`src/gone.txt\` \``);
    ws.commit('docs: a code reference to a file that is gone');
    ws.index();
    const broken = ws.cli(['verify-domain', '--json']);
    expect(broken.status).toBe(1);
    expect(broken.stdout).toContain('LEND-03: Code file \\"src/gone.txt\\" does not exist');
  });

  it.skipIf(variant !== 'typescript')('a card-only commit refreshes graph.json through ctxo index --commit HEAD', () => {
    const ws = prepared(variant);
    const before = JSON.parse(ws.read(GRAPH)) as { rules: { ruleId: string }[] };
    expect(before.rules.map((r) => r.ruleId)).not.toContain('LEND-06');

    ws.replace(CARD, '## Boundary contracts', '### LEND-06 A lost book ends its loan\nUntested: the lost-book desk has no code yet\n\n## Boundary contracts');
    ws.commit('docs: the lost-book rule');
    const result = ws.cli(['index', '--commit', 'HEAD']);
    expect(result.status, result.stderr).toBe(0);

    const after = JSON.parse(ws.read(GRAPH)) as { rules: { ruleId: string; title: string }[] };
    expect(after.rules.find((r) => r.ruleId === 'LEND-06')).toMatchObject({ title: 'A lost book ends its loan' });
  });

  it.skipIf(variant !== 'csharp')(
    'a C# Code: symbol ID of the other analysis tier falls back to its file; verify-domain warns and passes',
    async () => {
      // Review Focus 1: Roslyn writes `Ns.LoanLimit.CanBorrow`, tree-sitter `Ns.LoanLimit.CanBorrow(1)`.
      const ws = prepared(variant);
      let session = await ws.connect();
      const indexed = await borrowCheck(session, variant);
      await session.close();
      const [file, name, kind] = indexed.split('::') as [string, string, string];
      const otherTier = `${file}::${/\(\d+\)$/.test(name) ? name.replace(/\(\d+\)$/, '') : `${name}(1)`}::${kind}`;
      ws.replace(CARD, 'Code: `src/Lending/LoanLimit.cs`', `Code: \`${otherTier}\``);
      ws.commit('docs: name the borrow check by its symbol');
      ws.index();

      const verify = ws.cli(['verify-domain', '--json']);
      expect(verify.status, verify.stdout).toBe(0);
      expect(verify.stdout).toContain(`LEND-03: Code: \\"${otherTier}\\" is not an indexed symbol; it links to its file`);

      session = await ws.connect();
      try {
        const rule = (await session.call('get_rule', { ruleId: 'LEND-03' })) as unknown as RulePayload;
        // PR 4's loans controller links LEND-03 by a rule: comment as well; the card's Code: link is the fallback.
        const fromCard = rule.symbols.filter((s) => s.file === LOAN_LIMIT[variant]);
        expect(fromCard).toEqual([
          expect.objectContaining({ file: LOAN_LIMIT[variant], fallback: true, sources: [expect.objectContaining({ source: 'card-code', file: CARD })] }),
        ]);
        expect(fromCard[0]!.symbolId).toBeUndefined();
        expect(rule.symbols.filter((s) => s.file !== LOAN_LIMIT[variant]).map((s) => s.sources.map((source) => source.source))).toEqual([['rule-comment']]);
        const blast = await session.call('get_blast_radius', { symbolId: indexed });
        expect(blast['rulesAffected']).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'LEND-03' })]));
      } finally {
        await session.close();
      }
    },
  );

  it.skipIf(variant !== 'csharp')('get_pr_impact reports contextsTouched, cardsChanged and rulesWithoutTests', async () => {
    const ws = prepared(variant);
    ws.git('checkout', '-q', '-b', 'feat');
    ws.replace(LOAN_LIMIT[variant], 'MaxLoans = 5', 'MaxLoans = 6');
    ws.commit('feat: allow a sixth loan');

    let session = await ws.connect();
    try {
      const impact = (await session.call('get_pr_impact', { since: 'main' })) as {
        contextsTouched: { id: string; status: string }[];
        cardsChanged: string[];
        rulesWithoutTests: { ruleId: string }[];
      };
      expect(impact.contextsTouched).toEqual([expect.objectContaining({ id: 'lending', status: 'unresolved' })]);
      expect(impact.cardsChanged).toEqual([]);
      expect(impact.rulesWithoutTests.map((r) => r.ruleId)).toEqual(['LEND-01', 'LEND-02', 'LEND-04', 'LEND-05']);
    } finally {
      await session.close();
    }

    ws.replace(CARD, '### LEND-03 A member holds at most five loans', '### LEND-03 A member holds at most six loans');
    ws.commit('docs: the loan limit is six');
    session = await ws.connect();
    try {
      const impact = (await session.call('get_pr_impact', { since: 'main' })) as {
        contextsTouched: { id: string; status: string }[];
        cardsChanged: string[];
      };
      expect(impact.contextsTouched).toEqual([expect.objectContaining({ id: 'lending', status: 'card-changed' })]);
      expect(impact.cardsChanged).toEqual([CARD]);
    } finally {
      await session.close();
    }
  });

  it.skipIf(variant !== 'csharp')('tools/list holds 18 tools and the scope parameter lists code and domain', async () => {
    const tools = await shared.session.listToolDefinitions();
    expect(tools).toHaveLength(18);
    const ranked = tools.find((t) => t.name === 'get_ranked_context')!;
    const scope = (ranked.inputSchema['properties'] as Record<string, { enum?: string[] }>)['scope'];
    expect(scope?.enum).toEqual(['code', 'domain']);
  });

  it.skipIf(variant !== 'typescript')('card text passes the masking pipeline', async () => {
    const ws = SampleWorkspace.create(variant);
    ws.replace(CARD, '- Should renewals count as new loans?', '- Should renewals count as new loans? The old desk key AKIAIOSFODNN7EXAMPLE still opens the cabinet.');
    ws.commit('docs: a question with a key in it');
    ws.index();
    const session = await ws.connect();
    try {
      const card = await session.call('get_domain_context', { path: LOAN_LIMIT[variant] });
      const text = JSON.stringify(card);
      expect(text).toContain('Should renewals count as new loans?');
      expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    } finally {
      await session.close();
    }
  });

  it.skipIf(variant !== 'typescript')('get_domain_context truncates a card with 200 rules through the envelope', async () => {
    const ws = SampleWorkspace.create(variant);
    const generated = Array.from({ length: 200 }, (_, i) => `### LEND-${100 + i} Generated rule ${i + 1}\nUntested: generated for the truncation test\n`).join('\n');
    ws.replace(CARD, '## Boundary contracts', `${generated}\n## Boundary contracts`);
    ws.commit('docs: two hundred generated rules');
    ws.index();
    const session = await ws.connect({ CTXO_RESPONSE_LIMIT: '4096' });
    try {
      const card = (await session.call('get_domain_context', { path: LOAN_LIMIT[variant] })) as {
        rules: unknown[];
        _meta: { truncated: boolean; totalItems: number; returnedItems: number; hint?: string };
      };
      expect(card._meta.truncated).toBe(true);
      expect(card._meta.totalItems).toBe(205);
      expect(card._meta.returnedItems).toBe(card.rules.length);
      expect(card.rules.length).toBeLessThan(205);
      expect(card._meta.hint).toBe("Use get_rule with a ruleId for one rule's tests, code and decisions.");
    } finally {
      await session.close();
    }
  });
});
