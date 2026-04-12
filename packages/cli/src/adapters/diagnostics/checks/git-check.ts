import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';

export class GitBinaryCheck implements IHealthCheck {
  readonly id = 'git_binary';
  readonly title = 'Git available';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      const version = execFileSync('git', ['--version'], { encoding: 'utf-8' }).trim();
      return { id: this.id, title: this.title, status: 'pass', message: version, value: version };
    } catch {
      return { id: this.id, title: this.title, status: 'fail', message: 'git not found in PATH', fix: 'Install git and ensure it is in your PATH' };
    }
  }
}

export class GitRepoCheck implements IHealthCheck {
  readonly id = 'git_repo';
  readonly title = 'Git repository';

  async run(ctx: CheckContext): Promise<CheckResult> {
    if (existsSync(join(ctx.projectRoot, '.git'))) {
      return { id: this.id, title: this.title, status: 'pass', message: ctx.projectRoot, value: ctx.projectRoot };
    }
    return { id: this.id, title: this.title, status: 'fail', message: 'Not a git repository', fix: 'Run "git init" or clone a repository' };
  }
}
