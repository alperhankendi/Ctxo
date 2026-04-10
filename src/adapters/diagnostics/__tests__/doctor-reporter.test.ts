import { describe, it, expect } from 'vitest';
import { DoctorReporter } from '../doctor-reporter.js';
import type { DoctorReport, CheckResult } from '../../../core/diagnostics/types.js';

function makeReport(checks: CheckResult[]): DoctorReport {
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
  };
  return { checks, summary, exitCode: summary.fail > 0 ? 1 : 0 };
}

const passCheck: CheckResult = { id: 'node_version', title: 'Node.js version', status: 'pass', message: 'v22.1.0', value: 'v22.1.0' };
const warnCheck: CheckResult = { id: 'tree_sitter', title: 'tree-sitter', status: 'warn', message: 'not found', fix: 'Run "npm install"' };
const failCheck: CheckResult = { id: 'index_dir', title: 'Index directory', status: 'fail', message: 'missing', fix: 'Run "ctxo index"' };

describe('DoctorReporter', () => {
  const reporter = new DoctorReporter();

  describe('formatHuman', () => {
    it('includes header line', () => {
      const output = reporter.formatHuman(makeReport([passCheck]));
      expect(output).toContain('ctxo doctor — Health Check');
    });

    it('shows ✓ for pass', () => {
      const output = reporter.formatHuman(makeReport([passCheck]));
      expect(output).toContain('✓');
      expect(output).toContain('Node.js version');
    });

    it('shows ⚠ for warn', () => {
      const output = reporter.formatHuman(makeReport([warnCheck]));
      expect(output).toContain('⚠');
    });

    it('shows ✗ for fail', () => {
      const output = reporter.formatHuman(makeReport([failCheck]));
      expect(output).toContain('✗');
    });

    it('includes summary line', () => {
      const output = reporter.formatHuman(makeReport([passCheck, warnCheck, failCheck]));
      expect(output).toContain('1 passed');
      expect(output).toContain('1 warnings');
      expect(output).toContain('1 failures');
    });
  });

  describe('formatQuiet', () => {
    it('excludes pass results', () => {
      const output = reporter.formatQuiet(makeReport([passCheck, warnCheck]));
      expect(output).not.toContain('Node.js version');
      expect(output).toContain('tree-sitter');
    });

    it('shows warn and fail results', () => {
      const output = reporter.formatQuiet(makeReport([passCheck, warnCheck, failCheck]));
      expect(output).toContain('⚠');
      expect(output).toContain('✗');
    });

    it('still includes summary', () => {
      const output = reporter.formatQuiet(makeReport([passCheck]));
      expect(output).toContain('Summary');
      expect(output).toContain('1 passed');
    });
  });

  describe('formatJson', () => {
    it('produces valid JSON', () => {
      const output = reporter.formatJson(makeReport([passCheck, warnCheck]));
      const parsed = JSON.parse(output);
      expect(parsed).toBeTruthy();
    });

    it('includes checks array with correct schema', () => {
      const output = reporter.formatJson(makeReport([passCheck, warnCheck]));
      const parsed = JSON.parse(output);
      expect(parsed.checks).toHaveLength(2);
      expect(parsed.checks[0]).toHaveProperty('name');
      expect(parsed.checks[0]).toHaveProperty('status');
      expect(parsed.checks[0]).toHaveProperty('message');
    });

    it('includes summary with correct counts', () => {
      const output = reporter.formatJson(makeReport([passCheck, warnCheck, failCheck]));
      const parsed = JSON.parse(output);
      expect(parsed.summary).toEqual({ pass: 1, warn: 1, fail: 1 });
    });

    it('summary counts match checks length', () => {
      const report = makeReport([passCheck, warnCheck, failCheck]);
      const parsed = JSON.parse(reporter.formatJson(report));
      const sum = parsed.summary.pass + parsed.summary.warn + parsed.summary.fail;
      expect(sum).toBe(parsed.checks.length);
    });

    it('includes exitCode', () => {
      const output = reporter.formatJson(makeReport([failCheck]));
      const parsed = JSON.parse(output);
      expect(parsed.exitCode).toBe(1);
    });

    it('includes fix field only when present', () => {
      const output = reporter.formatJson(makeReport([passCheck, warnCheck]));
      const parsed = JSON.parse(output);
      expect(parsed.checks[0].fix).toBeUndefined();
      expect(parsed.checks[1].fix).toBe('Run "npm install"');
    });
  });

  describe('edge cases', () => {
    it('handles empty checks array', () => {
      const report = makeReport([]);
      expect(reporter.formatHuman(report)).toContain('0 passed');
      const parsed = JSON.parse(reporter.formatJson(report));
      expect(parsed.checks).toHaveLength(0);
    });
  });
});
