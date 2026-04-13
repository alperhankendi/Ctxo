import { execFileSync } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-go');

export interface GoToolchainInfo {
  available: boolean;
  version?: string;
}

const MIN_MAJOR = 1;
const MIN_MINOR = 22;

/**
 * Probe `go version` and gate full-tier on a minimum version. The minimum
 * matches the toolchain expected by golang.org/x/tools/go/ssa + callgraph
 * libraries used inside the binary.
 */
export function detectGoToolchain(): GoToolchainInfo {
  try {
    const out = execFileSync('go', ['version'], { encoding: 'utf-8', timeout: 10_000 }).trim();
    const match = out.match(/go(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) {
      log.info(`Could not parse go version output: ${out}`);
      return { available: false };
    }
    const major = parseInt(match[1]!, 10);
    const minor = parseInt(match[2]!, 10);
    const version = match[3] ? `${major}.${minor}.${match[3]}` : `${major}.${minor}`;
    if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) {
      log.info(`go ${version} found but >= ${MIN_MAJOR}.${MIN_MINOR} required`);
      return { available: false, version };
    }
    return { available: true, version };
  } catch {
    return { available: false };
  }
}
