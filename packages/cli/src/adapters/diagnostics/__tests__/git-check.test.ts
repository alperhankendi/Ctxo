import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitBinaryCheck, GitRepoCheck } from '../checks/git-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

describe('GitBinaryCheck', () => {
  const check = new GitBinaryCheck();
  const ctx: CheckContext = { projectRoot: '/tmp/test', ctxoRoot: '/tmp/test/.ctxo' };

  it('has correct id and title', () => {
    expect(check.id).toBe('git_binary');
    expect(check.title).toBe('Git available');
  });

  it('returns pass when git is installed', async () => {
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('git version');
  });

  it('includes git version in value', async () => {
    const result = await check.run(ctx);
    expect(result.value).toContain('git version');
  });
});

describe('GitRepoCheck', () => {
  const check = new GitRepoCheck();
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('has correct id and title', () => {
    expect(check.id).toBe('git_repo');
    expect(check.title).toBe('Git repository');
  });

  it('returns pass when .git directory exists', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-git-'));
    mkdirSync(join(tempDir, '.git'));
    const ctx: CheckContext = { projectRoot: tempDir, ctxoRoot: join(tempDir, '.ctxo') };
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.value).toBe(tempDir);
  });

  it('returns fail when .git directory is missing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-git-'));
    const ctx: CheckContext = { projectRoot: tempDir, ctxoRoot: join(tempDir, '.ctxo') };
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toBe('Not a git repository');
    expect(result.fix).toBeTruthy();
  });
});
