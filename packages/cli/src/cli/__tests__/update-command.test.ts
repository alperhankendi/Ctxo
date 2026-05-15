import { describe, it, expect } from 'vitest';
import {
  formatText,
  formatJson,
  type UpdateReport,
} from '../update-command.js';

const baseReport: UpdateReport = {
  ctxo: '0.7.0-alpha.0',
  channel: 'alpha',
  packages: [
    { name: '@ctxo/cli', current: '0.7.0-alpha.0', latest: '0.7.0-alpha.3', channel: 'alpha', status: 'update' },
    { name: '@ctxo/lang-typescript', current: '0.7.0-alpha.0', latest: '0.7.0-alpha.0', channel: 'alpha', status: 'current' },
    { name: '@ctxo/lang-csharp', current: '0.6.2', latest: '0.7.0', channel: 'latest', status: 'update' },
    { name: 'ctxo-lang-kotlin', current: '0.1.0', latest: null, channel: 'latest', status: 'unknown', reason: 'registry-404' },
  ],
  plan: {
    manager: 'pnpm',
    managerSource: 'lockfile',
    managerDetail: 'pnpm-lock.yaml',
    global: false,
    command: 'pnpm',
    args: ['add', '-D', '@ctxo/cli@0.7.0-alpha.3', '@ctxo/lang-csharp@0.7.0'],
  },
  strategy: 'execute',
  executed: true,
  exitCode: 0,
};

describe('formatText', () => {
  it('renders a header and a table of packages', () => {
    const out = formatText(baseReport);
    expect(out).toMatch(/checking registry for updates/);
    expect(out).toMatch(/PACKAGE\s+CURRENT\s+LATEST \(alpha\)\s+STATUS/);
    expect(out).toContain('@ctxo/cli');
    expect(out).toContain('0.7.0-alpha.3');
    expect(out).toContain('up to date');
    expect(out).toContain('update (latest)');
    expect(out).toContain('(not found)');
  });

  it('shows the install plan and a Running line when executing', () => {
    const out = formatText(baseReport);
    expect(out).toMatch(/Plan: pnpm add -D @ctxo\/cli@0\.7\.0-alpha\.3 @ctxo\/lang-csharp@0\.7\.0/);
    expect(out).toMatch(/Using pnpm \(lockfile: pnpm-lock\.yaml\)/);
    expect(out).toContain('Running');
  });

  it('switches to a print-only suggestion block when strategy is print', () => {
    const out = formatText({ ...baseReport, strategy: 'print', executed: false, exitCode: undefined });
    expect(out).toContain('To update, run:');
    expect(out).toMatch(/pnpm add -D @ctxo\/cli@/);
    expect(out).not.toContain('Running');
  });

  it('says everything is up to date when no updates exist', () => {
    const all: UpdateReport = {
      ...baseReport,
      packages: [
        { name: '@ctxo/cli', current: '0.7.0', latest: '0.7.0', channel: 'latest', status: 'current' },
      ],
      plan: null,
      strategy: 'none',
      executed: false,
    };
    const out = formatText(all);
    expect(out).toMatch(/All 1 packages? are up to date\./);
    expect(out).not.toContain('Plan:');
  });
});

describe('formatJson', () => {
  it('emits the documented JSON shape', () => {
    const parsed = JSON.parse(formatJson(baseReport));
    expect(parsed).toMatchObject({
      ctxo: '0.7.0-alpha.0',
      channel: 'alpha',
      packages: [
        { name: '@ctxo/cli', status: 'update' },
        { name: '@ctxo/lang-typescript', status: 'current' },
        { name: '@ctxo/lang-csharp', status: 'update' },
        { name: 'ctxo-lang-kotlin', status: 'unknown', reason: 'registry-404' },
      ],
      plan: {
        manager: 'pnpm',
        managerSource: 'lockfile',
        global: false,
        command: 'pnpm',
        args: ['add', '-D', '@ctxo/cli@0.7.0-alpha.3', '@ctxo/lang-csharp@0.7.0'],
      },
      executed: true,
      exitCode: 0,
    });
  });

  it('omits exitCode and plan when not applicable', () => {
    const parsed = JSON.parse(formatJson({ ...baseReport, plan: null, strategy: 'none', executed: false, exitCode: undefined }));
    expect(parsed.plan).toBeNull();
    expect(parsed.executed).toBe(false);
    expect(parsed.exitCode).toBeUndefined();
  });
});
