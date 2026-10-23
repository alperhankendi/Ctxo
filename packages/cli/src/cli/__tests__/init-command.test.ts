import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { InitCommand, type InitOptions } from '../init-command.js';
import { PLATFORMS, resolveRulesTier } from '../ai-rules.js';
import { AiRulesCheck } from '../../adapters/diagnostics/checks/agent-setup-check.js';
import * as gitHooks from '../git-hooks.js';
import {
  LEGACY_CURSOR_FRONTMATTER,
  LEGACY_RULE_BODY,
  blockTier,
  renderRulesBlock,
  ruleBody,
  scanRulesBlocks,
} from '../../core/agent-rules/rules-block.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

const tempDirs: string[] = [];
let gitEnv: IsolatedGitEnv;

/** A CLAUDE.md written by a ctxo version before the tiers: an unversioned marked block. */
const PRE_TIER_CLAUDE_MD = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';

/** The warning init prints for a rules file that `rulesHold` keeps back. */
function heldWarning(file: string): string {
  return `[ctxo] ⚠ ${file}: left unchanged until the guard and skills are installed; run "ctxo init --only rules,skills,guard" or "ctxo doctor --fix"`;
}

// Hook tests resolve `git rev-parse --git-path hooks` in temp repos; they must never see the
// owner's GIT_DIR or global/system git config (see git-test-env.ts).
beforeEach(() => {
  gitEnv = isolateGitEnv();
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  tempDirs.length = 0;
  gitEnv.restore();
});

/** A real, empty git repository in the OS temp dir. Hook tests never touch any other repository. */
function makeTempProject(prefix = 'ctxo-init-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/** The post-commit block that every v1 install wrote (unversioned `# ctxo-start`). */
const V1_POST_COMMIT_BLOCK = [
  '# ctxo-start',
  '# Incremental re-index on commit (only changed files)',
  'if command -v ctxo >/dev/null 2>&1; then',
  '  for file in $(git diff --name-only HEAD~1 HEAD 2>/dev/null); do',
  '    ctxo index --file "$file" 2>/dev/null || true',
  '  done',
  'fi',
  '# ctxo-end',
].join('\n');

/** Spec 6.3, verbatim: guarded on a `.ctxo` directory so a shared hooks dir stays harmless in other repos. */
const V2_POST_COMMIT_BLOCK = [
  '# ctxo-start v2',
  '# Incremental re-index of the files changed by this commit (one run per commit)',
  'if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then',
  '  ctxo index --commit HEAD >/dev/null 2>&1 || true',
  'fi',
  '# ctxo-end',
].join('\n');

/** The post-merge block: unversioned marker, same `.ctxo` guard. */
const POST_MERGE_BLOCK = [
  '# ctxo-start',
  '# Rebuild SQLite cache after merge (index updated via git pull)',
  'if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then',
  '  ctxo sync 2>/dev/null || true',
  'fi',
  '# ctxo-end',
].join('\n');

/** The post-merge block as earlier builds wrote it (no `.ctxo` guard). */
const UNGUARDED_POST_MERGE_BLOCK = [
  '# ctxo-start',
  '# Rebuild SQLite cache after merge (index updated via git pull)',
  'if command -v ctxo >/dev/null 2>&1; then',
  '  ctxo sync 2>/dev/null || true',
  'fi',
  '# ctxo-end',
].join('\n');

function hookPath(dir: string, name = 'post-commit'): string {
  return join(dir, '.git', 'hooks', name);
}

describe('InitCommand — hook installation', () => {
  it('installs post-commit and post-merge git hooks', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();

    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(true);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-merge'))).toBe(true);
  });

  it('installHooks writes the v2 block calling ctxo index --commit HEAD once', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();

    const content = readFileSync(hookPath(dir), 'utf-8');
    expect(content).toBe(`#!/bin/sh\n\n${V2_POST_COMMIT_BLOCK}\n`);
    expect(content.match(/ctxo index --commit HEAD/g)).toHaveLength(1);
    expect(content).not.toContain('ctxo index --file');
    expect(content).not.toContain('\r');
  });

  it('installHooks replaces an old v1 block and keeps user lines before and after it', () => {
    const dir = makeTempProject();
    const before = '#!/bin/sh\necho "before"\n\n';
    const after = '\necho "after"\nexit 0\n';
    writeFileSync(hookPath(dir), before + V1_POST_COMMIT_BLOCK + after, 'utf-8');

    new InitCommand(dir).installHooks();

    const content = readFileSync(hookPath(dir), 'utf-8');
    expect(content).toBe(before + V2_POST_COMMIT_BLOCK + after);
    expect(content).not.toContain('ctxo index --file');
    expect(content.match(/# ctxo-start/g) ?? []).toHaveLength(1);
  });

  it('installHooks replaces a v1 block that ends the file without a trailing newline', () => {
    const dir = makeTempProject();
    const before = '#!/bin/sh\necho "before"\n';
    writeFileSync(hookPath(dir), before + V1_POST_COMMIT_BLOCK, 'utf-8');

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir), 'utf-8')).toBe(before + V2_POST_COMMIT_BLOCK);
  });

  it('installHooks is idempotent', () => {
    const dir = makeTempProject();
    writeFileSync(hookPath(dir), `#!/bin/sh\necho "mine"\n\n${V1_POST_COMMIT_BLOCK}\necho "tail"\n`, 'utf-8');

    new InitCommand(dir).installHooks();
    const firstPostCommit = readFileSync(hookPath(dir), 'utf-8');
    const firstPostMerge = readFileSync(hookPath(dir, 'post-merge'), 'utf-8');
    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir), 'utf-8')).toBe(firstPostCommit);
    expect(readFileSync(hookPath(dir, 'post-merge'), 'utf-8')).toBe(firstPostMerge);
  });

  it('installHooks honours core.hooksPath', () => {
    const dir = makeTempProject();
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });

    new InitCommand(dir).installHooks();

    const custom = readFileSync(join(dir, '.githooks', 'post-commit'), 'utf-8');
    expect(custom).toContain(V2_POST_COMMIT_BLOCK);
    expect(existsSync(join(dir, '.githooks', 'post-merge'))).toBe(true);
    expect(existsSync(hookPath(dir))).toBe(false);
  });

  it('installHooks honours an absolute core.hooksPath', () => {
    const dir = makeTempProject();
    const shared = mkdtempSync(join(tmpdir(), 'ctxo-shared-hooks-'));
    tempDirs.push(shared);
    execFileSync('git', ['config', 'core.hooksPath', shared], { cwd: dir });

    new InitCommand(dir).installHooks();

    expect(readFileSync(join(shared, 'post-commit'), 'utf-8')).toContain(V2_POST_COMMIT_BLOCK);
    expect(existsSync(hookPath(dir))).toBe(false);
  });

  it('installHooks falls back to .git/hooks when git cannot answer', () => {
    // An empty `.git` directory is not a repository, so `git rev-parse` fails inside it.
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-init-nogit-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, '.git'));

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir), 'utf-8')).toContain(V2_POST_COMMIT_BLOCK);
  });

  // POSIX mode bits do not exist on Windows.
  it.skipIf(process.platform === 'win32')('installHooks keeps hook files executable', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();

    expect(statSync(hookPath(dir)).mode & 0o111).not.toBe(0);
    expect(statSync(hookPath(dir, 'post-merge')).mode & 0o111).not.toBe(0);
  });

  it.skipIf(process.platform === 'win32')('installHooks makes a current but non-executable hook executable', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();
    chmodSync(hookPath(dir), 0o644);
    chmodSync(hookPath(dir, 'post-merge'), 0o644);
    const before = readFileSync(hookPath(dir), 'utf-8');

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir), 'utf-8')).toBe(before);
    expect(statSync(hookPath(dir)).mode & 0o111).not.toBe(0);
    expect(statSync(hookPath(dir, 'post-merge')).mode & 0o111).not.toBe(0);
  });

  /**
   * Runs `git commit` in `dir` with a stand-in `ctxo` first on PATH. The hook resolves it through
   * `command -v ctxo`; the stand-in appends its arguments to the returned log file.
   */
  function makeCommitter(dir: string): { commit(files: string[]): void; calls(): string[] } {
    const binDir = mkdtempSync(join(tmpdir(), 'ctxo-fake-bin-'));
    tempDirs.push(binDir);
    const logFile = join(binDir, 'ctxo.log');
    writeFileSync(join(binDir, 'ctxo'), '#!/bin/sh\necho "$@" >> "$CTXO_LOG"\n', { mode: 0o755 });
    const env = { ...process.env, CTXO_LOG: logFile, PATH: `${binDir}${delimiter}${process.env['PATH'] ?? ''}` };
    return {
      commit(files: string[]): void {
        for (const name of files) writeFileSync(join(dir, name), name, 'utf-8');
        execFileSync('git', ['add', '-A'], { cwd: dir, env });
        execFileSync(
          'git',
          ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-q', '-m', files.join(' ')],
          { cwd: dir, env },
        );
      },
      calls(): string[] {
        return existsSync(logFile) ? readFileSync(logFile, 'utf-8').trim().split('\n') : [];
      },
    };
  }

  it('the installed post-commit hook runs ctxo index --commit HEAD once for a multi-file commit', () => {
    const dir = makeTempProject();
    mkdirSync(join(dir, '.ctxo'));
    const committer = makeCommitter(dir);
    new InitCommand(dir).installHooks();

    committer.commit(['a.txt', 'b.txt', 'c.txt']);

    expect(committer.calls()).toEqual(['index --commit HEAD']);
  });

  it('the installed post-commit hook does not call ctxo without a .ctxo directory, and calls it once with one', () => {
    const dir = makeTempProject();
    const committer = makeCommitter(dir);
    new InitCommand(dir).installHooks();

    committer.commit(['a.txt', 'b.txt']);
    expect(committer.calls()).toEqual([]);

    mkdirSync(join(dir, '.ctxo'));
    committer.commit(['c.txt', 'd.txt']);
    expect(committer.calls()).toEqual(['index --commit HEAD']);
  });

  it('installHooks upgrades an unguarded post-merge block to the .ctxo-guarded one', () => {
    const dir = makeTempProject();
    const before = '#!/bin/sh\necho "merge start"\n\n';
    const after = '\necho "merge end"\n';
    writeFileSync(hookPath(dir, 'post-merge'), before + UNGUARDED_POST_MERGE_BLOCK + after, 'utf-8');

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir, 'post-merge'), 'utf-8')).toBe(before + POST_MERGE_BLOCK + after);
  });

  it('installHooks replaces every ctxo block, leaving one block and every user line', () => {
    const dir = makeTempProject();
    const content = [
      '#!/bin/sh',
      'echo "first user line"',
      V1_POST_COMMIT_BLOCK,
      'echo "between the blocks"',
      V1_POST_COMMIT_BLOCK,
      'echo "last user line"',
      '',
    ].join('\n');
    writeFileSync(hookPath(dir), content, 'utf-8');

    new InitCommand(dir).installHooks();

    const result = readFileSync(hookPath(dir), 'utf-8');
    expect(result.match(/# ctxo-start/g) ?? []).toHaveLength(1);
    expect(result.match(/# ctxo-end/g) ?? []).toHaveLength(1);
    expect(result.match(/ctxo index --commit HEAD/g) ?? []).toHaveLength(1);
    expect(result).not.toContain('ctxo index --file');
    for (const line of ['echo "first user line"', 'echo "between the blocks"', 'echo "last user line"']) {
      expect(result).toContain(line);
    }
    // File order is kept: the surviving block sits where the first block stood.
    expect(result.indexOf('first user line')).toBeLessThan(result.indexOf('# ctxo-start v2'));
    expect(result.indexOf('# ctxo-start v2')).toBeLessThan(result.indexOf('between the blocks'));
    expect(result.indexOf('between the blocks')).toBeLessThan(result.indexOf('last user line'));
  });

  it('installHooks ignores look-alike marker lines (ctxo-end-of-my-section, ctxo-startup)', () => {
    const dir = makeTempProject();
    // `# ctxo-end-of-my-section` is not an end marker, so this start marker is dangling.
    const original = [
      '#!/bin/sh',
      '# ctxo-start',
      'echo "inside the dangling section"',
      '# ctxo-end-of-my-section',
      '# ctxo-startup notes',
      'echo "tail"',
      '',
    ].join('\n');
    writeFileSync(hookPath(dir), original, 'utf-8');

    new InitCommand(dir).installHooks();
    const once = readFileSync(hookPath(dir), 'utf-8');
    new InitCommand(dir).installHooks();

    expect(once.startsWith(original)).toBe(true);
    expect(once).toContain(V2_POST_COMMIT_BLOCK);
    expect(readFileSync(hookPath(dir), 'utf-8')).toBe(once);
  });

  it('installHooks matches marker lines with trailing blanks and CRLF line endings', () => {
    const dir = makeTempProject();
    const before = '#!/bin/sh\r\necho "before"\r\n';
    const after = '\r\necho "after"\r\n';
    const crlfV1 = V1_POST_COMMIT_BLOCK.replace('# ctxo-start', '# ctxo-start  ').replace(/\n/g, '\r\n');
    writeFileSync(hookPath(dir), before + crlfV1 + after, 'utf-8');

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir), 'utf-8')).toBe(before + V2_POST_COMMIT_BLOCK + after);
  });

  it('installHooks leaves an up-to-date post-merge block byte for byte as it was', () => {
    const dir = makeTempProject();
    const before = '#!/bin/sh\necho "merge start"\n\n';
    const after = '\necho "merge end"\n';
    writeFileSync(hookPath(dir, 'post-merge'), before + POST_MERGE_BLOCK + after, 'utf-8');

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir, 'post-merge'), 'utf-8')).toBe(before + POST_MERGE_BLOCK + after);
  });

  it('installHooks replaces an edited post-merge block in place', () => {
    const dir = makeTempProject();
    const before = '#!/bin/sh\necho "merge start"\n\n';
    const after = '\necho "merge end"\n';
    const stale = '# ctxo-start\nctxo sync --legacy\n# ctxo-end';
    writeFileSync(hookPath(dir, 'post-merge'), before + stale + after, 'utf-8');

    new InitCommand(dir).installHooks();

    expect(readFileSync(hookPath(dir, 'post-merge'), 'utf-8')).toBe(before + POST_MERGE_BLOCK + after);
  });

  it('installHooks keeps user lines when a ctxo-start marker has no matching ctxo-end', () => {
    const dir = makeTempProject();
    writeFileSync(hookPath(dir), '#!/bin/sh\n# ctxo-start\necho "user line that must survive"\n', 'utf-8');

    new InitCommand(dir).installHooks();
    const once = readFileSync(hookPath(dir), 'utf-8');
    new InitCommand(dir).installHooks();
    const twice = readFileSync(hookPath(dir), 'utf-8');

    expect(once).toContain('echo "user line that must survive"');
    expect(once).toContain(V2_POST_COMMIT_BLOCK);
    expect(twice).toBe(once);
  });

  it('preserves existing hook content (appends ctxo block)', () => {
    const dir = makeTempProject();
    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "existing hook"\n', 'utf-8');

    new InitCommand(dir).installHooks();

    const result = readFileSync(hookPath, 'utf-8');
    expect(result).toContain('existing hook');
    expect(result).toContain('# ctxo-start');
    expect(result).toContain('# ctxo-end');
  });

  it('is idempotent — running twice does not duplicate ctxo block', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();
    new InitCommand(dir).installHooks();

    const content = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf-8');
    const startCount = (content.match(/# ctxo-start/g) ?? []).length;
    expect(startCount).toBe(1);
  });

  it('uses # ctxo-start / # ctxo-end markers', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();

    const content = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf-8');
    expect(content).toContain('# ctxo-start');
    expect(content).toContain('# ctxo-end');
  });
});

describe('InitCommand - shared hooks directory (global or system core.hooksPath)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
  }

  function makeSharedHooksDir(): string {
    const shared = mkdtempSync(join(tmpdir(), 'ctxo-shared-hooks-'));
    tempDirs.push(shared);
    return shared;
  }

  it('installHooks does not write into a core.hooksPath from the global git config, and warns', () => {
    const dir = makeTempProject();
    const shared = makeSharedHooksDir();
    gitEnv.setGlobalHooksPath(shared);

    const result = new InitCommand(dir).installHooks();

    expect(result.installed).toBe(false);
    expect(readdirSync(shared)).toEqual([]);
    expect(existsSync(hookPath(dir))).toBe(false);
    const warning = stderr();
    expect(warning).toMatch(/shared by every repo/);
    expect(warning).toContain(shared.replace(/\\/g, '/'));
    expect(warning).toContain('by hand');
    expect(warning).toContain(V2_POST_COMMIT_BLOCK);
    expect(warning).toContain(POST_MERGE_BLOCK);
  });

  it('installHooks does not write into a core.hooksPath from the system git config either', () => {
    const dir = makeTempProject();
    const shared = makeSharedHooksDir();
    gitEnv.setSystemHooksPath(shared);

    const result = new InitCommand(dir).installHooks();

    expect(result.installed).toBe(false);
    expect(readdirSync(shared)).toEqual([]);
    expect(stderr()).toMatch(/shared by every repo/);
  });

  it('installHooks still honours a repo-local core.hooksPath that overrides a global one', () => {
    const dir = makeTempProject();
    gitEnv.setGlobalHooksPath(makeSharedHooksDir());
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: dir });

    const result = new InitCommand(dir).installHooks();

    expect(result.installed).toBe(true);
    expect(readFileSync(join(dir, '.githooks', 'post-commit'), 'utf-8')).toContain(V2_POST_COMMIT_BLOCK);
    expect(stderr()).not.toMatch(/shared by every repo/);
  });

  it('non-interactive init continues past a shared hooks directory: scaffolding done, no hooks, no failure exit', async () => {
    const dir = makeTempProject();
    const shared = makeSharedHooksDir();
    gitEnv.setGlobalHooksPath(shared);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    try {
      await new InitCommand(dir).run({ yes: true, noInstall: true });
    } finally {
      exitSpy.mockRestore();
    }

    expect(existsSync(join(dir, '.ctxo', 'index'))).toBe(true);
    expect(readdirSync(shared)).toEqual([]);
    expect(stderr()).toMatch(/shared by every repo/);
    // No hook row is reported as written: the summary keeps only the skip.
    expect(stderr()).not.toMatch(/post-(commit|merge) \((created|updated|unchanged)\)/);
    expect(stderr()).toContain('git hooks skipped - shared hooks directory (see warning above)');
  });

  it('--dry-run says the hooks would be skipped for a shared hooks directory', async () => {
    const dir = makeTempProject();
    const shared = makeSharedHooksDir();
    gitEnv.setGlobalHooksPath(shared);

    await new InitCommand(dir).run({ tools: ['windsurf'], dryRun: true });

    expect(stderr()).toContain(shared.replace(/\\/g, '/'));
    expect(stderr()).toMatch(/skipped/i);
    expect(readdirSync(shared)).toEqual([]);
  });

  it('--dry-run gives no would-create hook rows for a refused shared hooks directory', async () => {
    const dir = makeTempProject();
    gitEnv.setGlobalHooksPath(makeSharedHooksDir());

    await new InitCommand(dir).run({ tools: ['windsurf'], dryRun: true });

    expect(stderr()).not.toContain('(git hook)');
    expect(stderr()).not.toMatch(/post-(commit|merge).*would (create|update)/);
    expect(stderr()).toContain('  ⚠ git hooks skipped - shared hooks directory (see warning above)');
  });

  it('--dry-run keeps a space before (git hook) when the hooks path is long', async () => {
    const dir = makeTempProject();
    execFileSync('git', ['config', 'core.hooksPath', '.githooks-with-a-rather-long-directory-name'], { cwd: dir });

    await new InitCommand(dir).run({ tools: ['windsurf'], dryRun: true });

    expect(stderr()).toContain('.githooks-with-a-rather-long-directory-name/post-commit (git hook)');
    expect(stderr()).toContain('.githooks-with-a-rather-long-directory-name/post-merge (git hook)');
  });
});

describe('InitCommand — non-interactive mode', () => {
  it('creates index directory and installs hooks with --yes', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ yes: true });

    expect(existsSync(join(dir, '.ctxo', 'index'))).toBe(true);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(true);
  });

  it('generates rules for specified tools', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['windsurf', 'cursor'], yes: true });

    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);
    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);
  });

  it('rejects unknown tool IDs', async () => {
    const dir = makeTempProject();
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(new InitCommand(dir).run({ tools: ['unknown'], yes: true })).rejects.toThrow('exit');

    mockExit.mockRestore();
  });

  it('--rules only regenerates rules without hooks', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['windsurf'], rulesOnly: true });

    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);
    // No hooks installed
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('--dry-run does not create any files', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['windsurf'], dryRun: true });

    expect(existsSync(join(dir, '.windsurfrules'))).toBe(false);
  });

  it('--dry-run names the hooks directory git resolves', async () => {
    const dir = makeTempProject();
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await new InitCommand(dir).run({ tools: ['windsurf'], dryRun: true });
      const output = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(output).toContain('.githooks/post-commit');
      expect(output).toContain('.githooks/post-merge');
      expect(output).not.toContain('.git/hooks/');
    } finally {
      errorSpy.mockRestore();
    }
    expect(existsSync(join(dir, '.githooks'))).toBe(false);
  });

  it('installs safe-edit guard for claude-code in non-interactive mode', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, rulesOnly: false, noInstall: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'));
    const pre = cfg.hooks?.PreToolUse ?? [];
    expect(pre.some((e: { hooks?: Array<{ command?: string }> }) =>
      e.hooks?.some(h => h.command?.includes('gate-hook'))
    )).toBe(true);
  });

  it('does NOT install guard for claude-code when --rules-only', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['claude-code'], rulesOnly: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
  });
});

describe('InitCommand — cursor: skills + rules, no guard', () => {
  it('writes cursor rules file', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, noInstall: true });

    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);
  });

  it('writes cursor skill .mdc files', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, noInstall: true });

    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo-safe-edit.mdc'))).toBe(true);
  });

  it('does NOT create .claude/settings.json guard for cursor-only init', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, noInstall: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
  });
});

describe('InitCommand - selected parts and tiered rules (#159)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
  }

  /** Every file name in the hooks directory with its content, so a test can prove nothing changed there. */
  function hooksSnapshot(dir: string): Record<string, string> {
    const hooksDir = join(dir, '.git', 'hooks');
    if (!existsSync(hooksDir)) return {};
    return Object.fromEntries(readdirSync(hooksDir).sort().map((name) => [name, readFileSync(join(hooksDir, name), 'utf-8')]));
  }

  /** The body of the one ctxo rules block in a file. */
  function rulesBody(file: string): string {
    const scan = scanRulesBlocks(readFileSync(file, 'utf-8'));
    expect(scan.blocks).toHaveLength(1);
    return scan.blocks[0]!.body;
  }

  const SKILL_FILES = ['ctxo-understand', 'ctxo-safe-edit', 'ctxo-review-pr'].map((skill) =>
    join('.claude', 'skills', skill, 'SKILL.md'),
  );

  it.each<InitOptions>([{ only: ['guard', 'skills'] }, { skip: ['git-hooks'] }])(
    'installs the guard and skills without touching git hooks (#159 acceptance)',
    async (parts) => {
      const dir = makeTempProject();
      const before = hooksSnapshot(dir);

      await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true, ...parts });

      expect(hooksSnapshot(dir)).toEqual(before);
      expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toContain('ctxo gate-hook');
      for (const file of SKILL_FILES) expect(existsSync(join(dir, file)), file).toBe(true);
    },
  );

  it('Claude Code with the guard and skills gets the compact block; other clients get the full block (#159 acceptance)', async () => {
    const dir = makeTempProject();

    await new InitCommand(dir).run({ tools: ['claude-code', 'cursor', 'windsurf'], yes: true, noInstall: true });

    const claude = rulesBody(join(dir, 'CLAUDE.md'));
    expect(claude.split('\n').length).toBeLessThanOrEqual(8);
    expect(blockTier(claude)).toBe('compact');
    expect(readFileSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'), 'utf-8')).toContain(ruleBody({ tier: 'full' }));
    expect(readFileSync(join(dir, '.windsurfrules'), 'utf-8')).toContain(ruleBody({ tier: 'full' }));
  });

  it.each<InitOptions>([{ noGuard: true }, { skip: ['skills'] }])(
    '--no-guard and --skip skills give Claude Code the full block',
    async (flags) => {
      const dir = makeTempProject();

      await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true, ...flags });

      expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('full');
    },
  );

  it('gate.enabled false gives Claude Code the full block', async () => {
    const dir = makeTempProject();
    mkdirSync(join(dir, '.ctxo'), { recursive: true });
    writeFileSync(join(dir, '.ctxo', 'config.yaml'), 'gate:\n  enabled: false\n', 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true });

    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toContain('ctxo gate-hook');
    expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('full');
  });

  it('--rules prints the deprecation notice and skips only git hooks and the guard', async () => {
    const dir = makeTempProject();

    await new InitCommand(dir).run({ tools: ['claude-code'], rulesOnly: true, noInstall: true });

    expect(stderr().match(/deprecated/g) ?? []).toHaveLength(1);
    expect(stderr()).toContain('[ctxo] --rules is deprecated and now means --skip git-hooks,guard. Use --only or --skip instead.');
    for (const file of SKILL_FILES) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(hookPath(dir))).toBe(false);
    expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('full');
  });

  it('init keeps the Claude Code block when settings.json is unreadable', async () => {
    // Inverts the Task 6 test: a full block here would read as an opt-out of the guard (D5).
    const dir = makeTempProject();
    const corrupt = '{ "hooks": { "PreToolUse": [ \n';
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), corrupt, 'utf-8');
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true });

    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toBe(corrupt);
    expect(stderr()).toContain('[ctxo] ⚠ .claude/settings.json is not valid JSON');
    expect(stderr()).not.toContain('.claude/settings.json (unchanged)');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(PRE_TIER_CLAUDE_MD);
    expect(stderr().split('\n')).toContain(heldWarning('CLAUDE.md'));
    expect(stderr()).not.toContain('CLAUDE.md (updated)');
    for (const file of SKILL_FILES) expect(existsSync(join(dir, file)), file).toBe(true);
  });

  it('init --only rules keeps a pre-tier CLAUDE.md block when the guard and skills are missing', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, only: ['rules'] });

    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(PRE_TIER_CLAUDE_MD);
    expect(stderr().split('\n')).toContain(heldWarning('CLAUDE.md'));

    // The command the warning names installs the pieces and then renders the compact tier.
    errorSpy.mockClear();
    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, only: ['rules', 'skills', 'guard'] });

    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# P\n\n' + renderRulesBlock('compact') + '\n');
    expect(stderr()).toContain('[ctxo] ✓ CLAUDE.md (updated)');
  });

  it('--rules keeps a pre-tier CLAUDE.md block when the guard is missing', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], rulesOnly: true, noInstall: true });

    // --rules installs the skills but skips the guard; skipping is not declining (Review Focus 3).
    for (const file of SKILL_FILES) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(PRE_TIER_CLAUDE_MD);
    expect(stderr().split('\n')).toContain(heldWarning('CLAUDE.md'));
  });

  it('the Cursor rules block is held the same way', async () => {
    const dir = makeTempProject();
    const cursorFile = join(dir, '.cursor', 'rules', 'ctxo.mdc');
    const preTier = LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n';
    mkdirSync(dirname(cursorFile), { recursive: true });
    writeFileSync(cursorFile, preTier, 'utf-8');

    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, only: ['rules'] });

    expect(readFileSync(cursorFile, 'utf-8')).toBe(preTier);
    expect(stderr().split('\n')).toContain(heldWarning('.cursor/rules/ctxo.mdc'));

    errorSpy.mockClear();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, only: ['rules', 'skills'] });

    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo-safe-edit.mdc'))).toBe(true);
    expect(blockTier(rulesBody(cursorFile))).toBe('full');
    expect(readFileSync(cursorFile, 'utf-8')).toContain(renderRulesBlock('full'));
  });

  it('--no-guard still writes the full block', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true, noGuard: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# P\n\n' + renderRulesBlock('full') + '\n');
    expect(stderr()).not.toContain('left unchanged until');
  });

  it('--skip skills with the guard installed writes the full block', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true, skip: ['skills'] });

    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toContain('ctxo gate-hook');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# P\n\n' + renderRulesBlock('full') + '\n');
  });

  it('-y without --tools writes every platform, the same set the dry run previews', async () => {
    const dir = makeTempProject();
    const planned = new InitCommand(dir).plan({ yes: true, only: ['rules'] }).map((result) => result.file);

    await new InitCommand(dir).run({ yes: true, only: ['rules'] });

    expect(planned).toEqual(PLATFORMS.map((platform) => platform.file));
    for (const platform of PLATFORMS) expect(existsSync(join(dir, platform.file)), platform.file).toBe(true);
  });

  it('a skill path that is a directory gives the full tier in init and in doctor', async () => {
    const dir = makeTempProject();
    // Something other than a readable skill sits where ctxo-safe-edit belongs.
    mkdirSync(join(dir, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md'), { recursive: true });
    const only: InitOptions['only'] = ['rules', 'skills', 'guard'];

    const plannedClaude = new InitCommand(dir).plan({ tools: ['claude-code'], only }).find((row) => row.file === 'CLAUDE.md');
    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, only });

    expect(stderr()).toMatch(/\.claude\/skills\/ctxo-safe-edit\/SKILL\.md: could not be read \(E\w+\); left unchanged/);
    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toContain('ctxo gate-hook');
    expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('full');
    expect(plannedClaude).toMatchObject({ file: 'CLAUDE.md', action: 'created' });
    // Doctor expects the same tier, so the block raises no tier warning.
    expect(resolveRulesTier(dir, 'claude-code')).toBe('full');
    const doctor = await new AiRulesCheck().run({ projectRoot: dir, ctxoRoot: join(dir, '.ctxo') });
    expect(doctor.message).not.toContain('rules tier does not match');
    expect(doctor.message).toContain('CLAUDE.md v');
  });

  it('an invalid config.yaml warns once per init run, not once per platform', async () => {
    const dir = makeTempProject();
    mkdirSync(join(dir, '.ctxo'), { recursive: true });
    writeFileSync(join(dir, '.ctxo', 'config.yaml'), 'gate:\n  enabled: maybe\n', 'utf-8');
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');
    const configWarnings = (): number => stderr().split('\n').filter((line) => line.startsWith('[ctxo:config] WARN')).length;

    await new InitCommand(dir).run({ dryRun: true, only: ['rules'] });
    expect(configWarnings()).toBe(1);

    errorSpy.mockClear();
    await new InitCommand(dir).run({ yes: true, only: ['rules', 'skills', 'guard'] });
    expect(configWarnings()).toBe(1);
    expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('compact');
  });

  it('a tool named twice in --tools is applied once', async () => {
    const dir = makeTempProject();

    await new InitCommand(dir).run({ tools: ['cursor', 'cursor'], dryRun: true, only: ['rules', 'skills'] });
    expect(stderr().match(/\.cursor\/rules\/ctxo\.mdc/g)).toHaveLength(1);
    expect(stderr().match(/ctxo-safe-edit\.mdc/g)).toHaveLength(1);

    errorSpy.mockClear();
    await new InitCommand(dir).run({ tools: ['cursor', 'cursor'], yes: true, only: ['rules'] });
    expect(stderr().match(/\.cursor\/rules\/ctxo\.mdc/g)).toHaveLength(1);
  });

  it('a corrupt settings.json with no ctxo block in CLAUDE.md keeps today\'s full block', async () => {
    const dir = makeTempProject();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), 'not json{{{', 'utf-8');

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true });

    expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('full');
    expect(stderr()).not.toContain('left unchanged until');
  });

  it('re-running init reports CLAUDE.md unchanged and keeps one block', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true });
    expect(stderr()).toContain('[ctxo] ✓ CLAUDE.md (created)');
    errorSpy.mockClear();

    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true });

    expect(stderr()).toContain('[ctxo] ✓ CLAUDE.md (unchanged)');
    expect(stderr()).not.toContain(String.fromCharCode(0x2014));
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content.match(/<!-- ctxo-rules-start/g) ?? []).toHaveLength(1);
  });

  it('installHooks reports created, then skipped on a second run', () => {
    const dir = makeTempProject();

    const first = new InitCommand(dir).installHooks();
    const second = new InitCommand(dir).installHooks();

    expect(first.installed).toBe(true);
    expect(first.results).toHaveLength(2);
    expect(first.results[0]!.file).toMatch(/post-commit$/);
    expect(first.results[1]!.file).toMatch(/post-merge$/);
    expect(first.results.map((r) => r.file)).toEqual(['.git/hooks/post-commit', '.git/hooks/post-merge']);
    expect(first.results.map((r) => r.action)).toEqual(['created', 'created']);
    expect(second.results.map((r) => r.action)).toEqual(['skipped', 'skipped']);
  });

  it('installHooks reports an absolute path for a hooks directory outside the project', () => {
    const dir = makeTempProject();
    const outside = mkdtempSync(join(tmpdir(), 'ctxo-outside-hooks-'));
    tempDirs.push(outside);
    execFileSync('git', ['config', 'core.hooksPath', outside], { cwd: dir });

    const result = new InitCommand(dir).installHooks();

    expect(result.results.map((r) => r.file)).toEqual(
      ['post-commit', 'post-merge'].map((name) => `${outside.replace(/\\/g, '/')}/${name}`),
    );
  });

  it('installHooks gives no rows for a shared hooks directory', () => {
    const dir = makeTempProject();
    const shared = mkdtempSync(join(tmpdir(), 'ctxo-shared-hooks-'));
    tempDirs.push(shared);
    gitEnv.setGlobalHooksPath(shared);

    const result = new InitCommand(dir).installHooks();

    expect(result.installed).toBe(false);
    expect(result.sharedScope).toBe('global');
    expect(result.results).toEqual([]);
  });

  it.each<InitOptions>([{ only: ['guard'], noGuard: true }, { only: [] }])(
    'an empty selection prints a notice and writes nothing',
    async (flags) => {
      const dir = makeTempProject();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const before = readdirSync(dir).sort();
      const hooksBefore = hooksSnapshot(dir);

      try {
        await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true, ...flags });
        expect(exitSpy).not.toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
      }

      expect(stderr()).toContain('[ctxo] Nothing to install: every part is excluded.');
      expect(readdirSync(dir).sort()).toEqual(before);
      expect(hooksSnapshot(dir)).toEqual(hooksBefore);
    },
  );

  it('a missing skills directory is reported and the other parts still run', async () => {
    const dir = makeTempProject();
    vi.resetModules();
    vi.doMock('../ai-rules.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../ai-rules.js')>();
      const missing = (): never => { throw new Error('Could not locate ctxo skills/ directory.'); };
      // resolveRulesTier reads the skills through ai-rules' own skillStates, which this mock cannot
      // reach, so it is stubbed too: the rules step must take init's fallback to the full tier.
      return { ...actual, installSkills: missing, skillStates: missing, resolveRulesTier: missing };
    });
    try {
      const { InitCommand: InitWithoutSkills } = await import('../init-command.js');
      await new InitWithoutSkills(dir).run({ tools: ['claude-code', 'cursor'], yes: true, noInstall: true });
    } finally {
      vi.doUnmock('../ai-rules.js');
      vi.resetModules();
    }

    expect(stderr()).toMatch(/\[ctxo\] ⚠ .*Could not locate ctxo skills\/ directory/);
    expect(existsSync(join(dir, '.ctxo', 'config.yaml'))).toBe(true);
    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toContain('ctxo gate-hook');
    expect(blockTier(rulesBody(join(dir, 'CLAUDE.md')))).toBe('full');
    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);
    expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
    expect(existsSync(hookPath(dir))).toBe(true);
  });
});

describe('InitCommand - the dry run lists every file init would touch (#159)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
  }

  const TOOLS = ['claude-code', 'cursor', 'github-copilot'];

  /** Every path under root, `.git` included (directories end in `/`), mapped by `describeEntry`. */
  function walk(root: string, describeEntry: (path: string, isDir: boolean) => string, sub = ''): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const entry of readdirSync(join(root, sub), { withFileTypes: true })) {
      const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
      const isDir = entry.isDirectory();
      entries[isDir ? `${rel}/` : rel] = describeEntry(join(root, rel), isDir);
      if (isDir) Object.assign(entries, walk(root, describeEntry, rel));
    }
    return entries;
  }

  const sha1 = (path: string): string => createHash('sha1').update(readFileSync(path)).digest('hex');

  /** Content hash, mtime and mode of every file and directory: a dry run must change none of them. */
  function snapshot(root: string): Record<string, string> {
    return walk(root, (path, isDir) => {
      const stat = statSync(path);
      return `${isDir ? 'dir' : sha1(path)} ${stat.mtimeMs} ${stat.mode}`;
    });
  }

  /** The SHA-1 of every file (directories left out). */
  function fileHashes(root: string): Record<string, string> {
    return Object.fromEntries(Object.entries(walk(root, (path, isDir) => (isDir ? '' : sha1(path)))).filter(([path]) => !path.endsWith('/')));
  }

  it('--dry-run lists config, .gitignore, rules, skills for both platforms, the guard, MCP configs and git hooks', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, '.gitignore'), '.ctxo/.cache/\n', 'utf-8');

    await new InitCommand(dir).run({ tools: TOOLS, dryRun: true });

    const out = stderr();
    expect(out).toContain('[ctxo] Dry run: nothing is written. Files init would touch:');
    for (const file of [
      '.ctxo/config.yaml',
      '.gitignore',
      'CLAUDE.md',
      '.claude/skills/ctxo-safe-edit/SKILL.md',
      '.cursor/rules/ctxo-understand.mdc',
      '.claude/settings.json',
      '.mcp.json',
      '.vscode/mcp.json',
      'post-commit',
      'post-merge',
    ]) {
      expect(out, file).toContain(file);
    }
    expect(out).toMatch(/^ {2}CLAUDE\.md +would create$/m);
    expect(out).toMatch(/^ {2}\.gitignore +unchanged$/m);
    expect(out).toMatch(/^ {2}\.git\/hooks\/post-commit \(git hook\) +would create$/m);
    expect(out).not.toMatch(/skipped/i);
    expect(out).not.toContain(String.fromCharCode(0x2014));
  });

  it('the dry run reports a held block', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');
    const before = snapshot(dir);

    await new InitCommand(dir).run({ dryRun: true, tools: ['claude-code'], only: ['rules'] });

    expect(stderr()).toMatch(/^ {2}CLAUDE\.md +unchanged \(held\)$/m);
    expect(stderr()).not.toContain('would update');
    expect(snapshot(dir)).toEqual(before);

    // A dry run that would install the guard and the skills counts them as on disk: no hold.
    errorSpy.mockClear();
    await new InitCommand(dir).run({ dryRun: true, tools: ['claude-code'], only: ['rules', 'skills', 'guard'] });

    expect(stderr()).toMatch(/^ {2}CLAUDE\.md +would update$/m);
    expect(stderr()).not.toContain('(held)');
    expect(snapshot(dir)).toEqual(before);
  });

  // POSIX only by nature: Windows has no exec bit, so there is nothing for a dry run to leave alone.
  it.skipIf(process.platform === 'win32')('--dry-run does not restore a hook exec bit', async () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();
    chmodSync(hookPath(dir, 'post-merge'), 0o644);
    const before = snapshot(dir);

    await new InitCommand(dir).run({ dryRun: true });

    expect(statSync(hookPath(dir, 'post-merge')).mode & 0o111).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });

  it('--dry-run writes nothing', async () => {
    const dir = makeTempProject();
    // A project a real run would change everywhere: files to update, folders to create.
    new InitCommand(dir).installHooks();
    writeFileSync(hookPath(dir), `#!/bin/sh\n${V1_POST_COMMIT_BLOCK}\n`, 'utf-8');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n', 'utf-8');
    writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"other":{"command":"node"}}}', 'utf-8');
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"permissions":{}}\n', 'utf-8');
    const before = snapshot(dir);

    await new InitCommand(dir).run({ dryRun: true });

    expect(stderr()).toContain('would update');
    expect(snapshot(dir)).toEqual(before);
  });

  it('--dry-run follows --only and --skip', async () => {
    const dir = makeTempProject();

    await new InitCommand(dir).run({ dryRun: true, only: ['rules'] });
    expect(stderr()).toContain('CLAUDE.md');
    expect(stderr()).not.toContain('.claude/settings.json');
    expect(stderr()).not.toContain('post-commit');
    expect(stderr()).not.toContain('.ctxo/config.yaml');
    expect(stderr()).not.toContain('.mcp.json');

    errorSpy.mockClear();
    await new InitCommand(dir).run({ dryRun: true, tools: ['claude-code'], skip: ['git-hooks'], noGuard: true });
    expect(stderr()).toContain('.ctxo/config.yaml');
    expect(stderr()).toContain('.claude/skills/ctxo-safe-edit/SKILL.md');
    expect(stderr()).not.toContain('.claude/settings.json');
    expect(stderr()).not.toContain('post-commit');

    errorSpy.mockClear();
    await new InitCommand(dir).run({ dryRun: true, tools: ['claude-code'], rulesOnly: true });
    expect(stderr()).toContain('.mcp.json');
    expect(stderr()).not.toContain('.claude/settings.json');
    expect(stderr()).not.toContain('post-commit');
  });

  it('plan gives each file the action a real run then takes', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, '.gitignore'), '.ctxo/.cache/\n', 'utf-8');
    writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"other":{"command":"node"}}}', 'utf-8');
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n', 'utf-8');

    const plan = new InitCommand(dir).plan({ tools: TOOLS }).filter((result) => !result.file.endsWith('/'));
    const planned = Object.fromEntries(plan.map((result) => [result.file, result.action]));
    const before = fileHashes(dir);
    await new InitCommand(dir).run({ tools: TOOLS, yes: true, noInstall: true });
    const after = fileHashes(dir);

    /** What the real run did to a file, in the plan's words. */
    const actual = (file: string): string =>
      before[file] === undefined ? 'created' : before[file] !== after[file] ? 'updated' : 'skipped';
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((file) => before[file] !== after[file]);

    expect(Object.keys(planned)).toHaveLength(plan.length);
    expect(Object.fromEntries(Object.keys(planned).map((file) => [file, actual(file)]))).toEqual(planned);
    expect(changed.every((file) => planned[file] !== undefined && planned[file] !== 'skipped')).toBe(true);
    expect(planned['.mcp.json']).toBe('updated');
    expect(planned['CLAUDE.md']).toBe('updated');
    expect(planned['.git/hooks/post-commit']).toBe('created');
    expect(planned['.gitignore']).toBe('skipped');
  });

  it('--dry-run without the git-hooks part does not look up the hooks directory', async () => {
    const dir = makeTempProject();
    const lookup = vi.spyOn(gitHooks, 'resolveHooksDir');

    try {
      await new InitCommand(dir).run({ dryRun: true, tools: ['windsurf'], skip: ['git-hooks'] });
      expect(lookup).not.toHaveBeenCalled();

      await new InitCommand(dir).run({ dryRun: true, tools: ['windsurf'] });
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      lookup.mockRestore();
    }
    expect(stderr()).toMatch(/^ {2}\.git\/hooks\/post-commit \(git hook\) +would create$/m);
  });

  it('installHooks dryRun returns both hooks and writes nothing', () => {
    const dir = makeTempProject();
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });

    const fresh = new InitCommand(dir).installHooks({ dryRun: true });

    expect(fresh.installed).toBe(true);
    expect(fresh.results).toEqual([
      { file: '.githooks/post-commit', action: 'created' },
      { file: '.githooks/post-merge', action: 'created' },
    ]);
    expect(existsSync(join(dir, '.githooks'))).toBe(false);

    execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: dir });
    const v1 = `#!/bin/sh\n${V1_POST_COMMIT_BLOCK}\n`;
    writeFileSync(hookPath(dir), v1, 'utf-8');

    const upgrade = new InitCommand(dir).installHooks({ dryRun: true });

    expect(upgrade.results.map((result) => result.action)).toEqual(['updated', 'created']);
    expect(readFileSync(hookPath(dir), 'utf-8')).toBe(v1);
    expect(existsSync(hookPath(dir, 'post-merge'))).toBe(false);
  });
});
