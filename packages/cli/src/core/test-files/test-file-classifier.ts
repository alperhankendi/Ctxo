import { makeGlobMatcher } from '../config/load-config.js';
import type { FileIndex } from '../types.js';

/** Globs that mark a repo-relative path as a test file, in spec 7.1 order. */
export const DEFAULT_TEST_GLOBS: readonly string[] = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test/**',
  '**/tests/**',
  '**/*_test.go',
  '**/src/test/**',
  '**/*.Tests/**',
  '**/*.Test/**',
  '**/*Tests.cs',
  '**/*Test.cs',
  '**/test_*.py',
  '**/*_test.py',
];

/**
 * The default globs that decide by file name alone. With annotation evidence (see `annotationAware`) a path
 * matched only by one of these is a test file only when a test-framework annotation marks it.
 */
export const NAME_ONLY_TEST_GLOBS: readonly string[] = ['**/*Tests.cs', '**/*Test.cs'];

/**
 * Short names of the attributes that mark a test, as the C# plugin reports them (`Fact`, not
 * `Xunit.FactAttribute`): xUnit, NUnit and MSTest. Matching is exact and case-sensitive.
 */
export const TEST_FRAMEWORK_ANNOTATIONS: readonly string[] = [
  'Fact',
  'Theory',
  'SkippableFact',
  'SkippableTheory',
  'Test',
  'TestCase',
  'TestCaseSource',
  'TestFixture',
  'TestMethod',
  'DataTestMethod',
  'TestClass',
];

/** Takes a repo-relative path with either separator. */
export type TestFileClassifier = (path: string) => boolean;

export interface TestFileClassifierOptions {
  /**
   * True when annotation evidence exists (the plugin that reports annotations ran). A path matched only by
   * a name-only glob is then a test file only if `annotatedFiles` holds it. Default false: name globs decide.
   */
  readonly annotationAware?: boolean;
}

function normalisePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/** The files (forward-slash paths) that hold a symbol carrying a test-framework annotation. */
export function filesWithTestAnnotations(indices: readonly FileIndex[]): Set<string> {
  const names = new Set(TEST_FRAMEWORK_ANNOTATIONS);
  const files = new Set<string>();
  for (const index of indices) {
    const marked = index.symbols.some((symbol) => symbol.annotations?.some((annotation) => names.has(annotation.name)));
    if (marked) files.add(normalisePath(index.file));
  }
  return files;
}

/**
 * Classifies test files by the default globs plus any extra (`index.tests`) globs. A path in `annotatedFiles`
 * is always a test file. With `options.annotationAware`, the name-only globs no longer decide on their own.
 */
export function createTestFileClassifier(
  extraGlobs: readonly string[] = [],
  annotatedFiles?: ReadonlySet<string>,
  options: TestFileClassifierOptions = {},
): TestFileClassifier {
  const nameOnly = new Set(NAME_ONLY_TEST_GLOBS);
  const defaults = options.annotationAware === true
    ? DEFAULT_TEST_GLOBS.filter((glob) => !nameOnly.has(glob))
    : DEFAULT_TEST_GLOBS;
  const matchesGlob = makeGlobMatcher([...defaults, ...extraGlobs]);
  return (path) => annotatedFiles?.has(normalisePath(path)) === true || matchesGlob(path);
}
