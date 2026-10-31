import { join } from 'node:path';
import type { CoChangeWindowCommits, CtxoHost, CtxoHostServices } from '../ports/i-ctxo-module.js';
import type { CtxoConfig } from '../core/config/config-schema.js';
import { DATA_RESOURCE_KINDS } from '@ctxo/plugin-api';
import type { CoChangeEntry, FileIndex, SearchDocument } from '../core/types.js';
import { DOCUMENT_SEARCH_CONFIG, SearchEngine } from '../core/search/search-engine.js';
import { SymbolTokenizer } from '../core/search/symbol-tokenizer.js';
import { indexTestPatterns, loadConfig, makeGlobMatcher, resolveCoChangeConfig } from '../core/config/load-config.js';
import { selectWindow, windowCutoff } from '../core/co-change/co-change-window.js';
import { createLogger } from '../core/logger.js';
import {
  TEST_FRAMEWORK_ANNOTATIONS,
  createTestFileClassifier,
  filesWithTestAnnotations,
  hasCSharpAnnotations,
} from '../core/test-files/test-file-classifier.js';
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { CoChangeReader } from '../adapters/storage/co-change-reader.js';
import { buildGraphFromIndices } from '../adapters/mcp/get-logic-slice.js';
import { getVersion, locateGitRoot } from './cli-paths.js';

const log = createLogger('ctxo:module-host');

/**
 * The configured co-change window: `getChangeLog` with `cochange.maxCommits`, cut with the same
 * `windowCutoff` and `selectWindow` that `ctxo index` uses for `co-changes.json`. The commits stay raw
 * (renames carry `oldPath`). Undefined when git fails, the directory is not a repository or it has no
 * commits.
 */
async function readCoChangeWindow(projectRoot: string, config: CtxoConfig): Promise<CoChangeWindowCommits | undefined> {
  try {
    const coChange = resolveCoChangeConfig(config);
    const changeLog = await new SimpleGitAdapter(projectRoot).getChangeLog(coChange.maxCommits);
    if (changeLog === undefined) return undefined;
    return {
      head: changeLog.head,
      headCommittedAt: changeLog.headCommittedAt,
      commits: selectWindow(changeLog.commits, coChange.maxCommits, windowCutoff(coChange, changeLog.headCommittedAt)),
    };
  } catch (err) {
    // simple-git refuses a directory that does not exist when the adapter is built.
    log.warn(`Co-change window unavailable: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * One co-change reader per `.ctxo` root, kept for the life of the process, so a long-running MCP server
 * re-reads `co-changes.json` only when its mtime or size changes (the reader's own cache).
 */
const coChangeReaders = new Map<string, CoChangeReader>();

function readCoChangeEntries(ctxoRoot: string): readonly CoChangeEntry[] | undefined {
  let reader = coChangeReaders.get(ctxoRoot);
  if (reader === undefined) {
    reader = new CoChangeReader(ctxoRoot);
    coChangeReaders.set(ctxoRoot, reader);
  }
  return reader.readEntries();
}

/** The host's services: thin bindings to the CLI's own config, glob, test-file, git, index and graph code. */
const HOST_SERVICES: CtxoHostServices = Object.freeze({
  createLogger,
  loadConfig,
  // The CLI matcher takes a mutable array; the module API hands out readonly ones.
  makeGlobMatcher: (patterns: readonly string[]) => makeGlobMatcher([...patterns]),
  // Decided exactly as the contexts view decides it (index-contexts-view.ts), so both agree on every file.
  createTestFileCheck: (config: CtxoConfig, indices: readonly FileIndex[]) =>
    createTestFileClassifier(indexTestPatterns(config), filesWithTestAnnotations(indices), {
      annotationAware: hasCSharpAnnotations(indices),
    }),
  createGit: (projectRoot: string) => new SimpleGitAdapter(projectRoot),
  readIndex: (ctxoRoot: string) => new JsonIndexReader(ctxoRoot).readAll(),
  // Loaded on first use: the indexer and its plugin loader stay out of the hook route.
  readIndexAtCommit: async (projectRoot: string, commit: string) =>
    (await import('./base-index.js')).readIndexAtCommit(projectRoot, commit),
  indexCommitInWorktree: async (projectRoot: string, commit: string) =>
    (await import('./base-index.js')).indexCommitInWorktree(projectRoot, commit),
  buildGraph: buildGraphFromIndices,
  readCoChangeWindow,
  readCoChangeEntries,
  findGitRoot: (dir: string) => locateGitRoot(dir) ?? undefined,
  testFrameworkAnnotations: TEST_FRAMEWORK_ANNOTATIONS,
  dataResourceKinds: DATA_RESOURCE_KINDS,
  createDocumentSearch: (documents: readonly SearchDocument[]) => {
    const engine = new SearchEngine(DOCUMENT_SEARCH_CONFIG);
    engine.buildDocumentIndex(documents);
    // Only search goes out: a module never reaches buildIndex or updateFile.
    return { search: (query: string, limit?: number) => engine.search(query, limit) };
  },
  splitIdentifier: (name: string) => SymbolTokenizer.splitName(name),
});

export interface CreateModuleHostOptions {
  readonly projectRoot: string;
  readonly mode: CtxoHost['mode'];
  /** Defaults to the running CLI's version. */
  readonly cliVersion?: string;
}

/**
 * The host a module's `register(host)` receives: the CLI version, the run mode, the project paths and the
 * shared services. Imports neither the CLI router nor the MCP server, so the hook route can build one.
 */
export function createModuleHost(options: CreateModuleHostOptions): CtxoHost {
  return {
    cliVersion: options.cliVersion ?? getVersion(),
    mode: options.mode,
    projectRoot: options.projectRoot,
    ctxoRoot: join(options.projectRoot, '.ctxo'),
    services: HOST_SERVICES,
  };
}
