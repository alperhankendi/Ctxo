import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleHost, type CtxoHost, type FileIndex, type IndexPassContext } from '@ctxo/cli/internal';
import { domainIndexPass } from '../../index-pass/domain-index-pass.js';
import { createDomainState, STALE_CARDS_HINT, type DomainStateResult } from '../domain-state.js';

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending/domain.md
    paths: ["src/Lending/**"]
    rung: bounded
    rulePrefix: LEND
`;

const CARD = [
  '# Lending',
  '',
  '## Rules and invariants',
  '### LEND-03 A member holds at most five loans',
  'Code: `src/Lending/Loan.ts`',
  '',
].join('\n');

const INDEX: FileIndex = {
  file: 'src/Lending/Loan.ts',
  lastModified: 1_700_000_000,
  symbols: [{ symbolId: 'src/Lending/Loan.ts::Loan::class', name: 'Loan', kind: 'class', startLine: 0, endLine: 3 }],
  edges: [],
  intent: [],
  antiPatterns: [],
};

let root: string;
let ctxoRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ctxo-domain-state-'));
  ctxoRoot = join(root, '.ctxo');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function write(path: string, text: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf-8');
}

function setUp(): void {
  write('.ctxo/index/src/Lending/Loan.ts.json', JSON.stringify(INDEX, null, 2));
  write('src/Lending/Loan.ts', 'export class Loan {}\n');
  write('docs/domain/contexts.yaml', REGISTRY);
  write('docs/domain/lending/domain.md', CARD);
}

const newHost = (): CtxoHost => createModuleHost({ cliVersion: '0.0.0', mode: 'mcp', projectRoot: root });

async function runPass(): Promise<void> {
  const host = createModuleHost({ cliVersion: '0.0.0', mode: 'cli', projectRoot: root });
  const { services } = host;
  const indices = services.readIndex(ctxoRoot);
  const config = services.loadConfig(ctxoRoot).config;
  const ctx: IndexPassContext = {
    projectRoot: root,
    ctxoRoot,
    config,
    indices,
    graph: () => services.buildGraph(indices),
    isTestFile: services.createTestFileCheck(config, indices),
  };
  await domainIndexPass(host)(ctx);
}

/** Moves a file's mtime by `seconds`, so the stamp changes even within one clock tick. */
function touch(path: string, seconds = 10): void {
  const stat = statSync(path);
  const next = new Date(stat.mtimeMs + seconds * 1000);
  utimesSync(path, next, next);
}

function failure(result: DomainStateResult): { reason: string; hint: string } {
  if (result.ok) throw new Error('expected a failure');
  return { reason: result.reason, hint: result.hint };
}

describe('createDomainState', () => {
  it('does no I/O until the first load (P19)', () => {
    const host = newHost();
    const loadConfig = vi.fn(host.services.loadConfig);
    const spied: CtxoHost = { ...host, services: { ...host.services, loadConfig } };

    // The project does not exist yet: creating the state must not read or cache anything.
    const state = createDomainState(spied);
    expect(loadConfig).not.toHaveBeenCalled();

    setUp();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(failure(state.load()).reason).toBe('no-graph');
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it('reports no-registry, invalid-registry, no-graph and stale-registry with their hints', async () => {
    const state = createDomainState(newHost());

    expect(failure(state.load())).toEqual({
      reason: 'no-registry',
      hint: 'No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain". To propose the domain config from this repository, run "ctxo domain discover".',
    });

    write('docs/domain/contexts.yaml', REGISTRY.replace('rung: bounded', 'rung: unknown'));
    expect(failure(state.load())).toEqual({
      reason: 'invalid-registry',
      hint: 'The domain registry at docs/domain/contexts.yaml has problems; run "ctxo verify-domain".',
    });

    setUp();
    touch(join(root, 'docs/domain/contexts.yaml'));
    expect(failure(state.load())).toEqual({ reason: 'no-graph', hint: 'No domain graph yet; run "ctxo index". To propose the domain config from this repository, run "ctxo domain discover".' });

    await runPass();
    const ok = state.load();
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.snapshot.registryPath).toBe('docs/domain/contexts.yaml');
      expect(ok.snapshot.staleCards).toBe(false);
      expect(ok.snapshot.index.rules.get('LEND-03')?.context).toBe('lending');
      expect(ok.snapshot.ownership.ownerOf('src/Lending/Loan.ts')).toBe('lending');
      expect(ok.snapshot.config.registry).toBe('docs/domain/contexts.yaml');
    }

    write('docs/domain/contexts.yaml', REGISTRY.replace('name: Lending', 'name: Lending desk'));
    touch(join(root, 'docs/domain/contexts.yaml'));
    expect(failure(state.load())).toEqual({
      reason: 'stale-registry',
      hint: 'The domain registry changed since the domain graph was built; run "ctxo index" to rebuild it (a running "ctxo watch" does this shortly after the edit).',
    });
  });

  it('marks stale cards after a card edit and clears after re-indexing', async () => {
    setUp();
    await runPass();
    const state = createDomainState(newHost());
    const first = state.load();
    expect(first.ok && first.snapshot.staleCards).toBe(false);

    write('docs/domain/lending/domain.md', `${CARD}\nA new paragraph.\n`);
    touch(join(root, 'docs/domain/lending/domain.md'));
    const stale = state.load();
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.snapshot.staleCards).toBe(true);
      // The answers still come from the graph.
      expect(stale.snapshot.index.rules.has('LEND-03')).toBe(true);
    }
    expect(STALE_CARDS_HINT).toBe('Cards or the glossary changed since the domain graph was built; run "ctxo index" to refresh rule links (a running "ctxo watch" does this shortly after the edit).');

    // A glossary that appears is a card change too.
    await runPass();
    const fresh = state.load();
    expect(fresh.ok && fresh.snapshot.staleCards).toBe(false);
    write('docs/domain/glossary.md', '- **Loan**: a book lent\n');
    const glossaryStale = state.load();
    expect(glossaryStale.ok && glossaryStale.snapshot.staleCards).toBe(true);

    await runPass();
    const cleared = state.load();
    expect(cleared.ok && cleared.snapshot.staleCards).toBe(false);
  });

  it('hashes an oversize card as missing, like the index pass, and warns once across reloads (I2)', async () => {
    setUp();
    write('docs/domain/lending/domain.md', `${CARD}\n${'x'.repeat(1_048_577)}\n`);
    await runPass();
    const logs: string[] = [];
    vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    // The real clock: the card was just written, so its stamp is racy and every load reloads.
    const state = createDomainState(newHost());
    const first = state.load();
    const second = state.load();
    expect(first.ok && first.snapshot.staleCards).toBe(false);
    expect(second.ok && second.snapshot.staleCards).toBe(false);
    if (second.ok) expect(second.snapshot.index.rules.has('LEND-03')).toBe(false);
    const warnings = logs.filter((l) => l.includes('domain file docs/domain/lending/domain.md is not read: larger than 1048576 bytes'));
    expect(warnings).toHaveLength(1);
  });

  it('does not read a card symlinked outside the repository (I2)', async () => {
    setUp();
    await runPass();
    const outside = mkdtempSync(join(tmpdir(), 'ctxo-domain-outside-'));
    try {
      writeFileSync(join(outside, 'secret.md'), CARD, 'utf-8');
      const card = join(root, 'docs/domain/lending/domain.md');
      rmSync(card);
      try {
        symlinkSync(join(outside, 'secret.md'), card, 'file');
      } catch {
        return; // Windows without developer mode cannot make the symlink.
      }
      // Same text as indexed, but read through a link that leaves the repository: it counts as missing, so stale.
      const result = createDomainState(newHost()).load();
      expect(result.ok && result.snapshot.staleCards).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('reloads only after a file changes', async () => {
    setUp();
    await runPass();
    // A clock well past every mtime, so no stamp is racy.
    const state = createDomainState(newHost(), { now: () => Date.now() + 60_000 });
    const first = state.load();
    const second = state.load();
    if (!first.ok || !second.ok) throw new Error('expected a snapshot');
    expect(second.snapshot).toBe(first.snapshot);
    expect(second.snapshot.generation).toBe(first.snapshot.generation);

    touch(join(ctxoRoot, 'index', 'domain', 'graph.json'));
    const third = state.load();
    if (!third.ok) throw new Error('expected a snapshot');
    expect(third.snapshot.generation).toBeGreaterThan(first.snapshot.generation);
    expect(third.snapshot).not.toBe(first.snapshot);
  });

  it('does not trust a stamp whose mtime is within 2 s of the load (racy stamps)', async () => {
    setUp();
    await runPass();
    const cardPath = join(root, 'docs/domain/lending/domain.md');
    const mtime = new Date(Math.floor(statSync(cardPath).mtimeMs / 1000) * 1000);
    utimesSync(cardPath, mtime, mtime);
    let now = mtime.getTime() + 500;
    const state = createDomainState(newHost(), { now: () => now });
    const first = state.load();
    expect(first.ok && first.snapshot.staleCards).toBe(false);

    // Same size, same mtime: only the racy rule notices the edit.
    write('docs/domain/lending/domain.md', CARD.replace('five', 'FIVE'));
    utimesSync(cardPath, mtime, mtime);
    const second = state.load();
    expect(second.ok && second.snapshot.staleCards).toBe(true);

    // Once the clock is past the window the stamp is trusted again and the result is cached.
    now = mtime.getTime() + 5_000;
    const settled = state.load();
    const again = state.load();
    if (!settled.ok || !again.ok) throw new Error('expected a snapshot');
    expect(again.snapshot).toBe(settled.snapshot);
  });
});
