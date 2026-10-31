import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleHost } from '@ctxo/cli/internal';
import { domainCommand } from '../domain-command.js';
import { verifyDomainCommand } from '../verify-domain-command.js';

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];
const ISOLATED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];

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

const CARD = (rule: string, tests: string): string => `# Card

## Language

## Rules and invariants

### ${rule} A rule
${tests}

## Boundary contracts

## Decisions

## Open questions
`;

const CONTEXT_MAP = '# Map\n\n| Context | Rung |\n|---|---|\n| lending | named |\n| billing | bounded |\n';

const LOAN = 'src/Lending/Loan.ts::Loan::class';
const INVOICE = 'src/Billing/Invoice.ts::Invoice::class';

let saved: Map<string, string | undefined>;
let configDir: string;
let stderr: string[];
let stdout: string[];
const dirs: string[] = [];

beforeEach(() => {
  saved = new Map(ISOLATED.map((k) => [k, process.env[k]]));
  for (const k of ISOLATED) delete process.env[k];
  configDir = mkdtempSync(join(tmpdir(), 'ctxo-domain-verify-gitenv-'));
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

function indexEntry(dir: string, file: string, symbolId: string | undefined, edgeTo?: string): void {
  const symbols = symbolId === undefined ? [] : [{ symbolId, name: symbolId.split('::')[1], kind: 'class', startLine: 0, endLine: 5 }];
  const edges = symbolId !== undefined && edgeTo !== undefined ? [{ from: symbolId, to: edgeTo, kind: 'imports' }] : [];
  put(dir, `.ctxo/index/${file}.json`, JSON.stringify({ file, lastModified: 1, symbols, edges, intent: [], antiPatterns: [] }));
}

interface Options {
  /** Lending imports Billing outside any contract. */
  violation?: boolean;
  index?: boolean;
  registry?: string | null;
  extraFile?: boolean;
}

async function runCommand(dir: string, ...args: string[]): Promise<number> {
  const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
  return verifyDomainCommand(host).run(args, { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
}

/** A project whose gate is clean unless an option says otherwise. */
async function project(options: Options = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-domain-verify-'));
  dirs.push(dir);
  if (options.registry !== null) put(dir, 'docs/domain/contexts.yaml', options.registry ?? REGISTRY);
  put(dir, 'docs/domain/lending.md', CARD('LEND-01', 'Tests: `src/Lending/Loan.test.ts`'));
  put(dir, 'docs/domain/billing.md', CARD('BILL-01', 'Untested: later'));
  put(dir, 'docs/domain/context-map.md', CONTEXT_MAP);
  put(dir, 'src/Lending/Loan.ts', 'export class Loan {}\n');
  put(dir, 'src/Lending/Loan.test.ts', "it('LEND-01 one borrower', () => {});\n");
  put(dir, 'src/Billing/Invoice.ts', 'export class Invoice {}\n');
  if (options.extraFile) put(dir, 'src/Other/Thing.ts', 'export class Thing {}\n');
  if (options.index !== false) {
    indexEntry(dir, 'src/Lending/Loan.ts', LOAN, options.violation ? INVOICE : undefined);
    indexEntry(dir, 'src/Lending/Loan.test.ts', undefined);
    indexEntry(dir, 'src/Billing/Invoice.ts', INVOICE);
    if (options.extraFile) indexEntry(dir, 'src/Other/Thing.ts', 'src/Other/Thing.ts::Thing::class');
  }
  if (options.registry !== null) {
    const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
    await domainCommand(host).run(['rules', '--write'], { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
  }
  stderr.length = 0;
  return dir;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, ...IDENTITY, 'commit', '-q', '-m', message);
}

function json(): any {
  return JSON.parse(stdout.join(''));
}

describe('ctxo verify-domain', () => {
  it('no registry prints the hint and exits 0', async () => {
    const dir = await project({ registry: null, index: false });
    expect(await runCommand(dir)).toBe(0);
    expect(stderr.join('\n')).toContain('No domain registry');
  });

  it('exits 0 on a clean project and prints one line per check and a summary', async () => {
    const dir = await project();
    expect(await runCommand(dir)).toBe(0);
    const text = stderr.join('\n');
    expect(text).toContain('[ctxo] ✓ 1 Registry and config');
    expect(text).toContain('[ctxo] - 11 Fold since ref');
    expect(text).toContain('[ctxo] verify-domain: 0 errors, 0 warnings');
  });

  it('exits 1 on errors, 0 with warnings only, and 2 without an index', async () => {
    const failing = await project({ violation: true });
    expect(await runCommand(failing)).toBe(1);
    const text = stderr.join('\n');
    expect(text).toContain('✗ 10 Boundaries');
    expect(text).toMatch(/ {4}error src\/Lending\/Loan\.ts .*lending -> billing/);
    expect(text).toMatch(/verify-domain: 1 errors?, 0 warnings/);

    stderr.length = 0;
    const warning = await project({ extraFile: true });
    expect(await runCommand(warning)).toBe(0);
    expect(stderr.join('\n')).toContain('⚠ 4b Unowned files');
    expect(stderr.join('\n')).toMatch(/ {4}warning .*src\/Other\/Thing\.ts/);

    stderr.length = 0;
    const noIndex = await project({ index: false });
    expect(await runCommand(noIndex)).toBe(2);
    expect(stderr.join('\n')).toContain('[ctxo] No index found; run "ctxo index" first.');
  });

  it('--boundaries report turns boundary errors into warnings for this run', async () => {
    const dir = await project({ violation: true });
    expect(await runCommand(dir, '--boundaries', 'report')).toBe(0);
    expect(stderr.join('\n')).toContain('warning src/Lending/Loan.ts');
    expect(await runCommand(dir, '--boundaries', 'by-rung')).toBe(1);
  });

  it('a bad --boundaries value or an unknown flag exits 1 with the usage', async () => {
    const dir = await project();
    expect(await runCommand(dir, '--boundaries', 'nope')).toBe(1);
    expect(stderr.join('\n')).toContain('Usage: ctxo verify-domain');
    stderr.length = 0;
    expect(await runCommand(dir, '--bogus')).toBe(1);
    expect(stderr.join('\n')).toContain('Usage: ctxo verify-domain');
  });

  it('--since adds check 11 and fails on an unresolved context', async () => {
    const dir = await project();
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'init');
    git(dir, 'checkout', '-q', '-b', 'feat');
    put(dir, 'src/Lending/Loan.ts', 'export class Loan { x = 1 }\n');
    commit(dir, 'change loan');

    expect(await runCommand(dir, '--since', 'main', '--json')).toBe(1);
    const report = json();
    const eleven = report.checks.find((c: any) => c.id === '11');
    expect(eleven.status).toBe('fail');
    expect(eleven.findings[0].context).toBe('lending');

    stdout.length = 0;
    put(dir, 'docs/domain/lending.md', CARD('LEND-01', 'Tests: `src/Lending/Loan.test.ts`') + '\nMore.\n');
    commit(dir, 'update card');
    expect(await runCommand(dir, '--since', 'main', '--json')).toBe(0);
    expect(json().checks.find((c: any) => c.id === '11').status).toBe('pass');

    stdout.length = 0;
    expect(await runCommand(dir, '--json')).toBe(0);
    expect(json().checks.find((c: any) => c.id === '11').status).toBe('skipped');
  });

  it('an unknown --since ref exits 2', async () => {
    const dir = await project();
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'init');
    expect(await runCommand(dir, '--since', 'no-such-ref')).toBe(2);
    expect(stderr.join('\n')).toContain('fetch-depth: 0');
  });

  it('uses the current registry, not the artifacts', async () => {
    const dir = await project({ violation: true });
    // A stale artifact set from an older registry: no violation, a different owner for Loan.ts.
    put(
      dir,
      '.ctxo/index/domain/contexts.json',
      JSON.stringify({
        ctxoArtifact: 'domain-contexts',
        version: 1,
        registryHash: 'sha256:old',
        contexts: [{ id: 'billing', name: 'Billing', rung: 'fear', fileCount: 1, files: ['src/Lending/Loan.ts'] }],
        unowned: { count: 0, files: [] },
        multiplyOwned: [],
        movedFiles: [],
      }),
    );
    put(
      dir,
      '.ctxo/index/domain/boundaries.json',
      JSON.stringify({ ctxoArtifact: 'domain-boundaries', version: 1, registryHash: 'sha256:old', mode: 'report', blockingRungs: [], crossEdges: [], violations: [] }),
    );
    expect(await runCommand(dir)).toBe(1);
    expect(stderr.join('\n')).toContain('lending -> billing');
  });

  it('--json prints the checks and the summary on stdout', async () => {
    const dir = await project({ violation: true });
    const code = await runCommand(dir, '--json');
    const report = json();
    expect(code).toBe(1);
    expect(Object.keys(report)).toEqual(['registry', 'checks', 'summary', 'exitCode']);
    expect(report.registry).toBe('docs/domain/contexts.yaml');
    expect(report.checks.map((c: any) => c.id)).toEqual(['1', '2', '3', '4a', '4b', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(report.summary).toEqual({ errors: 1, warnings: 0 });
    expect(report.exitCode).toBe(1);
  });

  it('--help prints the usage and exits 0', async () => {
    const dir = await project();
    expect(await runCommand(dir, '--help')).toBe(0);
    expect(stderr.join('\n')).toContain('Usage: ctxo verify-domain [--since <ref>] [--boundaries by-rung|new-only|report] [--json]');
  });

  it('verify-domain reports card reference problems from the current index', async () => {
    const dir = await project();
    const gone = 'src/Lending/Loan.ts::Loan.Gone::method';
    put(dir, 'docs/domain/lending.md', CARD('LEND-01', `Tests: \`src/Lending/Loan.test.ts\`\nCode: \`src/Lending/Loan.ts\`, \`${LOAN}\`, \`${gone}\``));
    expect(await runCommand(dir, '--json')).toBe(0);
    const six = json().checks.find((c: any) => c.id === '6');
    expect(six.status).toBe('warn');
    expect(six.findings).toEqual([
      {
        check: '6',
        severity: 'warning',
        message: `LEND-01: Code: "${gone}" is not an indexed symbol; it links to its file`,
        file: 'docs/domain/lending.md',
        line: 9,
        context: 'lending',
      },
    ]);

    // A production rule: comment naming an unknown rule ID warns; a lint code with another prefix does not.
    stdout.length = 0;
    put(dir, 'src/Lending/Loan.ts', '// rule: LEND-77\n// rule: E501\nexport class Loan {}\n');
    put(dir, 'docs/domain/lending.md', CARD('LEND-01', 'Tests: `src/Lending/Loan.test.ts`\nCode: `src/Lending/Nope.ts`'));
    expect(await runCommand(dir, '--json')).toBe(1);
    const messages = json()
      .checks.find((c: any) => c.id === '6')
      .findings.map((f: any) => [f.severity, f.message, f.file, f.line]);
    expect(messages).toEqual([
      ['error', 'LEND-01: Code file "src/Lending/Nope.ts" does not exist', 'docs/domain/lending.md', 9],
      ['warning', 'rule: comment names unknown rule LEND-77', 'src/Lending/Loan.ts', 1],
    ]);
  });

  it('a Tests: or Code: value that names a directory is a missing file, reported once', async () => {
    const dir = await project();
    put(dir, 'docs/domain/lending.md', CARD('LEND-01', 'Tests: `src/Lending`\nCode: `src/Billing`'));
    expect(await runCommand(dir, '--json')).toBe(1);
    const findings = json()
      .checks.find((c: any) => c.id === '6')
      .findings.map((f: any) => [f.severity, f.message, f.file, f.line]);
    expect(findings).toEqual([
      ['error', 'LEND-01: Tests file "src/Lending" does not exist', 'docs/domain/lending.md', 7],
      ['error', 'LEND-01: Code file "src/Billing" does not exist', 'docs/domain/lending.md', 9],
    ]);
  });

  it('a registry with problems fails check 1 and exits 1', async () => {
    const dir = await project({ registry: 'version: 2\ncontexts: []\n' });
    expect(await runCommand(dir)).toBe(1);
    expect(stderr.join('\n')).toContain('✗ 1 Registry and config');
    expect(stderr.join('\n')).toContain('[ctxo] - 12 Shadow-spec resolutions');
  });
});

describe('ctxo verify-domain check 12', () => {
  // BILL-01 is `Untested: later`: a rule-without-tests candidate the current index pass resolves automatically.
  const BILLING_CANDIDATE = 'rule-without-tests | BILL-01 | A rule';
  const STALE = 'literal-comparison | Invoice.total | amount > 100';
  const LENDING_SPECS = 'docs/domain/lending/shadow-specs.yaml';
  const BILLING_SPECS = 'docs/domain/billing/shadow-specs.yaml';

  const twelve = (): any => json().checks.find((c: any) => c.id === '12');

  it('passes on a clean project without shadow-specs files', async () => {
    const dir = await project();
    expect(await runCommand(dir, '--json')).toBe(0);
    expect(twelve()).toEqual({ id: '12', title: 'Shadow-spec resolutions', status: 'pass', findings: [] });
  });

  it('verify-domain computes candidates from the index and warns about a stale resolution', async () => {
    const dir = await project();
    put(
      dir,
      BILLING_SPECS,
      `- fingerprint: "${BILLING_CANDIDATE}"\n  resolution: { notARule: "covered by the card" }\n- fingerprint: "${STALE}"\n  resolution: { notARule: "gone" }\n`,
    );
    expect(await runCommand(dir, '--json')).toBe(0);
    expect(twelve().status).toBe('warn');
    expect(twelve().findings).toEqual([
      {
        check: '12',
        severity: 'warning',
        message: `stale resolution "${STALE}" matches no candidate of billing`,
        file: BILLING_SPECS,
        line: 3,
        context: 'billing',
      },
    ]);
    expect(json().summary).toEqual({ errors: 0, warnings: 1 });
  });

  it('warns about an unknown rule and an orphan file', async () => {
    const dir = await project();
    put(dir, BILLING_SPECS, `- fingerprint: "${BILLING_CANDIDATE}"\n  resolution: { rule: BILL-99 }\n`);
    put(dir, 'docs/domain/gone/shadow-specs.yaml', '[]\n');
    expect(await runCommand(dir, '--json')).toBe(0);
    expect(twelve().findings.map((f: any) => [f.severity, f.message])).toEqual([
      ['warning', 'resolution names unknown rule BILL-99'],
      ['warning', 'docs/domain/gone/shadow-specs.yaml belongs to no context'],
    ]);
  });

  it('a syntax error in shadow-specs.yaml exits 1', async () => {
    const dir = await project();
    put(dir, LENDING_SPECS, '- fingerprint: [\n');
    expect(await runCommand(dir)).toBe(1);
    const text = stderr.join('\n');
    expect(text).toContain('✗ 12 Shadow-spec resolutions');
    expect(text).toMatch(/ {4}error docs\/domain\/lending\/shadow-specs\.yaml:\d+ \S/);
    stdout.length = 0;
    expect(await runCommand(dir, '--json')).toBe(1);
    const problem = twelve().findings[0];
    expect([problem.severity, problem.file, typeof problem.line, problem.message.startsWith(LENDING_SPECS)]).toEqual(['error', LENDING_SPECS, 'number', false]);
  });

  it('uses the current shadow-specs.yaml, not artifacts', async () => {
    const dir = await project();
    // Stored candidates from an older run: the stale fingerprint was a candidate then, the billing rule was not.
    put(
      dir,
      '.ctxo/index/domain/shadow-candidates.json',
      JSON.stringify({
        ctxoArtifact: 'domain-shadow-candidates',
        version: 1,
        registryHash: 'sha256:old',
        cardsHash: 'sha256:old',
        candidates: [
          { fingerprint: STALE, kind: 'literal-comparison', context: 'billing', file: 'src/Billing/Invoice.ts', line: 1, text: 'amount > 100', source: 'text' },
        ],
      }),
    );
    put(dir, BILLING_SPECS, `- fingerprint: "${BILLING_CANDIDATE}"\n  resolution: { notARule: "x" }\n`);
    expect(await runCommand(dir, '--json')).toBe(0);
    expect(twelve().status).toBe('pass');
    stdout.length = 0;
    put(dir, BILLING_SPECS, `- fingerprint: "${STALE}"\n  resolution: { notARule: "x" }\n`);
    expect(await runCommand(dir, '--json')).toBe(0);
    expect(twelve().findings.map((f: any) => f.message)).toEqual([`stale resolution "${STALE}" matches no candidate of billing`]);
  });

  it('candidates that cannot be built give one check 12 warning, and the exit code stays 0', async () => {
    const dir = await project();
    put(dir, BILLING_SPECS, `- fingerprint: "${STALE}"\n  resolution: { notARule: "gone" }\n`);
    const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
    // An index entry whose facts cannot be read: the graph builds, the candidates do not.
    const brokenFacts = (indices: any[]): any[] =>
      indices.map((index) =>
        index.file === 'src/Billing/Invoice.ts'
          ? Object.defineProperty({ ...index }, 'facts', {
              get() {
                throw new Error('facts unreadable');
              },
            })
          : index,
      );
    const failing = { ...host, services: { ...host.services, readIndex: (root: string) => brokenFacts(host.services.readIndex(root)) } };
    const code = await verifyDomainCommand(failing).run(['--json'], { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
    expect(code).toBe(0);
    expect(twelve().findings).toEqual([
      {
        check: '12',
        severity: 'warning',
        message: 'stale resolutions were not checked: The shadow-spec candidates could not be built: facts unreadable.',
      },
    ]);
  });

  it('exits 2 when git cannot list the tracked files', async () => {
    const dir = await project();
    const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
    const failing = {
      ...host,
      services: {
        ...host.services,
        createGit: (root: string) => {
          const real = host.services.createGit(root);
          return Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
            listTrackedFiles: async () => {
              throw new Error('git ls-files failed');
            },
          });
        },
      },
    };
    const code = await verifyDomainCommand(failing).run([], { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
    expect(code).toBe(2);
    expect(stderr.join('\n')).toContain('[ctxo] verify-domain failed: git ls-files failed');
  });

  it('a registry with problems still runs check 1 and skips checks 2 to 12', async () => {
    const dir = await project({ registry: 'version: 2\ncontexts: []\n' });
    expect(await runCommand(dir, '--json')).toBe(1);
    expect(json().checks.map((c: any) => c.status)).toEqual(['fail', ...Array(12).fill('skipped')]);
  });
});
