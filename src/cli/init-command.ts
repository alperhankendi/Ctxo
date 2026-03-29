import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';

const CTXO_START = '# ctxo-start';
const CTXO_END = '# ctxo-end';

const HOOK_CONTENT = `
${CTXO_START}
# Auto-index on commit (runs ctxo index if available)
if command -v ctxo >/dev/null 2>&1; then
  ctxo index 2>/dev/null || true
fi
${CTXO_END}
`.trim();

export class InitCommand {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  run(): void {
    const hooksDir = join(this.projectRoot, '.git', 'hooks');

    if (!existsSync(join(this.projectRoot, '.git'))) {
      console.error('[ctxo] Not a git repository. Run "git init" first.');
      process.exit(1);
    }

    mkdirSync(hooksDir, { recursive: true });

    this.installHook(hooksDir, 'post-commit');
    this.installHook(hooksDir, 'post-merge');

    console.error('[ctxo] Git hooks installed (post-commit, post-merge)');
  }

  private installHook(hooksDir: string, hookName: string): void {
    const hookPath = join(hooksDir, hookName);

    let existing = '';
    if (existsSync(hookPath)) {
      existing = readFileSync(hookPath, 'utf-8');

      // Already installed — idempotent
      if (existing.includes(CTXO_START)) {
        console.error(`[ctxo] ${hookName} hook already has ctxo block — skipping`);
        return;
      }
    } else {
      existing = '#!/bin/sh\n';
    }

    // Append ctxo block
    const updated = existing.endsWith('\n')
      ? existing + '\n' + HOOK_CONTENT + '\n'
      : existing + '\n\n' + HOOK_CONTENT + '\n';

    writeFileSync(hookPath, updated, 'utf-8');
    chmodSync(hookPath, 0o755);
  }
}
