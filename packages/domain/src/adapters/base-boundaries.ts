import type { CtxoConfig, CtxoHost, FileIndex } from '@ctxo/cli/internal';
import { computeBoundaries, type BoundaryViolationRecord } from '../core/boundaries.js';
import type { DomainConfig } from '../core/domain-config.js';
import type { Ownership } from '../core/ownership.js';
import type { DomainRegistry } from '../core/registry.js';

/** Where the base's index came from. */
export type BaseIndexSource = 'committed-index' | 'worktree';

export type BaseBoundaries =
  | {
      readonly violations: readonly BoundaryViolationRecord[];
      readonly source: BaseIndexSource;
      /** The commit whose committed index was used (the base, or a later commit for the post-commit hook's lag). */
      readonly indexCommit?: string;
    }
  | { readonly error: string };

export interface BaseBoundariesInput {
  readonly projectRoot: string;
  /** Full SHA of the base commit. */
  readonly base: string;
  /**
   * Full SHAs of the base's first-parent successors on the `--since` ref, nearest first. The post-commit hook commits
   * a commit's index with the next commit, so the index that describes the base can sit in one of them; it is used
   * when it is current for the base's tree.
   */
  readonly laterCommits?: readonly string[];
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

/** How many commits after the base are looked at for its index. */
export const LATER_INDEX_COMMITS = 2;

/**
 * The boundary violations of the base commit, for `new-only` (#156), computed as `verify-domain` computes the
 * current ones (`computeBoundaries` over the graph of the index) with the current registry, config and ownership.
 *
 * The base's index is a committed `.ctxo/index` that is current for the base's tree: the base's own, else the one in
 * one of the first `LATER_INDEX_COMMITS` first-parent successors on the `--since` ref (the post-commit hook's lag).
 * Otherwise ctxo indexes the base in a temporary git worktree. Never throws: a failure is an `error`.
 */
export async function baseBoundaries(host: CtxoHost, input: BaseBoundariesInput): Promise<BaseBoundaries> {
  const services = host.services;
  const short = input.base.slice(0, 7);
  let indices: readonly FileIndex[] | undefined;
  let indexCommit: string | undefined;
  const reasons: string[] = [];
  for (const candidate of [input.base, ...(input.laterCommits ?? []).slice(0, LATER_INDEX_COMMITS)]) {
    const label = candidate === input.base ? `the base ${short}` : `${candidate.slice(0, 7)} (after the base)`;
    try {
      const committed = await services.readIndexAtCommit(
        input.projectRoot,
        input.base,
        candidate === input.base ? undefined : { indexCommit: candidate },
      );
      if (committed === undefined) reasons.push(`${label} has no committed index`);
      else if (!committed.current) reasons.push(`the committed index of ${label} is not current for ${short} (${committed.staleReasons.join('; ')})`);
      else {
        indices = committed.indices;
        indexCommit = candidate;
        break;
      }
    } catch (err) {
      input.warn(`Cannot read the committed index of ${label}: ${(err as Error).message}`);
    }
  }
  let source: BaseIndexSource = 'committed-index';
  if (indices === undefined) {
    source = 'worktree';
    input.note(`[ctxo] ${reasons.length > 0 ? reasons.join('; ') : `No committed index for ${short}`}; indexing the base in a temporary worktree.`);
    try {
      const indexed = await services.indexCommitInWorktree(input.projectRoot, input.base);
      indices = indexed.indices;
      for (const warning of indexed.warnings) input.warn(`Base ${short}: ${warning}`);
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
    return { violations: result.violations, source, ...(indexCommit !== undefined ? { indexCommit } : {}) };
  } catch (err) {
    return { error: `cannot compute the boundaries of the base ${short}: ${(err as Error).message}` };
  }
}
