import { createRequire } from 'node:module';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';

const require = createRequire(import.meta.url);

function pass(id: string, title: string, message: string): CheckResult {
  return { id, title, status: 'pass', message };
}
function warn(id: string, title: string, message: string, fix: string): CheckResult {
  return { id, title, status: 'warn', message, fix };
}
function fail(id: string, title: string, message: string, fix: string): CheckResult {
  return { id, title, status: 'fail', message, fix };
}

export function checkNodeVersion(version: string): CheckResult {
  const id = 'node_version';
  const title = 'Node.js version';
  const major = parseInt(version.slice(1).split('.')[0] ?? '0', 10);
  if (major >= 20) return { id, title, status: 'pass', message: `Node.js ${version} (required: ≥20)`, value: version };
  if (major >= 18) return { id, title, status: 'warn', message: `Node.js ${version} — v20+ recommended`, fix: 'Upgrade to Node.js 20 or later', value: version };
  return { id, title, status: 'fail', message: `Node.js ${version} — v20+ required`, fix: 'Upgrade to Node.js 20 or later', value: version };
}

export class NodeVersionCheck implements IHealthCheck {
  readonly id = 'node_version';
  readonly title = 'Node.js version';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    return checkNodeVersion(process.version);
  }
}

export class TsMorphCheck implements IHealthCheck {
  readonly id = 'ts_morph';
  readonly title = 'ts-morph';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      require.resolve('ts-morph');
      return pass(this.id, this.title, 'available');
    } catch {
      return fail(this.id, this.title, 'ts-morph not installed', 'Run "npm install"');
    }
  }
}

export class TreeSitterCheck implements IHealthCheck {
  readonly id = 'tree_sitter';
  readonly title = 'tree-sitter';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      require.resolve('tree-sitter');
      require.resolve('tree-sitter-language-pack');
      return pass(this.id, this.title, 'available');
    } catch {
      return warn(this.id, this.title, 'tree-sitter not found — Go/C# indexing disabled', 'Run "npm install tree-sitter tree-sitter-language-pack"');
    }
  }
}
