import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHooksCheck } from '../checks/git-check.js';
import { InitCommand } from '../../../cli/init-command.js';
import { isolateGitEnv, type IsolatedGitEnv } from '../../../cli/__tests__/git-test-env.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

const V1_BLOCK = [
  '# ctxo-start',
  '# Incremental re-index on commit (only changed files)',
  'if command -v ctxo >/dev/null 2>&1; then',
  '  for file in $(git diff --name-only HEAD~1 HEAD 2>/dev/null); do',
  '    ctxo index --file "$file" 2>/dev/null || true',
  '  done',
  'fi',
  '# ctxo-end',
].join('\n');

const V2_BLOCK = [
  '# ctxo-start v2',
  '# Incremental re-index of the files changed by this commit (one run per commit)',
  'if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then',
  '  ctxo index --commit HEAD >/dev/null 2>&1 || true',
  'fi',
  '# ctxo-end',
].join('\n');

describe('GitHooksCheck', () => {
  const check = new GitHooksCheck();
  let gitEnv: IsolatedGitEnv;
  let tempDir: string;
  let ctx: CheckContext;

  beforeEach(() => {
    // Resolve against this test's own repo only: no inherited GIT_DIR, no global or system git config.
    gitEnv = isolateGitEnv();
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-hooks-check-'));
    execFileSync('git', ['init', '-q'], { cwd: tempDir });
    ctx = { projectRoot: tempDir, ctxoRoot: join(tempDir, '.ctxo') };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    gitEnv.restore();
  });

  function writePostCommit(content: string): void {
    writeFileSync(join(tempDir, '.git', 'hooks', 'post-commit'), content, 'utf-8');
  }

  it('has correct id and title', () => {
    expect(check.id).toBe('git_hooks');
    expect(check.title).toBe('Git hooks');
  });

  it('warns on a v1 block and passes on v2', async () => {
    writePostCommit(`#!/bin/sh\n\n${V1_BLOCK}\n`);
    const outdated = await check.run(ctx);
    expect(outdated.status).toBe('warn');
    expect(outdated.id).toBe('git_hooks');
    expect(outdated.message).toMatch(/v1|older|outdated/i);
    expect(outdated.fix).toContain('ctxo doctor --fix');

    writePostCommit(`#!/bin/sh\n\n${V2_BLOCK}\n`);
    const current = await check.run(ctx);
    expect(current.status).toBe('pass');
    expect(current.message).toContain('v2');
  });

  it('warns when the post-commit hook does not exist', async () => {
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/no ctxo post-commit hook/i);
    expect(result.fix).toContain('ctxo init');
  });

  it('warns when the post-commit hook has no ctxo block', async () => {
    writePostCommit('#!/bin/sh\necho "only mine"\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
  });

  it('warns on a ctxo-start marker that has no ctxo-end', async () => {
    writePostCommit('#!/bin/sh\n# ctxo-start v2\nctxo index --commit HEAD\n');
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
  });

  it('passes on a v2 block between user lines', async () => {
    writePostCommit(`#!/bin/sh\necho "before"\n\n${V2_BLOCK}\necho "after"\n`);
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('passes on a block newer than v2', async () => {
    writePostCommit(`#!/bin/sh\n${V2_BLOCK.replace('# ctxo-start v2', '# ctxo-start v3')}\n`);
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('passes after InitCommand.installHooks upgraded a v1 block', async () => {
    writePostCommit(`#!/bin/sh\n\n${V1_BLOCK}\n`);
    expect((await check.run(ctx)).status).toBe('warn');

    new InitCommand(tempDir).installHooks();

    expect((await check.run(ctx)).status).toBe('pass');
  });

  it('looks for the hook where core.hooksPath points', async () => {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: tempDir });
    writePostCommit(`#!/bin/sh\n\n${V2_BLOCK}\n`); // the default dir is no longer used by git
    expect((await check.run(ctx)).status).toBe('warn');

    mkdirSync(join(tempDir, '.githooks'));
    writeFileSync(join(tempDir, '.githooks', 'post-commit'), `#!/bin/sh\n\n${V2_BLOCK}\n`, 'utf-8');
    expect((await check.run(ctx)).status).toBe('pass');
  });

  it('warns when the post-commit hook holds more than one ctxo block', async () => {
    writePostCommit(`#!/bin/sh\n${V2_BLOCK}\necho "between"\n${V2_BLOCK}\n`);
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/2 ctxo/);
    expect(result.fix).toContain('ctxo doctor --fix');
  });

  it('does not take look-alike marker lines for a block', async () => {
    writePostCommit(`#!/bin/sh\n# ctxo-start v2\nctxo index --commit HEAD\n# ctxo-end-of-my-section\n`);
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/no ctxo post-commit hook/i);
  });

  describe('shared hooks directory (global or system core.hooksPath)', () => {
    let shared: string;

    beforeEach(() => {
      shared = mkdtempSync(join(tmpdir(), 'ctxo-hooks-check-shared-'));
      gitEnv.setGlobalHooksPath(shared);
    });

    afterEach(() => {
      rmSync(shared, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    it('warns with a message that explains the shared directory instead of plain "missing"', async () => {
      const result = await check.run(ctx);
      expect(result.status).toBe('warn');
      expect(result.message).toMatch(/shared/i);
      expect(result.message).toContain(shared.replace(/\\/g, '/'));
      expect(result.message).not.toMatch(/^No ctxo post-commit hook/);
      expect(result.fix).toMatch(/by hand/i);
      expect(readdirSync(shared)).toEqual([]);
    });

    it('still warns on an outdated block in the shared directory', async () => {
      writeFileSync(join(shared, 'post-commit'), `#!/bin/sh\n\n${V1_BLOCK}\n`, 'utf-8');
      const result = await check.run(ctx);
      expect(result.status).toBe('warn');
      expect(result.message).toMatch(/shared/i);
      expect(result.message).toMatch(/v1/);
    });

    it('passes once the current block was added by hand', async () => {
      writeFileSync(join(shared, 'post-commit'), `#!/bin/sh\n\n${V2_BLOCK}\n`, 'utf-8');
      expect((await check.run(ctx)).status).toBe('pass');
    });

    it('lets a repo-local core.hooksPath override the shared one', async () => {
      execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: tempDir });
      const result = await check.run(ctx);
      expect(result.status).toBe('warn');
      expect(result.message).not.toMatch(/shared/i);
    });
  });

  it('does not fail the doctor run outside a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'ctxo-hooks-check-nogit-'));
    try {
      const result = await check.run({ projectRoot: plain, ctxoRoot: join(plain, '.ctxo') });
      expect(result.status).toBe('pass');
      expect(result.message).toMatch(/not a git repository/i);
    } finally {
      rmSync(plain, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
