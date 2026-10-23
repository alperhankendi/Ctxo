import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ArchitectureArtifactsWriter } from '../adapters/storage/architecture-artifacts-writer.js';
import { CoChangeReader } from '../adapters/storage/co-change-reader.js';
import type { CtxoConfig } from '../core/config/config-schema.js';
import {
  indexIgnorePatterns,
  indexTestPatterns,
  makeGlobMatcher,
  resolveContextsViewConfig,
} from '../core/config/load-config.js';
import { buildContextsView, type ContextsView } from '../core/contexts-view/contexts-view-builder.js';
import { createTestFileClassifier, filesWithTestAnnotations } from '../core/test-files/test-file-classifier.js';
import type { CommunitySnapshot, FileIndex } from '../core/types.js';

export interface ContextsViewStepOptions {
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readonly config: CtxoConfig;
  /** The merged full index. */
  readonly indices: readonly FileIndex[];
  /** This run's snapshot: god nodes and commitSha. */
  readonly snapshot: CommunitySnapshot;
  readonly symbolPageRank: ReadonlyMap<string, number>;
  /** Whether an absolute path exists in the working tree; `existsSync` unless a test counts the checks. */
  readonly exists?: (path: string) => boolean;
}

/** The file part of a symbol ID (`<file>::<name>::<kind>`). */
function fileOfSymbol(symbolId: string): string {
  const cut = symbolId.indexOf('::');
  return cut === -1 ? symbolId : symbolId.slice(0, cut);
}

/**
 * Whether any `.cs` index entry carries an annotation on any symbol. That is the evidence that the v2 C#
 * plugin ran, so a `.cs` file without a test annotation really has none.
 */
function hasCSharpAnnotations(indices: readonly FileIndex[]): boolean {
  return indices.some(
    (index) =>
      index.file.endsWith('.cs') && index.symbols.some((symbol) => symbol.annotations && symbol.annotations.length > 0),
  );
}

/**
 * Builds the contexts view from the merged full index and writes `contexts-view.json` (only when its content
 * changed). A node is a file that is not a test file, not matched by `index.ignore` or `contextsView.exclude`,
 * and still present in the working tree: the committed JSON of a deleted or skip-worktree file must not
 * make it a node. A file is a test file when a test glob matches or a test-framework annotation marks it; once
 * `.cs` annotations exist, the name-only globs (`*Test.cs`, `*Tests.cs`) alone no longer decide. Throws on
 * failure; the caller reports it and carries on.
 */
export function computeAndWriteContextsView(options: ContextsViewStepOptions): ContextsView {
  const { projectRoot, ctxoRoot, config, indices, snapshot, symbolPageRank } = options;
  const exists = options.exists ?? existsSync;

  const settings = resolveContextsViewConfig(config);
  const isTest = createTestFileClassifier(indexTestPatterns(config), filesWithTestAnnotations(indices), {
    annotationAware: hasCSharpAnnotations(indices),
  });
  const isIgnored = makeGlobMatcher(indexIgnorePatterns(config));
  const isExcluded = makeGlobMatcher([...settings.exclude]);
  // The file graph asks about each file once per index entry and up to four times per co-change pair, and
  // every answer costs a stat and a dozen glob matches, so each file is decided once.
  const nodeDecisions = new Map<string, boolean>();
  const isNode = (file: string): boolean => {
    let decision = nodeDecisions.get(file);
    if (decision === undefined) {
      decision = !isTest(file) && !isIgnored(file) && !isExcluded(file) && exists(join(projectRoot, file));
      nodeDecisions.set(file, decision);
    }
    return decision;
  };

  const godNodeFiles = new Set(snapshot.godNodes.map((god) => fileOfSymbol(god.symbolId)));
  const filePageRank = new Map<string, number>();
  for (const index of indices) {
    let sum = filePageRank.get(index.file) ?? 0;
    for (const symbol of index.symbols) sum += symbolPageRank.get(symbol.symbolId) ?? 0;
    filePageRank.set(index.file, sum);
  }

  const coChangeMap = new CoChangeReader(ctxoRoot).readCoChangeMap();
  const view = buildContextsView({
    indices,
    isNode,
    ...(coChangeMap ? { coChangeMap } : {}),
    godNodeFiles,
    filePageRank,
    settings,
    commitSha: snapshot.commitSha,
  });

  new ArchitectureArtifactsWriter(ctxoRoot, { allowProductionPath: true }).writeContextsView(view);

  const { coverage } = view;
  // A shared table is a resource of two or more candidates, as `ctxo contexts` counts it.
  const sharedTables = view.dataResources.filter((resource) => resource.accesses.length >= 2).length;
  console.error(
    `[ctxo] Contexts view: ${view.candidates.length} candidates cover ${coverage.covered}/${coverage.files} files ` +
      `(${Math.round(coverage.ratio * 100)}%), ${view.hubs.length} hubs, ${view.unclustered.count} unclustered` +
      (sharedTables > 0 ? `, ${sharedTables} shared tables` : ''),
  );
  return view;
}
