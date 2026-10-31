import type { CtxoHost, IndexPassContext } from '@ctxo/cli/internal';
import { DomainArtifactStore, type BoundariesArtifact, type ContextsArtifact } from '../adapters/artifact-store.js';
import { gatherDiscoveryInput } from '../adapters/discovery-sources.js';
import { discoverConventions, proposalAddsSomething } from '../core/discovery.js';
import { composeLoopInputs, type LoopInputs } from '../adapters/loop-inputs.js';
import { readRegistry } from '../adapters/registry-reader.js';
import { computeBoundaries } from '../core/boundaries.js';
import { historyEntry, judgeRename, movedFiles, sortMovedFiles, type MovedFile } from '../core/context-metrics.js';
import { resolveDomainConfig, type DomainConfig } from '../core/domain-config.js';
import { buildMaturityFacts, type MaturityArtifact } from '../core/maturity.js';
import { createOwnership, type Ownership } from '../core/ownership.js';
import { buildReachGraph } from '../core/reachability.js';
import { registryHash, type DomainRegistry } from '../core/registry.js';
import { scanTestTitles } from '../core/rule-id-scan.js';
import type { ShadowCandidatesArtifact } from '../core/shadow-candidates.js';
import { classifyTests } from '../core/test-conventions.js';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Logged on every skipped pass while the registry exists but this watch's plugins were loaded without a fact request
 * (`factsRequested: false`). A `ctxo index` run meanwhile does not help this watch: its own re-indexes still write no
 * facts, so it keeps skipping until it is restarted.
 */
export const FACTS_MISSING_WARNING =
  'The domain registry appeared after this ctxo watch started, so its plugins report no facts; domain artifacts not updated. ' +
  'This watch skips the domain pass until it is restarted: restart ctxo watch (and run "ctxo index" if you have not).';

/**
 * Phase 2e of `ctxo index` for `@ctxo/domain` (spec 10.7): the file-to-context map, the cross-context edges and
 * boundary violations, the domain graph (`graph.json`, spec 11.2), the shadow-spec candidates
 * (`shadow-candidates.json`, spec 12.2), the per-context maturity facts (`maturity.json`, spec 12.3), and with the
 * change log a per-commit history entry, written under `.ctxo/index/domain/`. Each artifact is rewritten only when
 * its content changed.
 *
 * - No registry: the artifacts are removed. Registry problems: a warning, and nothing is written or removed.
 * - The graph, the test texts and the candidates come from `composeLoopInputs` (W10, shared with verify-domain).
 *   When the graph cannot be built, `graph.json`, `shadow-candidates.json` and `maturity.json` stay as they are.
 *   When the graph builds but the candidates or the maturity facts fail, both marked loop files are removed (C-I2),
 *   so the loop tools answer that there is no loop data instead of serving the previous run's as current.
 * - Moved files come from the window's renames; without a change log they are kept from the existing
 *   `contexts.json`, re-judged against the current registry.
 */
export function domainIndexPass(host: CtxoHost): (ctx: IndexPassContext) => Promise<void> {
  const log = host.services.createLogger('ctxo:domain');
  return async (ctx) => {
    const started = performance.now();
    const store = new DomainArtifactStore(ctx.ctxoRoot);

    const { config, problems: configProblems } = resolveDomainConfig((ctx.config as Record<string, unknown>)['domain']);
    for (const problem of configProblems) log.warn(`${problem.path}: ${problem.message}`);

    const loaded = readRegistry(ctx.projectRoot, config.registry);
    if (loaded === undefined) {
      store.removeAll();
      return;
    }
    if (loaded.registry === undefined || loaded.problems.length > 0) {
      log.warn(
        `The domain registry at ${loaded.path} has ${loaded.problems.length} problem(s); domain artifacts not updated. Run "ctxo verify-domain".`,
      );
      return;
    }
    // A registry that appeared after `ctxo watch` started: its plugins were loaded without a fact request, so
    // its re-indexes write no facts. Artifacts built from them would answer as fresh with the native candidates
    // missing; nothing is written, and every skipped (batched) pass says so, also after a `ctxo index` run.
    if (ctx.factsRequested === false) {
      log.warn(FACTS_MISSING_WARNING);
      return;
    }
    const registry = loaded.registry;
    const hash = registryHash(loaded.text);
    const ownership = createOwnership(registry, host.services.makeGlobMatcher);

    // File ownership over the merged index (E4: tests are listed as owned files; unowned and file counts skip them).
    const files = [...new Set(ctx.indices.map((i) => i.file.replace(/\\/g, '/')))].sort(compare);
    const owned = new Map<string, string[]>(registry.contexts.map((c) => [c.id, []]));
    const nonTestFiles = new Map<string, number>(registry.contexts.map((c) => [c.id, 0]));
    const unowned: string[] = [];
    const multiplyOwned: { file: string; contexts: string[] }[] = [];
    for (const file of files) {
      const owners = ownership.owners(file);
      if (owners.length === 1) {
        const id = owners[0]!;
        owned.get(id)!.push(file);
        if (!ctx.isTestFile(file)) nonTestFiles.set(id, nonTestFiles.get(id)! + 1);
      } else if (owners.length > 1) {
        multiplyOwned.push({ file, contexts: [...owners] });
      } else if (!ctx.isTestFile(file) && !ownership.isAllowedUnowned(file)) {
        unowned.push(file);
      }
    }

    const boundaries = computeBoundaries(ctx.graph().allEdges(), {
      registry,
      ownership,
      isTestFile: ctx.isTestFile,
      mode: config.boundaries.enforce,
      blockingRungs: config.boundaries.blockingRungs,
    });

    let moved: MovedFile[];
    if (ctx.history !== undefined) {
      moved = movedFiles(ctx.history.commits, ownership);
    } else {
      const kept: MovedFile[] = [];
      for (const m of store.readContexts()?.movedFiles ?? []) {
        const judged = judgeRename(m, ownership);
        if (judged !== undefined) kept.push(judged);
      }
      moved = sortMovedFiles(kept);
    }

    const contextsArtifact: ContextsArtifact = {
      ctxoArtifact: 'domain-contexts',
      version: 1,
      registryHash: hash,
      contexts: registry.contexts.map((c) => {
        const list = owned.get(c.id)!;
        return {
          id: c.id,
          name: c.name,
          rung: c.rung,
          ...(c.card !== undefined ? { card: c.card } : {}),
          fileCount: list.length,
          files: list,
        };
      }),
      unowned: { count: unowned.length, files: unowned },
      multiplyOwned,
      movedFiles: moved,
    };
    const boundariesArtifact: BoundariesArtifact = {
      ctxoArtifact: 'domain-boundaries',
      version: 1,
      registryHash: hash,
      mode: config.boundaries.enforce,
      blockingRungs: [...config.boundaries.blockingRungs],
      crossEdges: boundaries.crossEdges,
      violations: boundaries.violations,
    };

    // A graph that cannot be built skips graph.json and the two loop artifacts (W10): the ownership and boundary
    // artifacts are still written.
    let inputs: LoopInputs | undefined;
    try {
      inputs = await composeLoopInputs(host, {
        projectRoot: ctx.projectRoot,
        indices: ctx.indices,
        isTestFile: ctx.isTestFile,
        registry,
        registryHash: hash,
        config,
        ownership,
        files,
        warn: (m) => log.warn(m),
      });
    } catch (err) {
      log.warn(
        `The domain graph could not be built: ${(err as Error).message}; graph.json not updated. ` +
          'Until the graph builds again, the domain tools may serve the previous graph (or report a stale registry if it changed).',
      );
    }

    const graph = inputs?.graph;
    const loop =
      inputs === undefined ? undefined : loopArtifacts(host, ctx, inputs, { registry, registryHash: hash, config, ownership }, (m) => log.warn(m));

    store.writeIfChanged('contexts.json', contextsArtifact);
    store.writeIfChanged('boundaries.json', boundariesArtifact);
    if (graph !== undefined) store.writeIfChanged('graph.json', graph);
    if (loop !== undefined) {
      const discovery = await discoveryResult(host, ctx, config, store, (m) => log.warn(m));
      store.writeIfChanged('shadow-candidates.json', loop.candidates);
      store.writeIfChanged('maturity.json', discovery === undefined ? loop.maturity : { ...loop.maturity, discovery });
    } else if (inputs !== undefined) {
      store.removeLoopArtifacts();
    }
    if (ctx.history !== undefined) {
      store.writeHistory(
        historyEntry({ sha: ctx.history.head, committedAt: ctx.history.headCommittedAt }, hash, nonTestFiles, boundaries),
      );
    }

    const crossCount = boundaries.crossEdges.reduce((sum, c) => sum + c.allowed + c.violations, 0);
    let graphPart = '';
    if (graph !== undefined) {
      const tested = new Set(graph.links.flatMap((l) => (l.kind === 'rule-test' ? [l.from] : [])));
      const withoutTests = graph.rules.filter((rule) => !tested.has(rule.id)).length;
      graphPart = `${graph.rules.length} rules (${withoutTests} without tests), ${graph.links.length} links, `;
    }
    if (loop !== undefined) {
      const all = loop.candidates.candidates;
      const resolved = all.filter((c) => c.resolution !== undefined).length;
      graphPart += `${all.length} shadow-spec candidates (${resolved} resolved by links or Untested), `;
    }
    const ms = Math.round(performance.now() - started);
    log.info(
      `Domain: ${registry.contexts.length} contexts, ${graphPart}` +
        `${crossCount} cross-context edges, ${boundaries.violations.length} boundary violations (${ms} ms)`,
    );
  };
}

/**
 * Whether `ctxo domain discover` would add a value to the config (#191), recorded in `maturity.json` for the
 * `get_context_map` hint. It reads committed inputs only: the pass's index and change log (no second index read
 * or `git log`) and the tracked files, never the local branch refs, because `maturity.json` is committed. Without a change log (`--skip-history`, a file re-index) the subjects are
 * unknown, so the last recorded result is kept; a failure keeps it too, with a warning.
 */
async function discoveryResult(
  host: CtxoHost,
  ctx: IndexPassContext,
  config: DomainConfig,
  store: DomainArtifactStore,
  warn: (message: string) => void,
): Promise<MaturityArtifact['discovery']> {
  const previous = (): MaturityArtifact['discovery'] => {
    try {
      return store.readMaturity()?.discovery;
    } catch {
      return undefined;
    }
  };
  if (ctx.history === undefined) return previous();
  try {
    const input = await gatherDiscoveryInput(host, ctx.projectRoot, ctx.ctxoRoot, { config: ctx.config }, config, {
      indices: ctx.indices,
      commitSubjects: ctx.history.commits.map((commit) => commit.message),
      // maturity.json is committed: no local branch refs, so every machine at the same commit records the same result.
      branches: { local: [], remote: [] },
    });
    const { proposal } = discoverConventions(input);
    return { addsSomething: proposalAddsSomething(proposal, config, input.indexTests) };
  } catch (err) {
    warn(`Convention discovery failed: ${(err as Error).message}; the last result in maturity.json is kept.`);
    return previous();
  }
}

/**
 * The loop artifacts of a built graph: the candidates as composed, and the maturity facts over the test texts the
 * composition read (`scanTestTitles`, `classifyTests`), the reach graph of the symbol graph, the effective facts and
 * the co-change entries. Undefined, with a warning, when the candidates are missing or the maturity facts fail:
 * the pass then removes both files.
 */
function loopArtifacts(
  host: CtxoHost,
  ctx: IndexPassContext,
  inputs: LoopInputs,
  input: { readonly registry: DomainRegistry; readonly registryHash: string; readonly config: DomainConfig; readonly ownership: Ownership },
  warn: (message: string) => void,
): { candidates: ShadowCandidatesArtifact; maturity: MaturityArtifact } | undefined {
  const composed = inputs.candidates;
  if (composed === undefined) {
    warn('The shadow-spec candidates are missing; shadow-candidates.json and maturity.json removed. Fix the cause and run "ctxo index".');
    return undefined;
  }
  try {
    const { registry, config, ownership } = input;
    const titles = inputs.testTexts.flatMap((test) => scanTestTitles(test.file, test.text));
    const tests = classifyTests({
      indices: ctx.indices,
      isTestFile: ctx.isTestFile,
      titles,
      characterization: config.tests.characterization,
      contract: config.tests.contract,
      makeMatcher: host.services.makeGlobMatcher,
    });
    const coChange = host.services.readCoChangeEntries(ctx.ctxoRoot);
    const contexts = buildMaturityFacts({
      registry,
      ownership,
      isTestFile: ctx.isTestFile,
      indices: ctx.indices,
      facts: composed.facts,
      reach: buildReachGraph(ctx.graph(), ctx.indices),
      tests,
      ...(coChange === undefined ? {} : { coChange }),
    });
    const hashes = { registryHash: input.registryHash, cardsHash: inputs.graph.cardsHash };
    return {
      candidates: { ctxoArtifact: 'domain-shadow-candidates', version: 1, ...hashes, candidates: composed.candidates },
      maturity: { ctxoArtifact: 'domain-maturity', version: 1, ...hashes, contexts },
    };
  } catch (err) {
    warn(`The maturity facts could not be built: ${(err as Error).message}; shadow-candidates.json and maturity.json removed.`);
    return undefined;
  }
}
