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
 * Sentinel returned when the plugin's own package.json cannot be located
 * (e.g. bundled/global installs where the directory walk exhausts without
 * finding a matching package.json). Callers that would compare versions
 * should skip the check when PLUGIN_VERSION equals this value.
 */
export const UNKNOWN_VERSION = '0.0.0';

/**
 * Compare two semver-ish versions by base x.y.z only (ignore prerelease/build).
 * Returns true when the base versions differ (i.e. a mismatch).
 * Returns false (no mismatch) when either argument is UNKNOWN_VERSION — the
 * plugin version could not be determined, so we cannot make a meaningful
 * comparison and suppressing the warning is safer than always firing it.
 */
export function baseVersionMismatch(a: string, b: string): boolean {
  if (a === UNKNOWN_VERSION || b === UNKNOWN_VERSION) return false;
  const base = (v: string) => (v.split('-')[0] ?? v).split('+')[0] ?? v;
  return base(a) !== base(b);
}

/**
 * Walk up from the current module's directory to find this plugin's own
 * package.json by matching "name": "@ctxo/lang-java". Works from both
 * the compiled dist/ location and the source src/analyzer/ location during
 * vitest runs. Cap raised to 10 to match lang-go/lang-csharp's findPackageRoot.
 */
function findOwnPluginVersion(): string | null {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
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
export const PLUGIN_VERSION: string = findOwnPluginVersion() ?? UNKNOWN_VERSION;

/**
 * Module-level memoization for resolveAnalyzerPkgJson.
 * `undefined` = not yet resolved; `null` = resolved but not found; string = path.
 */
let _analyzerPkgJsonCache: string | null | undefined = undefined;

/**
 * Resolve @ctxo/lang-java-analyzer/package.json using multiple search paths
 * to handle global-plugin + local-analyzer (and vice versa) installs:
 *   1. consumer project cwd (local node_modules)
 *   2. default module-anchored resolve (plugin-local node_modules)
 * Returns null when the package is not found anywhere.
 *
 * Result is memoized for the lifetime of the process so that repeated calls
 * from resolveAnalyzerJar() and analyzerPackageVersion() within a single
 * initialize() do not repeat the require.resolve walk.
 */
function resolveAnalyzerPkgJson(): string | null {
  if (_analyzerPkgJsonCache !== undefined) return _analyzerPkgJsonCache;
  const target = `${ANALYZER_PKG}/package.json`;
  // 1. Try consumer project cwd first (handles: global plugin + local analyzer)
  try {
    _analyzerPkgJsonCache = require.resolve(target, { paths: [process.cwd()] });
    return _analyzerPkgJsonCache;
  } catch {
    // fall through
  }
  // 2. Default module-anchored resolve (handles: local plugin + local analyzer)
  try {
    _analyzerPkgJsonCache = require.resolve(target);
  } catch {
    _analyzerPkgJsonCache = null;
  }
  return _analyzerPkgJsonCache;
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
