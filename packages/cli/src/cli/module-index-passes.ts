import type { CtxoConfig } from '../core/config/config-schema.js';
import type { SymbolGraph } from '../core/graph/symbol-graph.js';
import type { FileIndex } from '../core/types.js';
import type { CoChangeWindowCommits, IndexPassContext, LoadedModule } from '../ports/i-ctxo-module.js';

export interface ModuleIndexPassInput {
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readonly config: CtxoConfig;
  /** The merged full index. */
  readonly indices: readonly FileIndex[];
  /** The raw commits of the co-change window; absent with --skip-history, without git, and under `ctxo watch`. */
  readonly history?: CoChangeWindowCommits;
  /** `ctxo watch` only: whether its plugins were asked for facts (`IndexPassContext.factsRequested`). */
  readonly factsRequested?: boolean;
  /** Where a failure is reported; `console.error` by default (stderr, never stdout). */
  readonly report?: (message: string) => void;
}

/** Whether any of the modules has an index pass. */
export function hasModuleIndexPass(modules: readonly LoadedModule[]): boolean {
  return modules.some((module) => typeof module.registration.indexPass === 'function');
}

/**
 * Runs each module's `indexPass` on the merged index, with a graph built on first use, the host's test-file
 * check and, when given, the raw commits of the co-change window. Each pass is awaited in turn; one that throws
 * is reported and the next one still runs. Never throws: `ctxo index` (Phase 2e) and `ctxo watch` both call it.
 */
export async function runModuleIndexPasses(modules: readonly LoadedModule[], input: ModuleIndexPassInput): Promise<void> {
  const report = input.report ?? ((message: string) => console.error(message));
  const passes = modules.filter((module) => typeof module.registration.indexPass === 'function');
  if (passes.length === 0) return;

  let ctx: IndexPassContext;
  try {
    // The host's services, so a pass classifies test files and builds the graph exactly as the module
    // host does everywhere else.
    const { createModuleHost } = await import('./module-host.js');
    const { services } = createModuleHost({ projectRoot: input.projectRoot, mode: 'cli' });
    const { indices } = input;
    let graph: SymbolGraph | undefined;
    ctx = {
      projectRoot: input.projectRoot,
      ctxoRoot: input.ctxoRoot,
      config: input.config,
      indices,
      graph: () => (graph ??= services.buildGraph(indices)),
      isTestFile: services.createTestFileCheck(input.config, indices),
      ...(input.history === undefined ? {} : { history: input.history }),
      ...(input.factsRequested === undefined ? {} : { factsRequested: input.factsRequested }),
    };
  } catch (err) {
    report(`[ctxo] Module index passes skipped: ${(err as Error).message}`);
    return;
  }

  for (const module of passes) {
    try {
      await module.registration.indexPass!(ctx);
    } catch (err) {
      report(`[ctxo] ${module.name} index pass failed: ${(err as Error).message}`);
    }
  }
}
