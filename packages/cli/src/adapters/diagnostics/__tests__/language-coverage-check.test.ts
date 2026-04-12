import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { LanguageCoverageCheck } from '../checks/language-coverage-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

function makeCtx(projectRoot: string): CheckContext {
  return { projectRoot, ctxoRoot: join(projectRoot, '.ctxo') };
}

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
}

describe('LanguageCoverageCheck', () => {
  const check = new LanguageCoverageCheck();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ctxo-lc-'));
    initRepo(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('has stable id and title', () => {
    expect(check.id).toBe('language_coverage');
    expect(check.title).toBe('Language coverage');
  });

  it('passes when no source languages detected', async () => {
    const result = await check.run(makeCtx(tmp));
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no source languages');
  });

  it('warns when a manifest language has no installed plugin', async () => {
    writeFileSync(join(tmp, 'pyproject.toml'), '[project]\nname="x"');
    execFileSync('git', ['add', '-A'], { cwd: tmp });
    execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init', '--quiet'],
      { cwd: tmp },
    );
    const result = await check.run(makeCtx(tmp));
    // @ctxo/lang-python is not installed in the monorepo
    expect(result.status).toBe('warn');
    expect(result.message).toContain('python');
    expect(result.fix).toContain('ctxo install python');
  });
});
