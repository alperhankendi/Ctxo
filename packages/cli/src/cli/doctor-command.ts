import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { IHealthCheck } from '../core/diagnostics/types.js';
import type { LoadedModule } from '../adapters/modules/module-loader.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { HealthChecker } from '../adapters/diagnostics/health-checker.js';
import { DoctorReporter } from '../adapters/diagnostics/doctor-reporter.js';
import { NodeVersionCheck, TsMorphCheck, TreeSitterCheck } from '../adapters/diagnostics/checks/runtime-check.js';
import { VersionsCheck } from '../adapters/diagnostics/checks/versions-check.js';
import { LanguageCoverageCheck } from '../adapters/diagnostics/checks/language-coverage-check.js';
import { JavaTierCheck } from '../adapters/diagnostics/checks/java-tier-check.js';
import { CSharpTierCheck } from '../adapters/diagnostics/checks/csharp-tier-check.js';
import { GitBinaryCheck, GitRepoCheck, GitHooksCheck } from '../adapters/diagnostics/checks/git-check.js';
import { AiRulesCheck, SkillsCheck, ClaudeGuardHookCheck } from '../adapters/diagnostics/checks/agent-setup-check.js';
import { InstallCopiesCheck } from '../adapters/diagnostics/checks/install-copies-check.js';
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
import { applyFixes, formatFixReport } from './doctor-fix.js';
import { getVersion } from './cli-paths.js';

export interface DoctorOptions {
  json?: boolean;
  quiet?: boolean;
  fix?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  /** Loaded opt-in modules (@ctxo/domain); their doctor checks run after the core checks. */
  modules?: readonly LoadedModule[];
}

export class DoctorCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(options: DoctorOptions = {}): Promise<void> {
    console.error(`ctxo v${getVersion()} — health check\n`);
    // A loaded @ctxo/domain adds the domain line to the expected rules block (#191).
    const domain = (options.modules ?? []).some((module) => module.registration.id === 'domain');

    const checks: IHealthCheck[] = [
      new VersionsCheck(),
      new NodeVersionCheck(),
      new GitBinaryCheck(),
      new GitRepoCheck(),
      new GitHooksCheck(),
      new AiRulesCheck({ domain }),
      new SkillsCheck(),
      new ClaudeGuardHookCheck(),
      new InstallCopiesCheck(),
      new IndexDirectoryCheck(),
      new IndexFreshnessCheck(),
      new SqliteCacheCheck(),
      new ConfigFileCheck(),
      new TsMorphCheck(),
      new TreeSitterCheck(),
      new LanguageCoverageCheck(),
      new JavaTierCheck(),
      new CSharpTierCheck(),
      new DiskUsageCheck(),
      new SymbolCountCheck(),
      new EdgeCountCheck(),
      new OrphanedFilesCheck(),
      new CoChangesCacheCheck(),
      new SchemaVersionCheck(),
      // Module checks last, so the core report reads the same with or without a module.
      ...(options.modules ?? []).flatMap((module) => module.registration.doctorChecks ?? []),
    ];

    // Pre-load index once — shared by all index-related checks (avoids 5x redundant readAll)
    const indexDir = join(this.ctxoRoot, 'index');
    const indices = existsSync(indexDir)
      ? new JsonIndexReader(this.ctxoRoot).readAll()
      : [];

    const checker = new HealthChecker(checks, { quiet: Boolean(options.quiet) });
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

    if (options.fix) {
      console.error('');
      console.error(options.dryRun ? '[ctxo] --fix --dry-run: planned actions' : '[ctxo] --fix: applying remediation');
      const fixReport = await applyFixes(report, {
        projectRoot: this.projectRoot,
        ctxoRoot: this.ctxoRoot,
        yes: options.yes,
        dryRun: options.dryRun,
        domain,
        moduleFixes: (options.modules ?? []).flatMap((module) => module.registration.doctorFixes ?? []),
      });
      console.error(formatFixReport(fixReport));
      if (fixReport.halted) {
        process.exitCode = 2;
      }
      return;
    }

    if (report.exitCode !== 0) {
      process.exitCode = 1;
    }
  }
}
