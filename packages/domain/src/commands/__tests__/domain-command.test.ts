import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleHost } from '@ctxo/cli/internal';
import { createDomainState } from '../../mcp/domain-state.js';
import { FIND_SHADOW_SPECS, GET_CONTEXT_MAP, loopTools } from '../../mcp/loop-tools.js';
import { createLoopProject, POLICY_FILE, type LoopProject } from '../../mcp/__tests__/loop-fixture.js';
import { domainCommand } from '../domain-command.js';

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending.md
    paths: ["src/Lending/**"]
    rung: named
  - id: fold
    name: Fold
    card: docs/domain/fold.md
    paths: ["src/Fold/**"]
    rung: named
`;

let stderr: string[];
const dirs: string[] = [];

beforeEach(() => {
  stderr = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function project(registry: string | null = REGISTRY): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-domain-rules-'));
  dirs.push(dir);
  if (registry !== null) put(dir, 'docs/domain/contexts.yaml', registry);
  return dir;
}

function put(dir: string, file: string, content: string): void {
  const full = join(dir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

async function run(dir: string, ...args: string[]): Promise<number> {
  const host = createModuleHost({ projectRoot: dir, mode: 'cli' });
  return domainCommand(host).run(args, { projectRoot: dir, ctxoRoot: host.ctxoRoot, readStdin: async () => '' });
}

describe('ctxo domain rules', () => {
  it('--check passes right after --write and fails after a registry change', async () => {
    const dir = project();
    expect(await run(dir, 'rules', '--check')).toBe(1);
    expect(await run(dir, 'rules', '--write')).toBe(0);
    expect(existsSync(join(dir, '.claude/rules/ctxo-context-lending.md'))).toBe(true);
    expect(await run(dir, 'rules', '--check')).toBe(0);
    put(dir, 'docs/domain/contexts.yaml', REGISTRY.replace('src/Lending/**', 'src/Loans/**'));
    expect(await run(dir, 'rules', '--check')).toBe(1);
    expect(stderr.join('\n')).toContain('outdated  .claude/rules/ctxo-context-lending.md');
  });

  it('--write deletes stale generated files and keeps a prefixed file without the marker', async () => {
    const dir = project();
    await run(dir, 'rules', '--write');
    put(dir, 'docs/domain/contexts.yaml', REGISTRY.replace(/  - id: fold[\s\S]*$/, ''));
    put(dir, '.claude/rules/ctxo-context-mine.md', '# my own\n');
    expect(await run(dir, 'rules', '--check')).toBe(1);
    expect(await run(dir, 'rules', '--write')).toBe(0);
    expect(existsSync(join(dir, '.claude/rules/ctxo-context-fold.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude/rules/ctxo-context-lending.md'))).toBe(true);
    expect(readFileSync(join(dir, '.claude/rules/ctxo-context-mine.md'), 'utf-8')).toBe('# my own\n');
    expect(await run(dir, 'rules', '--check')).toBe(0);
  });

  it('the file names use the ctxo-context- prefix and never touch the ctxo-domain-fold skill files', async () => {
    const dir = project();
    put(dir, '.cursor/rules/ctxo-domain-fold.mdc', 'skill\n');
    put(dir, '.claude/skills/ctxo-domain-fold/SKILL.md', 'skill\n');
    expect(await run(dir, 'rules', '--write')).toBe(0);
    expect(existsSync(join(dir, '.claude/rules/ctxo-context-fold.md'))).toBe(true);
    expect(existsSync(join(dir, '.cursor/rules/ctxo-context-fold.mdc'))).toBe(true);
    expect(readFileSync(join(dir, '.cursor/rules/ctxo-domain-fold.mdc'), 'utf-8')).toBe('skill\n');
    expect(readFileSync(join(dir, '.claude/skills/ctxo-domain-fold/SKILL.md'), 'utf-8')).toBe('skill\n');
    expect(stderr.join('\n')).not.toContain('ctxo-domain-fold');
    expect(await run(dir, 'rules', '--check')).toBe(0);
    expect(stderr.join('\n')).not.toContain('ctxo-domain-fold');
  });

  it('Cursor files appear only when .cursor/ exists', async () => {
    const dir = project();
    await run(dir, 'rules', '--write');
    expect(existsSync(join(dir, '.cursor'))).toBe(false);
    mkdirSync(join(dir, '.cursor'));
    expect(await run(dir, 'rules', '--check')).toBe(1);
    await run(dir, 'rules', '--write');
    expect(existsSync(join(dir, '.cursor/rules/ctxo-context-lending.mdc'))).toBe(true);
  });

  it('prints usage and exits 1 without a flag or for an unknown subcommand; --help exits 0', async () => {
    const dir = project();
    expect(await run(dir, 'rules')).toBe(1);
    expect(await run(dir, 'bogus')).toBe(1);
    expect(await run(dir)).toBe(1);
    expect(await run(dir, '--help')).toBe(0);
    expect(await run(dir, 'rules', '--help')).toBe(0);
    expect(stderr.join('\n')).toContain('Usage: ctxo domain rules --write | --check');
  });

  it('gives the hint and exit 0 without a registry, and exit 2 for a broken one', async () => {
    expect(await run(project(null), 'rules', '--check')).toBe(0);
    expect(await run(project('version: 2\n'), 'rules', '--check')).toBe(2);
  });

  it('--check fails and --write refuses when a prefixed file without the marker sits at an expected path', async () => {
    const dir = project();
    put(dir, '.claude/rules/ctxo-context-lending.md', '# my own lending rule\n');
    expect(await run(dir, 'rules', '--check')).toBe(1);
    const message = 'exists without the generated marker; rename it or delete it, then run --write';
    expect(stderr.join('\n')).toContain(`.claude/rules/ctxo-context-lending.md ${message}`);
    stderr.length = 0;
    expect(await run(dir, 'rules', '--write')).toBe(1);
    expect(stderr.join('\n')).toContain(`.claude/rules/ctxo-context-lending.md ${message}`);
    expect(readFileSync(join(dir, '.claude/rules/ctxo-context-lending.md'), 'utf-8')).toBe('# my own lending rule\n');
    expect(existsSync(join(dir, '.claude/rules/ctxo-context-fold.md'))).toBe(true);
  });

  it('--check with only a blocked file prints the blocked advice, not the run --write hint', async () => {
    const dir = project();
    expect(await run(dir, 'rules', '--write')).toBe(0);
    writeFileSync(join(dir, '.claude/rules/ctxo-context-lending.md'), '# my own lending rule\n', 'utf-8');
    stderr.length = 0;
    expect(await run(dir, 'rules', '--check')).toBe(1);
    const output = stderr.join('\n');
    expect(output).toContain('exists without the generated marker; rename it or delete it, then run --write');
    expect(output).toContain('Loader rules are blocked');
    expect(output).not.toContain('Loader rules are out of date');
  });

  it('a user file that quotes the marker in its body is not generated', async () => {
    const dir = project();
    const quoted = '# mine\n<!-- generated by ctxo domain rules; do not edit -->\n';
    put(dir, '.claude/rules/ctxo-context-lending.md', quoted);
    put(dir, '.claude/rules/ctxo-context-old.md', quoted);
    await run(dir, 'rules', '--write');
    expect(readFileSync(join(dir, '.claude/rules/ctxo-context-old.md'), 'utf-8')).toBe(quoted);
    expect(readFileSync(join(dir, '.claude/rules/ctxo-context-lending.md'), 'utf-8')).toBe(quoted);
  });

  it('ignores .tmp files in the rules directories', async () => {
    const dir = project();
    await run(dir, 'rules', '--write');
    put(dir, '.claude/rules/ctxo-context-lending.md.123.abc.tmp', 'leftover\n');
    stderr.length = 0;
    expect(await run(dir, 'rules', '--check')).toBe(0);
    expect(stderr.join('\n')).not.toContain('.tmp');
  });

  it('a write failure gives skipped and exit 1', async () => {
    const dir = project();
    put(dir, '.claude/rules', 'a file where the directory should be');
    expect(await run(dir, 'rules', '--write')).toBe(1);
    expect(stderr.join('\n')).toContain('skipped');
  });

  it('--write with --check, and an unknown flag, give exit 1', async () => {
    const dir = project();
    expect(await run(dir, 'rules', '--write', '--check')).toBe(1);
    expect(await run(dir, 'rules', '--bogus')).toBe(1);
    expect(existsSync(join(dir, '.claude/rules/ctxo-context-lending.md'))).toBe(false);
  });

  it('lists several contexts in sorted order', async () => {
    const extra = '  - id: alpha\n    name: Alpha\n    card: docs/domain/alpha.md\n    paths: ["src/Alpha/**"]\n    rung: named\n';
    const dir = project(REGISTRY + extra);
    expect(await run(dir, 'rules', '--check')).toBe(1);
    const missing = stderr.filter((l) => l.includes('missing'));
    expect(missing.map((l) => l.trim().split(/\s+/)[1])).toEqual([
      '.claude/rules/ctxo-context-alpha.md',
      '.claude/rules/ctxo-context-fold.md',
      '.claude/rules/ctxo-context-lending.md',
    ]);
  });
});

describe('ctxo domain discover', () => {
  function gitRepo(subjectsList: string[]): string {
    const dir = project(null);
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...args], {
        cwd: dir,
        stdio: 'ignore',
      });
    };
    git('init', '-q');
    subjectsList.forEach((subject, i) => {
      put(dir, `f${i}.txt`, `${i}\n`);
      git('add', '.');
      git('commit', '-q', '-m', subject);
    });
    return dir;
  }

  const five = ['LEND-1 a', 'LEND-2 b', 'LEND-3 c', 'LEND-4 d', 'LEND-5 e'];
  let stdout: string[];
  beforeEach(() => {
    stdout = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  it('prints the evidence to stderr and writes nothing without --write', async () => {
    const dir = gitRepo(five);
    expect(await run(dir, 'discover')).toBe(0);
    const text = stderr.join('\n');
    expect(text).toContain('Rule IDs');
    expect(text).toContain('LEND in 5');
    expect(text).toContain('trackerPrefixes');
    expect(existsSync(join(dir, '.ctxo', 'config.yaml'))).toBe(false);
    expect(stdout.join('')).toBe('');
  });

  it('--json prints evidence and proposal on stdout', async () => {
    const dir = gitRepo(five);
    expect(await run(dir, 'discover', '--json')).toBe(0);
    const out = JSON.parse(stdout.join('')) as { evidence: { trackerKeys: unknown[] }; proposal: { trackerPrefixes: string[] } };
    expect(out.proposal.trackerPrefixes).toEqual(['LEND']);
    expect(out.evidence.trackerKeys).toEqual([{ prefix: 'LEND', occurrences: 5, overlapsRulePrefix: false }]);
    expect(existsSync(join(dir, '.ctxo', 'config.yaml'))).toBe(false);
  });

  it('--json adds external IDs, GitHub issues, other identifiers and test-kind markers from a real repository (#191)', async () => {
    const dir = gitRepo([
      'fix: path traversal (CWE-22)',
      'fix: injection (CWE-89) (#12)',
      'feat: holds (#164)',
      'LEND-1 a',
      'LEND-2 b',
      'LEND-3 c',
      'LEND-4 d',
      'LEND-5 e',
    ]);
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...args], {
        cwd: dir,
        stdio: 'ignore',
      });
    };
    const testFile = 'tests/Storage.Tests/BlobStoreContractTests.cs';
    put(dir, testFile, 'public class BlobStoreContractTests {}\n');
    git('add', testFile);
    git('commit', '-q', '-m', 'test: storage contract (#170)');
    for (const branch of ['feat/164-holds', 'fix/acme-12', 'fix/acme-13', 'fix/acme-14']) git('branch', branch);
    put(
      dir,
      `.ctxo/index/${testFile}.json`,
      JSON.stringify({
        file: testFile,
        lastModified: 1,
        symbols: [
          {
            symbolId: `${testFile}::BlobStoreContractTests::class`,
            name: 'BlobStoreContractTests',
            kind: 'class',
            startLine: 0,
            endLine: 9,
            annotations: [{ name: 'Trait', args: ['Category', 'StorageContract'] }],
          },
          {
            symbolId: `${testFile}::BlobStoreContractTests.Puts::method`,
            name: 'Puts',
            kind: 'method',
            startLine: 2,
            endLine: 4,
            annotations: [{ name: 'StorageContractFact' }],
          },
        ],
        edges: [],
        intent: [],
        antiPatterns: [],
      }),
    );

    expect(await run(dir, 'discover', '--json')).toBe(0);
    const out = JSON.parse(stdout.join('')) as {
      evidence: Record<string, unknown> & { trackerKeys: unknown[] };
      proposal: Record<string, unknown>;
    };
    expect(out.evidence.trackerKeys).toEqual([{ prefix: 'LEND', occurrences: 5, overlapsRulePrefix: false }]);
    expect(out.evidence['externalIds']).toEqual([
      { prefix: 'CWE', occurrences: 2, overlapsRulePrefix: false, note: 'references, not rule IDs; no config needed' },
    ]);
    expect(out.evidence['githubIssues']).toEqual({ subjects: 3, squashSuffixes: 3, totalSubjects: 9, branches: 1, largestFamily: false });
    expect(out.evidence['otherIdentifiers']).toEqual([{ prefix: 'acme', branches: 3, possibleTrackerKey: false }]);
    // External IDs are evidence only.
    expect(out.proposal['trackerPrefixes']).toEqual(['LEND']);
    expect(out.proposal).not.toHaveProperty('externalIdPrefixes');
    expect(out.proposal['contractAnnotations']).toEqual(['StorageContractFact', 'Trait:Category=StorageContract']);
    expect(out.proposal['contractPaths']).toEqual(['**/*ContractTests.cs']);
    // The existing fields stay.
    for (const key of ['cardPrefixes', 'traitKeys', 'uncoveredTestFolders', 'characterizationFolders', 'contractFolders', 'provenanceFolders']) {
      expect(out.evidence, key).toHaveProperty(key);
    }

    stdout.length = 0;
    expect(await run(dir, 'discover', '--write')).toBe(0);
    const written = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
    expect(written).toContain('Trait:Category=StorageContract');
    expect(written).toContain('Trait:Kind=Contract');
    expect(stderr.join('\n')).toContain('domain.tests.contract.annotations');
  });

  it('--write merges the proposal into .ctxo/config.yaml and lists the added values', async () => {
    const dir = gitRepo(five);
    put(dir, '.ctxo/config.yaml', 'version: "1.0"\n# keep me\n');
    expect(await run(dir, 'discover', '--write')).toBe(0);
    const written = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
    expect(written).toContain('# keep me');
    expect(written).toMatch(/trackerPrefixes:\s*\[\s*LEND\s*\]/);
    expect(stderr.join('\n')).toContain('LEND');
    stderr.length = 0;
    expect(await run(dir, 'discover', '--write')).toBe(0);
    expect(readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8')).toBe(written);
    expect(stderr.join('\n')).toContain('nothing to add');
  });

  it('works without a registry and without git history', async () => {
    const dir = project(null);
    expect(await run(dir, 'discover')).toBe(0);
    expect(stderr.join('\n')).toContain('Rule IDs');
  });

  it('rejects an unknown flag', async () => {
    expect(await run(project(null), 'discover', '--bogus')).toBe(1);
  });

  it('--write exits 2 and leaves an invalid config.yaml alone', async () => {
    const dir = gitRepo(five);
    put(dir, '.ctxo/config.yaml', 'a: [\n');
    expect(await run(dir, 'discover', '--write')).toBe(2);
    expect(readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8')).toBe('a: [\n');
    expect(stderr.join('\n')).toContain('domain discover failed');
  });

  it('marks a tracker prefix that overlaps a rule prefix in the human output', async () => {
    const dir = gitRepo(five);
    put(dir, 'docs/domain/contexts.yaml', REGISTRY.replace('src/Lending/**"]\n    rung: named', 'src/Lending/**"]\n    rung: named\n    rulePrefix: LEND'));
    expect(await run(dir, 'discover')).toBe(0);
    expect(stderr.join('\n')).toMatch(/LEND in 5 commit subjects\/branches\s+<- overlaps a rule prefix/);
  });
});

describe('ctxo domain map and ctxo domain shadow-specs', () => {
  const LITERAL = 'literal-comparison | LoanPolicy.canBorrow | loans.length >= 5';
  const UNTESTED = 'rule-without-tests | LEND-04 | A loan lasts three weeks';
  let loop: LoopProject;
  let stdout: string[];

  beforeEach(() => {
    loop = createLoopProject();
    stdout = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    loop.dispose();
  });

  const runLoop = (...args: string[]): Promise<number> => run(loop.root, ...args);
  const printed = (): Record<string, unknown> => JSON.parse(stdout.join('')) as Record<string, unknown>;

  /** The MCP tool's body for the same project: the CLI prints exactly this (the CLI adds `_meta` only on MCP). */
  async function toolBody(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const host = createModuleHost({ projectRoot: loop.root, mode: 'mcp' });
    const tool = loopTools(host, createDomainState(host)).find((t) => t.name === name)!;
    return tool.handler(args);
  }

  it('domain map --json prints the context map and exits 0', async () => {
    await loop.index();
    expect(await runLoop('map', '--json')).toBe(0);
    const body = printed();
    expect(stdout.join('')).toBe(`${JSON.stringify(body, null, 2)}\n`);
    expect(body).toEqual(await toolBody(GET_CONTEXT_MAP));
    expect((body['contextMap'] as { id: string }[]).map((entry) => entry.id).sort()).toEqual(['billing', 'lending']);
  });

  it('domain map prints the summary and one line per context to stderr', async () => {
    await loop.index();
    expect(await runLoop('map')).toBe(0);
    expect(stdout.join('')).toBe('');
    const body = (await toolBody(GET_CONTEXT_MAP)) as { summary: { agree: number } };
    const text = stderr.join('\n');
    expect(text).toContain(`[ctxo] Context map: 2 contexts (${body.summary.agree} agree with the suggested rung)`);
    expect(text).toMatch(
      /^ {2}lending {2}rung bounded {2}suggested \S+ {2}rules 2 \(1 tested\) {2}open candidates 2 {2}pinned [✓✗] named [✓✗] bounded [✓✗] boring ✗$/m,
    );
    expect(text).toMatch(/^ {2}billing {2}rung pinned {2}suggested \S+ {2}rules 0 \(0 tested\) {2}open candidates 0 {2}pinned /m);
  });

  it('domain map without artifacts exits 2 with the hint', async () => {
    await loop.index();
    rmSync(join(loop.ctxoRoot, 'index', 'domain', 'maturity.json'));
    expect(await runLoop('map')).toBe(2);
    expect(stderr.join('\n')).toContain('[ctxo] No context map yet; run "ctxo index".');
    expect(stdout.join('')).toBe('');
    stderr.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--json')).toBe(2);
    expect(stderr.join('\n')).toContain('[ctxo] No shadow-spec data yet; run "ctxo index".');
    expect(stdout.join('')).toBe('');
  });

  it('a graph built from another registry prints the stale-registry hint and exits 2', async () => {
    // domain-state.ts STALE_REGISTRY_HINT (not exported).
    const STALE_REGISTRY_HINT = 'The domain registry changed since the domain graph was built; run "ctxo index" to rebuild it (a running "ctxo watch" does this shortly after the edit).';
    await loop.index();
    loop.write('docs/domain/contexts.yaml', `${readFileSync(join(loop.root, 'docs/domain/contexts.yaml'), 'utf-8')}# edited\n`);
    loop.age('docs/domain/contexts.yaml');
    stderr.length = 0;
    expect(await runLoop('map')).toBe(2);
    expect(stderr).toEqual([`[ctxo] ${STALE_REGISTRY_HINT}`]);
    stderr.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--json')).toBe(2);
    expect(stderr).toEqual([`[ctxo] ${STALE_REGISTRY_HINT}`]);
    expect(stdout.join('')).toBe('');
  });

  it('an unexpected failure prints an internal-error line and exits 2, never 1', async () => {
    await loop.index();
    const host = createModuleHost({ projectRoot: loop.root, mode: 'cli' });
    const failing = {
      ...host,
      services: {
        ...host.services,
        loadConfig: () => {
          throw new Error('config exploded');
        },
      },
    };
    const ctx = { projectRoot: loop.root, ctxoRoot: host.ctxoRoot, readStdin: async () => '' };
    stderr.length = 0;
    expect(await domainCommand(failing).run(['map'], ctx)).toBe(2);
    expect(stderr).toContain('[ctxo] domain map failed: config exploded');
    expect(await domainCommand(failing).run(['shadow-specs', 'lending', '--json'], ctx)).toBe(2);
    expect(stderr).toContain('[ctxo] domain shadow-specs failed: config exploded');
    expect(stdout.join('')).toBe('');
  });

  it('no registry exits 0 with the hint; registry problems exit 2', async () => {
    const empty = project(null);
    expect(await run(empty, 'map')).toBe(0);
    expect(await run(empty, 'shadow-specs', 'lending')).toBe(0);
    expect(stderr.join('\n')).toContain('[ctxo] No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain".');
    stderr.length = 0;
    const broken = project('version: 2\n');
    expect(await run(broken, 'map', '--json')).toBe(2);
    expect(await run(broken, 'shadow-specs', 'lending')).toBe(2);
    expect(stderr.join('\n')).toContain('has problems; run "ctxo verify-domain".');
    expect(stdout.join('')).toBe('');
  });

  it('domain shadow-specs lending --json prints open candidates and --all adds resolved ones', async () => {
    await loop.index();
    loop.write('docs/domain/lending/shadow-specs.yaml', `- fingerprint: "${LITERAL}"\n  resolution: { notARule: "a paging limit" }\n`);
    expect(await runLoop('shadow-specs', 'lending', '--json')).toBe(0);
    const open = printed();
    expect(open).toEqual(await toolBody(FIND_SHADOW_SPECS, { context: 'lending' }));
    expect((open['shadowSpecs'] as { fingerprint: string }[]).map((c) => c.fingerprint)).toEqual([UNTESTED]);

    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--all', '--json')).toBe(0);
    const all = printed();
    expect(all).toEqual(await toolBody(FIND_SHADOW_SPECS, { context: 'lending', includeResolved: true }));
    expect((all['shadowSpecs'] as { fingerprint: string }[]).map((c) => c.fingerprint)).toEqual([UNTESTED, LITERAL]);
  });

  it('domain shadow-specs prints candidates, fingerprints, resolutions and stale entries to stderr', async () => {
    await loop.index();
    loop.write(
      'docs/domain/lending/shadow-specs.yaml',
      `- fingerprint: "${LITERAL}"\n  resolution: { rule: lend03 }\n- fingerprint: "endpoint | Gone.handler | GET /gone"\n  resolution: { notARule: "removed" }\n`,
    );
    stderr.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--all')).toBe(0);
    expect(stdout.join('')).toBe('');
    expect(stderr).toEqual([
      '[ctxo] lending: 1 open, 1 resolved shadow-spec candidates (docs/domain/lending/shadow-specs.yaml)',
      '  open  rule-without-tests  docs/domain/lending/domain.md:13  LEND-04 A loan lasts three weeks',
      `      '${UNTESTED}'`,
      `  resolved  literal-comparison  ${POLICY_FILE}:3  loans.length >= 5  [rule LEND-03]`,
      `      '${LITERAL}'`,
      "  stale  'endpoint | Gone.handler | GET /gone' (line 3)",
    ]);
  });

  it('domain shadow-specs prints each fingerprint as a YAML single-quoted scalar that pastes back as is (D-I1)', async () => {
    await loop.index();
    stderr.length = 0;
    expect(await runLoop('shadow-specs', 'lending')).toBe(0);
    const quoted = stderr.filter((l) => l.startsWith("      '")).map((l) => l.trim());
    expect(quoted).toHaveLength(2);
    loop.write('docs/domain/lending/shadow-specs.yaml', quoted.map((q) => `- fingerprint: ${q}\n  resolution: { notARule: "pasted" }\n`).join(''));
    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--json')).toBe(0);
    const body = printed();
    expect(body['shadowSpecs']).toEqual([]);
    expect(body['resolutionProblems']).toEqual([]);
    expect(body['staleResolutions']).toEqual([]);
  });

  it('--kinds filters and an unknown kind exits 1', async () => {
    await loop.index();
    expect(await runLoop('shadow-specs', 'lending', '--kinds', 'literal-comparison', '--json')).toBe(0);
    const filtered = printed();
    expect(filtered).toEqual(await toolBody(FIND_SHADOW_SPECS, { context: 'lending', kinds: ['literal-comparison'] }));
    expect((filtered['shadowSpecs'] as { fingerprint: string }[]).map((c) => c.fingerprint)).toEqual([LITERAL]);

    // An empty list means every kind.
    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--kinds', '', '--json')).toBe(0);
    expect(printed()).toEqual(await toolBody(FIND_SHADOW_SPECS, { context: 'lending' }));

    // A repeated --kinds adds to the list (union, deduplicated, in CANDIDATE_KINDS order).
    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--kinds', 'rule-without-tests', '--kinds', 'literal-comparison,literal-comparison', '--json')).toBe(0);
    expect(printed()).toEqual(await toolBody(FIND_SHADOW_SPECS, { context: 'lending', kinds: ['literal-comparison', 'rule-without-tests'] }));
    expect((printed()['shadowSpecs'] as unknown[]).length).toBe(2);
    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--kinds', 'endpoint', '--kinds', '', '--json')).toBe(0);
    expect((printed()['counts'] as { open: number }).open).toBe(0);

    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--kinds', 'endpoint', '--kinds', 'bogus')).toBe(1);
    stdout.length = 0;
    expect(await runLoop('shadow-specs', 'lending', '--kinds', 'endpoint,bogus')).toBe(1);
    expect(stderr.join('\n')).toContain(
      '[ctxo] Unknown kind "bogus"; use one of: literal-comparison, normalization, retry-timeout, endpoint, data-resource, procedure, rule-without-tests',
    );
    expect(stdout.join('')).toBe('');
  });

  it('an unknown context exits 1', async () => {
    await loop.index();
    expect(await runLoop('shadow-specs', 'nope')).toBe(1);
    expect(stderr.join('\n')).toContain('[ctxo] No context "nope" in the registry.');
    stderr.length = 0;
    expect(await runLoop('shadow-specs', 'nope', '--json')).toBe(1);
    expect(stdout.join('')).toBe('');
  });

  it('a missing context argument or a bad flag prints the usage and exits 1', async () => {
    await loop.index();
    expect(await runLoop('shadow-specs')).toBe(1);
    expect(stderr.join('\n')).toContain('Usage: ctxo domain rules --write | --check');
    stderr.length = 0;
    expect(await runLoop('shadow-specs', '--json')).toBe(1);
    expect(await runLoop('shadow-specs', 'lending', '--kinds')).toBe(1);
    expect(await runLoop('shadow-specs', 'lending', 'billing')).toBe(1);
    expect(await runLoop('shadow-specs', 'lending', '--bogus')).toBe(1);
    expect(await runLoop('map', '--bogus')).toBe(1);
    expect(stderr.join('\n')).toContain('ctxo domain shadow-specs <context> [--kinds <k,...>] [--all] [--json]');
    expect(stdout.join('')).toBe('');
  });

  it('help lists map and shadow-specs', async () => {
    const host = createModuleHost({ projectRoot: loop.root, mode: 'cli' });
    expect(domainCommand(host).help).toEqual([
      'ctxo domain rules --write|--check   Generate or check the path-scoped loader rules per context',
      'ctxo domain discover [--json] [--write]   Propose the domain config from the repository (run it first when adopting the domain layer)',
      'ctxo domain map   Context map: metrics, rungs and suggested rungs per context (--json)',
      'ctxo domain shadow-specs <context>   Shadow-spec candidates of a context (--kinds, --all, --json)',
    ]);
    // --help never runs the command: there is no index here, and every form exits 0 with the full usage.
    for (const args of [['map', '--help'], ['shadow-specs', '--help'], ['shadow-specs', 'lending', '-h']]) {
      stderr.length = 0;
      expect(await runLoop(...args)).toBe(0);
      const text = stderr.join('\n');
      expect(text).toContain('       ctxo domain map [--json]');
      expect(text).toContain('       ctxo domain shadow-specs <context> [--kinds <k,...>] [--all] [--json]');
      expect(text).toContain('Exit codes (map, shadow-specs)');
      // The help says what the code does (C-M): stale data answers with a hint and exit 0; a graph from another
      // registry exits 2.
      expect(text).toContain(
        'Exit codes (map, shadow-specs): 0 done (stale data, such as cards edited since the last index, prints a hint and still exits 0) or no registry, ' +
          '1 bad arguments or an unknown context, 2 registry problems, no index data or a graph built from another registry (run "ctxo index"), or an internal error.',
      );
    }
    expect(stdout.join('')).toBe('');
  });
});
