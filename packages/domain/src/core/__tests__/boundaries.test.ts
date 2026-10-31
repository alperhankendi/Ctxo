import { describe, it, expect } from 'vitest';
import { createModuleHost, type GraphEdge } from '@ctxo/cli/internal';
import { computeBoundaries } from '../boundaries.js';
import type { BoundaryMode } from '../domain-config.js';
import { createOwnership } from '../ownership.js';
import { parseRegistry, type Rung } from '../registry.js';

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    paths: ["src/Lending/**"]
    rung: bounded
    contracts:
      billing: ["src/Billing/Api/**"]
  - id: billing
    name: Billing
    paths: ["src/Billing/**"]
    rung: named
  - id: reporting
    name: Reporting
    paths: ["src/Reporting/**"]
    rung: fear
`;

function setup() {
  const { registry, problems } = parseRegistry(REGISTRY);
  expect(problems).toEqual([]);
  const host = createModuleHost({ cliVersion: '0.0.0', mode: 'cli', projectRoot: process.cwd() });
  const ownership = createOwnership(registry!, host.services.makeGlobMatcher);
  return { registry: registry!, ownership };
}

const isTestFile = (p: string): boolean => /(^|\/)tests?\//.test(p) || p.endsWith('.test.ts');

function run(edges: GraphEdge[], mode: BoundaryMode = 'by-rung', blockingRungs: readonly Rung[] = ['bounded', 'boring']) {
  const { registry, ownership } = setup();
  return computeBoundaries(edges, { registry, ownership, isTestFile, mode, blockingRungs });
}

const e = (from: string, to: string, kind: GraphEdge['kind'] = 'calls'): GraphEdge => ({ from, to, kind });

const LOAN = 'src/Lending/Loan.ts::Loan::class';
const LOAN_SVC = 'src/Lending/LoanService.ts::LoanService::class';
const INVOICE = 'src/Billing/Invoice.ts::Invoice::class';
const BILLING_API = 'src/Billing/Api/Charges.ts::Charges::class';
const REPORT = 'src/Reporting/Report.ts::Report::class';

describe('computeBoundaries', () => {
  it('an edge into another context outside its contracts is a violation; through a contract file it is allowed', () => {
    const result = run([e(LOAN_SVC, LOAN), e(LOAN, INVOICE), e(LOAN, BILLING_API, 'imports')]);

    expect(result.violations).toEqual([
      {
        from: { symbolId: LOAN, file: 'src/Lending/Loan.ts', context: 'lending' },
        to: { symbolId: INVOICE, file: 'src/Billing/Invoice.ts', context: 'billing' },
        edgeKind: 'calls',
        severity: 'error',
      },
    ]);
    expect(result.crossEdges).toEqual([
      { from: 'lending', to: 'billing', byKind: { calls: 1, imports: 1 }, allowed: 1, violations: 1 },
    ]);
    expect(result.perContext.get('lending')).toEqual({ internal: 1, out: 2, in: 0 });
    expect(result.perContext.get('billing')).toEqual({ internal: 0, out: 0, in: 2 });
    expect(result.perContext.get('reporting')).toEqual({ internal: 0, out: 0, in: 0 });
  });

  it('edges into unowned files and from test files are ignored', () => {
    const result = run([
      e(LOAN, 'src/Host/Program.ts::Program::class'),
      e('src/Host/Program.ts::Program::class', LOAN),
      e('src/Lending/tests/Loan.test.ts::LoanTests::class', INVOICE),
      e('src/Lending/Loan.test.ts::LoanSpec::function', INVOICE),
    ]);

    expect(result.violations).toEqual([]);
    expect(result.crossEdges).toEqual([]);
    expect(result.perContext.get('lending')).toEqual({ internal: 0, out: 0, in: 0 });
  });

  it('by-rung gives an error when either context is bounded or boring and a warning otherwise; report always warns', () => {
    const edges = [e(INVOICE, LOAN), e(REPORT, INVOICE), e(LOAN, REPORT)];

    const byRung = run(edges);
    const severities = (r: ReturnType<typeof run>) => r.violations.map((v) => `${v.from.context}>${v.to.context}:${v.severity}`);
    // billing (named) -> lending (bounded): target is blocking; lending -> reporting: source is blocking.
    expect(severities(byRung)).toEqual(['billing>lending:error', 'lending>reporting:error', 'reporting>billing:warning']);

    const report = run(edges, 'report');
    expect(severities(report)).toEqual(['billing>lending:warning', 'lending>reporting:warning', 'reporting>billing:warning']);

    // new-only judges severities as by-rung does; verify-domain keeps only the new errors later.
    expect(severities(run(edges, 'new-only'))).toEqual(severities(byRung));

    const custom = run(edges, 'by-rung', ['named']);
    expect(severities(custom)).toEqual(['billing>lending:error', 'lending>reporting:warning', 'reporting>billing:error']);
  });

  it('two-part name references are skipped', () => {
    const result = run([e(LOAN, 'Invoice::class'), e(LOAN, 'dbo.loans::table', 'reads')]);

    expect(result.violations).toEqual([]);
    expect(result.crossEdges).toEqual([]);
    expect(result.perContext.get('lending')).toEqual({ internal: 0, out: 0, in: 0 });
  });

  it('the result is identical for shuffled input', () => {
    const edges = [
      e(LOAN, INVOICE),
      e(LOAN, INVOICE, 'imports'),
      e(LOAN_SVC, INVOICE),
      e(LOAN_SVC, LOAN),
      e(INVOICE, LOAN),
      e(REPORT, INVOICE, 'uses'),
      e(REPORT, LOAN_SVC),
      e(LOAN, BILLING_API),
      e(LOAN, REPORT),
    ];
    const expected = JSON.stringify({ ...run(edges), perContext: [...run(edges).perContext] });
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let round = 0; round < 10; round++) {
      const shuffled = [...edges];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const result = run(shuffled);
      expect(JSON.stringify({ ...result, perContext: [...result.perContext] })).toBe(expected);
    }
  });
});
