import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexCommand } from '../index-command.js';
import { VerifyCommand } from '../verify-command.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort — Windows file locks from simple-git / sqlite */
    }
  }
  tempDirs.length = 0;
});

function setupProject(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-verify-'));
  tempDirs.push(tempDir);

  mkdirSync(join(tempDir, 'src'), { recursive: true });
  writeFileSync(join(tempDir, 'src', 'foo.ts'), 'export function foo() { return 1; }');

  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'init'], { cwd: tempDir, stdio: 'ignore' });

  return tempDir;
}

describe('VerifyCommand', () => {
  it('exits 0 when index matches source files', async () => {
    const tempDir = setupProject();

    // Build index first
    const indexCmd = new IndexCommand(tempDir);
    await indexCmd.run();

    // Verify should pass
    const verifyCmd = new VerifyCommand(tempDir);

    // Mock process.exit to capture exit code
    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;

    try {
      await verifyCmd.run();
    } finally {
      process.exit = originalExit;
    }

    // Should not have called process.exit(1)
    expect(exitCode).toBeUndefined();
  });

  it('detects stale index when source file is modified after indexing', async () => {
    const tempDir = setupProject();

    // Build index
    const indexCmd = new IndexCommand(tempDir);
    await indexCmd.run();

    // Wait and modify source
    await new Promise((r) => setTimeout(r, 1100));
    // Add a NEW export so symbols actually change (verify compares symbols JSON)
    writeFileSync(join(tempDir, 'src', 'foo.ts'), 'export function foo() { return 2; }\nexport function bar() { return 3; }');

    // Verify should detect staleness
    const verifyCmd = new VerifyCommand(tempDir);

    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;

    try {
      await verifyCmd.run();
    } finally {
      process.exit = originalExit;
    }

    expect(exitCode).toBe(1);
  });

  it('does not modify the committed index directory', async () => {
    const tempDir = setupProject();

    // Build index
    const indexCmd = new IndexCommand(tempDir);
    await indexCmd.run();

    // Record index content before verify
    const indexPath = join(tempDir, '.ctxo', 'index', 'src', 'foo.ts.json');
    const before = readFileSync(indexPath, 'utf-8');

    // Modify source so verify will detect staleness
    await new Promise((r) => setTimeout(r, 1100));
    writeFileSync(join(tempDir, 'src', 'foo.ts'), 'export function foo() { return 999; }\nexport function newFn() {}');

    const originalExit = process.exit;
    process.exit = (() => {}) as never;

    try {
      await new VerifyCommand(tempDir).run();
    } finally {
      process.exit = originalExit;
    }

    // Committed index should NOT have been modified
    const after = readFileSync(indexPath, 'utf-8');
    expect(after).toBe(before);
  });
});
