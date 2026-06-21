import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const ANALYZER_VERSION = require('./package.json').version;

/** Absolute path to the bundled analyzer JAR, or null if it isn't present. */
export function jarPath() {
  const p = join(here, 'jar', 'ctxo-jdt-analyzer.jar');
  return existsSync(p) ? p : null;
}
