import { join } from 'node:path';
import type { CtxoHost } from '@ctxo/cli/internal';
import { DomainArtifactStore, type BoundariesArtifact } from '../adapters/artifact-store.js';
import { readShadowSpecs, type LoadedShadowSpecs } from '../adapters/shadow-specs-files.js';
import type { ContextHistoryEntry, MovedFile } from '../core/context-metrics.js';
import type { DomainSnapshot } from '../core/domain-graph-query.js';
import type { MaturityArtifact } from '../core/maturity.js';
import type { ShadowCandidate } from '../core/shadow-candidates.js';
import { createRacyStamper, STALE_CARDS_HINT, type DomainState, type DomainStateReason } from './domain-state.js';

/** `shadow-candidates.json` or `maturity.json` is missing or unreadable. */
export const NO_LOOP_DATA_HINT = 'No shadow-spec data yet; run "ctxo index".';

/** A loop artifact was built from another registry than the current graph's. */
export const STALE_LOOP_HINT =
  'The shadow-spec, maturity or boundary data was built from another domain registry; run "ctxo index" to refresh it (a running "ctxo watch" does this shortly after the edit).';

/** `boundaries.json` is missing: the map still answers, with `boundariesKnown: false`. */
export const NO_BOUNDARIES_HINT =
  'No boundary data yet, so cross-context edges and violations are unknown and bounded is not met; run "ctxo index".';

export interface LoopSnapshot {
  readonly domain: DomainSnapshot;
  readonly candidates: readonly ShadowCandidate[];
  readonly maturity: MaturityArtifact;
  /** Absent when `boundaries.json` is missing or unreadable. */
  readonly boundaries?: BoundariesArtifact;
  /** Newest first. */
  readonly history: readonly ContextHistoryEntry[];
  readonly movedFiles: readonly MovedFile[];
  /** One per registry context, in registry order, read on every load. */
  readonly shadowSpecs: readonly LoadedShadowSpecs[];
  /** Cards edited since the graph, artifacts of other cards than the graph's, or of another registry. */
  readonly stale: boolean;
  /** The stale hints, joined: `STALE_CARDS_HINT`, then `STALE_LOOP_HINT`. Set exactly when `stale`. */
  readonly staleHint?: string;
}

/**
 * Why a load gave no snapshot: `no-registry` (no registry file), `registry-problems` (the registry does not load or
 * validate), `no-artifacts` (the domain graph or a loop artifact is missing or invalid, or the graph was built from
 * another registry: each is fixed by `ctxo index`).
 */
export type LoopStateFailure = 'no-registry' | 'registry-problems' | 'no-artifacts';

export type LoopStateResult =
  | { readonly ok: true; readonly snapshot: LoopSnapshot }
  | { readonly ok: false; readonly reason: LoopStateFailure; readonly hint: string };

const FAILURE_OF: Readonly<Record<DomainStateReason, LoopStateFailure>> = {
  'no-registry': 'no-registry',
  'invalid-registry': 'registry-problems',
  'no-graph': 'no-artifacts',
  'stale-registry': 'no-artifacts',
};

export interface LoopState {
  load(): LoopStateResult;
}

type ArtifactKey = 'candidates' | 'maturity' | 'boundaries' | 'contexts' | 'history';

/**
 * The inputs of the loop tools (spec 12.2, 12.3) on top of the domain state: the shadow-spec candidates, maturity
 * facts, boundaries, history and moved files under `.ctxo/index/domain/`, each cached by the racy stamp of its file
 * (the history by its folder), and every context's `shadow-specs.yaml`, read on every load so an entry written after
 * the index resolves its candidate on the next call. Never writes.
 */
export function createLoopState(host: CtxoHost, state: DomainState): LoopState {
  const stampOf = createRacyStamper();
  const dir = join(host.ctxoRoot, 'index', 'domain');
  const store = new DomainArtifactStore(host.ctxoRoot);
  const paths: Record<ArtifactKey, string> = {
    candidates: join(dir, 'shadow-candidates.json'),
    maturity: join(dir, 'maturity.json'),
    boundaries: join(dir, 'boundaries.json'),
    contexts: join(dir, 'contexts.json'),
    history: join(dir, 'history'),
  };
  const cache = new Map<ArtifactKey, { stamp: string; value: unknown }>();

  /** The cached value while the stamp holds; a stamp is taken before its file is read. */
  function cached<T>(key: ArtifactKey, read: () => T): T {
    const stamp = stampOf(paths[key]);
    const hit = cache.get(key);
    if (hit !== undefined && hit.stamp === stamp) return hit.value as T;
    const value = read();
    cache.set(key, { stamp, value });
    return value;
  }

  return {
    load() {
      const loaded = state.load();
      if (!loaded.ok) return { ok: false, reason: FAILURE_OF[loaded.reason], hint: loaded.hint };
      const domain = loaded.snapshot;

      const candidates = cached('candidates', () => store.readShadowCandidates());
      const maturity = cached('maturity', () => store.readMaturity());
      if (candidates === undefined || maturity === undefined) return { ok: false, reason: 'no-artifacts', hint: NO_LOOP_DATA_HINT };
      const boundaries = cached('boundaries', () => store.readBoundaries());
      const contexts = cached('contexts', () => store.readContexts());
      const history = cached('history', () => store.readHistory());

      // The domain state has checked graph.json against the current registry, so the graph's hashes are current.
      const { registryHash, cardsHash } = domain.graph;
      const staleCards = domain.staleCards || candidates.cardsHash !== cardsHash || maturity.cardsHash !== cardsHash;
      const staleRegistry =
        candidates.registryHash !== registryHash ||
        maturity.registryHash !== registryHash ||
        (boundaries !== undefined && boundaries.registryHash !== registryHash) ||
        // movedFiles name the contexts of the registry contexts.json was built from.
        (contexts !== undefined && contexts.registryHash !== registryHash);
      const hints = [...(staleCards ? [STALE_CARDS_HINT] : []), ...(staleRegistry ? [STALE_LOOP_HINT] : [])];

      const shadowSpecs = readShadowSpecs(
        host.projectRoot,
        domain.registryPath,
        domain.registry.contexts.map((c) => c.id),
      );

      return {
        ok: true,
        snapshot: {
          domain,
          candidates: candidates.candidates,
          maturity,
          ...(boundaries === undefined ? {} : { boundaries }),
          history,
          movedFiles: contexts?.movedFiles ?? [],
          shadowSpecs,
          stale: hints.length > 0,
          ...(hints.length > 0 ? { staleHint: hints.join(' ') } : {}),
        },
      };
    },
  };
}
