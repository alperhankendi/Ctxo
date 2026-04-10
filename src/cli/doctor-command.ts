import { join } from 'node:path';
import type { IHealthCheck } from '../core/diagnostics/types.js';
import { HealthChecker } from '../adapters/diagnostics/health-checker.js';
import { DoctorReporter } from '../adapters/diagnostics/doctor-reporter.js';
import { NodeVersionCheck, TsMorphCheck, TreeSitterCheck } from '../adapters/diagnostics/checks/runtime-check.js';
import { GitBinaryCheck, GitRepoCheck } from '../adapters/diagnostics/checks/git-check.js';
import {
  IndexDirectoryCheck,
  IndexFreshnessCheck,
  SymbolCountCheck,
  EdgeCountCheck,
  OrphanedFilesCheck,
  CoChangesCacheCheck,
  SchemaVersionCheck,
} from '../adapters/diagnostics/checks/index-check.js';
import { SqliteCacheCheck } from '../adapters/diagnostics/checks/storage-check.js';
import { ConfigFileCheck } from '../adapters/diagnostics/checks/config-check.js';
import { DiskUsageCheck } from '../adapters/diagnostics/checks/disk-check.js';

export interface DoctorOptions {
  json?: boolean;
  quiet?: boolean;
}

export class DoctorCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(options: DoctorOptions = {}): Promise<void> {
    const checks: IHealthCheck[] = [
      new NodeVersionCheck(),
      new GitBinaryCheck(),
      new GitRepoCheck(),
      new IndexDirectoryCheck(),
      new IndexFreshnessCheck(),
      new SqliteCacheCheck(),
      new ConfigFileCheck(),
      new TsMorphCheck(),
      new TreeSitterCheck(),
      new DiskUsageCheck(),
      new SymbolCountCheck(),
      new EdgeCountCheck(),
      new OrphanedFilesCheck(),
      new CoChangesCacheCheck(),
      new SchemaVersionCheck(),
    ];

    const checker = new HealthChecker(checks);
    const report = await checker.runAll({
      projectRoot: this.projectRoot,
      ctxoRoot: this.ctxoRoot,
    });

    const reporter = new DoctorReporter();
    let output: string;

    if (options.json) {
      output = reporter.formatJson(report);
      process.stdout.write(output + '\n');
    } else if (options.quiet) {
      output = reporter.formatQuiet(report);
      console.error(output);
    } else {
      output = reporter.formatHuman(report);
      console.error(output);
    }

    if (report.exitCode !== 0) {
      process.exit(1);
    }
  }
}
