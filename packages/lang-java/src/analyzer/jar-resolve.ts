import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');
const require = createRequire(import.meta.url);
const ANALYZER_PKG = '@ctxo/lang-java-analyzer';
const ENV_OVERRIDE = 'CTXO_JDT_ANALYZER_JAR';
const JAR_REL = ['jar', 'ctxo-jdt-analyzer.jar'];

/**
 * Compare two semver-ish versions by base x.y.z only (ignore prerelease/build).
 * Returns true when the base versions differ (i.e. a mismatch).
 */
export function baseVersionMismatch(a: string, b: string): boolean {
  const base = (v: string) => (v.split('-')[0] ?? v).split('+')[0] ?? v;
  return base(a) !== base(b);
}

/**
 * Walk up from the current module's directory to find this plugin's own
 * package.json by matching "name": "@ctxo/lang-java". Works from both
 * the compiled dist/ location and the source src/analyzer/ location during
 * vitest runs.
 */
function findOwnPluginVersion(): string | null {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string; version?: string };
        if (pkg.name === '@ctxo/lang-java' && typeof pkg.version === 'string') {
          return pkg.version;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
  } catch {
    // never throw
  }
  return null;
}

/** The plugin's own version, read once from its package.json at startup. */
export const PLUGIN_VERSION: string = findOwnPluginVersion() ?? '0.0.0';

/**
 * Resolve @ctxo/lang-java-analyzer/package.json using multiple search paths
 * to handle global-plugin + local-analyzer (and vice versa) installs:
 *   1. consumer project cwd (local node_modules)
 *   2. default module-anchored resolve (plugin-local node_modules)
 * Returns null when the package is not found anywhere.
 */
function resolveAnalyzerPkgJson(): string | null {
  const target = `${ANALYZER_PKG}/package.json`;
  // 1. Try consumer project cwd first (handles: global plugin + local analyzer)
  try {
    return require.resolve(target, { paths: [process.cwd()] });
  } catch {
    // fall through
  }
  // 2. Default module-anchored resolve (handles: local plugin + local analyzer)
  try {
    return require.resolve(target);
  } catch {
    return null;
  }
}

/**
 * Resolve the full-tier analyzer JAR WITHOUT network access:
 *   1. CTXO_JDT_ANALYZER_JAR env override (dev/CI/test escape hatch), if the file exists
 *   2. the bundled jar inside the installed @ctxo/lang-java-analyzer package
 *      (searched at consumer cwd first, then plugin-local node_modules)
 *   3. null  -> caller degrades to tree-sitter
 * Never throws.
 */
export function resolveAnalyzerJar(): string | null {
  const override = process.env[ENV_OVERRIDE];
  if (override && existsSync(override)) {
    log.info(`Using analyzer jar from ${ENV_OVERRIDE}: ${override}`);
    return override;
  }
  try {
    const pkgJson = resolveAnalyzerPkgJson();
    if (!pkgJson) return null;
    const jar = join(dirname(pkgJson), ...JAR_REL);
    return existsSync(jar) ? jar : null;
  } catch {
    return null;
  }
}

/** Version of the installed analyzer package, or null when absent. */
export function analyzerPackageVersion(): string | null {
  try {
    const pkgJson = resolveAnalyzerPkgJson();
    if (!pkgJson) return null;
    return (require(pkgJson) as { version: string }).version;
  } catch {
    return null;
  }
}
