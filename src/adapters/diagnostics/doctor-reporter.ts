import type { DoctorReport, CheckResult } from '../../core/diagnostics/types.js';

const ICONS: Record<string, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
};

export class DoctorReporter {
  formatHuman(report: DoctorReport): string {
    const lines: string[] = ['ctxo doctor — Health Check', ''];

    for (const check of report.checks) {
      lines.push(this.formatCheckLine(check));
    }

    lines.push('');
    lines.push(`  Summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failures`);

    return lines.join('\n');
  }

  formatQuiet(report: DoctorReport): string {
    const lines: string[] = [];

    for (const check of report.checks) {
      if (check.status === 'warn' || check.status === 'fail') {
        lines.push(this.formatCheckLine(check));
      }
    }

    if (lines.length > 0) lines.push('');
    lines.push(`  Summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failures`);

    return lines.join('\n');
  }

  formatJson(report: DoctorReport): string {
    return JSON.stringify({
      checks: report.checks.map(c => ({
        name: c.id,
        status: c.status,
        value: c.value ?? null,
        message: c.message,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
      summary: report.summary,
      exitCode: report.exitCode,
    }, null, 2);
  }

  private formatCheckLine(check: CheckResult): string {
    const icon = ICONS[check.status] ?? '?';
    const title = check.title.padEnd(24);
    const suffix = check.fix ? ` (${check.fix.toLowerCase().startsWith('run') ? check.fix : check.fix})` : '';
    return `  ${icon} ${title} ${check.message}${suffix}`;
  }
}
