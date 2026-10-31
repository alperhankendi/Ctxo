import picomatch from 'picomatch';
import { isTestFilePath } from './test-blocks.js';

/** Takes a project-relative path with either separator. */
export type TestFileMatcher = (path: string) => boolean;

/**
 * True for a negated glob: a `!` prefix that is not the start of a `!(...)` extglob. Negation is not supported
 * (such a glob would match every path outside its pattern). The same rule as the core's `isNegatedGlob`.
 */
export function isNegatedGlob(glob: string): boolean {
  return glob.startsWith('!') && !glob.startsWith('!(');
}

/**
 * The test-file rule for this run. With the host's `PluginContext.testGlobs` (defaults plus `index.tests`),
 * a path is a test file when any glob matches it (picomatch, `dot: true`, as in the core). Without them (an
 * older core), or when none of the given values is a usable glob, the built-in default rule
 * (`isTestFilePath`) decides. A value that is not a string, is negated (`!`) or does not compile is skipped,
 * never thrown.
 */
export function createTestFileMatcher(testGlobs: readonly unknown[] | undefined): TestFileMatcher {
  if (!Array.isArray(testGlobs)) return isTestFilePath;
  const matchers: Array<(path: string) => boolean> = [];
  for (const glob of testGlobs) {
    // Negation is not supported: a `!` glob would match every path outside its pattern.
    if (typeof glob !== 'string' || glob.length === 0 || isNegatedGlob(glob)) continue;
    try {
      matchers.push(picomatch(glob, { dot: true }));
    } catch {
      // An invalid glob is skipped; the host already warns about it through `ctxo doctor`.
    }
  }
  if (matchers.length === 0) return isTestFilePath;
  return (path) => {
    const normalised = path.replace(/\\/g, '/');
    return matchers.some((matches) => matches(normalised));
  };
}
