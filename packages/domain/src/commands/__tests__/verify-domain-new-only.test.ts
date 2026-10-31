import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleHost, type CtxoHost, type FileIndex } from '@ctxo/cli/internal';
import { domainCommand } from '../domain-command.js';
import { verifyDomainCommand } from '../verify-domain-command.js';

/** `verify-domain --boundaries new-only` (#156): only the violations the branch adds fail the gate. */

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];
const ISOLATED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];
/** Check 11 would fail on every Lending or Billing change without a card change: each branch commit carries the trailer. */
const TRAILER = '\n\nDomain-Unchanged: lending (boundary test)\nDomain-Unchanged: billing (boundary test)';

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending.md
    paths: ["src/Lending/**"]
    rung: named
    rulePrefix: LEND
  - id: billing
    name: Billing
    card: docs/domain/billing.md
    paths: ["src/Billing/**"]
    rung: bounded
    rulePrefix: BILL
`;

const CARD = (rule: string, tests: string): string =>
  `# Card\n\n## Language\n\n## Rules and invariants\n\n### ${rule} A rule\n${tests}\n\n## Boundary contracts\n\n## Decisions\n\n## Open questions\n`;
const CONTEXT_MAP = '# Map\n\n| Context | Rung |\n|---|---|\n| lending | named |\n| billing | bounded |\n';

const LOAN = 'src/Lending/Loan.ts::Loan::class';
const FEE = 'src/Lending/Fee.ts::Fee::class';
const INVOICE = 'src/Billing/Invoice.ts::Invoice::class';

let saved: Map<string, string | undefined>;
let configDir: string;
let stderr: string[];
let stdout: string[];
const dirs: string[] = [];

beforeEach(() => {
  saved = new Map(ISOLATED.map((k) => [k, process.env[k]]));
  for (const k of ISOLATED) delete process.env[k];
  configDir = mkdtempSync(join(tmpdir(), 'ctxo-domain-newonly-gitenv-'));
  writeFileSync(join(configDir, 'gitconfig'), '');
  process.env['GIT_CONFIG_GLOBAL'] = join(configDir, 'gitconfig');
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  stderr = [];
  stdout = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(configDir, { recursive: true, force: true });
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function put(dir: string, file: string, content: string): void {
  const full = join(dir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, ...IDENTITY, 'commit', '-q', '-m', message);
}

/** An index entry for a file on disk; `hashed` adds the content hash `ctxo index` writes. */
function entry(dir: string, file: string, symbolId: string | undefined, edgeTo: readonly string[] = [], options: { hashed?: boolean; line?: number } = {}): FileIndex {
  const symbols = symbolId === undefined ? [] : [{ symbolId, name: symbolId.split('::')[1]!, kind: 'class' as const, startLine: options.line ?? 0, endLine: (options.line ?? 0) + 5 }];
  const edges = symbolId === undefined ? [] : edgeTo.map((to) => ({ from: symbolId, to, kind: 'imports' as const }));
  const index: FileIndex = { file, lastModified: 1, symbols, edges, intent: [], antiPatterns: [] };
  if (options.hashed !== false) {
    (index as { contentHash?: string }).contentHash = createHash('sha256').update(readFileSync(join(dir, file), 'utf-8'), 'utf-8').digest('hex');
  }
  put(dir, `.ctxo/index/${file}.json`, JSON.stringify(index));
  return index;
}

async function run(dir: string, args: readonly string[], host: CtxoHost = createModuleHost({ projectRoot: dir, mode: 'cli' })): Promise<number> {
  return verifyDomainCommand(host).run(args, { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
}

function json(): any {
  return JSON.parse(stdout.join(''));
}

/**
 * A repository on `main` whose Lending already imports a Billing internal (the existing violation), with its index
 * committed (content hashes unless `hashed: false`), and a branch `feat`.
 */
async function repo(options: { hashed?: boolean; config?: string } = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-domain-newonly-'));
  dirs.push(dir);
  put(dir, 'docs/domain/contexts.yaml', REGISTRY);
  put(dir, 'docs/domain/lending.md', CARD('LEND-01', 'Tests: `src/Lending/Loan.test.ts`'));
  put(dir, 'docs/domain/billing.md', CARD('BILL-01', 'Untested: later'));
  put(dir, 'docs/domain/context-map.md', CONTEXT_MAP);
  if (options.config !== undefined) put(dir, '.ctxo/config.yaml', options.config);
  put(dir, 'src/Lending/Loan.ts', 'export class Loan {}\n');
  put(dir, 'src/Lending/Loan.test.ts', "it('LEND-01 one borrower', () => {});\n");
  put(dir, 'src/Billing/Invoice.ts', 'export class Invoice {}\n');
  entry(dir, 'src/Lending/Loan.ts', LOAN, [INVOICE], { hashed: options.hashed });
  entry(dir, 'src/Lending/Loan.test.ts', undefined, [], { hashed: options.hashed });
  entry(dir, 'src/Billing/Invoice.ts', INVOICE, [], { hashed: options.hashed });
  const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
  await domainCommand(host).run(['rules', '--write'], { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'init');
  git(dir, 'checkout', '-q', '-b', 'feat');
  stderr.length = 0;
  return dir;
}

/** The branch shifts Loan down by two lines, changes an unrelated Billing file, and adds Fee -> Invoice. */
function addViolationOnBranch(dir: string): void {
  put(dir, 'src/Lending/Loan.ts', '// moved\n// down\nexport class Loan {}\n');
  entry(dir, 'src/Lending/Loan.ts', LOAN, [INVOICE], { line: 2 });
  put(dir, 'src/Billing/Invoice.ts', 'export class Invoice { total = 0 }\n');
  entry(dir, 'src/Billing/Invoice.ts', INVOICE);
  put(dir, 'src/Lending/Fee.ts', 'export class Fee {}\n');
  entry(dir, 'src/Lending/Fee.ts', FEE, [INVOICE]);
  commit(dir, `add fee${TRAILER}`);
}

function withServices(dir: string, overrides: Partial<CtxoHost['services']>): CtxoHost {
  const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
  return { ...host, services: { ...host.services, ...overrides } };
}

describe('verify-domain --boundaries new-only', () => {
  it('fails on the violation the branch adds and reports the base one as existing (committed index)', async () => {
    const dir = await repo();
    addViolationOnBranch(dir);
    const indexCommitInWorktree = vi.fn(async () => [] as FileIndex[]);
    const host = withServices(dir, { indexCommitInWorktree });

    expect(await run(dir, ['--since', 'main', '--boundaries', 'new-only', '--json'], host)).toBe(1);
    const report = json();
    expect(indexCommitInWorktree).not.toHaveBeenCalled();
    expect(report.boundaries).toMatchObject({ mode: 'new-only', compared: true, source: 'committed-index' });
    expect(report.boundaries.base).toMatch(/^[0-9a-f]{7}$/);
    expect(report.boundaries.new.map((v: any) => v.from.symbolId)).toEqual([FEE]);
    expect(report.boundaries.existing.map((v: any) => v.from.symbolId)).toEqual([LOAN]);
    expect(report.boundaries.new[0].severity).toBe('error');
    expect(report.boundaries.existing[0].severity).toBe('warning');
    expect(report.boundaries.new[0].key).toBe(`lending | billing | ${FEE} | imports | ${INVOICE}`);

    const ten = report.checks.find((c: any) => c.id === '10');
    expect(ten.findings.map((f: any) => [f.severity, f.message])).toEqual([
      ['error', `lending -> billing: ${FEE} imports ${INVOICE} is outside the contracts (new)`],
      ['warning', `lending -> billing: ${LOAN} imports ${INVOICE} is outside the contracts (existing at the base)`],
    ]);
    expect(report.summary.errors).toBe(1);
    expect(report.exitCode).toBe(1);
  });

  it('passes when the branch only moves an existing violation and changes an unrelated file', async () => {
    const dir = await repo();
    put(dir, 'src/Lending/Loan.ts', '// moved\n// down\nexport class Loan {}\n');
    entry(dir, 'src/Lending/Loan.ts', LOAN, [INVOICE], { line: 2 });
    put(dir, 'src/Billing/Invoice.ts', 'export class Invoice { total = 0 }\n');
    entry(dir, 'src/Billing/Invoice.ts', INVOICE);
    commit(dir, `shift${TRAILER}`);

    expect(await run(dir, ['--since', 'main', '--boundaries', 'new-only'])).toBe(0);
    const text = stderr.join('\n');
    expect(text).toMatch(/Boundaries new-only against [0-9a-f]{7} \(its committed index\): 0 new, 1 existing/);
    expect(text).toContain('warning src/Lending/Loan.ts lending -> billing');
    expect(text).toContain('(existing at the base)');
    // by-rung on the same branch still fails on the existing violation.
    expect(await run(dir, ['--since', 'main', '--boundaries', 'by-rung'])).toBe(1);
  });

  it('keeps a violation existing when its file is renamed on the branch', async () => {
    const dir = await repo();
    git(dir, 'mv', 'src/Lending/Loan.ts', 'src/Lending/Loans.ts');
    rmSync(join(dir, '.ctxo/index/src/Lending/Loan.ts.json'));
    entry(dir, 'src/Lending/Loans.ts', 'src/Lending/Loans.ts::Loan::class', [INVOICE]);
    commit(dir, `rename${TRAILER}`);

    expect(await run(dir, ['--since', 'main', '--boundaries', 'new-only', '--json'])).toBe(0);
    const report = json();
    expect(report.boundaries.new).toEqual([]);
    expect(report.boundaries.existing.map((v: any) => v.from.symbolId)).toEqual(['src/Lending/Loans.ts::Loan::class']);
  });

  it('indexes the base in a temporary worktree when its committed index is not current', async () => {
    const dir = await repo({ hashed: false });
    addViolationOnBranch(dir);
    const base = git(dir, 'rev-parse', 'main');
    const baseIndex: FileIndex[] = [
      { file: 'src/Lending/Loan.ts', lastModified: 1, symbols: [], edges: [{ from: LOAN, to: INVOICE, kind: 'imports' }], intent: [], antiPatterns: [] },
    ];
    const indexCommitInWorktree = vi.fn(async () => baseIndex);
    const host = withServices(dir, { indexCommitInWorktree });

    expect(await run(dir, ['--since', 'main', '--boundaries', 'new-only', '--json'], host)).toBe(1);
    expect(indexCommitInWorktree).toHaveBeenCalledWith(dir, base);
    const report = json();
    expect(report.boundaries).toMatchObject({ compared: true, source: 'worktree' });
    expect(report.boundaries.new.map((v: any) => v.from.symbolId)).toEqual([FEE]);
    expect(report.boundaries.existing.map((v: any) => v.from.symbolId)).toEqual([LOAN]);
    expect(stderr.join('\n')).toContain('src/Lending/Loan.ts: the entry has no content hash');
  });

  it('falls back to by-rung, saying so, when the base cannot be indexed', async () => {
    const dir = await repo({ hashed: false });
    addViolationOnBranch(dir);
    const host = withServices(dir, {
      indexCommitInWorktree: async () => {
        throw new Error('git worktree add failed');
      },
    });

    expect(await run(dir, ['--since', 'main', '--boundaries', 'new-only', '--json'], host)).toBe(1);
    const report = json();
    expect(report.boundaries).toMatchObject({ compared: false, existing: [] });
    expect(report.boundaries.fallback).toContain('git worktree add failed');
    expect(report.boundaries.new).toHaveLength(2);
    expect(report.summary.errors).toBe(2);
    expect(stderr.join('\n')).toContain('failing on every boundary violation, as by-rung does');
  });

  it('without --since behaves as by-rung with a warning, and reads the mode from the config', async () => {
    const dir = await repo({ config: 'version: "1.0"\ndomain:\n  boundaries:\n    enforce: new-only\n' });
    expect(await run(dir, ['--json'])).toBe(1);
    const report = json();
    expect(report.boundaries).toMatchObject({ mode: 'new-only', compared: false, fallback: 'no base without --since <ref>' });
    expect(report.summary.errors).toBe(1);
    expect(stderr.join('\n')).toContain('--boundaries new-only: no base without --since <ref>');

    // The config mode with --since: the base already has the only violation.
    stdout.length = 0;
    expect(await run(dir, ['--since', 'main', '--json'])).toBe(0);
    expect(json().boundaries).toMatchObject({ compared: true, new: [] });
  });

  it('the other modes print no boundaries block', async () => {
    const dir = await repo();
    expect(await run(dir, ['--since', 'main', '--json'])).toBe(1);
    expect(json().boundaries).toBeUndefined();
  });
});
