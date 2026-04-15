import { describe, it, expect, vi } from 'vitest';
import { HealthChecker } from '../health-checker.js';
import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';

const ctx: CheckContext = { projectRoot: '/tmp/test', ctxoRoot: '/tmp/test/.ctxo' };

function mockCheck(id: string, result: Partial<CheckResult>): IHealthCheck {
  return {
    id,
    title: result.title ?? id,
    run: vi.fn().mockResolvedValue({
      id,
      title: result.title ?? id,
      status: result.status ?? 'pass',
      message: result.message ?? 'ok',
      ...result,
    }),
  };
}

function crashingCheck(id: string, error: string): IHealthCheck {
  return {
    id,
    title: id,
    run: vi.fn().mockRejectedValue(new Error(error)),
  };
}

describe('HealthChecker', () => {
  it('runs all checks and aggregates results', async () => {
    const checks = [
      mockCheck('a', { status: 'pass', message: 'ok' }),
      mockCheck('b', { status: 'warn', message: 'warning' }),
      mockCheck('c', { status: 'fail', message: 'broken' }),
    ];
    const checker = new HealthChecker(checks);
    const report = await checker.runAll(ctx);

    expect(report.checks).toHaveLength(3);
    expect(report.summary.pass).toBe(1);
    expect(report.summary.warn).toBe(1);
    expect(report.summary.fail).toBe(1);
  });

  it('returns exit code 0 when all pass', async () => {
    const checks = [
      mockCheck('a', { status: 'pass' }),
      mockCheck('b', { status: 'pass' }),
    ];
    const report = await new HealthChecker(checks).runAll(ctx);
    expect(report.exitCode).toBe(0);
  });

  it('returns exit code 0 when only warnings', async () => {
    const checks = [
      mockCheck('a', { status: 'pass' }),
      mockCheck('b', { status: 'warn' }),
    ];
    const report = await new HealthChecker(checks).runAll(ctx);
    expect(report.exitCode).toBe(0);
  });

  it('returns exit code 1 when any check fails', async () => {
    const checks = [
      mockCheck('a', { status: 'pass' }),
      mockCheck('b', { status: 'fail' }),
    ];
    const report = await new HealthChecker(checks).runAll(ctx);
    expect(report.exitCode).toBe(1);
  });

  it('handles crashing check gracefully via allSettled', async () => {
    const checks = [
      mockCheck('a', { status: 'pass', message: 'ok' }),
      crashingCheck('b', 'something exploded'),
      mockCheck('c', { status: 'pass', message: 'ok' }),
    ];
    const checker = new HealthChecker(checks);
    const report = await checker.runAll(ctx);

    expect(report.checks).toHaveLength(3);
    expect(report.checks[0]!.status).toBe('pass');
    expect(report.checks[1]!.status).toBe('fail');
    expect(report.checks[1]!.message).toContain('crashed');
    expect(report.checks[1]!.message).toContain('something exploded');
    expect(report.checks[2]!.status).toBe('pass');
  });

  it('calls each check with the provided context', async () => {
    const check = mockCheck('a', { status: 'pass' });
    await new HealthChecker([check]).runAll(ctx);
    expect(check.run).toHaveBeenCalledWith(ctx);
  });

  it('works with empty check array', async () => {
    const report = await new HealthChecker([]).runAll(ctx);
    expect(report.checks).toHaveLength(0);
    expect(report.summary).toEqual({ pass: 0, warn: 0, fail: 0 });
    expect(report.exitCode).toBe(0);
  });

  it('summary counts match checks length', async () => {
    const checks = [
      mockCheck('a', { status: 'pass' }),
      mockCheck('b', { status: 'warn' }),
      mockCheck('c', { status: 'fail' }),
      mockCheck('d', { status: 'pass' }),
    ];
    const report = await new HealthChecker(checks).runAll(ctx);
    expect(report.summary.pass + report.summary.warn + report.summary.fail).toBe(report.checks.length);
  });

  it('emits per-check INFO lines by default (non-quiet mode)', async () => {
    const checks = [
      mockCheck('a', { status: 'pass' }),
      mockCheck('b', { status: 'warn' }),
    ];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await new HealthChecker(checks).runAll(ctx);
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('a: PASS'))).toBe(true);
      expect(lines.some((l) => l.includes('b: WARN'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('suppresses all per-check logger lines in quiet mode (reporter still prints WARN/FAIL)', async () => {
    const checks = [
      mockCheck('a', { status: 'pass' }),
      mockCheck('b', { status: 'warn', message: 'look here' }),
      mockCheck('c', { status: 'fail', message: 'broken' }),
    ];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await new HealthChecker(checks, { quiet: true }).runAll(ctx);
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('a: PASS'))).toBe(false);
      expect(lines.some((l) => l.includes('b: WARN'))).toBe(false);
      expect(lines.some((l) => l.includes('c: FAIL'))).toBe(false);
      // Results still include the WARN/FAIL data for the reporter to render.
      expect(report.summary).toEqual({ pass: 1, warn: 1, fail: 1 });
    } finally {
      spy.mockRestore();
    }
  });

  it('suppresses ERROR logger lines for crashing checks in quiet mode but still records the FAIL result', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await new HealthChecker([crashingCheck('crashy', 'boom')], { quiet: true }).runAll(ctx);
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('crashy: FAIL'))).toBe(false);
      expect(report.summary.fail).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
