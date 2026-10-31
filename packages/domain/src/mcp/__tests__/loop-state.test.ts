import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomainState, STALE_CARDS_HINT } from '../domain-state.js';
import { createLoopState, NO_LOOP_DATA_HINT, STALE_LOOP_HINT, type LoopSnapshot } from '../loop-state.js';
import { CARD, createLoopProject, REGISTRY, type LoopProject } from './loop-fixture.js';

let project: LoopProject;

beforeEach(() => {
  project = createLoopProject();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  project.dispose();
});

function loopState() {
  const host = project.host();
  return createLoopState(host, createDomainState(host));
}

function snapshotOf(state: ReturnType<typeof loopState>): LoopSnapshot {
  const loaded = state.load();
  if (!loaded.ok) throw new Error(`not ok: ${loaded.hint}`);
  return loaded.snapshot;
}

const artifactPath = (name: string): string => join(project.ctxoRoot, 'index', 'domain', name);

/** Rewrites one field of an artifact and ages the file out of the racy window. */
function patchArtifact(name: string, patch: Record<string, unknown>): void {
  const path = artifactPath(name);
  const value = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...value, ...patch }, null, 2)}\n`, 'utf-8');
  project.age(`.ctxo/index/domain/${name}`, 5);
}

describe('createLoopState', () => {
  it('reports the PR 3 hints and a missing-artifact hint', async () => {
    const state = loopState();
    expect(state.load()).toEqual({
      ok: false,
      reason: 'no-registry',
      hint: 'No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain". To propose the domain config from this repository, run "ctxo domain discover".',
    });

    project.write('docs/domain/contexts.yaml', REGISTRY);
    expect(state.load()).toEqual({ ok: false, reason: 'no-artifacts', hint: 'No domain graph yet; run "ctxo index". To propose the domain config from this repository, run "ctxo domain discover".' });

    await project.index();
    const snapshot = snapshotOf(state);
    expect(snapshot.stale).toBe(false);
    expect(snapshot.staleHint).toBeUndefined();
    expect(snapshot.candidates.map((c) => c.fingerprint)).toEqual([
      'rule-without-tests | LEND-04 | A loan lasts three weeks',
      'literal-comparison | LoanPolicy.canBorrow | loans.length >= 5',
    ]);
    expect(snapshot.maturity.contexts.map((c) => c.context)).toEqual(['lending', 'billing']);
    expect(snapshot.boundaries?.crossEdges).toEqual([]);
    expect(snapshot.shadowSpecs.map((s) => s.path)).toEqual(['docs/domain/lending/shadow-specs.yaml', 'docs/domain/billing/shadow-specs.yaml']);

    for (const name of ['shadow-candidates.json', 'maturity.json']) {
      const path = artifactPath(name);
      const saved = readFileSync(path, 'utf-8');
      rmSync(path);
      expect(state.load(), name).toEqual({ ok: false, reason: 'no-artifacts', hint: NO_LOOP_DATA_HINT });
      writeFileSync(path, saved, 'utf-8');
      project.age(`.ctxo/index/domain/${name}`, 5);
      expect(state.load().ok, name).toBe(true);
    }
    expect(NO_LOOP_DATA_HINT).toBe('No shadow-spec data yet; run "ctxo index".');
  });

  it('marks stale cards after a card edit', async () => {
    await project.index();
    const state = loopState();
    expect(snapshotOf(state).stale).toBe(false);

    project.write('docs/domain/lending/domain.md', `${CARD}\nAn edit after indexing.\n`);
    project.age('docs/domain/lending/domain.md', 5);
    const stale = snapshotOf(state);
    expect(stale.stale).toBe(true);
    expect(stale.staleHint).toBe(STALE_CARDS_HINT);
  });

  it('marks artifacts with another cardsHash than the graph as stale', async () => {
    await project.index();
    const state = loopState();
    patchArtifact('shadow-candidates.json', { cardsHash: 'another' });

    const snapshot = snapshotOf(state);
    expect(snapshot.stale).toBe(true);
    expect(snapshot.staleHint).toBe(STALE_CARDS_HINT);
  });

  it.each(['shadow-candidates.json', 'maturity.json', 'boundaries.json', 'contexts.json'])(
    'answers from %s built for another registry, marked stale',
    async (name) => {
      await project.index();
      const state = loopState();
      patchArtifact(name, { registryHash: 'another' });

      const snapshot = snapshotOf(state);
      expect(snapshot.stale).toBe(true);
      expect(snapshot.staleHint).toBe(STALE_LOOP_HINT);
      expect(snapshot.candidates).toHaveLength(2);
      expect(STALE_LOOP_HINT).toBe(
        'The shadow-spec, maturity or boundary data was built from another domain registry; run "ctxo index" to refresh it (a running "ctxo watch" does this shortly after the edit).',
      );
    },
  );

  it('joins both stale hints when cards and an artifact registry are stale', async () => {
    await project.index();
    const state = loopState();
    patchArtifact('maturity.json', { registryHash: 'another' });
    project.write('docs/domain/lending/domain.md', `${CARD}\nAn edit after indexing.\n`);
    project.age('docs/domain/lending/domain.md', 5);

    expect(snapshotOf(state).staleHint).toBe(`${STALE_CARDS_HINT} ${STALE_LOOP_HINT}`);
  });

  it('a missing boundaries artifact leaves boundaries undefined, the snapshot still loads', async () => {
    await project.index();
    rmSync(artifactPath('boundaries.json'));

    const snapshot = snapshotOf(loopState());
    expect(snapshot.boundaries).toBeUndefined();
    expect(snapshot.stale).toBe(false);
  });

  it('reads shadow-specs.yaml on every call', async () => {
    await project.index();
    const state = loopState();
    const lending = (s: LoopSnapshot) => s.shadowSpecs.find((x) => x.context === 'lending')!;
    expect(lending(snapshotOf(state)).parsed).toBeUndefined();

    // Written right after the index, inside the racy window and with no artifact change: still seen.
    project.write(
      'docs/domain/lending/shadow-specs.yaml',
      '- fingerprint: "literal-comparison | LoanPolicy.canBorrow | loans.length >= 5"\n  resolution: { rule: LEND-03 }\n',
    );
    expect(lending(snapshotOf(state)).parsed?.entries).toEqual([
      { fingerprint: 'literal-comparison | LoanPolicy.canBorrow | loans.length >= 5', resolution: { rule: 'LEND-03' }, line: 1 },
    ]);

    project.write('docs/domain/lending/shadow-specs.yaml', '[]\n');
    expect(lending(snapshotOf(state)).parsed?.entries).toEqual([]);
  });

  it('gives the reason registry-problems for a registry that does not validate', () => {
    project.write('docs/domain/contexts.yaml', 'version: 1\ncontexts: 3\n');

    expect(loopState().load()).toEqual({
      ok: false,
      reason: 'registry-problems',
      hint: 'The domain registry at docs/domain/contexts.yaml has problems; run "ctxo verify-domain".',
    });
  });

  it('gives the reason no-artifacts for invalid loop artifacts and a graph of another registry', async () => {
    await project.index();
    writeFileSync(artifactPath('shadow-candidates.json'), '{ "ctxoArtifact": "domain-shadow-candidates", "version": 2 }\n', 'utf-8');
    expect(loopState().load()).toEqual({ ok: false, reason: 'no-artifacts', hint: NO_LOOP_DATA_HINT });

    project.write('docs/domain/contexts.yaml', `${REGISTRY}  - id: shipping\n    name: Shipping\n    paths: ["src/Shipping/**"]\n    rung: fear\n`);
    const loaded = loopState().load();
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? undefined : loaded.reason).toBe('no-artifacts');
  });

  it('rereads an artifact rewritten at the same size inside the racy window', async () => {
    await project.index();
    const path = artifactPath('maturity.json');
    // A fresh mtime, inside the 2 s window: the same instant before and after the rewrite (one coarse mtime tick).
    const tick = new Date(Math.floor(Date.now()) - 500);
    utimesSync(path, tick, tick);
    const state = loopState();
    expect(snapshotOf(state).maturity.contexts[0]!.tests.characterization).toBe(0);

    const before = readFileSync(path, 'utf-8');
    const after = before.replace('"characterization": 0', '"characterization": 1');
    expect(after.length).toBe(before.length);
    writeFileSync(path, after, 'utf-8');
    utimesSync(path, tick, tick);
    expect(statSync(path).size).toBe(Buffer.byteLength(before));

    expect(snapshotOf(state).maturity.contexts[0]!.tests.characterization).toBe(1);
  });

  it('caches the artifacts by mtime and size, and rereads a changed one', async () => {
    await project.index();
    const state = loopState();
    const first = snapshotOf(state);
    expect(snapshotOf(state).candidates).toBe(first.candidates);
    expect(snapshotOf(state).maturity).toBe(first.maturity);

    const path = artifactPath('shadow-candidates.json');
    const value = JSON.parse(readFileSync(path, 'utf-8')) as { candidates: unknown[] };
    writeFileSync(path, `${JSON.stringify({ ...value, candidates: value.candidates.slice(0, 1) }, null, 2)}\n`, 'utf-8');
    project.age('.ctxo/index/domain/shadow-candidates.json', 5);

    const next = snapshotOf(state);
    expect(next.candidates).toHaveLength(1);
    expect(next.maturity).toBe(first.maturity);
  });
});
