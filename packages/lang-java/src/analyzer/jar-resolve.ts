import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');
const require = createRequire(import.meta.url);
const ANALYZER_PKG = '@ctxo/lang-java-analyzer';
const ENV_OVERRIDE = 'CTXO_JDT_ANALYZER_JAR';
const JAR_REL = ['jar', 'ctxo-jdt-analyzer.jar'];

/**
 * Resolve the full-tier analyzer JAR WITHOUT network access:
 *   1. CTXO_JDT_ANALYZER_JAR env override (dev/CI/test escape hatch), if the file exists
 *   2. the bundled jar inside the installed @ctxo/lang-java-analyzer package
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
    const pkgJson = require.resolve(`${ANALYZER_PKG}/package.json`);
    const jar = join(dirname(pkgJson), ...JAR_REL);
    return existsSync(jar) ? jar : null;
  } catch {
    return null;
  }
}

/** Version of the installed analyzer package, or null when absent. */
export function analyzerPackageVersion(): string | null {
  try {
    const pkgJson = require.resolve(`${ANALYZER_PKG}/package.json`);
    return (require(pkgJson) as { version: string }).version;
  } catch {
    return null;
  }
}
