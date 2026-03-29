import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';

const CTXO_START = '# ctxo-start';
const CTXO_END = '# ctxo-end';

const POST_COMMIT_CONTENT = `
${CTXO_START}
# Incremental re-index on commit (only changed files)
if command -v ctxo >/dev/null 2>&1; then
  for file in $(git diff --name-only HEAD~1 HEAD 2>/dev/null); do
    ctxo index --file "$file" 2>/dev/null || true
  done
fi
${CTXO_END}
`.trim();

const POST_MERGE_CONTENT = `
${CTXO_START}
# Rebuild SQLite cache after merge (index updated via git pull)
if command -v ctxo >/dev/null 2>&1; then
  ctxo sync 2>/dev/null || true
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

    this.installHook(hooksDir, 'post-commit', POST_COMMIT_CONTENT);
    this.installHook(hooksDir, 'post-merge', POST_MERGE_CONTENT);

    console.error('[ctxo] Git hooks installed (post-commit, post-merge)');
  }

  private installHook(hooksDir: string, hookName: string, hookContent: string): void {
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
      ? existing + '\n' + hookContent + '\n'
      : existing + '\n\n' + hookContent + '\n';

    writeFileSync(hookPath, updated, 'utf-8');
    chmodSync(hookPath, 0o755);
  }
}
