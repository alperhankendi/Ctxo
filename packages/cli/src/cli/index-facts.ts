import type { CodeFact, ILanguageAdapter, SymbolNode } from '@ctxo/plugin-api';
import type { CtxoConfig } from '../core/config/config-schema.js';
import { factsRequested } from '../core/config/load-config.js';
import { createTestFileClassifier, filesWithTestAnnotations, type TestFileClassifier } from '../core/test-files/test-file-classifier.js';
import type { FactDetectorOptions, LoadedModule } from '../ports/i-ctxo-module.js';

/** The fact request `ctxo index` and `ctxo watch` hand to the plugins. */
export interface PluginFactRequest {
  readonly facts: boolean;
  readonly factOptions?: FactDetectorOptions;
}

/**
 * Facts are requested by `index.facts: true` or by a loaded module that asks for them. The detector options
 * come from the first module (load order) that declares them, and only when facts are requested.
 */
export function pluginFactRequest(config: CtxoConfig, modules: readonly LoadedModule[]): PluginFactRequest {
  const facts = factsRequested(config) || modules.some((module) => module.registration.indexCapabilities?.facts === true);
  if (!facts) return { facts };
  const factOptions = modules.find((module) => module.registration.indexCapabilities?.factOptions !== undefined)
    ?.registration.indexCapabilities?.factOptions;
  return factOptions ? { facts, factOptions: frozenCopy(factOptions) } : { facts };
}

/**
 * A deep-frozen copy of the detector options: every plugin of the run receives this one object, so a plugin that
 * tried to change a list would change it for the others (and for the module). The lists hold only primitives.
 */
function frozenCopy(options: FactDetectorOptions): FactDetectorOptions {
  return Object.freeze({
    trivialLiterals: Object.freeze([...options.trivialLiterals]),
    normalizationMethods: Object.freeze([...options.normalizationMethods]),
  });
}

/** Fact kinds a test file never keeps: their precision there is too low (owner ruling, #156). */
const TEST_FILE_DROPPED_KINDS: ReadonlySet<CodeFact['kind']> = new Set(['retry-timeout', 'normalization']);

/**
 * The facts `ctxo index` and `ctxo watch` write for one file: in a test file, `retry-timeout` facts (owner ruling,
 * #156) and `normalization` facts (FC-4b: a test's trims and case changes prepare inputs and assertions, they state
 * no rule) are dropped and every other kind is kept. Test files are
 * classified by the shared classifier that verify-domain and dead-code use: the default test globs, the
 * `index.tests` globs and a test-framework annotation on one of the file's own symbols. The decision reads
 * only this file and the config, so a full run, an incremental run and watch write the same facts. A path
 * matched only by a name-only glob (`*Tests.cs`) needs a test annotation, because a fact-capable C# plugin
 * always reports annotations.
 */
export function dropTestFileFacts(
  file: string,
  symbols: readonly SymbolNode[],
  facts: readonly CodeFact[],
  testGlobs: readonly string[],
): CodeFact[] {
  const isTestFile = globClassifier(testGlobs)(file) || filesWithTestAnnotations([{ file, symbols: [...symbols] }]).size > 0;
  return isTestFile ? facts.filter((fact) => !TEST_FILE_DROPPED_KINDS.has(fact.kind)) : [...facts];
}

/**
 * The glob part of the classifier (default globs without the name-only ones, plus `testGlobs`), compiled once per
 * glob list: a run (`ctxo index`, `ctxo watch`) passes the same list for every file. One entry is kept.
 */
let compiled: { readonly key: string; readonly classify: TestFileClassifier } | undefined;
function globClassifier(testGlobs: readonly string[]): TestFileClassifier {
  const key = testGlobs.join('\0');
  if (compiled?.key !== key) compiled = { key, classify: createTestFileClassifier(testGlobs, undefined, { annotationAware: true }) };
  return compiled.classify;
}

/**
 * The facts one adapter extracts from one file. `[]` when the adapter has `extractFacts` and finds nothing;
 * `undefined` when the adapter has no `extractFacts` or when it throws (the failure is reported and indexing
 * carries on without facts).
 */
export async function extractFileFacts(
  adapter: ILanguageAdapter,
  relativePath: string,
  source: string,
): Promise<CodeFact[] | undefined> {
  if (typeof adapter.extractFacts !== 'function') return undefined;
  try {
    return await adapter.extractFacts(relativePath, source);
  } catch (err) {
    console.error(`[ctxo] Fact extraction failed for ${relativePath}: ${(err as Error).message}`);
    return undefined;
  }
}
