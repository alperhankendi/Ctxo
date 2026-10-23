import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';
import {
  POST_COMMIT_HOOK_VERSION,
  forwardSlashes,
  readCtxoBlockVersions,
  resolveHooksDir,
  sharedHooksScope,
} from '../../../cli/git-hooks.js';

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

/**
 * Reports whether the post-commit hook carries exactly one, current ctxo block. A missing, older
 * (the unversioned v1 block re-indexed once per changed file) or duplicated block is a warn;
 * `ctxo doctor --fix` and `ctxo init` repair it in place. When `core.hooksPath` comes from the
 * global or system git config the directory is shared by every repository and ctxo never writes
 * there, so the warn explains that and the fix is manual; a current block added by hand passes.
 */
export class GitHooksCheck implements IHealthCheck {
  readonly id = 'git_hooks';
  readonly title = 'Git hooks';

  async run(ctx: CheckContext): Promise<CheckResult> {
    // Without a repository there is nothing to install into; git_repo already reports that as a fail.
    if (!existsSync(join(ctx.projectRoot, '.git'))) {
      return { id: this.id, title: this.title, status: 'pass', message: 'Not a git repository (hooks not applicable)' };
    }

    const hooksDir = resolveHooksDir(ctx.projectRoot);
    const hookPath = join(hooksDir, 'post-commit');
    let versions: number[];
    try {
      versions = readCtxoBlockVersions(readFileSync(hookPath, 'utf-8'));
    } catch {
      versions = []; // no hook file (or unreadable): same as no ctxo block
    }

    const version = versions[0];
    if (versions.length === 1 && version !== undefined && version >= POST_COMMIT_HOOK_VERSION) {
      return {
        id: this.id,
        title: this.title,
        status: 'pass',
        message: `ctxo post-commit hook v${version}`,
        value: `v${version}`,
      };
    }

    const sharedScope = sharedHooksScope(ctx.projectRoot);
    if (sharedScope) {
      const problem =
        versions.length > 1
          ? `${versions.length} ctxo blocks in post-commit (expected 1)`
          : version === undefined
            ? 'no ctxo block in post-commit'
            : `outdated ctxo block in post-commit (v${version}, current v${POST_COMMIT_HOOK_VERSION})`;
      return {
        id: this.id,
        title: this.title,
        status: 'warn',
        message: `Shared hooks directory ${forwardSlashes(hooksDir)} (${sharedScope} core.hooksPath): ${problem}; ctxo does not write there`,
        fix: `Add the current ctxo post-commit block to ${forwardSlashes(hookPath)} by hand (run "ctxo init" to print it), or set a repo-local core.hooksPath`,
        ...(version !== undefined ? { value: `v${version}` } : {}),
      };
    }

    if (versions.length > 1) {
      return {
        id: this.id,
        title: this.title,
        status: 'warn',
        message: `${versions.length} ctxo blocks in the post-commit hook (expected 1); the hook runs ctxo once per block`,
        fix: 'Run "ctxo doctor --fix" or "ctxo init" to collapse them into one block',
      };
    }
    if (version === undefined) {
      return {
        id: this.id,
        title: this.title,
        status: 'warn',
        message: `No ctxo post-commit hook (${hookPath})`,
        fix: 'Run "ctxo init" or "ctxo doctor --fix" to install the post-commit hook',
      };
    }
    return {
      id: this.id,
      title: this.title,
      status: 'warn',
      message: `Outdated ctxo post-commit hook (v${version}, current v${POST_COMMIT_HOOK_VERSION})`,
      fix: 'Run "ctxo doctor --fix" or "ctxo init" to upgrade the post-commit hook',
      value: `v${version}`,
    };
  }
}
