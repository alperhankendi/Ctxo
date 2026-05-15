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

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateCommand } from '../update-command.js';
import type { HttpsFetcher } from '../../core/update/registry-client.js';

interface Captured {
  stdout: string;
  stderr: string;
  exitCode?: number;
  runs: Array<{ command: string; args: readonly string[]; cwd: string }>;
}

function makeCapture(): { capture: Captured; restore: () => void; deps: { runner: (command: string, args: readonly string[], cwd: string) => Promise<number>; setExitCode: (code: number) => void } } {
  const capture: Captured = { stdout: '', stderr: '', runs: [] };
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: any) => { capture.stdout += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: any) => { capture.stderr += String(chunk); return true; }) as typeof process.stderr.write;

  const runner = async (command: string, args: readonly string[], cwd: string): Promise<number> => {
    capture.runs.push({ command, args, cwd });
    return 0;
  };
  const setExitCode = (code: number) => { capture.exitCode = code; };

  return {
    capture,
    restore: () => { process.stdout.write = origOut; process.stderr.write = origErr; },
    deps: { runner, setExitCode },
  };
}

function makeFetcher(map: Record<string, { status: number; body: string } | Error>): HttpsFetcher {
  return async (url) => {
    const entry = Object.entries(map).find(([key]) => url.includes(encodeURIComponent(key)) || url.includes(key));
    if (!entry) return { status: 404, body: '{}' };
    const v = entry[1];
    if (v instanceof Error) throw v;
    return v;
  };
}

function makeTempProject(opts: { withCtxoDep?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-update-'));
  if (opts.withCtxoDep) {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { '@ctxo/cli': '0.7.0-alpha.0' } }, null, 2),
    );
  }
  return dir;
}

describe('UpdateCommand', () => {
  it('--check prints the report and never runs the package manager', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [
          { name: '@ctxo/cli', version: '0.7.0-alpha.0' },
          { name: '@ctxo/lang-typescript', version: '0.7.0-alpha.0' },
        ],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
          '@ctxo/lang-typescript': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.0' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true });
      expect(cap.capture.stdout).toMatch(/checking registry/);
      expect(cap.capture.stdout).toMatch(/up to date/);
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.exitCode).toBeUndefined();
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--check shows the suggested command, not a misleading "Running" line, when updates exist', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true });
      expect(cap.capture.stdout).toContain('To update, run:');
      expect(cap.capture.stdout).not.toContain('Running');
      expect(cap.capture.runs).toHaveLength(0);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('default mode runs the local install command when @ctxo/* is a devDependency', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        // Empty env so the CI lockfile guard does not trigger from the host CI=true.
        env: {},
      });
      await cmd.run({});
      expect(cap.capture.runs).toHaveLength(1);
      const call = cap.capture.runs[0]!;
      expect(call.args.join(' ')).toContain('@ctxo/cli@0.7.0-alpha.3');
      expect(call.cwd).toBe(dir);
      expect(cap.capture.exitCode ?? 0).toBe(0);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('prints the global command without running when no package.json exists', async () => {
    const dir = makeTempProject({ withCtxoDep: false });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({});
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.stdout).toContain('To update, run:');
      expect(cap.capture.stdout).toMatch(/(npm install -g|pnpm add -g|yarn global add|bun add -g) @ctxo\/cli@/);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--print never runs even when a project package.json exists', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ print: true });
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.stdout).toContain('To update, run:');
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--global builds and runs a global install command', async () => {
    const dir = makeTempProject({ withCtxoDep: false });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ global: true, pm: 'npm' });
      expect(cap.capture.runs).toHaveLength(1);
      expect(cap.capture.runs[0]!.args).toEqual(['install', '-g', '@ctxo/cli@0.7.0-alpha.3']);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--json emits structured output for check mode', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true, json: true });
      const parsed = JSON.parse(cap.capture.stdout);
      expect(parsed.packages[0]).toMatchObject({ name: '@ctxo/cli', status: 'update' });
      expect(parsed.executed).toBe(false);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('exits 1 when every fetch fails', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: async () => { const e: NodeJS.ErrnoException = new Error('down'); e.code = 'ECONNREFUSED'; throw e; },
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true });
      expect(cap.capture.exitCode).toBe(1);
      expect(cap.capture.stderr).toMatch(/registry/i);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--json (non-check) emits exactly one JSON document after the runner completes', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        // Empty env so the CI lockfile guard does not trigger from the host CI=true.
        env: {},
      });
      await cmd.run({ json: true });
      // Single document — JSON.parse must succeed on the entire stdout.
      const parsed = JSON.parse(cap.capture.stdout);
      expect(parsed.executed).toBe(true);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.plan).not.toBeNull();
      expect(cap.capture.runs).toHaveLength(1);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--check --json includes the plan and reports executed=false with no exitCode', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true, json: true });
      const parsed = JSON.parse(cap.capture.stdout);
      expect(parsed.executed).toBe(false);
      expect(parsed.exitCode).toBeUndefined();
      expect(parsed.plan).not.toBeNull();
      expect(parsed.plan.args.some((s: string) => s.includes('@ctxo/cli@0.7.0-alpha.3'))).toBe(true);
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.exitCode).toBeUndefined();
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to mutate in CI unless --force or --global is set', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        env: { CI: 'true' },
      });
      await cmd.run({});
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.exitCode).toBe(1);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('CI guard: --force allows the install to proceed', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        env: { CI: 'true' },
      });
      await cmd.run({ force: true });
      expect(cap.capture.runs).toHaveLength(1);
      expect(cap.capture.exitCode).toBeUndefined();
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('continues when one fetch 404s and others succeed; plan excludes the 404 package', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [
          { name: '@ctxo/cli', version: '0.7.0-alpha.0' },
          { name: 'ctxo-lang-kotlin', version: '0.1.0' },
        ],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
          'ctxo-lang-kotlin': { status: 404, body: '{"error":"not found"}' },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true });
      expect(cap.capture.exitCode).toBeUndefined();
      expect(cap.capture.stdout).toContain('ctxo-lang-kotlin');
      expect(cap.capture.stdout).toMatch(/(skipped|not found)/);
      // The plan in --check mode should reference @ctxo/cli but not ctxo-lang-kotlin.
      expect(cap.capture.stdout).toMatch(/@ctxo\/cli@0\.7\.0-alpha\.3/);
      expect(cap.capture.stdout).not.toMatch(/ctxo-lang-kotlin@/);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('CI guard: --global allows the install to proceed (and uses global flags)', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        env: { CI: 'true' },
        // pm-resolved via env/lockfile but we pass --pm npm for deterministic args
      });
      await cmd.run({ global: true, pm: 'npm' });
      expect(cap.capture.runs).toHaveLength(1);
      expect(cap.capture.runs[0]!.args).toEqual(['install', '-g', '@ctxo/cli@0.7.0-alpha.3']);
      expect(cap.capture.exitCode).toBeUndefined();
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('excludes workspace-linked plugins from the install plan and shows them as workspace link', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-update-ws-'));
    // package.json declares @ctxo/cli as a normal devDep but @ctxo/lang-typescript
    // as a workspace link — exactly what the Ctxo monorepo itself looks like.
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture-monorepo',
        devDependencies: {
          '@ctxo/cli': '0.9.1',
          '@ctxo/lang-typescript': 'workspace:*',
        },
      }),
    );
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [
          { name: '@ctxo/cli', version: '0.9.1' },
          { name: '@ctxo/lang-typescript', version: '0.7.0-alpha.0' },
        ],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '0.9.2' } }) },
          '@ctxo/lang-typescript': { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '0.7.1' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        env: {},
      });
      await cmd.run({ check: true });
      // The table shows the plugin as workspace link with (local) in the LATEST column.
      expect(cap.capture.stdout).toContain('@ctxo/lang-typescript');
      expect(cap.capture.stdout).toContain('workspace link');
      expect(cap.capture.stdout).toContain('(local)');
      // The plan only mentions @ctxo/cli; the workspace-linked plugin is excluded.
      expect(cap.capture.stdout).toMatch(/@ctxo\/cli@0\.9\.2/);
      expect(cap.capture.stdout).not.toMatch(/@ctxo\/lang-typescript@0\.7\.1/);
      expect(cap.capture.runs).toHaveLength(0);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });
});
