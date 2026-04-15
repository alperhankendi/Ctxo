import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexCommand } from '../index-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'sample-project');

function gitCommit(cwd: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync('git', [
    '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Test',
    '-c', 'user.email=test@test.com',
    'commit', '-m', message,
  ], { cwd, stdio: 'ignore' });
}

function setupProjectWithHistory(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-intent-'));

  cpSync(FIXTURES_DIR, tempDir, { recursive: true });

  // Commit 1: initial
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  gitCommit(tempDir, 'feat: initial commit');

  // Commit 2: modify a file
  writeFileSync(
    join(tempDir, 'src', 'utils.ts'),
    'export function formatName(name: string): string { return name.toUpperCase(); }\nexport const VERSION = "2.0.0";\n',
  );
  gitCommit(tempDir, 'feat: update formatName');

  // Commit 3: a revert commit
  writeFileSync(
    join(tempDir, 'src', 'utils.ts'),
    'export function formatName(name: string): string { return name.trim().toUpperCase(); }\nexport const VERSION = "1.0.0";\n',
  );
  gitCommit(tempDir, 'Revert "feat: update formatName"');

  return tempDir;
}

describe('IndexCommand — intent and antiPatterns (Issue #1)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = setupProjectWithHistory();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort — Windows file locks from simple-git / sqlite */
    }
  });

  it('populates intent with commit history for each indexed file', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const utilsIndex = join(tempDir, '.ctxo', 'index', 'src', 'utils.ts.json');
    const content = JSON.parse(readFileSync(utilsIndex, 'utf-8'));

    // utils.ts has 3 commits — intent should NOT be empty
    expect(content.intent.length).toBeGreaterThan(0);
    expect(content.intent[0].hash).toBeDefined();
    expect(content.intent[0].message).toBeDefined();
    expect(content.intent[0].date).toBeDefined();
    expect(content.intent[0].kind).toBe('commit');
  });

  it('populates antiPatterns when revert commits exist', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const utilsIndex = join(tempDir, '.ctxo', 'index', 'src', 'utils.ts.json');
    const content = JSON.parse(readFileSync(utilsIndex, 'utf-8'));

    // utils.ts has a 'Revert "..."' commit — antiPatterns should NOT be empty
    expect(content.antiPatterns.length).toBeGreaterThan(0);
    expect(content.antiPatterns[0].message).toContain('Revert');
  });

  it('files with no revert history have empty antiPatterns', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const greetIndex = join(tempDir, '.ctxo', 'index', 'src', 'greet.ts.json');
    const content = JSON.parse(readFileSync(greetIndex, 'utf-8'));

    // greet.ts has only 1 commit (initial) with no reverts
    expect(content.antiPatterns).toEqual([]);
    // But intent should still have the initial commit
    expect(content.intent.length).toBeGreaterThan(0);
  });
});
