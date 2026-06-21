import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';

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

function detectJreMajor(): number | undefined {
  const home = process.env['CTXO_JAVA_HOME'] || process.env['JAVA_HOME'];
  const bin = home
    ? join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const r = spawnSync(bin, ['-version'], { encoding: 'utf-8' });
  const text = `${r.stderr ?? ''}${r.stdout ?? ''}`;
  const m = text.match(/version "([^"]+)"/);
  if (!m) return undefined;
  const parts = m[1]!.split('.');
  const major =
    parts[0] === '1' && parts[1] ? parseInt(parts[1]!, 10) : parseInt(parts[0]!, 10);
  return Number.isNaN(major) ? undefined : major;
}

function projectHasJava(root: string): boolean {
  for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    if (existsSync(join(root, f))) return true;
  }
  try {
    return readdirSync(root).some((n) => n.endsWith('.java'));
  } catch {
    return false;
  }
}

function analyzerInstalled(): boolean {
  try {
    require.resolve('@ctxo/lang-java-analyzer/package.json');
    return true;
  } catch {
    return false;
  }
}

export class JavaTierCheck implements IHealthCheck {
  readonly id = 'java_tier';
  readonly title = 'Java analysis tier';

  async run(ctx: CheckContext): Promise<CheckResult> {
    return evaluateJavaTier({
      hasJava: projectHasJava(ctx.projectRoot),
      jreMajor: detectJreMajor(),
      analyzerInstalled: analyzerInstalled(),
    });
  }
}
