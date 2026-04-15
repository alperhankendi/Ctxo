import { createLogger } from '../../core/logger.js';
import type { IHealthCheck, CheckContext, CheckResult, DoctorReport } from '../../core/diagnostics/types.js';

const log = createLogger('ctxo:doctor');

export interface HealthCheckerOptions {
  /** Suppress per-check PASS info lines only. WARN, FAIL, and ERROR still log. */
  readonly quiet?: boolean;
}

export class HealthChecker {
  private readonly checks: IHealthCheck[];
  private readonly quiet: boolean;

  constructor(checks: IHealthCheck[], options: HealthCheckerOptions = {}) {
    this.checks = checks;
    this.quiet = options.quiet ?? false;
  }

  async runAll(ctx: CheckContext): Promise<DoctorReport> {
    const settled = await Promise.allSettled(
      this.checks.map(check => check.run(ctx)),
    );

    const results: CheckResult[] = settled.map((outcome, i) => {
      const check = this.checks[i]!;
      if (outcome.status === 'fulfilled') {
        const r = outcome.value;
        // In --quiet mode, suppress PASS noise only. WARN and FAIL still log
        // so operators can see anything that needs attention.
        if (!this.quiet || r.status !== 'pass') {
          log.info(`${r.id}: ${r.status.toUpperCase()} (${r.message})`);
        }
        return r;
      }
      const message = (outcome.reason as Error)?.message ?? 'Unknown error';
      log.error(`${check.id}: FAIL (${message})`);
      return {
        id: check.id,
        title: check.title,
        status: 'fail' as const,
        message: `Check crashed: ${message}`,
      };
    });

    const summary = {
      pass: results.filter(r => r.status === 'pass').length,
      warn: results.filter(r => r.status === 'warn').length,
      fail: results.filter(r => r.status === 'fail').length,
    };

    const exitCode = summary.fail > 0 ? 1 as const : 0 as const;

    return { checks: results, summary, exitCode };
  }
}
