import { statSync } from 'node:fs';
import type { CtxoHost, ModuleToolDefinition } from '@ctxo/cli/internal';
import { locateRepoPath } from '../adapters/repo-files.js';
import { buildContextMap } from '../core/context-map.js';
import { conventionsAtDefaults } from '../core/domain-config.js';
import { canonicalRuleId } from '../core/domain-graph-query.js';
import { CANDIDATE_KINDS, candidatesOf, type CandidateKind, type ShadowCandidate } from '../core/shadow-candidates.js';
import { applyResolutions, shadowSpecsPath, type AppliedResolutions } from '../core/shadow-specs-file.js';
import { shadowSpecsView } from '../core/shadow-specs-view.js';
import type { DomainState } from './domain-state.js';
import { createLoopState, NO_BOUNDARIES_HINT, type LoopSnapshot, type LoopState } from './loop-state.js';

/**
 * The agentic loop tools of `@ctxo/domain` (spec 12.2, 12.3): `find_shadow_specs` and `get_context_map`. Without a
 * registry, a graph or the loop artifacts they answer `{ found: false, hint }`; an unexpected failure gives
 * `{ error: true, message }` (PR 3 convention, W12). The CLI adds `_meta`, truncation and masking.
 */

export const FIND_SHADOW_SPECS = 'find_shadow_specs';
export const GET_CONTEXT_MAP = 'get_context_map';

type Payload = Record<string, unknown>;

/** The `get_context_map` hint while the discoverable conventions are all at their defaults (#191). */
export const DEFAULT_CONVENTIONS_HINT =
  'The domain conventions are still at their defaults; run "ctxo domain discover" to propose them from this repository.';

const FIND_SHADOW_SPECS_DESCRIPTION =
  'Find shadow-spec candidates in a named context: business-looking logic that no card rule pins yet. Candidates are literal comparisons in conditions, string normalization, retry and timeout values and public endpoints in the context\'s code, the SQL tables, views and procedures it owns, and its rules without tests. Each has its file, line, symbol, a line-independent fingerprint, its source (native analysis, text scan, the index or the card) and its resolution: linked to a rule, marked Untested in the card, or resolved in the context\'s shadow-specs.yaml (the response names the file) with { rule: <ID> } or { notARule: "<reason>" }. Use this for the Deletion Test: for each open candidate, find or write the rule that pins it, or record why it is not a rule. Resolved candidates are hidden unless includeResolved is true. Copy each fingerprint verbatim into shadow-specs.yaml as a YAML single-quoted scalar (fingerprint: \'...\', with a \' inside written as \'\'); %7C and %25 in the symbol part are an encoded | and %. Under ctxo watch, candidates refresh shortly after a card, glossary or registry edit, and after watch.snapshotMinFileChanges re-indexed source files. Large results are truncated with _meta.hint.';

const GET_CONTEXT_MAP_DESCRIPTION =
  "Get the map of named contexts: for each context its card, rule count and share of rules with tests, characterization and contract test counts, cross-context edges in and out, co-change with other contexts, drift, boundary violations and open shadow-spec candidates, plus the owner's rung from the registry, a suggested rung and the status of each criterion (pinned, named, bounded, boring). Use this to see how mature each context is and what blocks its next rung. The suggestion never changes the registry. Under ctxo watch, the map refreshes shortly after a card, glossary or registry edit, and after watch.snapshotMinFileChanges re-indexed source files. Large results are truncated with _meta.hint; run \"ctxo domain map\" for the full map. Needs a domain registry (docs/domain/contexts.yaml). While the domain conventions are at their defaults and discovery has something to propose, the hint says to run \"ctxo domain discover\", which proposes tracker prefixes, rule trait keys and test-kind markers from the repository.";

const KINDS_DESCRIPTION = `Candidate kinds to return (default: all): ${CANDIDATE_KINDS.join(', ')}. An empty list also returns all kinds.`;

export interface ShadowSpecsQuery {
  readonly context: string;
  /** Undefined or empty: every kind. */
  readonly kinds?: readonly CandidateKind[];
  readonly includeResolved?: boolean;
}

/** Stale data adds `stale: true` and the stale hint, after any hint of the view itself. */
function withStale(snapshot: LoopSnapshot, body: Payload): Payload {
  if (!snapshot.stale || snapshot.staleHint === undefined) return body;
  const hint = typeof body['hint'] === 'string' ? `${body['hint']} ${snapshot.staleHint}` : snapshot.staleHint;
  return { ...body, stale: true, hint };
}

/** One context's candidates with its `shadow-specs.yaml` entries applied. */
function resolvedCandidates(snapshot: LoopSnapshot, context: string): AppliedResolutions {
  const entries = snapshot.shadowSpecs.find((s) => s.context === context)?.parsed?.entries ?? [];
  const index = snapshot.domain.index;
  return applyResolutions(candidatesOf(snapshot.candidates, context), entries, (raw) => canonicalRuleId(index, raw));
}

/**
 * The `find_shadow_specs` answer (also the body of `ctxo domain shadow-specs`): `shadowSpecsView` of one context,
 * or `{ found: false, hint }` for a context the registry does not name; stale data adds `stale` and the hint.
 */
export function shadowSpecsAnswer(snapshot: LoopSnapshot, query: ShadowSpecsQuery): Payload {
  const id = query.context.trim();
  if (id === '') return { found: false, hint: 'Pass a context ID from the registry; get_context_map lists the contexts.' };
  const context = snapshot.domain.index.contexts.get(id);
  if (context === undefined) return { found: false, hint: `No context ${id} in the registry; get_context_map lists the contexts.` };
  const applied = resolvedCandidates(snapshot, id);
  const problems = snapshot.shadowSpecs.find((s) => s.context === id)?.parsed?.problems ?? [];
  return withStale(
    snapshot,
    shadowSpecsView({
      context,
      candidates: applied.candidates,
      ...(query.kinds === undefined || query.kinds.length === 0 ? {} : { kinds: query.kinds }),
      includeResolved: query.includeResolved === true,
      resolutionFile: shadowSpecsPath(snapshot.domain.registryPath, id),
      stale: applied.stale,
      unknownRules: applied.unknownRules,
      problems,
    }),
  );
}

/** True when the repo path is a regular file inside the repository. Never throws. */
function repoFileExists(projectRoot: string, repoPath: string): boolean {
  const located = locateRepoPath(projectRoot, repoPath);
  if (!('real' in located)) return false;
  try {
    return statSync(located.real).isFile();
  } catch {
    return false;
  }
}

/**
 * The `get_context_map` answer (also the body of `ctxo domain map`): `buildContextMap` over every context's
 * candidates after its file resolutions. A missing boundaries artifact adds `NO_BOUNDARIES_HINT`; conventions still
 * at their defaults, when the last index recorded that discovery would add something (`maturity.json` `discovery`),
 * add `DEFAULT_CONVENTIONS_HINT` (#191), in that order; stale data adds `stale` and the stale hint.
 */
export function contextMapAnswer(projectRoot: string, snapshot: LoopSnapshot): Payload {
  const candidates: ShadowCandidate[] = [];
  for (const context of snapshot.domain.registry.contexts) candidates.push(...resolvedCandidates(snapshot, context.id).candidates);
  const view = buildContextMap({
    snapshot: snapshot.domain,
    ...(snapshot.boundaries === undefined ? {} : { boundaries: snapshot.boundaries }),
    history: snapshot.history,
    movedFiles: snapshot.movedFiles,
    maturity: snapshot.maturity,
    candidates,
    cardExists: (path) => repoFileExists(projectRoot, path),
  });
  const body: Payload = { ...view };
  const hints: string[] = [];
  if (snapshot.boundaries === undefined) hints.push(NO_BOUNDARIES_HINT);
  // Only while the conventions are at their defaults and the last index found discovery would add something (#191).
  if (snapshot.maturity.discovery?.addsSomething === true && conventionsAtDefaults(snapshot.domain.config)) hints.push(DEFAULT_CONVENTIONS_HINT);
  if (hints.length > 0) body['hint'] = hints.join(' ');
  return withStale(snapshot, body);
}

/** Runs an answer over the loaded snapshot; a not-ok state gives `{ found: false, hint }`, an exception an error. */
function answer(loop: LoopState, view: (snapshot: LoopSnapshot) => Payload): Payload {
  try {
    const loaded = loop.load();
    if (!loaded.ok) return { found: false, hint: loaded.hint };
    return view(loaded.snapshot);
  } catch (err) {
    // An unexpected failure is an error, never a miss (W12).
    return { error: true, message: `The shadow-spec data could not be read: ${(err as Error).message}` };
  }
}

const KIND_SET: ReadonlySet<string> = new Set(CANDIDATE_KINDS);

function kindsOf(raw: unknown): CandidateKind[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((k): k is CandidateKind => typeof k === 'string' && KIND_SET.has(k));
}

export function loopTools(host: CtxoHost, state: DomainState): ModuleToolDefinition[] {
  const loop = createLoopState(host, state);

  const findShadowSpecs: ModuleToolDefinition = {
    name: FIND_SHADOW_SPECS,
    description: FIND_SHADOW_SPECS_DESCRIPTION,
    inputSchema: (z) => ({
      // Trimmed first, so a whitespace-only context is rejected.
      context: z.string().trim().min(1).describe('Context ID from the registry, e.g. lending'),
      kinds: z.array(z.enum(CANDIDATE_KINDS)).optional().describe(KINDS_DESCRIPTION),
      includeResolved: z.boolean().optional().describe('Also return resolved candidates with their resolution (default false)'),
    }),
    handler: (args) =>
      answer(loop, (snapshot) => {
        const kinds = kindsOf(args['kinds']);
        return shadowSpecsAnswer(snapshot, {
          context: typeof args['context'] === 'string' ? args['context'] : '',
          ...(kinds === undefined ? {} : { kinds }),
          includeResolved: args['includeResolved'] === true,
        });
      }),
  };

  const contextMap: ModuleToolDefinition = {
    name: GET_CONTEXT_MAP,
    description: GET_CONTEXT_MAP_DESCRIPTION,
    inputSchema: () => ({}),
    handler: () => answer(loop, (snapshot) => contextMapAnswer(host.projectRoot, snapshot)),
  };

  return [findShadowSpecs, contextMap];
}
