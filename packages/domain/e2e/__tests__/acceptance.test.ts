import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { allKeys, assertBuilt, cleanupWorkspaces, SampleWorkspace, type Variant } from './sample-workspace.js';

/**
 * The PR 2B acceptance tests (spec 10.10, 13.1): the synthetic library-lending sample in a C# and a TypeScript
 * variant, driven through the built CLI and the built MCP server. Each test copies a variant to a temp
 * repository, so none depends on another.
 */

const VARIANTS: readonly Variant[] = ['csharp', 'typescript'];

const REGISTRY = 'docs/domain/contexts.yaml';
const LOAN_LIMIT_TEST: Record<Variant, string> = {
  csharp: 'tests/Lending.Tests/LoanLimitTests.cs',
  typescript: 'src/lending/__tests__/loan-limit.test.ts',
};
const LOAN_LIMIT: Record<Variant, string> = {
  csharp: 'src/Lending/LoanLimit.cs',
  typescript: 'src/lending/loan-limit.ts',
};
const CANBORROW_ID: Record<Variant, string> = {
  csharp: 'src/Lending/LoanLimit.cs::LibraryLending.Lending.LoanLimit::class',
  typescript: 'src/lending/loan-limit.ts::canBorrow::function',
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

interface VerifyReport {
  readonly checks: readonly { id: string; status: string; findings: readonly { severity: string; message: string }[] }[];
  readonly summary: { errors: number; warnings: number };
  readonly exitCode: number;
}

function verifyJson(ws: SampleWorkspace, ...args: string[]): { status: number | null; report: VerifyReport; messages: string[] } {
  const result = ws.cli(['verify-domain', '--json', ...args]);
  const report = JSON.parse(result.stdout) as VerifyReport;
  const messages = report.checks.flatMap((check) => check.findings.map((finding) => `${check.id} ${finding.severity} ${finding.message}`));
  return { status: result.status, report, messages };
}

/** A Lending class that reaches into a Billing internal instead of the charge service. */
function addBillingInternalEdge(ws: SampleWorkspace, variant: Variant): void {
  if (variant === 'csharp') {
    ws.write(
      'src/Lending/LateFee.cs',
      `using LibraryLending.Billing;

namespace LibraryLending.Lending;

public static class LateFee
{
    public static int For(int payerId)
    {
        return new InvoiceLedger().BalanceOf(payerId);
    }
}
`,
    );
  } else {
    ws.write(
      'src/lending/late-fee.ts',
      `import { InvoiceLedger } from '../billing/invoice-ledger.js';

export function lateFeeFor(payerId: number): number {
  return new InvoiceLedger().balanceOf(payerId);
}
`,
    );
  }
}

const FIRST_EDGE_FILE: Record<Variant, string> = { csharp: 'src/Lending/LateFee.cs', typescript: 'src/lending/late-fee.ts' };
const SECOND_EDGE_FILE: Record<Variant, string> = { csharp: 'src/Lending/Fine.cs', typescript: 'src/lending/fine.ts' };

/** A second Lending class that reaches into the Billing internal: the violation a branch adds. */
function addSecondBillingInternalEdge(ws: SampleWorkspace, variant: Variant): void {
  if (variant === 'csharp') {
    ws.write(
      SECOND_EDGE_FILE.csharp,
      `using LibraryLending.Billing;

namespace LibraryLending.Lending;

public static class Fine
{
    public static int Owed(int payerId)
    {
        return new InvoiceLedger().BalanceOf(payerId) * 2;
    }
}
`,
    );
  } else {
    ws.write(
      SECOND_EDGE_FILE.typescript,
      `import { InvoiceLedger } from '../billing/invoice-ledger.js';

export function fineOwed(payerId: number): number {
  return new InvoiceLedger().balanceOf(payerId) * 2;
}
`,
    );
  }
}

function domainArtifacts(ws: SampleWorkspace): Map<string, string> {
  const root = ws.path('.ctxo/index/domain');
  const files = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    // Entry kinds come from the directory listing itself: no stat before the read (CodeQL js/file-system-race).
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else files.set(`${prefix}${entry.name}`, readFileSync(full, 'utf-8'));
    }
  };
  walk(root, '');
  return files;
}

describe.each(VARIANTS)('PR 2B acceptance, %s sample', (variant) => {
  it('the sample passes verify-domain with warnings only', () => {
    const ws = prepared(variant);
    const { status, report } = verifyJson(ws);
    expect(status).toBe(0);
    expect(report.exitCode).toBe(0);
    expect(report.summary.errors).toBe(0);
    const boundaries = report.checks.find((check) => check.id === '10')!;
    expect(boundaries.findings.every((f) => f.severity === 'warning')).toBe(true);
    ws.requireEdges();
    if (ws.resolvesEdges) {
      // The Catalog -> Lending edge is a warning: both rungs are non-blocking.
      expect(report.summary.warnings).toBeGreaterThanOrEqual(1);
      expect(boundaries.status).toBe('warn');
      expect(boundaries.findings.some((f) => f.message.startsWith('catalog -> lending:'))).toBe(true);
    }
    for (const check of report.checks) expect(['pass', 'warn', 'skipped'], `check ${check.id}`).toContain(check.status);
  });

  it('verify-domain fails on a non-fear context without a card', () => {
    const ws = prepared(variant);
    ws.replace(REGISTRY, 'rung: fear', 'rung: named');
    const { status, messages } = verifyJson(ws);
    expect(status).toBe(1);
    expect(messages).toContain('2 error catalog: rung "named" needs a card; set "card" or lower the rung to fear');
  });

  it('verify-domain fails on a glob that matches nothing', () => {
    const ws = prepared(variant);
    ws.replace(REGISTRY, '      - "db/migrations/lending/**"', '      - "db/migrations/lending/**"\n      - "src/Shipping/**"');
    const { status, messages } = verifyJson(ws);
    expect(status).toBe(1);
    expect(messages).toContain('3 error lending: "src/Shipping/**" matches no indexed file');
  });

  it('verify-domain fails on an unknown rule ID found in a test', () => {
    const ws = prepared(variant);
    const file = LOAN_LIMIT_TEST[variant];
    if (variant === 'csharp') {
      ws.replace(
        file,
        '    [Fact]\n    [Trait("Rule", "LEND-03")]',
        '    [Fact]\n    [Trait("Rule", "LEND-99")]\n    public void RefundsNothing()\n    {\n    }\n\n    [Fact]\n    [Trait("Rule", "LEND-03")]',
      );
    } else {
      ws.replace(file, "  it('LEND-03 rejects", "  it('LEND-99 refunds nothing', () => {\n    expect(true).toBe(true);\n  });\n\n  it('LEND-03 rejects");
    }
    ws.commit('test: a rule that no card defines');
    ws.index();
    const { status, messages } = verifyJson(ws);
    expect(status).toBe(1);
    expect(messages.some((m) => m.startsWith('6 error LEND-99: referenced as "LEND-99" but no card defines it'))).toBe(true);
    // The known rule keeps its link.
    expect(messages.filter((m) => m.includes('LEND-03'))).toEqual([]);
  });

  it('ctxo domain rules --check passes right after --write and fails after a registry change', () => {
    const ws = SampleWorkspace.create(variant);
    ws.index();

    const before = ws.cli(['domain', 'rules', '--check']);
    expect(before.status).toBe(1);
    expect(before.stderr).toContain('missing   .claude/rules/ctxo-context-lending.md');
    expect(before.stderr).toContain('missing   .claude/rules/ctxo-context-billing.md');

    const write = ws.cli(['domain', 'rules', '--write']);
    expect(write.status, write.stderr).toBe(0);
    expect(ws.read('.claude/rules/ctxo-context-lending.md')).toContain('Domain-Unchanged: lending (reason)');
    // Catalog has no card, so it gets no rule.
    expect(ws.exists('.claude/rules/ctxo-context-catalog.md')).toBe(false);

    const after = ws.cli(['domain', 'rules', '--check']);
    expect(after.status, after.stderr).toBe(0);
    expect(after.stderr).toContain('Loader rules are up to date.');

    ws.replace(REGISTRY, 'name: Lending', 'name: Lending desk');
    const changed = ws.cli(['domain', 'rules', '--check']);
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain('outdated  .claude/rules/ctxo-context-lending.md');
  });

  it('boundaries: a Lending edge into a Billing internal fails by-rung and passes with --boundaries report', (context) => {
    const ws = prepared(variant);
    ws.requireEdges();
    if (!ws.resolvesEdges) context.skip('C# needs the Roslyn tier (.NET SDK 8+) to resolve edges between files');
    addBillingInternalEdge(ws, variant);
    ws.commit('feat: lending reads the billing ledger directly');
    ws.index();

    const byRung = verifyJson(ws);
    expect(byRung.status).toBe(1);
    expect(byRung.messages.some((m) => m.startsWith('10 error lending -> billing:'))).toBe(true);

    const report = verifyJson(ws, '--boundaries', 'report');
    expect(report.status).toBe(0);
    expect(report.messages.some((m) => m.startsWith('10 warning lending -> billing:'))).toBe(true);
    expect(report.messages.some((m) => m.startsWith('10 error'))).toBe(false);
  });

  it('boundaries new-only: the branch fails on the violation it adds, not on the one main has', (context) => {
    const ws = prepared(variant);
    ws.requireEdges();
    if (!ws.resolvesEdges) context.skip('C# needs the Roslyn tier (.NET SDK 8+) to resolve edges between files');
    // main already has a Lending edge into a Billing internal; its index is not committed (.gitignore).
    addBillingInternalEdge(ws, variant);
    ws.commit('feat: lending reads the billing ledger directly');
    ws.git('checkout', '-q', '-b', 'feat/fine');
    addSecondBillingInternalEdge(ws, variant);
    ws.commit('feat: fines read the ledger too', '-m', 'Domain-Unchanged: lending (boundary e2e)');
    ws.index();

    const result = ws.cli(['verify-domain', '--json', '--since', 'main', '--boundaries', 'new-only']);
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as VerifyReport & {
      boundaries: { compared: boolean; source: string; new: { from: { file: string }; severity: string }[]; existing: { from: { file: string }; severity: string }[] };
    };
    expect(report.boundaries).toMatchObject({ compared: true, source: 'worktree' });
    expect(new Set(report.boundaries.new.map((v) => v.from.file))).toEqual(new Set([SECOND_EDGE_FILE[variant]]));
    expect(report.boundaries.new.every((v) => v.severity === 'error')).toBe(true);
    expect(report.boundaries.existing.map((v) => v.from.file)).toContain(FIRST_EDGE_FILE[variant]);
    expect(report.boundaries.existing.every((v) => v.severity === 'warning')).toBe(true);
    // Only the new edges are errors (one file can give more than one edge: an import and a call).
    expect(report.summary.errors).toBe(report.boundaries.new.length);
    // ctxo removed its temporary worktree.
    expect(ws.git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);

    // by-rung fails on the existing edges too; without the new edge, new-only passes.
    const byRung = verifyJson(ws, '--since', 'main');
    expect(byRung.report.summary.errors).toBe(report.boundaries.new.length + report.boundaries.existing.filter((v) => v.from.file === FIRST_EDGE_FILE[variant]).length);
    ws.git('checkout', '-q', 'main');
    ws.git('checkout', '-q', '-b', 'feat/quiet');
    ws.commit('chore: nothing', '--allow-empty');
    ws.index();
    const quiet = ws.cli(['verify-domain', '--json', '--since', 'main', '--boundaries', 'new-only']);
    expect(quiet.status, quiet.stderr).toBe(0);
  });

  it('boundaries new-only reads the base from its committed index when it is current', (context) => {
    if (variant !== 'typescript') context.skip('one variant is enough for the committed-index path');
    const ws = prepared(variant);
    ws.write('.gitignore', 'node_modules/\nbin/\nobj/\n.ctxo/.cache/\n');
    addBillingInternalEdge(ws, variant);
    ws.index();
    ws.commit('feat: lending reads the billing ledger directly, index committed');
    ws.git('checkout', '-q', '-b', 'feat/fine');
    addSecondBillingInternalEdge(ws, variant);
    ws.index();
    ws.commit('feat: fines read the ledger too', '-m', 'Domain-Unchanged: lending (boundary e2e)');

    const result = ws.cli(['verify-domain', '--json', '--since', 'main', '--boundaries', 'new-only']);
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as { boundaries: { source: string; new: { from: { file: string } }[] } };
    expect(report.boundaries.source, result.stderr).toBe('committed-index');
    expect(new Set(report.boundaries.new.map((v) => v.from.file))).toEqual(new Set([SECOND_EDGE_FILE[variant]]));
  });

  it('the same input twice gives byte-identical domain artifacts', () => {
    const first = prepared(variant);
    const second = prepared(variant);
    const a = domainArtifacts(first);
    const b = domainArtifacts(second);
    expect([...a.keys()]).toEqual(expect.arrayContaining(['contexts.json', 'boundaries.json']));
    expect([...b.entries()]).toEqual([...a.entries()]);

    // A second run over the same workspace rewrites nothing that differs.
    first.index();
    expect([...domainArtifacts(first).entries()]).toEqual([...a.entries()]);
  });

  it('the server lists the 14 core tools plus get_domain_context, get_rule, find_shadow_specs and get_context_map, which answer without a registry too', async () => {
    const ws = prepared(variant);
    let session = await ws.connect();
    try {
      const names = await session.listTools();
      expect(names).toHaveLength(18);
      expect(names).toEqual(expect.arrayContaining(['get_domain_context', 'get_rule', 'find_shadow_specs', 'get_context_map', 'get_blast_radius']));

      const rule = (await session.call('get_rule', { ruleId: 'lend_03' })) as {
        rule: { ruleId: string; context: { id: string } };
        tests: { file: string; sources: { source: string }[] }[];
        _meta?: unknown;
      };
      expect(rule.rule).toMatchObject({ ruleId: 'LEND-03', context: { id: 'lending' } });
      expect(rule.tests.map((t) => t.file)).toContain(LOAN_LIMIT_TEST[variant]);
      expect(rule.tests.flatMap((t) => t.sources.map((s) => s.source))).toContain('card-tests');
      expect(rule._meta).toBeDefined();

      const card = await session.call('get_domain_context', { path: LOAN_LIMIT[variant] });
      expect(card['context']).toMatchObject({ id: 'lending', card: 'docs/domain/lending/domain.md' });
      expect(card['_meta']).toBeDefined();
    } finally {
      await session.close();
    }

    ws.remove(REGISTRY);
    session = await ws.connect();
    try {
      expect(await session.listTools()).toHaveLength(18);
      const hint = 'No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain". To propose the domain config from this repository, run "ctxo domain discover".';
      for (const [name, args] of [
        ['get_rule', { ruleId: 'LEND-03' }],
        ['get_domain_context', {}],
        ['find_shadow_specs', { context: 'lending' }],
        ['get_context_map', {}],
      ] as const) {
        const response = await session.call(name, args);
        expect(response['error'], name).toBeUndefined();
        expect(response, name).toMatchObject({ found: false, hint });
      }
    } finally {
      await session.close();
    }
  });

  it('no registry: no new fields anywhere, and the commands print a hint and exit 0', async () => {
    const ws = SampleWorkspace.create(variant);
    ws.commitLoaderRules();
    const registryText = ws.read(REGISTRY);
    // A second commit, so get_pr_impact has a change to report.
    ws.replace(LOAN_LIMIT[variant], variant === 'csharp' ? 'MaxLoans = 5' : 'MAX_LOANS = 5', variant === 'csharp' ? 'MaxLoans = 5 ' : 'MAX_LOANS = 5 ');
    ws.commit('chore: touch the loan limit');
    ws.index();

    // With the registry the same tools do carry the context.
    let session = await ws.connect();
    try {
      const found = (await session.call('search_symbols', { pattern: 'LoanLimit|canBorrow' })) as { results: { context?: string }[] };
      expect(found.results.length).toBeGreaterThan(0);
      expect(found.results.map((r) => r.context)).toContain('lending');
    } finally {
      await session.close();
    }

    ws.remove(REGISTRY);
    ws.index();
    // The artifacts go; the folder itself may stay, since other files in it are not ours to delete.
    for (const artifact of ['contexts.json', 'boundaries.json', 'history', 'shadow-candidates.json', 'maturity.json']) expect(ws.exists(`.ctxo/index/domain/${artifact}`), artifact).toBe(false);

    const symbolId = CANBORROW_ID[variant];
    session = await ws.connect();
    try {
      const responses = [
        await session.call('search_symbols', { pattern: 'LoanLimit|canBorrow' }),
        await session.call('get_blast_radius', { symbolId }),
        await session.call('find_importers', { symbolId }),
        await session.call('get_logic_slice', { symbolId }),
        await session.call('get_pr_impact', { since: 'HEAD~1' }),
        await session.call('get_why_context', { symbolId }),
        await session.call('get_context_for_task', { symbolId, taskType: 'understand' }),
      ];
      const added = [
        'rulesAffected',
        'cardsToUpdate',
        'cardExcerpt',
        'decisions',
        'contextsTouched',
        'cardsChanged',
        'rulesWithoutTests',
        // PR 4: the loop tools' fields never reach a core response.
        'shadowSpecs',
        'contextMap',
        'suggestedRung',
        'criteria',
        'fingerprint',
        'resolution',
      ];
      responses.forEach((response, i) => {
        expect(response['error'], `response ${i}`).toBeUndefined();
        const keys = allKeys(response);
        for (const key of ['context', 'contextBoundaryViolations', 'contextDrift', ...added]) {
          // get_context_for_task has its own `context` list of code symbols.
          if (key === 'context' && i === 6) continue;
          expect(keys.has(key), `response ${i} has ${key}`).toBe(false);
        }
      });
      expect((responses[0] as { results: unknown[] }).results.length).toBeGreaterThan(0);

      // The domain tools and the domain scope answer a graceful miss, never an error (spec 11.5).
      for (const [name, args] of [
        ['get_domain_context', { path: LOAN_LIMIT[variant] }],
        ['get_rule', { ruleId: 'LEND-03' }],
        ['get_ranked_context', { query: 'five loans', scope: 'domain' }],
        ['find_shadow_specs', { context: 'lending' }],
        ['get_context_map', {}],
      ] as const) {
        const response = await session.call(name, args);
        expect(response['error'], name).toBeUndefined();
        expect(response, name).toMatchObject({ found: false, hint: 'No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain". To propose the domain config from this repository, run "ctxo domain discover".' });
      }
    } finally {
      await session.close();
    }

    for (const args of [['verify-domain'], ['contexts-touched'], ['domain', 'rules', '--check']]) {
      const result = ws.cli(args);
      expect(result.status, args.join(' ')).toBe(0);
      expect(result.stderr, args.join(' ')).toContain('No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain".');
    }

    // Restored and re-indexed, the tags are back.
    ws.write(REGISTRY, registryText);
    ws.index();
    session = await ws.connect();
    try {
      const found = (await session.call('search_symbols', { pattern: 'LoanLimit|canBorrow' })) as { results: { context?: string }[] };
      expect(found.results.map((r) => r.context)).toContain('lending');
    } finally {
      await session.close();
    }
  });

  it('no registry: the index asks no plugin for facts, so no index JSON gains a facts key', () => {
    const ws = SampleWorkspace.create(variant);
    ws.remove(REGISTRY);
    ws.commit('chore: no registry');
    ws.index();
    const withFacts: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.json') && 'facts' in (JSON.parse(readFileSync(full, 'utf-8')) as object)) withFacts.push(full);
      }
    };
    walk(ws.path('.ctxo/index'));
    expect(withFacts).toEqual([]);
  });

  it.skipIf(variant !== 'csharp')('the guard blocks a sample session and lets it finish after a trailer commit', () => {
    const ws = SampleWorkspace.create(variant);
    ws.git('checkout', '-q', '-b', 'feat');

    const start = ws.guardHook({ session_id: 'acceptance-1', hook_event_name: 'SessionStart', source: 'startup' });
    expect(start).toMatchObject({ status: 0, stdout: '', stderr: '' });

    ws.replace(LOAN_LIMIT[variant], 'MaxLoans = 5', 'MaxLoans = 6');
    ws.commit('feat: allow a sixth loan');
    const blocked = ws.guardHook({ session_id: 'acceptance-1', hook_event_name: 'Stop', stop_hook_active: false });
    expect(blocked.status).toBe(0);
    const decision = JSON.parse(blocked.stdout) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('- lending: 1 file (src/Lending/LoanLimit.cs)');
    expect(decision.reason).toContain('card: docs/domain/lending/domain.md (unchanged)');
    expect(decision.reason).toContain('Domain-Unchanged: lending (reason)');

    // A further code commit without the trailer is blocked again: the guard is not just "once per session".
    ws.replace('src/Billing/InvoiceLedger.cs', 'CentsPerDay = 2', 'CentsPerDay = 3');
    ws.write('src/Lending/Account.cs', `${ws.read('src/Lending/Account.cs')}\n// reviewed\n`);
    ws.commit('chore: tidy the account');
    const again = ws.guardHook({ session_id: 'acceptance-1', hook_event_name: 'Stop', stop_hook_active: false });
    const second = JSON.parse(again.stdout) as { decision: string; reason: string };
    expect(second.decision).toBe('block');
    expect(second.reason).toContain('ctxo domain guard: 2 contexts have committed changes without a card update.');

    // The trailer resolves both contexts, so the session can finish.
    ws.commit('refactor: no behaviour change', '--allow-empty', '-m', 'Domain-Unchanged: lending, billing (constants and comments only)');
    const done = ws.guardHook({ session_id: 'acceptance-1', hook_event_name: 'Stop', stop_hook_active: false });
    expect(done).toMatchObject({ status: 0, stdout: '', stderr: '' });
  });

  it.skipIf(variant !== 'typescript')(
    'discovery proposes trackerPrefixes [LEND] from LEND-<n> commit subjects; once confirmed, a LEND-01 comment no longer links the rule',
    () => {
      const ws = SampleWorkspace.create(variant);
      ws.commitLoaderRules();
      for (const n of [101, 102, 103, 104, 105]) ws.commit(`LEND-${n} adjust the loan desk`, '--allow-empty');
      ws.index();

      const discover = ws.cli(['domain', 'discover', '--json']);
      expect(discover.status, discover.stderr).toBe(0);
      const found = JSON.parse(discover.stdout) as {
        evidence: { trackerKeys: { prefix: string; occurrences: number; overlapsRulePrefix: boolean }[] };
        proposal: { trackerPrefixes: string[] };
      };
      expect(found.proposal.trackerPrefixes).toEqual(['LEND']);
      expect(found.evidence.trackerKeys).toEqual([{ prefix: 'LEND', occurrences: 5, overlapsRulePrefix: true }]);
      // Nothing is written until it is confirmed.
      expect(ws.exists('.ctxo/config.yaml') ? ws.read('.ctxo/config.yaml') : '').not.toContain('trackerPrefixes');

      // LEND-01 loses its Untested line and is only mentioned in a test comment. Before the prefix is confirmed
      // the mention links the rule, so check 6 passes; after, a tracker-prefix mention no longer links.
      ws.replace(
        'docs/domain/lending/domain.md',
        '### LEND-01 A loan lasts fourteen days\nUntested: the due date is set by the loan service and has no test yet\n',
        '### LEND-01 A loan lasts fourteen days\n',
      );
      ws.replace(LOAN_LIMIT_TEST[variant], "describe('loan limit'", "// LEND-01 flaky on the build server\ndescribe('loan limit'");
      ws.commit('test: note the ticket on the loan limit test');
      ws.index();

      const before = verifyJson(ws);
      expect(before.status, before.messages.join('\n')).toBe(0);
      expect(before.report.checks.find((check) => check.id === '6')!.status).toBe('pass');

      const write = ws.cli(['domain', 'discover', '--write']);
      expect(write.status, write.stderr).toBe(0);
      const config = parse(ws.read('.ctxo/config.yaml')) as { domain: { rules: { trackerPrefixes: string[] } } };
      expect(config.domain.rules.trackerPrefixes).toEqual(['LEND']);

      const after = verifyJson(ws);
      expect(after.status).toBe(1);
      expect(after.messages).toContain('6 error LEND-01: no test link, no "Tests:" line and no "Untested:" line');
    },
  );
});
