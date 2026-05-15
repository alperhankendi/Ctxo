import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVersion } from './cli-router.js';
import { discoverPlugins } from '../adapters/language/plugin-discovery.js';
import { loadManifestPath } from './plugin-loader.js';
import { fetchDistTagsBatch, type HttpsFetcher } from '../core/update/registry-client.js';
import {
  computePackageStates,
  detectChannel,
  selectInstallTargets,
} from '../core/update/update-plan.js';
import {
  resolvePackageManager,
  buildInstallCommand,
  isPackageManager,
  isWorkspaceRoot,
} from '../core/install/package-manager.js';
import { runPackageManager } from '../core/install/run-package-manager.js';
import { createLogger } from '../core/logger.js';
import type { PackageManager, Resolution } from '../core/install/package-manager.js';
import type { PackageState, Channel } from '../core/update/update-plan.js';

const log = createLogger('ctxo:update');
const CTXO_CLI_PACKAGE = '@ctxo/cli';

export type UpdateStrategy = 'execute' | 'print' | 'none';

export interface UpdatePlanShape {
  readonly manager: PackageManager;
  readonly managerSource: Resolution['source'];
  readonly managerDetail?: string;
  readonly global: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

export interface UpdateReport {
  readonly ctxo: string;
  readonly channel: Channel;
  readonly packages: readonly PackageState[];
  readonly plan: UpdatePlanShape | null;
  readonly strategy: UpdateStrategy;
  readonly executed: boolean;
  readonly exitCode?: number;
}

export function formatText(report: UpdateReport): string {
  const lines: string[] = [];
  lines.push('ctxo update — checking registry for updates...');
  lines.push('');

  const updatesExist = report.packages.some((p) => p.status === 'update');
  if (!updatesExist && report.strategy !== 'print') {
    const total = report.packages.length;
    lines.push(`All ${total} package${total === 1 ? '' : 's'} are up to date.`);
    return lines.join('\n');
  }

  const nameCol = Math.max(7, ...report.packages.map((p) => p.name.length));
  const curCol = Math.max(7, ...report.packages.map((p) => p.current.length));
  const latestCol = Math.max(15, ...report.packages.map((p) => (p.latest ?? '(not found)').length));

  lines.push(
    `${'PACKAGE'.padEnd(nameCol)}  ${'CURRENT'.padEnd(curCol)}  ${`LATEST (${report.channel})`.padEnd(latestCol)}  STATUS`,
  );
  for (const pkg of report.packages) {
    const latestText = pkg.latest ?? '(not found)';
    const statusText = renderStatus(pkg, report.channel);
    lines.push(
      `${pkg.name.padEnd(nameCol)}  ${pkg.current.padEnd(curCol)}  ${latestText.padEnd(latestCol)}  ${statusText}`,
    );
  }

  if (report.plan && report.strategy === 'execute') {
    lines.push('');
    lines.push(`Plan: ${report.plan.command} ${report.plan.args.join(' ')}`);
    lines.push(`Using ${report.plan.manager} (${formatManagerSource(report.plan)})`);
    lines.push('');
    lines.push('Running...');
  } else if (report.plan && report.strategy === 'print') {
    lines.push('');
    lines.push('To update, run:');
    lines.push(`  ${report.plan.command} ${report.plan.args.join(' ')}`);
  }

  return lines.join('\n');
}

function renderStatus(pkg: PackageState, reportChannel: Channel): string {
  switch (pkg.status) {
    case 'current': return 'up to date';
    case 'ahead': return 'ahead of registry';
    case 'unknown': return pkg.reason === 'registry-404' ? 'skipped' : `error${pkg.reason ? ` (${pkg.reason})` : ''}`;
    case 'update':
      return pkg.channel === reportChannel ? 'update' : `update (${pkg.channel})`;
  }
}

function formatManagerSource(plan: UpdatePlanShape): string {
  return plan.managerDetail ? `${plan.managerSource}: ${plan.managerDetail}` : plan.managerSource;
}

export function formatJson(report: UpdateReport): string {
  return JSON.stringify(
    {
      ctxo: report.ctxo,
      channel: report.channel,
      packages: report.packages,
      plan: report.plan,
      executed: report.executed,
      ...(report.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
    },
    null,
    2,
  );
}

export interface UpdateOptions {
  readonly check?: boolean;
  readonly print?: boolean;
  readonly global?: boolean;
  readonly json?: boolean;
  readonly pm?: string;
  readonly force?: boolean;
}

export interface UpdateCommandDeps {
  readonly discoverInstalled?: (projectRoot: string) => Promise<ReadonlyArray<{ name: string; version: string }>>;
  readonly fetcher?: HttpsFetcher;
  readonly runner?: (command: string, args: readonly string[], cwd: string) => Promise<number>;
  readonly setExitCode?: (code: number) => void;
  readonly env?: NodeJS.ProcessEnv;
}

export class UpdateCommand {
  constructor(
    private readonly projectRoot: string,
    private readonly deps: UpdateCommandDeps = {},
  ) {}

  async run(options: UpdateOptions = {}): Promise<void> {
    if (options.pm && !isPackageManager(options.pm)) {
      this.emitError(`Unknown --pm value "${options.pm}".`);
      this.deps.setExitCode?.(1);
      return;
    }

    const discover = this.deps.discoverInstalled ?? defaultDiscoverInstalled;
    const installed = await discover(this.projectRoot);
    if (installed.length === 0) {
      this.emit(options.json ? '{}\n' : 'ctxo update — no @ctxo/* packages discovered.\n');
      return;
    }

    const names = installed.map((p) => p.name);
    const results = await fetchDistTagsBatch(names, { fetcher: this.deps.fetcher });

    const allMissed = results.every((r) => !('distTags' in r));
    if (allMissed) {
      this.emitError('registry unreachable for every package; aborting.');
      this.deps.setExitCode?.(1);
      return;
    }

    const states = computePackageStates(installed, results);
    const targets = selectInstallTargets(states);

    const cliVersion = getVersion();
    const channel = detectChannel(cliVersion);
    const plan = targets.length === 0 ? null : this.buildPlan(targets, options);
    const strategy = this.pickStrategy(targets, options);

    const baseReport: UpdateReport = {
      ctxo: cliVersion,
      channel,
      packages: states,
      plan,
      strategy,
      executed: false,
    };

    if (options.check) {
      // --check never executes, so render with the print-style block so the user
      // sees the suggested command instead of a misleading "Running..." line.
      const checkStrategy: UpdateStrategy = plan ? 'print' : strategy;
      this.emitReport({ ...baseReport, strategy: checkStrategy }, options.json ?? false);
      return;
    }

    if (strategy === 'none' || strategy === 'print' || !plan) {
      this.emitReport(baseReport, options.json ?? false);
      return;
    }

    if (!options.force && !options.global && isLockedCI(this.deps.env ?? process.env)) {
      this.emitReport({ ...baseReport, strategy: 'print' }, options.json ?? false);
      this.emitError('CI environment with frozen lockfile detected. Refusing to mutate. Use --force or --global.');
      this.deps.setExitCode?.(1);
      return;
    }

    if (!options.json) this.emitReport(baseReport, false);
    const run = this.deps.runner ?? runPackageManager;
    const code = await run(plan.command, plan.args, this.projectRoot);
    const finalReport: UpdateReport = { ...baseReport, executed: true, exitCode: code };
    if (options.json) this.emit(formatJson(finalReport) + '\n');
    if (code !== 0) this.deps.setExitCode?.(code);
  }

  private buildPlan(
    targets: ReadonlyArray<{ name: string; version: string }>,
    options: UpdateOptions,
  ): UpdatePlanShape {
    const resolution = resolvePackageManager({
      flag: options.pm,
      projectRoot: this.projectRoot,
      env: this.deps.env,
    });
    const specifiers = targets.map((t) => `${t.name}@${t.version}`);
    const useGlobal = options.global || !this.projectHasCtxoDep();
    const invocation = buildInstallCommand(resolution.manager, specifiers, {
      global: useGlobal,
      workspaceRoot: !useGlobal && isWorkspaceRoot(this.projectRoot),
    });
    return {
      manager: resolution.manager,
      managerSource: resolution.source,
      managerDetail: resolution.detail,
      global: useGlobal,
      command: invocation.command,
      args: invocation.args,
    };
  }

  private pickStrategy(
    targets: ReadonlyArray<{ name: string; version: string }>,
    options: UpdateOptions,
  ): UpdateStrategy {
    if (targets.length === 0) return 'none';
    if (options.print) return 'print';
    if (options.global) return 'execute';
    return this.projectHasCtxoDep() ? 'execute' : 'print';
  }

  private projectHasCtxoDep(): boolean {
    const pkg = join(this.projectRoot, 'package.json');
    if (!existsSync(pkg)) return false;
    try {
      const json = JSON.parse(readFileSync(pkg, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const merged = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
      return Object.keys(merged).some(
        (name) => name === CTXO_CLI_PACKAGE || name.startsWith('@ctxo/lang-') || name.startsWith('ctxo-lang-'),
      );
    } catch (err) {
      log.error(`failed to read project package.json: ${(err as Error).message}`);
      return false;
    }
  }

  private emit(text: string): void { process.stdout.write(text); }
  private emitError(text: string): void { process.stderr.write(`[ctxo] ${text}\n`); }

  private emitReport(report: UpdateReport, json: boolean): void {
    if (json) this.emit(formatJson(report) + '\n');
    else this.emit(formatText(report) + '\n');
  }
}

async function defaultDiscoverInstalled(projectRoot: string): Promise<ReadonlyArray<{ name: string; version: string }>> {
  const out: Array<{ name: string; version: string }> = [{ name: CTXO_CLI_PACKAGE, version: getVersion() }];
  const manifestPath = loadManifestPath(projectRoot);
  if (!manifestPath) return out;
  const { plugins } = await discoverPlugins({ manifestPath });
  for (const p of plugins) out.push({ name: p.specifier, version: p.plugin.version });
  return out;
}

function isLockedCI(env: NodeJS.ProcessEnv): boolean {
  return env['CI'] === 'true' || env['CI'] === '1';
}
