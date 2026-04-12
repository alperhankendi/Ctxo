import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SimpleGitAdapter } from '../simple-git-adapter.js';

function setupGitRepo(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-git-'));

  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });

  writeFileSync(join(tempDir, 'foo.ts'), 'export function foo() {}', 'utf-8');
  execFileSync('git', ['add', '.'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'initial commit'], { cwd: tempDir, stdio: 'ignore' });

  writeFileSync(join(tempDir, 'foo.ts'), 'export function foo() { return 1; }', 'utf-8');
  execFileSync('git', ['add', '.'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'Revert "add caching"'], { cwd: tempDir, stdio: 'ignore' });

  return tempDir;
}

describe('SimpleGitAdapter', () => {
  let tempDir: string;
  let adapter: SimpleGitAdapter;

  beforeEach(() => {
    tempDir = setupGitRepo();
    adapter = new SimpleGitAdapter(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts commit history for a file with correct fields', async () => {
    const history = await adapter.getCommitHistory('foo.ts');
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]?.hash).toBeDefined();
    expect(history[0]?.message).toBeDefined();
    expect(history[0]?.date).toBeDefined();
    expect(history[0]?.author).toBe('Test');
  });

  it('returns empty array for file with no commits', async () => {
    const history = await adapter.getCommitHistory('nonexistent.ts');
    expect(history).toEqual([]);
  });

  it('counts file churn (number of commits touching file)', async () => {
    const churn = await adapter.getFileChurn('foo.ts');
    expect(churn.filePath).toBe('foo.ts');
    expect(churn.commitCount).toBeGreaterThanOrEqual(2);
  });

  it('returns zero churn for nonexistent file', async () => {
    const churn = await adapter.getFileChurn('nonexistent.ts');
    expect(churn.commitCount).toBe(0);
  });

  it('reports git as available', async () => {
    expect(await adapter.isAvailable()).toBe(true);
  });
});

describe('SimpleGitAdapter — invalid directory', () => {
  it('throws when constructed with nonexistent directory', () => {
    expect(() => new SimpleGitAdapter('/nonexistent/path/that/does/not/exist'))
      .toThrow('does not exist');
  });
});
