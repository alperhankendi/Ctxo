import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InitCommand } from '../init-command.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function createGitDir(tempDir: string): void {
  mkdirSync(join(tempDir, '.git', 'hooks'), { recursive: true });
}

describe('InitCommand', () => {
  it('installs post-commit and post-merge git hooks', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-init-'));
    tempDirs.push(tempDir);
    createGitDir(tempDir);

    new InitCommand(tempDir).run();

    expect(existsSync(join(tempDir, '.git', 'hooks', 'post-commit'))).toBe(true);
    expect(existsSync(join(tempDir, '.git', 'hooks', 'post-merge'))).toBe(true);
  });

  it('preserves existing hook content (appends ctxo block)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-init2-'));
    tempDirs.push(tempDir);
    createGitDir(tempDir);

    // Write existing hook
    const hookPath = join(tempDir, '.git', 'hooks', 'post-commit');
    const existingContent = '#!/bin/sh\necho "existing hook"\n';
    require('fs').writeFileSync(hookPath, existingContent, 'utf-8');

    new InitCommand(tempDir).run();

    const result = readFileSync(hookPath, 'utf-8');
    expect(result).toContain('existing hook');
    expect(result).toContain('# ctxo-start');
    expect(result).toContain('# ctxo-end');
  });

  it('is idempotent — running twice does not duplicate ctxo block', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-init3-'));
    tempDirs.push(tempDir);
    createGitDir(tempDir);

    new InitCommand(tempDir).run();
    new InitCommand(tempDir).run();

    const hookContent = readFileSync(join(tempDir, '.git', 'hooks', 'post-commit'), 'utf-8');
    const startCount = (hookContent.match(/# ctxo-start/g) ?? []).length;
    expect(startCount).toBe(1);
  });

  it('uses # ctxo-start / # ctxo-end markers', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-init4-'));
    tempDirs.push(tempDir);
    createGitDir(tempDir);

    new InitCommand(tempDir).run();

    const hookContent = readFileSync(join(tempDir, '.git', 'hooks', 'post-commit'), 'utf-8');
    expect(hookContent).toContain('# ctxo-start');
    expect(hookContent).toContain('# ctxo-end');
  });
});
