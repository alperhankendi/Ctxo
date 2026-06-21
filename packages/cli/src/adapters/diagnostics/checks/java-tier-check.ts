import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';
import { detectJavaMajor } from '../../../core/detection/detect-java-runtime.js';

const require = createRequire(import.meta.url);

export interface JavaTierInputs {
  hasJava: boolean;
  jreMajor: number | undefined;
  analyzerInstalled: boolean;
}

/** Pure decision: map (java-present, jre, analyzer) -> CheckResult. */
export function evaluateJavaTier(i: JavaTierInputs): CheckResult {
  const id = 'java_tier';
  const title = 'Java analysis tier';

  if (!i.hasJava) {
    return { id, title, status: 'pass', message: 'no Java sources detected' };
  }

  const jreOk = (i.jreMajor ?? 0) >= 17;

  if (jreOk && i.analyzerInstalled) {
    return { id, title, status: 'pass', message: `full tier (JRE ${i.jreMajor}, analyzer installed)` };
  }

  if (jreOk && !i.analyzerInstalled) {
    return {
      id,
      title,
      status: 'warn',
      message: `syntax tier (JRE ${i.jreMajor} present, analyzer missing)`,
      fix: 'Run "ctxo install java --full-tier" for resolved call/use edges',
    };
  }

  if (!jreOk && i.analyzerInstalled) {
    return {
      id,
      title,
      status: 'warn',
      message: 'syntax tier (analyzer installed but no JRE 17+)',
      fix: 'Install a JRE 17+ and ensure it is on PATH (or set JAVA_HOME)',
    };
  }

  // No JRE >=17, no analyzer — syntax tier only, no nag
  return {
    id,
    title,
    status: 'pass',
    message: 'syntax tier (install JRE 17+ and run "ctxo install java --full-tier" for full tier)',
  };
}

/**
 * Returns true only when the @ctxo/lang-java-analyzer package is installed
 * AND its actual JAR file (`jar/ctxo-jdt-analyzer.jar`) exists on disk.
 * A package-only install without a built/extracted jar is not sufficient for
 * the full-tier indexer — doctor must reflect that accurately.
 */
export function analyzerJarPresent(): boolean {
  try {
    const pkgJson = require.resolve('@ctxo/lang-java-analyzer/package.json');
    const jarPath = join(dirname(pkgJson), 'jar', 'ctxo-jdt-analyzer.jar');
    return existsSync(jarPath);
  } catch {
    return false;
  }
}

/** Directories that should never be descended into during a Java source scan. */
const SKIP_DIRS = new Set([
  'node_modules', 'target', 'build', 'out', 'bin',
  '.git', '.ctxo', 'dist', 'coverage',
]);

/**
 * Shallow-bounded recursive search for any `.java` file under `root`.
 * Descends at most `maxDepth` directory levels (root = depth 0), skipping
 * SKIP_DIRS at every level.  Stops and returns true as soon as one file is
 * found to keep the work bounded.
 *
 * Uses Dirent entries — no extra stat calls.  Symlinked entries (both files
 * and directories) are skipped entirely to avoid following loops.
 */
export function findJavaFile(root: string, maxDepth: number): boolean {
  function walk(dir: string, depth: number): boolean {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow symlinks
      if (entry.isFile() && entry.name.endsWith('.java')) return true;
    }
    if (depth >= maxDepth) return false;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        if (walk(join(dir, entry.name), depth + 1)) return true;
      }
    }
    return false;
  }
  return walk(root, 0);
}

function projectHasJava(root: string): boolean {
  for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    if (existsSync(join(root, f))) return true;
  }
  return findJavaFile(root, 4);
}

export class JavaTierCheck implements IHealthCheck {
  readonly id = 'java_tier';
  readonly title = 'Java analysis tier';

  async run(ctx: CheckContext): Promise<CheckResult> {
    return evaluateJavaTier({
      hasJava: projectHasJava(ctx.projectRoot),
      jreMajor: detectJavaMajor(),
      analyzerInstalled: analyzerJarPresent(),
    });
  }
}
