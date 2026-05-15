import type { PackageManager, Resolution } from '../core/install/package-manager.js';
import type { PackageState, Channel } from '../core/update/update-plan.js';

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
