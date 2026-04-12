import { createRequire } from 'node:module';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';

const require = createRequire(import.meta.url);

function pass(id: string, title: string, message: string): CheckResult {
  return { id, title, status: 'pass', message };
}
function warn(id: string, title: string, message: string, fix: string): CheckResult {
  return { id, title, status: 'warn', message, fix };
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
  readonly title = 'TypeScript plugin (@ctxo/lang-typescript)';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      require.resolve('@ctxo/lang-typescript');
      return pass(this.id, this.title, 'available');
    } catch {
      return warn(
        this.id,
        this.title,
        '@ctxo/lang-typescript not installed — TypeScript/JavaScript indexing disabled',
        'Run "npm install @ctxo/lang-typescript" (or "ctxo install typescript")',
      );
    }
  }
}

export class TreeSitterCheck implements IHealthCheck {
  readonly id = 'tree_sitter';
  readonly title = 'Go / C# plugins (@ctxo/lang-go, @ctxo/lang-csharp)';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    const goOk = tryResolve('@ctxo/lang-go');
    const csOk = tryResolve('@ctxo/lang-csharp');
    if (goOk && csOk) return pass(this.id, this.title, 'both plugins available');
    if (goOk || csOk) {
      const missing = goOk ? '@ctxo/lang-csharp' : '@ctxo/lang-go';
      return warn(
        this.id,
        this.title,
        `${missing} not installed`,
        `Run "npm install ${missing}" (or "ctxo install ${missing === '@ctxo/lang-go' ? 'go' : 'csharp'}")`,
      );
    }
    return warn(
      this.id,
      this.title,
      'No Go/C# plugin installed — extended language indexing disabled',
      'Run "npm install @ctxo/lang-go @ctxo/lang-csharp"',
    );
  }
}

function tryResolve(specifier: string): boolean {
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
