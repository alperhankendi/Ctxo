import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DoctorReport } from '../../core/diagnostics/types.js';
import {
  LEGACY_CURSOR_FRONTMATTER,
  LEGACY_RULE_BODY,
  RULES_TEMPLATE_VERSION,
  SKILLS_TEMPLATE_VERSION,
  renderRulesBlock,
} from '../../core/agent-rules/rules-block.js';
import { HealthChecker } from '../../adapters/diagnostics/health-checker.js';
import {
  AiRulesCheck,
  ClaudeGuardHookCheck,
  SkillsCheck,
} from '../../adapters/diagnostics/checks/agent-setup-check.js';
import { JsonIndexWriter } from '../../adapters/storage/json-index-writer.js';
import { buildFileIndex } from '../../adapters/storage/__tests__/test-fixtures.js';
import { ensureClaudeHook, installSkills } from '../ai-rules.js';
import { applyFixes, formatFixReport, type FixAttempt, type FixReport } from '../doctor-fix.js';
import { InitCommand, type InitOptions } from '../init-command.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

/**
 * Set by a test to make the guard write fail as it does on a read-only `.claude/`, or the skills
 * install fail for the platforms listed in `skills`, before anything is written.
 */
const faults = vi.hoisted(() => ({ guardWrite: false, skills: [] as string[] }));

vi.mock('../ai-rules.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-rules.js')>();
  return {
    ...actual,
    ensureClaudeHook: (...args: Parameters<typeof actual.ensureClaudeHook>) => {
      if (faults.guardWrite && args[1]?.dryRun !== true) {
        throw Object.assign(new Error("EACCES: permission denied, open '.claude/settings.json'"), { code: 'EACCES' });
      }
      return actual.ensureClaudeHook(...args);
    },
    installSkills: (...args: Parameters<typeof actual.installSkills>) => {
      if (faults.skills.includes(args[1]) && args[2]?.dryRun !== true) {
        throw Object.assign(new Error(`EACCES: permission denied, mkdir '${args[1]} skills'`), { code: 'EACCES' });
      }
      return actual.installSkills(...args);
    },
  };
});

function report(overrides: Partial<DoctorReport['checks'][number]>[]): DoctorReport {
  const checks = overrides.map((o, i) => ({
    id: o.id ?? `check_${i}`,
    title: o.title ?? `Check ${i}`,
    status: o.status ?? 'warn',
    message: o.message ?? '',
    fix: o.fix,
    value: o.value,
  }));
  return {
    checks,
    summary: { pass: 0, warn: checks.filter((c) => c.status === 'warn').length, fail: checks.filter((c) => c.status === 'fail').length },
    exitCode: 1,
  };
}

describe('applyFixes', () => {
  let tmp: string;
  let savedCI: string | undefined;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ctxo-fix-'));
    savedCI = process.env['CI'];
    delete process.env['CI'];
    // The hook tests below must resolve against their own temp repo: no inherited GIT_DIR, no global or system git config.
    gitEnv = isolateGitEnv();
  });

  afterEach(() => {
    faults.guardWrite = false;
    faults.skills = [];
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (savedCI === undefined) delete process.env['CI'];
    else process.env['CI'] = savedCI;
    gitEnv.restore();
  });

  it('returns empty attempts on a clean report', async () => {
    const r = await applyFixes(report([]), {
      projectRoot: tmp,
      ctxoRoot: join(tmp, '.ctxo'),
      dryRun: true,
    });
    expect(r.attempts).toEqual([]);
    expect(r.halted).toBe(false);
  });

  it('halts in CI without --yes', async () => {
    process.env['CI'] = 'true';
    const r = await applyFixes(
      report([{ id: 'config_file', status: 'warn' }]),
      { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo') },
    );
    expect(r.halted).toBe(true);
    expect(r.reason).toMatch(/CI/);
  });

  it('produces planned attempts under --dry-run', async () => {
    const r = await applyFixes(
      report([
        { id: 'config_file', status: 'warn' },
        { id: 'sqlite_cache', status: 'warn' },
      ]),
      { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true },
    );
    expect(r.halted).toBe(false);
    expect(r.attempts.length).toBeGreaterThanOrEqual(2);
    expect(r.attempts.every((a) => a.status === 'planned')).toBe(true);
  });

  it('writes an audit log entry', async () => {
    await applyFixes(
      report([{ id: 'config_file', status: 'warn' }]),
      { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true },
    );
    const logPath = join(tmp, '.ctxo', 'doctor-fix.log');
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, 'utf-8')).toContain('doctor --fix');
  });

  describe('git_hooks', () => {
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

    function seedV1Hook(): string {
      execFileSync('git', ['init', '-q'], { cwd: tmp });
      const hookFile = join(tmp, '.git', 'hooks', 'post-commit');
      writeFileSync(hookFile, `#!/bin/sh\necho "mine"\n\n${V1_BLOCK}\necho "tail"\n`, 'utf-8');
      return hookFile;
    }

    it('doctor --fix upgrades a v1 block', async () => {
      const hookFile = seedV1Hook();

      const r = await applyFixes(
        report([{ id: 'git_hooks', status: 'warn' }]),
        { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), yes: true },
      );

      const hooksAttempt = r.attempts.find((a) => a.name === 'Git hooks');
      expect(hooksAttempt?.status).toBe('success');
      const content = readFileSync(hookFile, 'utf-8');
      expect(content).toContain('# ctxo-start v2');
      expect(content).toContain('ctxo index --commit HEAD');
      expect(content).not.toContain('ctxo index --file');
      expect(content).toContain('echo "mine"');
      expect(content).toContain('echo "tail"');
    });

    it('doctor --fix refuses a core.hooksPath from the global git config: skipped, nothing written', async () => {
      const hookFile = seedV1Hook();
      const before = readFileSync(hookFile, 'utf-8');
      const shared = mkdtempSync(join(tmpdir(), 'ctxo-fix-shared-hooks-'));
      gitEnv.setGlobalHooksPath(shared);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const r = await applyFixes(
          report([{ id: 'git_hooks', status: 'warn' }]),
          { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), yes: true },
        );

        const hooksAttempt = r.attempts.find((a) => a.name === 'Git hooks');
        expect(hooksAttempt?.status).toBe('skipped');
        expect(hooksAttempt?.error).toMatch(/shared/i);
        expect(r.halted).toBe(false);
        expect(readdirSync(shared)).toEqual([]);
        expect(readFileSync(hookFile, 'utf-8')).toBe(before);
        expect(errorSpy.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(/shared by every repo/);
      } finally {
        errorSpy.mockRestore();
        rmSync(shared, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });

    it('doctor --fix --dry-run leaves the hook untouched', async () => {
      const hookFile = seedV1Hook();
      const before = readFileSync(hookFile, 'utf-8');

      const r = await applyFixes(
        report([{ id: 'git_hooks', status: 'warn' }]),
        { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true },
      );

      expect(r.attempts.find((a) => a.name === 'Git hooks')?.status).toBe('planned');
      expect(readFileSync(hookFile, 'utf-8')).toBe(before);
    });
  });

  it('orphan prune keeps the index entry of a tracked file with a non-ASCII name', async () => {
    // Without -z, git quotes such a name ("\303\266d\303\274n\303\247 kayd\304\261.txt") and the entry would be
    // deleted as an orphan. .txt files: no language plugin is needed, so nothing is installed.
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['config', 'core.quotePath', 'true'], { cwd: tmp });
    for (const file of ['ödünç kaydı.txt', 'plain.txt']) writeFileSync(join(tmp, file), 'notes', 'utf-8');
    const ctxoRoot = join(tmp, '.ctxo');
    const writer = new JsonIndexWriter(ctxoRoot);
    for (const file of ['ödünç kaydı.txt', 'plain.txt', 'gone.txt']) writer.write(buildFileIndex({ file }));
    const entry = (file: string): string => join(ctxoRoot, 'index', `${file}.json`);

    const r = await applyFixes(report([{ id: 'orphaned_files', status: 'fail' }]), { projectRoot: tmp, ctxoRoot });

    expect(r.attempts.find((a) => a.name === 'Orphaned index files')?.status).toBe('success');
    expect(existsSync(entry('ödünç kaydı.txt'))).toBe(true);
    expect(existsSync(entry('plain.txt'))).toBe(true);
    expect(existsSync(entry('gone.txt'))).toBe(false);
  });

  it('schedules an orphan prune attempt when orphaned_files is failing', async () => {
    const r = await applyFixes(
      report([{ id: 'orphaned_files', status: 'fail' }]),
      { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true },
    );
    expect(r.attempts.some((a) => a.name === 'Orphaned index files')).toBe(true);
  });

  describe('agent setup', () => {
    /** A CLAUDE.md written by a ctxo version before the tiers: an unversioned marked block. */
    const PRE_TIER_CLAUDE_MD = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';
    const SETTINGS = join('.claude', 'settings.json');
    const ALL_PASS = { ai_rules: 'pass', skills: 'pass', claude_guard_hook: 'pass' };

    /** Writes a project-relative file, creating its directory. */
    function write(file: string, content: string): void {
      const path = join(tmp, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf-8');
    }

    function bytes(file: string): Buffer {
      return readFileSync(join(tmp, file));
    }

    function text(file: string): string {
      return readFileSync(join(tmp, file), 'utf-8');
    }

    /** The three agent-setup checks, run as `ctxo doctor` runs them. */
    function runAgentChecks(): Promise<DoctorReport> {
      return new HealthChecker([new AiRulesCheck(), new SkillsCheck(), new ClaudeGuardHookCheck()], { quiet: true })
        .runAll({ projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo') });
    }

    function statuses(r: DoctorReport): Record<string, string> {
      return Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    }

    function fix(r: DoctorReport): Promise<FixReport> {
      return applyFixes(r, { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), yes: true });
    }

    function attempt(r: FixReport, name: string): FixAttempt | undefined {
      return r.attempts.find((a) => a.name === name);
    }

    function outcomes(r: FixReport): [string, FixAttempt['status']][] {
      return r.attempts.map((a) => [a.name, a.status]);
    }

    /** `ctxo init --tools claude-code --yes --no-install` plus `options`, in a fresh temp repo, quietly. */
    async function init(options: InitOptions): Promise<void> {
      execFileSync('git', ['init', '-q'], { cwd: tmp });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await new InitCommand(tmp).run({ tools: ['claude-code'], yes: true, noInstall: true, ...options });
      } finally {
        errorSpy.mockRestore();
      }
    }

    it('schedules Skills, Claude guard hook and AI rules after Git hooks and before Language plugins', async () => {
      const r = await applyFixes(
        report([
          { id: 'language_coverage' },
          { id: 'claude_guard_hook' },
          { id: 'skills' },
          { id: 'ai_rules' },
          { id: 'git_hooks' },
        ]),
        { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true },
      );

      expect(r.attempts).toEqual([
        { name: 'Git hooks', action: 're-install ctxo git hooks', status: 'planned' },
        { name: 'Skills', action: 'install missing or outdated ctxo skills', status: 'planned' },
        { name: 'Claude guard hook', action: 'register ctxo gate-hook in .claude/settings.json', status: 'planned' },
        { name: 'AI rules', action: 're-render ctxo rules blocks', status: 'planned' },
        { name: 'Language plugins', action: 'install missing @ctxo/lang-* packages', status: 'planned' },
      ]);
    });

    it('runs the D13 order: config, git hooks, skills, guard, rules, then plugins, index and cache', async () => {
      const r = await applyFixes(
        report([
          { id: 'sqlite_cache' },
          { id: 'index_freshness' },
          { id: 'language_coverage' },
          { id: 'ai_rules' },
          { id: 'claude_guard_hook' },
          { id: 'skills' },
          { id: 'git_hooks' },
          { id: 'config_file' },
        ]),
        { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true },
      );

      expect(r.attempts.map((a) => a.name)).toEqual([
        'Config',
        'Git hooks',
        'Skills',
        'Claude guard hook',
        'AI rules',
        'Language plugins',
        'Index',
        'SQLite cache',
      ]);
    });

    it('re-renders AI rules when only the skills check failed', async () => {
      const r = await applyFixes(report([{ id: 'skills' }]), {
        projectRoot: tmp,
        ctxoRoot: join(tmp, '.ctxo'),
        dryRun: true,
      });

      expect(r.attempts.map((a) => a.name)).toEqual(['Skills', 'AI rules']);
    });

    it('re-renders AI rules when only the claude_guard_hook check failed', async () => {
      const r = await applyFixes(report([{ id: 'claude_guard_hook' }]), {
        projectRoot: tmp,
        ctxoRoot: join(tmp, '.ctxo'),
        dryRun: true,
      });

      expect(r.attempts.map((a) => a.name)).toEqual(['Claude guard hook', 'AI rules']);
    });

    it('the AI rules re-render follows the skills installed in the same run', async () => {
      // Compact block and guard present, skills missing: doctor expects full. Once the skills are
      // installed, the re-render must see them and keep the block compact.
      ensureClaudeHook(tmp);
      write('CLAUDE.md', '# P\n\n' + renderRulesBlock('compact') + '\n');
      const before = bytes('CLAUDE.md');
      const doctor = await runAgentChecks();
      expect(statuses(doctor)).toEqual({ ai_rules: 'warn', skills: 'warn', claude_guard_hook: 'pass' });
      expect(doctor.checks.find((c) => c.id === 'ai_rules')?.message).toBe(
        'CLAUDE.md: rules tier does not match the guard and skills (expected full)',
      );

      const r = await fix(doctor);

      // Content first: re-rendered before the skills were installed, the block would turn full here.
      expect(text('CLAUDE.md')).toBe('# P\n\n' + renderRulesBlock('compact') + '\n');
      expect(bytes('CLAUDE.md')).toEqual(before);
      expect(statuses(await runAgentChecks())).toEqual(ALL_PASS);
      expect(outcomes(r)).toEqual([['Skills', 'success'], ['AI rules', 'success']]);
    });

    it('doctor reports rules present, guard missing and rules template outdated, and --fix resolves both (#159 acceptance)', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);

      const doctor = await runAgentChecks();
      const aiRules = doctor.checks.find((c) => c.id === 'ai_rules');
      expect(aiRules?.message).toContain('rules present, guard missing');
      expect(aiRules?.message).toContain('rules template outdated');

      const r = await fix(doctor);

      expect(r.halted).toBe(false);
      const claudeMd = text('CLAUDE.md');
      expect(claudeMd.match(/<!-- ctxo-rules-start/g)).toHaveLength(1);
      expect(claudeMd).toBe('# P\n\n' + renderRulesBlock('compact') + '\n');
      expect(text(SETTINGS)).toContain('ctxo gate-hook');
      expect(statuses(await runAgentChecks())).toEqual(ALL_PASS);
      expect(outcomes(r)).toEqual([['Skills', 'success'], ['Claude guard hook', 'success'], ['AI rules', 'success']]);
    });

    it('--fix leaves a deliberate opt-out alone', async () => {
      await init({ noGuard: true });
      const claudeMd = bytes('CLAUDE.md');
      const doctor = await runAgentChecks();
      expect(statuses(doctor)).toEqual(ALL_PASS);

      // A real run, not a dry one: config_file fails too, so the run has work to do around the agent steps.
      const r = await fix({
        ...doctor,
        checks: [...doctor.checks, { id: 'config_file', title: 'Config file', status: 'fail', message: 'missing' }],
      });

      expect(r.attempts.map((a) => a.name)).toEqual(['Config']);
      expect(existsSync(join(tmp, SETTINGS))).toBe(false);
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
    });

    it.each<[string, InitOptions]>([
      ['--no-guard', { noGuard: true }],
      ['--no-guard --skip skills', { noGuard: true, skip: ['skills'] }],
    ])('--fix installs nothing declined by init %s even when the report lists every agent check', async (_flags, options) => {
      await init(options);
      const claudeMd = bytes('CLAUDE.md');
      const skillsDir = join(tmp, '.claude', 'skills');
      const hadSkills = existsSync(skillsDir);

      const r = await fix(
        report([{ id: 'config_file' }, { id: 'ai_rules' }, { id: 'skills' }, { id: 'claude_guard_hook' }]),
      );

      expect(attempt(r, 'Claude guard hook')?.status).toBe('skipped');
      expect(existsSync(join(tmp, SETTINGS))).toBe(false);
      expect(existsSync(skillsDir)).toBe(hadSkills);
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
    });

    it('--fix with gate.enabled false installs the skills but not the guard', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      write('.ctxo/config.yaml', 'gate:\n  enabled: false\n');
      const doctor = await runAgentChecks();
      expect(statuses(doctor)).toEqual({ ai_rules: 'warn', skills: 'warn', claude_guard_hook: 'pass' });

      const r = await fix(doctor);

      expect(outcomes(r)).toEqual([['Skills', 'success'], ['AI rules', 'success']]);
      expect(existsSync(join(tmp, SETTINGS))).toBe(false);
      expect(existsSync(join(tmp, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md'))).toBe(true);
      expect(text('CLAUDE.md')).toBe('# P\n\n' + renderRulesBlock('full') + '\n');
      expect(statuses(await runAgentChecks())).toEqual(ALL_PASS);
    });

    it('--fix reports a corrupt settings.json as failed and leaves it unchanged', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      write(SETTINGS, 'not json{{{');
      const doctor = await runAgentChecks();

      const r = await fix(doctor);

      expect(r.halted).toBe(false);
      const guard = attempt(r, 'Claude guard hook');
      expect(guard?.status).toBe('failed');
      // One next step: the same --fix run that installs the guard also renders the right tier.
      expect(guard?.error).toBe(
        '.claude/settings.json is not valid JSON or not a settings object; left unchanged. Fix it, then run "ctxo doctor --fix".',
      );
      expect(text(SETTINGS)).toBe('not json{{{');
      // CLAUDE.md waits for a readable settings.json: a full block now would read as an opt-out (D5).
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('skipped');
      expect(rules?.error).toBe('CLAUDE.md left unchanged while .claude/settings.json is unreadable');
      expect(text('CLAUDE.md')).toBe(PRE_TIER_CLAUDE_MD);
    });

    it('--fix keeps the Claude Code rules block when the skills install fails', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      // A file where a skill folder belongs: installSkills writes ctxo-understand, then throws.
      write('.claude/skills/ctxo-safe-edit', 'not a folder');
      const claudeMd = bytes('CLAUDE.md');

      const r = await fix(await runAgentChecks());

      expect(attempt(r, 'Skills')?.status).toBe('failed');
      expect(attempt(r, 'Claude guard hook')?.status).toBe('success');
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('skipped');
      expect(rules?.error).toBe('CLAUDE.md left unchanged while ctxo skills are missing (ctxo-safe-edit, ctxo-review-pr)');
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
      expect(existsSync(join(tmp, '.claude', 'skills', 'ctxo-understand', 'SKILL.md'))).toBe(true);
      const after = await runAgentChecks();
      expect(statuses(after)).toEqual({ ai_rules: 'warn', skills: 'warn', claude_guard_hook: 'pass' });
      expect(after.checks.find((c) => c.id === 'skills')?.message).toBe('Claude Code: missing ctxo-safe-edit, ctxo-review-pr');
      expect(after.checks.find((c) => c.id === 'ai_rules')?.message).toContain('CLAUDE.md: rules template outdated');
    });

    it('--fix keeps the Claude Code rules block when the guard write fails', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      const claudeMd = bytes('CLAUDE.md');
      faults.guardWrite = true;

      const r = await fix(await runAgentChecks());

      expect(attempt(r, 'Skills')?.status).toBe('success');
      const guard = attempt(r, 'Claude guard hook');
      expect(guard?.status).toBe('failed');
      expect(guard?.error).toContain('EACCES');
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('skipped');
      expect(rules?.error).toBe('CLAUDE.md left unchanged while the safe-edit guard is not registered');
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
      expect(existsSync(join(tmp, SETTINGS))).toBe(false);
      faults.guardWrite = false;
      const after = await runAgentChecks();
      expect(statuses(after)).toEqual({ ai_rules: 'warn', skills: 'pass', claude_guard_hook: 'warn' });
      expect(after.checks.find((c) => c.id === 'ai_rules')?.message).toContain('CLAUDE.md: rules present, guard missing');
    });

    it('--fix holds the Cursor rules block until its skills are in place', async () => {
      const cursorFile = '.cursor/rules/ctxo.mdc';
      const preTier = LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n';
      write(cursorFile, preTier);
      faults.skills = ['cursor'];
      const doctor = await runAgentChecks();
      expect(statuses(doctor)).toEqual({ ai_rules: 'warn', skills: 'warn', claude_guard_hook: 'pass' });

      const r = await fix(doctor);

      expect(attempt(r, 'Skills')?.status).toBe('failed');
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('skipped');
      expect(rules?.error).toBe(
        '.cursor/rules/ctxo.mdc left unchanged while ctxo skills are missing (ctxo-understand, ctxo-safe-edit, ctxo-review-pr)',
      );
      expect(text(cursorFile)).toBe(preTier);

      faults.skills = [];
      const second = await fix(await runAgentChecks());
      expect(outcomes(second)).toEqual([['Skills', 'success'], ['AI rules', 'success']]);
      expect(text(cursorFile)).toContain(renderRulesBlock('full'));
      expect(statuses(await runAgentChecks())).toEqual(ALL_PASS);
    });

    it.each<[string, () => void]>([
      ['an older versioned full block', () => write('CLAUDE.md', '# P\n\n' + renderRulesBlock('full').replace(`v${RULES_TEMPLATE_VERSION}`, 'v0.1') + '\n')],
      ['gate.enabled false', () => {
        write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
        write('.ctxo/config.yaml', 'gate:\n  enabled: false\n');
      }],
      ['no ctxo block', () => write('CLAUDE.md', '# P\n')],
    ])('--fix neither fails the guard step nor holds CLAUDE.md over an unreadable settings.json when no guard is expected: %s', async (_case, seed) => {
      seed();
      write(SETTINGS, 'not json{{{');

      const r = await fix(report([{ id: 'skills' }, { id: 'claude_guard_hook' }, { id: 'ai_rules' }]));

      const guard = attempt(r, 'Claude guard hook');
      expect(guard?.status).toBe('skipped');
      expect(guard?.error).toMatch(/^not expected/);
      expect(text(SETTINGS)).toBe('not json{{{');
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).not.toBe('failed');
      expect(rules?.error ?? '').not.toContain('left unchanged while');
      expect(rules?.warnings).toBeUndefined();
      if (_case !== 'no ctxo block') expect(text('CLAUDE.md')).toBe('# P\n\n' + renderRulesBlock('full') + '\n');
    });

    it('--fix installs the skills of every platform and reports each failure', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      write('.cursor/rules/ctxo.mdc', LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n');
      faults.skills = ['claude-code'];

      const r = await fix(await runAgentChecks());

      const skills = attempt(r, 'Skills');
      expect(skills?.status).toBe('failed');
      expect(skills?.error).toBe("claude-code: EACCES: permission denied, mkdir 'claude-code skills'");
      // Cursor still got its skills, so its block renders; CLAUDE.md waits for its skills.
      expect(existsSync(join(tmp, '.cursor', 'rules', 'ctxo-safe-edit.mdc'))).toBe(true);
      expect(text('.cursor/rules/ctxo.mdc')).toContain(renderRulesBlock('full'));
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('success');
      expect(rules?.warnings).toEqual([
        'CLAUDE.md left unchanged while ctxo skills are missing (ctxo-understand, ctxo-safe-edit, ctxo-review-pr)',
      ]);
      expect(text('CLAUDE.md')).toBe(PRE_TIER_CLAUDE_MD);

      faults.skills = ['claude-code', 'cursor'];
      const both = await fix(report([{ id: 'skills' }]));
      expect(attempt(both, 'Skills')?.error).toBe(
        "claude-code: EACCES: permission denied, mkdir 'claude-code skills'; cursor: EACCES: permission denied, mkdir 'cursor skills'",
      );
    });

    it('--fix --dry-run plans the agent steps and changes nothing on disk', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      const claudeMd = bytes('CLAUDE.md');
      const doctor = await runAgentChecks();
      expect(statuses(doctor)).toEqual({ ai_rules: 'warn', skills: 'warn', claude_guard_hook: 'warn' });

      const r = await applyFixes(doctor, { projectRoot: tmp, ctxoRoot: join(tmp, '.ctxo'), dryRun: true });

      expect(r.attempts).toEqual([
        { name: 'Skills', action: 'install missing or outdated ctxo skills', status: 'planned' },
        { name: 'Claude guard hook', action: 'register ctxo gate-hook in .claude/settings.json', status: 'planned' },
        { name: 'AI rules', action: 're-render ctxo rules blocks', status: 'planned' },
      ]);
      expect(formatFixReport(r).split('\n')).toEqual([
        '  · Skills: install missing or outdated ctxo skills',
        '  · Claude guard hook: register ctxo gate-hook in .claude/settings.json',
        '  · AI rules: re-render ctxo rules blocks',
      ]);
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
      expect(existsSync(join(tmp, '.claude'))).toBe(false);
      expect(statuses(await runAgentChecks())).toEqual(statuses(doctor));
    });

    it('--fix keeps the unterminated-marker warning for a held CLAUDE.md', async () => {
      // The pre-tier block expects the guard, so CLAUDE.md is held; the start marker after it has no end marker.
      // (An unterminated block alone expects nothing, so it is not held: an opt-out holds nothing.)
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD + '\n' + renderRulesBlock('full').replace('\n<!-- ctxo-rules-end -->', '') + '\n');
      write(SETTINGS, 'not json{{{');
      const claudeMd = bytes('CLAUDE.md');

      const r = await fix(await runAgentChecks());

      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('failed');
      expect(rules?.error).toBe(
        'CLAUDE.md: ctxo rules start marker has no end marker; left unchanged; CLAUDE.md left unchanged while .claude/settings.json is unreadable',
      );
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
    });

    it('--fix leaves the Claude Code rules block alone while settings.json is unreadable', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      write('AGENTS.md', PRE_TIER_CLAUDE_MD.replace('# P', '# Agents'));
      write(SETTINGS, 'not json{{{');
      const claudeMd = bytes('CLAUDE.md');

      const r = await fix(await runAgentChecks());

      expect(attempt(r, 'Claude guard hook')?.status).toBe('failed');
      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('success');
      // The held file is a warning line under the success line, never shown as fixed.
      expect(rules?.warnings).toEqual(['CLAUDE.md left unchanged while .claude/settings.json is unreadable']);
      const output = formatFixReport(r).split('\n');
      const rulesLine = output.findIndex((line) => line.includes('AI rules: re-render ctxo rules blocks'));
      expect(output[rulesLine + 1]).toBe('      ⚠ CLAUDE.md left unchanged while .claude/settings.json is unreadable');
      expect(text('.ctxo/doctor-fix.log')).toContain('  - warning: CLAUDE.md left unchanged while .claude/settings.json is unreadable');
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
      expect(text('AGENTS.md')).toBe('# Agents\n\n' + renderRulesBlock('full') + '\n');
      const after = await runAgentChecks();
      expect(after.checks.find((c) => c.id === 'ai_rules')?.message).toBe(
        `CLAUDE.md: rules template outdated (unversioned block, template v${RULES_TEMPLATE_VERSION})`,
      );
    });

    it('after settings.json is repaired, --fix installs the guard and renders the compact tier', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      write(SETTINGS, 'not json{{{');
      const first = await fix(await runAgentChecks());
      expect(attempt(first, 'Claude guard hook')?.status).toBe('failed');

      write(SETTINGS, '{ "permissions": { "allow": [] } }\n');
      const doctor = await runAgentChecks();
      expect(doctor.checks.find((c) => c.id === 'ai_rules')?.message).toContain('rules present, guard missing');
      const second = await fix(doctor);

      expect(outcomes(second)).toEqual([['Claude guard hook', 'success'], ['AI rules', 'success']]);
      const settings = JSON.parse(text(SETTINGS)) as Record<string, unknown>;
      expect(settings['permissions']).toEqual({ allow: [] });
      expect(text(SETTINGS)).toContain('ctxo gate-hook');
      expect(text('CLAUDE.md')).toBe('# P\n\n' + renderRulesBlock('compact') + '\n');
      expect(statuses(await runAgentChecks())).toEqual(ALL_PASS);
    });

    it.each([
      ['null', 'null'],
      ['an array', '[]'],
      ['a string', '"settings"'],
      ['hooks as an array', '{ "hooks": [] }'],
      ['PreToolUse as an object', '{ "hooks": { "PreToolUse": {} } }'],
      ['a PreToolUse entry without hooks', '{ "hooks": { "PreToolUse": [{ "matcher": "Edit" }] } }'],
      ['JSONC comments', '// team settings\n{ "hooks": {} }\n'],
    ])('--fix leaves an unreadable settings.json unchanged: %s', async (_shape, content) => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      write(SETTINGS, content);
      const before = bytes(SETTINGS);
      const claudeMd = bytes('CLAUDE.md');
      const doctor = await runAgentChecks();
      expect(statuses(doctor)['claude_guard_hook']).toBe('warn');

      const r = await fix(doctor);

      expect(attempt(r, 'Claude guard hook')?.status).toBe('failed');
      expect(bytes(SETTINGS)).toEqual(before);
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
    });

    it('--fix reports an unterminated rules block as failed and leaves the file unchanged', async () => {
      write('AGENTS.md', '# Agents\n\n' + renderRulesBlock('full').replace('\n<!-- ctxo-rules-end -->', '') + '\n');
      const before = bytes('AGENTS.md');
      const doctor = await runAgentChecks();
      expect(statuses(doctor)['ai_rules']).toBe('warn');

      const r = await fix(doctor);

      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('failed');
      expect(rules?.error).toContain('AGENTS.md: ctxo rules start marker has no end marker; left unchanged');
      expect(bytes('AGENTS.md')).toEqual(before);
    });

    it('--fix reports an end marker without a start marker as failed and leaves the file unchanged', async () => {
      // The start marker line was deleted: no block is found, but the file is still passed to the writer (D8).
      const startLine = `<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->\n`;
      write('AGENTS.md', '# Agents\n\n' + renderRulesBlock('full').slice(startLine.length) + '\n');
      const before = bytes('AGENTS.md');
      const doctor = await runAgentChecks();
      expect(doctor.checks.find((c) => c.id === 'ai_rules')?.message).toBe('AGENTS.md: end marker without start marker');

      const r = await fix(doctor);

      const rules = attempt(r, 'AI rules');
      expect(rules?.status).toBe('failed');
      expect(rules?.error).toBe('AGENTS.md: ctxo rules end marker has no start marker; left unchanged');
      expect(bytes('AGENTS.md')).toEqual(before);
    });

    it('--fix reports the installSkills warning for a skill path that is a directory', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      mkdirSync(join(tmp, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md'), { recursive: true });
      const claudeMd = bytes('CLAUDE.md');

      const r = await fix(report([{ id: 'skills' }]));

      // The skill stays missing, so the step fails with the warning instead of reporting success.
      const skills = attempt(r, 'Skills');
      expect(skills?.status).toBe('failed');
      expect(skills?.error).toMatch(/^\.claude\/skills\/ctxo-safe-edit\/SKILL\.md: could not be read \(E\w+\); left unchanged$/);
      expect(existsSync(join(tmp, '.claude', 'skills', 'ctxo-understand', 'SKILL.md'))).toBe(true);
      expect(attempt(r, 'AI rules')?.error).toBe('CLAUDE.md left unchanged while the safe-edit guard is not registered and ctxo skills are missing (ctxo-safe-edit)');
      expect(bytes('CLAUDE.md')).toEqual(claudeMd);
    });

    it('--fix reports a skill from a newer ctxo as a warning line and installs the missing ones', async () => {
      write('CLAUDE.md', PRE_TIER_CLAUDE_MD);
      installSkills(tmp, 'claude-code');
      const newerFile = '.claude/skills/ctxo-review-pr/SKILL.md';
      const newer = text(newerFile).replace(`<!-- ctxo-skill v${SKILLS_TEMPLATE_VERSION} -->`, '<!-- ctxo-skill v99.0 -->');
      expect(newer).toContain('<!-- ctxo-skill v99.0 -->');
      write(newerFile, newer);
      rmSync(join(tmp, '.claude', 'skills', 'ctxo-safe-edit'), { recursive: true, force: true });

      const r = await fix(report([{ id: 'skills' }]));

      const skills = attempt(r, 'Skills');
      expect(skills?.status).toBe('success');
      expect(skills?.warnings).toEqual([`${newerFile}: skill v99.0 comes from a newer ctxo; left unchanged`]);
      expect(existsSync(join(tmp, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md'))).toBe(true);
      expect(text(newerFile)).toBe(newer);
    });

    it('--fix leaves a rules block from a newer ctxo alone and re-renders the others', async () => {
      write('CLAUDE.md', renderRulesBlock('full').replace(`v${RULES_TEMPLATE_VERSION}`, 'v99.0') + '\n');
      write('.windsurfrules', LEGACY_RULE_BODY + '\n');
      const before = bytes('CLAUDE.md');

      const r = await fix(report([{ id: 'ai_rules' }]));

      expect(attempt(r, 'AI rules')?.status).toBe('success');
      expect(bytes('CLAUDE.md')).toEqual(before);
      expect(text('.windsurfrules')).toBe(renderRulesBlock('full') + '\n');
    });
  });
});

describe('formatFixReport', () => {
  it('emits one line per attempt with status glyph', () => {
    const out = formatFixReport({
      attempts: [
        { name: 'Config', action: 'create', status: 'success', durationMs: 12 },
        { name: 'Plugins', action: 'install', status: 'failed', error: 'network' },
        { name: 'Index', action: 'rebuild', status: 'skipped' },
        { name: 'Cache', action: 'rebuild', status: 'planned' },
      ],
      halted: false,
    });
    expect(out).toMatch(/✓ Config/);
    expect(out).toMatch(/✗ Plugins.*network/);
    expect(out).toMatch(/- Index/);
    expect(out).toMatch(/· Cache/);
  });

  it('appends halt reason when halted', () => {
    const out = formatFixReport({ attempts: [], halted: true, reason: 'CI detected' });
    expect(out).toContain('halted: CI detected');
  });
});
