import type { CtxoConfig, CtxoHost, FileIndex } from '@ctxo/cli/internal';
import { computeBoundaries, type BoundaryViolationRecord } from '../core/boundaries.js';
import type { DomainConfig } from '../core/domain-config.js';
import type { Ownership } from '../core/ownership.js';
import type { DomainRegistry } from '../core/registry.js';

/** Where the base's index came from. */
export type BaseIndexSource = 'committed-index' | 'worktree';

export type BaseBoundaries =
  | { readonly violations: readonly BoundaryViolationRecord[]; readonly source: BaseIndexSource }
  | { readonly error: string };

export interface BaseBoundariesInput {
  readonly projectRoot: string;
  /** Full SHA of the base commit. */
  readonly base: string;
  /** The current config (`index.tests` and the test-file classifier). */
  readonly ctxoConfig: CtxoConfig;
  readonly config: DomainConfig;
  /** The current registry and ownership: the base's edges are judged by today's rules. */
  readonly registry: DomainRegistry;
  readonly ownership: Ownership;
  readonly warn: (message: string) => void;
  /** Progress lines for the user (stderr). */
  readonly note: (message: string) => void;
}

/**
 * The boundary violations of the base commit, for `new-only` (#156), computed as `verify-domain` computes the
 * current ones (`computeBoundaries` over the graph of the index) with the current registry, config and ownership.
 *
 * The base's index is its committed `.ctxo/index`, read from git, when the commit has one and it is current for that
 * commit; otherwise ctxo indexes the base in a temporary git worktree. Never throws: a failure is an `error`.
 */
export async function baseBoundaries(host: CtxoHost, input: BaseBoundariesInput): Promise<BaseBoundaries> {
  const services = host.services;
  const short = input.base.slice(0, 7);
  let indices: readonly FileIndex[] | undefined;
  let source: BaseIndexSource = 'committed-index';
  try {
    const committed = await services.readIndexAtCommit(input.projectRoot, input.base);
    if (committed === undefined) input.note(`[ctxo] The base ${short} has no committed index; indexing it in a temporary worktree.`);
    else if (!committed.current) {
      input.note(`[ctxo] The committed index of the base ${short} is not current (${committed.staleReasons.join('; ')}); indexing it in a temporary worktree.`);
    } else indices = committed.indices;
  } catch (err) {
    input.warn(`Cannot read the committed index of the base ${short}: ${(err as Error).message}`);
  }
  if (indices === undefined) {
    source = 'worktree';
    try {
      indices = await services.indexCommitInWorktree(input.projectRoot, input.base);
    } catch (err) {
      return { error: `cannot index the base ${short} in a temporary worktree: ${(err as Error).message}` };
    }
  }
  try {
    const result = computeBoundaries(services.buildGraph(indices).allEdges(), {
      registry: input.registry,
      ownership: input.ownership,
      isTestFile: services.createTestFileCheck(input.ctxoConfig, indices),
      mode: 'by-rung',
      blockingRungs: input.config.boundaries.blockingRungs,
    });
    return { violations: result.violations, source };
  } catch (err) {
    return { error: `cannot compute the boundaries of the base ${short}: ${(err as Error).message}` };
  }
}
