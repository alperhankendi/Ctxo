import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { IHealthCheck } from '../core/diagnostics/types.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
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
    const { getVersion } = await import('./cli-router.js');
    console.error(`ctxo v${getVersion()} — health check\n`);

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

    // Pre-load index once — shared by all index-related checks (avoids 5x redundant readAll)
    const indexDir = join(this.ctxoRoot, 'index');
    const indices = existsSync(indexDir)
      ? new JsonIndexReader(this.ctxoRoot).readAll()
      : [];

    const checker = new HealthChecker(checks);
    const report = await checker.runAll({
      projectRoot: this.projectRoot,
      ctxoRoot: this.ctxoRoot,
      indices,
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
      process.exitCode = 1;
    }
  }
}
