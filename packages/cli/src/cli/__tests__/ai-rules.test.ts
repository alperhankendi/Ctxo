import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, linkSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLATFORMS, generateRules, installRules, detectPlatforms, ensureGitignore, ensureConfig, ensureIndexDir, getMcpConfigTargets, ensureMcpConfig, installSkills, skillStates, SKILLS, SKILL_PLATFORMS, ensureClaudeHook, readClaudeGuardState, resolveRulesTier, gateEnabled, linkedRulesPlatforms, readRulesStates } from '../ai-rules.js';
import { InitCommand } from '../init-command.js';
import { applyFixes } from '../doctor-fix.js';
import { AiRulesCheck, SkillsCheck } from '../../adapters/diagnostics/checks/agent-setup-check.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';
import {
  LEGACY_CURSOR_FRONTMATTER,
  LEGACY_RULE_BODY,
  RULES_TEMPLATE_VERSION,
  SKILLS_TEMPLATE_VERSION,
  renderRulesBlock,
  skillTemplateVersion,
} from '../../core/agent-rules/rules-block.js';

const EM_DASH = String.fromCharCode(0x2014);
const BOM = String.fromCharCode(0xfeff);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeTempDir(prefix = 'ctxo-rules-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** packages/cli/skills, the folder `installSkills` copies from. */
const BUNDLED_SKILLS_DIR = join(import.meta.dirname, '..', '..', '..', 'skills');

/** LF text without a BOM, so a CRLF checkout (core.autocrlf) and an LF one compare equal. */
function normalised(text: string): string {
  return (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n/g, '\n');
}

function bundledSkill(skill: string): string {
  return normalised(readFileSync(join(BUNDLED_SKILLS_DIR, skill, 'SKILL.md'), 'utf-8'));
}

/** The guard entry ctxo registers under hooks.PreToolUse. */
const CTXO_GUARD_ENTRY = { matcher: 'Edit', hooks: [{ type: 'command', command: 'ctxo gate-hook' }] };

const UNREADABLE_SETTINGS_WARNING =
  '.claude/settings.json is not valid JSON or not a settings object; left unchanged. Fix it, then run "ctxo init --only rules,skills,guard".';

/** Writes `.claude/<name>` under root and returns its absolute path. */
function writeClaudeSettings(root: string, name: string, text: string): string {
  const file = join(root, '.claude', name);
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(file, text, 'utf-8');
  return file;
}

describe('PLATFORMS', () => {
  it('has unique IDs', () => {
    const ids = PLATFORMS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique file paths', () => {
    const files = PLATFORMS.map(p => p.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('every platform has at least one detect path', () => {
    for (const p of PLATFORMS) {
      expect(p.detectPaths.length).toBeGreaterThan(0);
    }
  });
});

describe('detectPlatforms', () => {
  it('returns empty set for a bare directory', () => {
    const dir = makeTempDir();
    expect(detectPlatforms(dir).size).toBe(0);
  });

  it('detects claude-code when CLAUDE.md exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'CLAUDE.md'), '# test', 'utf-8');
    const detected = detectPlatforms(dir);
    expect(detected.has('claude-code')).toBe(true);
  });

  it('detects cursor when .cursor/ exists', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.cursor'));
    const detected = detectPlatforms(dir);
    expect(detected.has('cursor')).toBe(true);
  });

  it('detects multiple platforms', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'CLAUDE.md'), '# test', 'utf-8');
    mkdirSync(join(dir, '.vscode'));
    const detected = detectPlatforms(dir);
    expect(detected.has('claude-code')).toBe(true);
    expect(detected.has('github-copilot')).toBe(true);
  });

  it('detects gemini-cli when .gemini/settings.json exists', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.gemini'));
    writeFileSync(join(dir, '.gemini', 'settings.json'), '{}', 'utf-8');
    const detected = detectPlatforms(dir);
    expect(detected.has('gemini-cli')).toBe(true);
  });

  it('detects continue when .continue/ exists', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.continue'));
    const detected = detectPlatforms(dir);
    expect(detected.has('continue')).toBe(true);
  });
});

describe('generateRules', () => {
  it('generates markdown with mandatory rules for all platforms', () => {
    for (const p of PLATFORMS) {
      const content = generateRules(p.id);
      expect(content).toContain('get_blast_radius');
      expect(content).toContain('get_why_context');
      expect(content).toContain('get_context_for_task');
      expect(content).toContain('NEVER');
    }
  });

  it('adds YAML frontmatter for cursor', () => {
    const content = generateRules('cursor');
    expect(content).toContain('---');
    expect(content).toContain('alwaysApply: true');
  });

  it('does not add frontmatter for non-cursor platforms', () => {
    const content = generateRules('claude-code');
    expect(content).not.toContain('alwaysApply');
  });

  it('the generated Cursor frontmatter has no em dash', () => {
    const content = generateRules('cursor');
    expect(content.startsWith('---\ndescription: ctxo MCP tool usage rules, always applied\nglobs:\nalwaysApply: true\n---\n\n')).toBe(true);
    expect(content).not.toContain(EM_DASH);
  });
});

describe('installRules', () => {
  it('creates a missing rules file', () => {
    const dir = makeTempDir();
    const result = installRules(dir, 'windsurf');

    expect(result.file).toBe('.windsurfrules');
    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);

    const content = readFileSync(join(dir, '.windsurfrules'), 'utf-8');
    expect(content).toContain('get_blast_radius');
  });

  it('creates nested directories for cursor', () => {
    const dir = makeTempDir();
    const result = installRules(dir, 'cursor');

    expect(result.file).toBe('.cursor/rules/ctxo.mdc');
    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);

    const content = readFileSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'), 'utf-8');
    expect(content).toContain('alwaysApply: true');
  });

  it('creates nested directories for amazon q', () => {
    const dir = makeTempDir();
    installRules(dir, 'amazonq');
    expect(existsSync(join(dir, '.amazonq', 'rules', 'ctxo.md'))).toBe(true);
  });

  it('appends a marked section to existing CLAUDE.md', () => {
    const dir = makeTempDir();
    const claudeMd = join(dir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# My Project\n\nExisting content.\n', 'utf-8');

    const result = installRules(dir, 'claude-code');
    expect(result.action).toBe('updated');

    const content = readFileSync(claudeMd, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
    expect(content).toContain(`<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->`);
    expect(content).toContain('<!-- ctxo-rules-end -->');
    expect(content).toContain('get_blast_radius');
  });

  it('replaces existing ctxo section on re-run (idempotent)', () => {
    const dir = makeTempDir();
    const claudeMd = join(dir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# My Project\n', 'utf-8');

    installRules(dir, 'claude-code');
    installRules(dir, 'claude-code');

    const content = readFileSync(claudeMd, 'utf-8');
    const startCount = (content.match(/<!-- ctxo-rules-start/g) ?? []).length;
    expect(startCount).toBe(1);
  });

  it.each(PLATFORMS)('a new rules file gets one versioned marked block for every platform ($id)', (platform) => {
    const dir = makeTempDir();

    const result = installRules(dir, platform.id);

    expect(result).toEqual({ file: platform.file, action: 'created' });
    const content = readFileSync(join(dir, platform.file), 'utf-8');
    expect(content).toBe(generateRules(platform.id));
    expect(content.match(/<!-- ctxo-rules-start/g)).toHaveLength(1);
    expect(content).toContain(`<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->\n`);
    expect(content.endsWith('<!-- ctxo-rules-end -->\n')).toBe(true);
  });

  it('a second run on a new CLAUDE.md is skipped and keeps one block', () => {
    const dir = makeTempDir();

    const first = installRules(dir, 'claude-code');
    const afterFirst = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    const second = installRules(dir, 'claude-code');

    expect(first.action).toBe('created');
    expect(second.action).toBe('skipped');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe(afterFirst);
    expect(content.match(/<!-- ctxo-rules-start/g)).toHaveLength(1);
  });

  it('a CLAUDE.md that older ctxo versions doubled collapses to one block', () => {
    const dir = makeTempDir();
    // Older versions created CLAUDE.md without markers, then appended a marked copy on the next run.
    const doubled = LEGACY_RULE_BODY + '\n' + '\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';
    writeFileSync(join(dir, 'CLAUDE.md'), doubled, 'utf-8');

    const result = installRules(dir, 'claude-code');

    expect(result.action).toBe('updated');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(renderRulesBlock('full') + '\n');
  });

  it('an existing AGENTS.md keeps user content outside the block', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'AGENTS.md'), '# Team rules\nBe kind.\n', 'utf-8');

    const result = installRules(dir, 'antigravity');

    expect(result.action).toBe('updated');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe('# Team rules\nBe kind.\n\n' + renderRulesBlock('full') + '\n');
  });

  it('reports created, then skipped, then updated when the tier changes', () => {
    const dir = makeTempDir();

    const actions = [
      installRules(dir, 'windsurf').action,
      installRules(dir, 'windsurf').action,
      installRules(dir, 'windsurf', { tier: 'compact' }).action,
    ];

    expect(actions).toEqual(['created', 'skipped', 'updated']);
    expect(readFileSync(join(dir, '.windsurfrules'), 'utf-8')).toBe(renderRulesBlock('compact') + '\n');
  });

  it('replaces an existing marked block in place, never appending a second one (#159 acceptance)', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'CLAUDE.md'), 'Intro\n\n<!-- ctxo-rules-start -->\nold\n<!-- ctxo-rules-end -->\n\nOutro\n', 'utf-8');

    const result = installRules(dir, 'claude-code');

    expect(result.action).toBe('updated');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('Intro\n\n' + renderRulesBlock('full') + '\n\nOutro\n');
  });

  it('upgrades legacy files from earlier ctxo versions without duplicating the rules', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.windsurfrules'), LEGACY_RULE_BODY + '\n', 'utf-8');
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'), LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n', 'utf-8');

    expect(installRules(dir, 'windsurf').action).toBe('updated');
    expect(installRules(dir, 'cursor').action).toBe('updated');

    expect(readFileSync(join(dir, '.windsurfrules'), 'utf-8')).toBe(renderRulesBlock('full') + '\n');
    expect(readFileSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'), 'utf-8')).toBe(generateRules('cursor'));
  });

  it('a current Cursor block under the legacy frontmatter gets the new frontmatter and reports updated', () => {
    const dir = makeTempDir();
    const file = join(dir, '.cursor', 'rules', 'ctxo.mdc');
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
    writeFileSync(file, LEGACY_CURSOR_FRONTMATTER + renderRulesBlock('full') + '\n', 'utf-8');

    const result = installRules(dir, 'cursor');

    expect(result.action).toBe('updated');
    expect(readFileSync(file, 'utf-8')).toBe(generateRules('cursor'));
    expect(installRules(dir, 'cursor').action).toBe('skipped');
  });

  it('a legacy Cursor file keeps its CRLF line endings and its BOM', () => {
    const dir = makeTempDir();
    const file = join(dir, '.cursor', 'rules', 'ctxo.mdc');
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
    const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
    writeFileSync(file, BOM + crlf(LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n'), 'utf-8');

    const result = installRules(dir, 'cursor');

    expect(result.action).toBe('updated');
    expect(readFileSync(file, 'utf-8')).toBe(BOM + crlf(generateRules('cursor')));
  });

  it('an existing Cursor file without the legacy frontmatter gets no frontmatter added', () => {
    const dir = makeTempDir();
    const file = join(dir, '.cursor', 'rules', 'ctxo.mdc');
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
    const own = '---\ndescription: team rules\nalwaysApply: true\n---\n\nOur rules.\n';
    writeFileSync(file, own, 'utf-8');

    const result = installRules(dir, 'cursor');

    expect(result.action).toBe('updated');
    expect(readFileSync(file, 'utf-8')).toBe(own + '\n' + renderRulesBlock('full') + '\n');
  });

  it('writes the compact tier when asked', () => {
    const dir = makeTempDir();

    const result = installRules(dir, 'claude-code', { tier: 'compact' });

    expect(result.action).toBe('created');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe(renderRulesBlock('compact') + '\n');
    // Non-blank lines only: the block carries Prettier's blank lines around the markers and the heading.
    expect(content.split('\n').filter((line) => line.trim() !== '').length).toBeLessThanOrEqual(8);
  });

  it('dryRun reports the action and writes nothing', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'AGENTS.md'), '# Team rules\n', 'utf-8');

    expect(installRules(dir, 'cursor', { dryRun: true })).toEqual({ file: '.cursor/rules/ctxo.mdc', action: 'created' });
    expect(existsSync(join(dir, '.cursor'))).toBe(false);

    expect(installRules(dir, 'antigravity', { dryRun: true }).action).toBe('updated');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe('# Team rules\n');
  });

  it('an unterminated block is left byte-for-byte unchanged with a warning', () => {
    const dir = makeTempDir();
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, 'Intro\r\n\r\n<!-- ctxo-rules-start -->\r\nold rules\r\n', 'utf-8');
    const before = readFileSync(file);

    const result = installRules(dir, 'claude-code');

    expect(result.action).toBe('skipped');
    expect(result.warning).toContain('CLAUDE.md');
    expect(result.warning).toContain('no end marker');
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('a block from a newer ctxo is left unchanged with a warning', () => {
    const dir = makeTempDir();
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, '<!-- ctxo-rules-start v99.0 -->\nfuture rules\n<!-- ctxo-rules-end -->\n', 'utf-8');
    const before = readFileSync(file);

    const result = installRules(dir, 'claude-code');

    expect(result.action).toBe('skipped');
    expect(result.warning).toBe('CLAUDE.md: rules block v99.0 comes from a newer ctxo; left unchanged');
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('creates CLAUDE.md if it does not exist', () => {
    const dir = makeTempDir();
    const result = installRules(dir, 'claude-code');

    expect(result.action).toBe('created');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
  });

  it('a CLAUDE.md with CRLF line endings and a BOM keeps both when its block is rewritten', () => {
    const dir = makeTempDir();
    const file = join(dir, 'CLAUDE.md');
    const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
    const preTier = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n\nNotes\n';
    writeFileSync(file, BOM + crlf(preTier), 'utf-8');

    expect(installRules(dir, 'claude-code')).toEqual({ file: 'CLAUDE.md', action: 'updated' });
    expect(readFileSync(file, 'utf-8')).toBe(BOM + crlf('# P\n\n' + renderRulesBlock('full') + '\n\nNotes\n'));
    expect(installRules(dir, 'claude-code').action).toBe('skipped');
  });

  it('a legacy GEMINI.md is upgraded in place', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'GEMINI.md'), '# Gemini\n\n' + LEGACY_RULE_BODY + '\n\nMore notes\n', 'utf-8');

    expect(installRules(dir, 'gemini-cli')).toEqual({ file: 'GEMINI.md', action: 'updated' });
    expect(readFileSync(join(dir, 'GEMINI.md'), 'utf-8')).toBe('# Gemini\n\n' + renderRulesBlock('full') + '\n\nMore notes\n');
  });

  it('a dry run of a current rules file reports unchanged (skipped)', () => {
    const dir = makeTempDir();
    installRules(dir, 'windsurf');
    const before = readFileSync(join(dir, '.windsurfrules'));

    expect(installRules(dir, 'windsurf', { dryRun: true })).toEqual({ file: '.windsurfrules', action: 'skipped' });
    expect(readFileSync(join(dir, '.windsurfrules')).equals(before)).toBe(true);
  });

  it('a rules path that cannot be read gets a warning instead of an error, in a dry run too', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'CLAUDE.md'));

    for (const dryRun of [true, false]) {
      let result: ReturnType<typeof installRules> | undefined;
      expect(() => { result = installRules(dir, 'claude-code', { dryRun }); }).not.toThrow();
      expect(result).toMatchObject({ file: 'CLAUDE.md', action: 'skipped' });
      expect(result?.warning).toMatch(/^CLAUDE\.md: could not be read \(.+\); left unchanged$/);
    }
    expect(readdirSync(join(dir, 'CLAUDE.md'))).toEqual([]);
  });

  it('an empty or whitespace-only Cursor rules file gets the frontmatter, like a created one', () => {
    const dir = makeTempDir();
    const file = join(dir, '.cursor', 'rules', 'ctxo.mdc');
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });

    writeFileSync(file, '', 'utf-8');
    expect(installRules(dir, 'cursor')).toEqual({ file: '.cursor/rules/ctxo.mdc', action: 'updated' });
    expect(readFileSync(file, 'utf-8')).toBe(generateRules('cursor'));
    expect(installRules(dir, 'cursor').action).toBe('skipped');

    writeFileSync(file, BOM + ' \r\n\r\n', 'utf-8');
    expect(installRules(dir, 'cursor').action).toBe('updated');
    expect(readFileSync(file, 'utf-8')).toBe(BOM + generateRules('cursor').replace(/\n/g, '\r\n'));
  });

  it('an end marker without a start marker is left byte-for-byte unchanged with a warning', () => {
    const dir = makeTempDir();
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, 'Intro\n\nold rules\n<!-- ctxo-rules-end -->\n', 'utf-8');
    const before = readFileSync(file);

    const result = installRules(dir, 'claude-code');

    expect(result).toEqual({
      file: 'CLAUDE.md',
      action: 'skipped',
      warning: 'CLAUDE.md: ctxo rules end marker has no start marker; left unchanged',
    });
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('throws on unknown platform ID', () => {
    const dir = makeTempDir();
    expect(() => installRules(dir, 'unknown-tool')).toThrow('Unknown platform');
  });

  it('installs all platforms without error', () => {
    const dir = makeTempDir();
    for (const p of PLATFORMS) {
      expect(() => installRules(dir, p.id)).not.toThrow();
    }
  });
});

describe('ensureGitignore', () => {
  it('creates .gitignore with cache entry if missing', () => {
    const dir = makeTempDir();
    const result = ensureGitignore(dir);
    expect(result.action).toBe('created');
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('.ctxo/.cache/');
  });

  it('appends cache entry to existing .gitignore', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
    const result = ensureGitignore(dir);
    expect(result.action).toBe('updated');
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.ctxo/.cache/');
  });

  it('skips if entry already exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), '.ctxo/.cache/\n', 'utf-8');
    const result = ensureGitignore(dir);
    expect(result.action).toBe('skipped');
  });

  it('is idempotent — does not duplicate entry', () => {
    const dir = makeTempDir();
    ensureGitignore(dir);
    ensureGitignore(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    const count = (content.match(/\.ctxo\/\.cache\//g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('ensureConfig', () => {
  it('creates config.yaml with defaults', () => {
    const dir = makeTempDir();
    const result = ensureConfig(dir);
    expect(result.action).toBe('created');
    expect(existsSync(join(dir, '.ctxo', 'config.yaml'))).toBe(true);
    const content = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
    expect(content).toContain('version');
    expect(content).toContain('ignore: []');
    expect(content).toContain('ignoreProjects: []');
    expect(content).toContain('gate:');
    expect(content).toContain('sensitivity: balanced');
  });

  it('generated config.yaml passes the loader and doctor checks', async () => {
    const dir = makeTempDir();
    ensureConfig(dir);
    const { loadConfig } = await import('../../core/config/load-config.js');
    const loaded = loadConfig(join(dir, '.ctxo'));
    expect(loaded.errors).toEqual([]);
    expect(loaded.invalidGlobs).toEqual([]);
  });

  describe('cochange block', () => {
    // The commented block, from its "# cochange:" line to the first line that is not part of it.
    function cochangeBlock(content: string): string[] {
      const lines = content.split('\n');
      const start = lines.indexOf('# cochange:');
      if (start === -1) return [];
      const block = [lines[start]!];
      for (const line of lines.slice(start + 1)) {
        if (!line.startsWith('#   ')) break;
        block.push(line);
      }
      return block;
    }

    it('lists every cochange key with its default, fully commented out', () => {
      const dir = makeTempDir();
      ensureConfig(dir);
      const content = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');

      const block = cochangeBlock(content).join('\n');
      expect(block).toContain('#   maxCommits: 2000');
      expect(block).toMatch(/^#   # since: 12m/m);
      expect(block).toContain('#   maxFilesPerCommit: 30');
      expect(block).toContain('#   minShared: 2');
      expect(block).toContain('#   include: []');
      expect(block).toContain('#   exclude: []');
      // Fully commented: no active cochange section, so the defaults apply exactly as before.
      expect(content.split('\n').some((line) => line.startsWith('cochange:'))).toBe(false);
    });

    it('changes neither the loaded config nor its validation', async () => {
      const dir = makeTempDir();
      ensureConfig(dir);
      const { loadConfig, resolveCoChangeConfig } = await import('../../core/config/load-config.js');
      const { DEFAULT_CONFIG } = await import('../../core/config/config-schema.js');

      const loaded = loadConfig(join(dir, '.ctxo'));

      expect(loaded.errors).toEqual([]);
      expect(loaded.config.cochange).toBeUndefined();
      expect(resolveCoChangeConfig(loaded.config)).toStrictEqual(resolveCoChangeConfig(DEFAULT_CONFIG));
    });

    it('is valid and keeps the defaults when a user uncomments it', async () => {
      const dir = makeTempDir();
      ensureConfig(dir);
      const content = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
      const uncommented = cochangeBlock(content).map((line) => line.slice(2));
      expect(uncommented[0]).toBe('cochange:');
      writeFileSync(join(dir, '.ctxo', 'config.yaml'), `version: "1.0"\n${uncommented.join('\n')}\n`, 'utf-8');
      const { loadConfig, resolveCoChangeConfig } = await import('../../core/config/load-config.js');
      const { DEFAULT_CONFIG } = await import('../../core/config/config-schema.js');

      const loaded = loadConfig(join(dir, '.ctxo'));

      expect(loaded.errors).toEqual([]);
      expect(resolveCoChangeConfig(loaded.config)).toStrictEqual(resolveCoChangeConfig(DEFAULT_CONFIG));
    });
  });

  it('skips if config.yaml already exists', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.ctxo'), { recursive: true });
    writeFileSync(join(dir, '.ctxo', 'config.yaml'), 'custom: true\n', 'utf-8');
    const result = ensureConfig(dir);
    expect(result.action).toBe('skipped');
    const content = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
    expect(content).toBe('custom: true\n');
  });

  it('creates .ctxo/ directory if missing', () => {
    const dir = makeTempDir();
    ensureConfig(dir);
    expect(existsSync(join(dir, '.ctxo'))).toBe(true);
  });
});

describe('getMcpConfigTargets', () => {
  it('returns .mcp.json for claude-code', () => {
    const targets = getMcpConfigTargets(['claude-code']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.mcp.json');
    expect(targets[0].serverKey).toBe('mcpServers');
  });

  it('returns .vscode/mcp.json for github-copilot', () => {
    const targets = getMcpConfigTargets(['github-copilot']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.vscode/mcp.json');
    expect(targets[0].serverKey).toBe('servers');
  });

  it('returns .amazonq/mcp.json for amazonq', () => {
    const targets = getMcpConfigTargets(['amazonq']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.amazonq/mcp.json');
  });

  it('deduplicates .mcp.json for multiple tools', () => {
    const targets = getMcpConfigTargets(['claude-code', 'cursor', 'windsurf']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.mcp.json');
  });

  it('returns both .mcp.json and .vscode/mcp.json when mixed', () => {
    const targets = getMcpConfigTargets(['claude-code', 'github-copilot']);
    expect(targets).toHaveLength(2);
    const files = targets.map(t => t.file).sort();
    expect(files).toEqual(['.mcp.json', '.vscode/mcp.json']);
  });

  it('returns empty for no tools', () => {
    expect(getMcpConfigTargets([])).toHaveLength(0);
  });

  it('returns .gemini/settings.json for gemini-cli', () => {
    const targets = getMcpConfigTargets(['gemini-cli']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.gemini/settings.json');
    expect(targets[0].serverKey).toBe('mcpServers');
  });

  it('returns .continue/mcpServers/ctxo.json for continue', () => {
    const targets = getMcpConfigTargets(['continue']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.continue/mcpServers/ctxo.json');
    expect(targets[0].serverKey).toBe('mcpServers');
  });
});

describe('ensureMcpConfig', () => {
  it('creates .mcp.json with ctxo entry', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['claude-code'])[0];
    const result = ensureMcpConfig(dir, target);

    expect(result.action).toBe('created');
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers.ctxo).toBeDefined();
    expect(config.mcpServers.ctxo.command).toBe('npx');
    expect(config.mcpServers.ctxo.args).toContain('@ctxo/cli');
  });

  it('creates .vscode/mcp.json with type: stdio for copilot', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['github-copilot'])[0];
    ensureMcpConfig(dir, target);

    const config = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
    expect(config.servers.ctxo.type).toBe('stdio');
    expect(config.servers.ctxo.command).toBe('npx');
  });

  it('merges into existing config without overwriting other servers', () => {
    const dir = makeTempDir();
    const existing = { mcpServers: { other: { command: 'node', args: ['other.js'] } } };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(existing), 'utf-8');

    const target = getMcpConfigTargets(['claude-code'])[0];
    const result = ensureMcpConfig(dir, target);

    expect(result.action).toBe('updated');
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers.other).toBeDefined();
    expect(config.mcpServers.ctxo).toBeDefined();
  });

  it('skips if ctxo already registered', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['claude-code'])[0];
    ensureMcpConfig(dir, target);
    const result = ensureMcpConfig(dir, target);
    expect(result.action).toBe('skipped');
  });

  it('creates parent directory if missing', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['amazonq'])[0];
    ensureMcpConfig(dir, target);
    expect(existsSync(join(dir, '.amazonq', 'mcp.json'))).toBe(true);
  });

  it('handles corrupt JSON by overwriting', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.mcp.json'), 'not json{{{', 'utf-8');
    const target = getMcpConfigTargets(['claude-code'])[0];
    const result = ensureMcpConfig(dir, target);
    expect(result.action).toBe('updated');
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers.ctxo).toBeDefined();
  });

  // D12: corrupt MCP JSON is overwritten. JSON that parses but has no usable server map counts as
  // corrupt, so ensureMcpConfig never throws on a file's content. A real run and a dry run agree.
  it.each([
    ['an array root', '[ ]'],
    ['a string root', '"servers"'],
    ['a number root', '42'],
    ['a null root', 'null'],
    ['a string mcpServers', '{ "mcpServers": "elsewhere" }'],
    ['an array mcpServers', '{ "mcpServers": [] }'],
    ['a number mcpServers', '{ "mcpServers": 1 }'],
  ])('ensureMcpConfig overwrites %s like corrupt MCP JSON (D12)', (_shape, original) => {
    const target = getMcpConfigTargets(['claude-code'])[0]!;
    const dir = makeTempDir();
    const file = join(dir, '.mcp.json');
    writeFileSync(file, original, 'utf-8');

    expect(ensureMcpConfig(dir, target, { dryRun: true })).toEqual({ file: '.mcp.json', action: 'updated' });
    expect(readFileSync(file, 'utf-8')).toBe(original);
    expect(ensureMcpConfig(dir, target)).toEqual({ file: '.mcp.json', action: 'updated' });
    expect(readFileSync(file, 'utf-8')).toBe(
      JSON.stringify({ mcpServers: { ctxo: { command: 'npx', args: ['-y', '@ctxo/cli'] } } }, null, 2) + '\n',
    );
  });

  it('ensureMcpConfig merges into a null mcpServers and keeps the other keys in order', () => {
    const target = getMcpConfigTargets(['claude-code'])[0]!;
    const dir = makeTempDir();
    writeFileSync(join(dir, '.mcp.json'), '{ "a": 1, "mcpServers": null, "z": 2 }', 'utf-8');

    expect(ensureMcpConfig(dir, target)).toEqual({ file: '.mcp.json', action: 'updated' });
    expect(Object.keys(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8')))).toEqual(['a', 'mcpServers', 'z']);
    expect(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8')).mcpServers.ctxo.command).toBe('npx');
  });

  it('ensureMcpConfig warns instead of throwing when the config path is a directory', () => {
    const target = getMcpConfigTargets(['claude-code'])[0]!;
    const dir = makeTempDir();
    mkdirSync(join(dir, '.mcp.json'));

    for (const dryRun of [true, false]) {
      const result = ensureMcpConfig(dir, target, { dryRun });
      expect(result).toMatchObject({ file: '.mcp.json', action: 'skipped' });
      expect(result.warning).toMatch(/^\.mcp\.json: could not be read \(\w+\); left unchanged$/);
    }
  });

  it('creates .gemini/settings.json with mcpServers.ctxo', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['gemini-cli'])[0];
    const result = ensureMcpConfig(dir, target);

    expect(result.action).toBe('created');
    const config = JSON.parse(readFileSync(join(dir, '.gemini', 'settings.json'), 'utf-8'));
    expect(config.mcpServers.ctxo.command).toBe('npx');
    expect(config.mcpServers.ctxo.args).toContain('@ctxo/cli');
  });

  it('creates .continue/mcpServers/ctxo.json with mcpServers.ctxo', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['continue'])[0];
    const result = ensureMcpConfig(dir, target);

    expect(result.action).toBe('created');
    expect(existsSync(join(dir, '.continue', 'mcpServers', 'ctxo.json'))).toBe(true);
    const config = JSON.parse(readFileSync(join(dir, '.continue', 'mcpServers', 'ctxo.json'), 'utf-8'));
    expect(config.mcpServers.ctxo.command).toBe('npx');
    expect(config.mcpServers.ctxo.args).toContain('@ctxo/cli');
  });
});

describe('scaffolding writers in dryRun', () => {
  /** Every path under root (directories end in `/`) with its file content, so a test can prove nothing changed. */
  function tree(root: string, sub = ''): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const entry of readdirSync(join(root, sub), { withFileTypes: true })) {
      const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
      if (entry.isDirectory()) {
        entries[`${rel}/`] = '';
        Object.assign(entries, tree(root, rel));
      } else {
        entries[rel] = readFileSync(join(root, rel), 'utf-8');
      }
    }
    return entries;
  }

  const mcp = (platformId: string) => getMcpConfigTargets([platformId])[0]!;

  it('ensureGitignore, ensureConfig, ensureIndexDir and ensureMcpConfig write nothing in dryRun', () => {
    const empty = makeTempDir();
    expect(ensureIndexDir(empty, { dryRun: true })).toEqual({ file: '.ctxo/index/', action: 'created' });
    expect(ensureConfig(empty, { dryRun: true })).toEqual({ file: '.ctxo/config.yaml', action: 'created' });
    expect(ensureGitignore(empty, { dryRun: true })).toEqual({ file: '.gitignore', action: 'created' });
    expect(ensureMcpConfig(empty, mcp('claude-code'), { dryRun: true })).toEqual({ file: '.mcp.json', action: 'created' });
    expect(ensureMcpConfig(empty, mcp('github-copilot'), { dryRun: true })).toEqual({ file: '.vscode/mcp.json', action: 'created' });
    expect(ensureMcpConfig(empty, mcp('continue'), { dryRun: true })).toEqual({ file: '.continue/mcpServers/ctxo.json', action: 'created' });
    expect(tree(empty)).toEqual({});

    const existing = makeTempDir();
    writeFileSync(join(existing, '.gitignore'), 'node_modules/\n', 'utf-8');
    writeFileSync(join(existing, '.mcp.json'), '{"mcpServers":{"other":{"command":"node"}}}', 'utf-8');
    mkdirSync(join(existing, '.vscode'));
    writeFileSync(join(existing, '.vscode', 'mcp.json'), 'not json{{{', 'utf-8');
    const before = tree(existing);
    expect(ensureIndexDir(existing, { dryRun: true }).action).toBe('created');
    expect(ensureConfig(existing, { dryRun: true }).action).toBe('created');
    expect(ensureGitignore(existing, { dryRun: true })).toEqual({ file: '.gitignore', action: 'updated' });
    expect(ensureMcpConfig(existing, mcp('claude-code'), { dryRun: true })).toEqual({ file: '.mcp.json', action: 'updated' });
    expect(ensureMcpConfig(existing, mcp('github-copilot'), { dryRun: true })).toEqual({ file: '.vscode/mcp.json', action: 'updated' });
    expect(tree(existing)).toEqual(before);

    const current = makeTempDir();
    ensureIndexDir(current);
    ensureConfig(current);
    ensureGitignore(current);
    ensureMcpConfig(current, mcp('claude-code'));
    const written = tree(current);
    expect(ensureIndexDir(current, { dryRun: true }).action).toBe('skipped');
    expect(ensureConfig(current, { dryRun: true }).action).toBe('skipped');
    expect(ensureGitignore(current, { dryRun: true }).action).toBe('skipped');
    expect(ensureMcpConfig(current, mcp('claude-code'), { dryRun: true }).action).toBe('skipped');
    expect(tree(current)).toEqual(written);
  });
});

describe('installSkills', () => {
  it('copies skills into .claude/skills for claude-code', () => {
    const root = makeTempDir();
    const results = installSkills(root, 'claude-code');
    expect(results.length).toBe(SKILLS.length);
    const f = join(root, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md');
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f, 'utf-8')).toContain('Safe edit with ctxo');
  });

  it('writes cursor skills as .mdc files', () => {
    const root = makeTempDir();
    const results = installSkills(root, 'cursor');
    expect(results.length).toBe(SKILLS.length);
    expect(existsSync(join(root, '.cursor', 'rules', 'ctxo-safe-edit.mdc'))).toBe(true);
  });

  it('returns an empty list for a platform without skill support', () => {
    const root = makeTempDir();
    expect(installSkills(root, 'amazonq')).toEqual([]);
  });

  it('skips a skill that differs only in line endings', () => {
    const root = makeTempDir();
    const files = SKILLS.map(skill => join(root, '.claude', 'skills', skill, 'SKILL.md'));
    SKILLS.forEach((skill, i) => {
      mkdirSync(join(root, '.claude', 'skills', skill), { recursive: true });
      writeFileSync(files[i], bundledSkill(skill).replace(/\n/g, '\r\n'), 'utf-8');
    });
    const before = files.map(f => readFileSync(f));

    const results = installSkills(root, 'claude-code');

    expect(results.map(r => r.action)).toEqual(SKILLS.map(() => 'skipped'));
    files.forEach((f, i) => expect(readFileSync(f).equals(before[i])).toBe(true));
  });

  it('skips a skill that differs only in a UTF-8 BOM', () => {
    const root = makeTempDir();
    const files = SKILLS.map(skill => join(root, '.cursor', 'rules', `${skill}.mdc`));
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    SKILLS.forEach((skill, i) => writeFileSync(files[i], BOM + bundledSkill(skill), 'utf-8'));
    const before = files.map(f => readFileSync(f));

    const results = installSkills(root, 'cursor');

    expect(results.map(r => r.action)).toEqual(SKILLS.map(() => 'skipped'));
    files.forEach((f, i) => expect(readFileSync(f).equals(before[i])).toBe(true));
  });

  it('rewrites an edited skill and reports updated', () => {
    const root = makeTempDir();
    installSkills(root, 'claude-code');
    const edited = join(root, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md');
    writeFileSync(edited, readFileSync(edited, 'utf-8') + '\nA local edit.\n', 'utf-8');

    const results = installSkills(root, 'claude-code');

    expect(results.map(r => [r.file, r.action])).toEqual([
      ['.claude/skills/ctxo-understand/SKILL.md', 'skipped'],
      ['.claude/skills/ctxo-safe-edit/SKILL.md', 'updated'],
      ['.claude/skills/ctxo-review-pr/SKILL.md', 'skipped'],
    ]);
    expect(normalised(readFileSync(edited, 'utf-8'))).toBe(bundledSkill('ctxo-safe-edit'));
  });

  it('returns project-relative paths and writes nothing in dryRun', () => {
    const root = makeTempDir();

    const claude = installSkills(root, 'claude-code', { dryRun: true });
    const cursor = installSkills(root, 'cursor', { dryRun: true });

    expect(claude.find(r => r.file === '.claude/skills/ctxo-safe-edit/SKILL.md')?.action).toBe('created');
    expect(cursor.find(r => r.file === '.cursor/rules/ctxo-safe-edit.mdc')?.action).toBe('created');
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, '.cursor'))).toBe(false);
  });

  it('reports updated in dryRun for an edited skill without rewriting it', () => {
    const root = makeTempDir();
    installSkills(root, 'claude-code');
    const edited = join(root, '.claude', 'skills', 'ctxo-review-pr', 'SKILL.md');
    writeFileSync(edited, 'edited\n', 'utf-8');

    const results = installSkills(root, 'claude-code', { dryRun: true });

    expect(results.find(r => r.file.endsWith('ctxo-review-pr/SKILL.md'))?.action).toBe('updated');
    expect(readFileSync(edited, 'utf-8')).toBe('edited\n');
  });

  it('writes the skill files as bundled on a first install', () => {
    const root = makeTempDir();
    installSkills(root, 'claude-code');
    for (const skill of SKILLS) {
      const file = join(root, '.claude', 'skills', skill, 'SKILL.md');
      expect(normalised(readFileSync(file, 'utf-8'))).toBe(bundledSkill(skill));
    }
  });

  it('installSkills warns instead of throwing when a skill path is a directory', () => {
    const root = makeTempDir();
    const blocked = join(root, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md');
    mkdirSync(blocked, { recursive: true });

    for (const dryRun of [true, false]) {
      let results: ReturnType<typeof installSkills> = [];
      expect(() => { results = installSkills(root, 'claude-code', { dryRun }); }).not.toThrow();
      expect(results[1]).toMatchObject({ file: '.claude/skills/ctxo-safe-edit/SKILL.md', action: 'skipped' });
      expect(results[1]?.warning).toMatch(/^\.claude\/skills\/ctxo-safe-edit\/SKILL\.md: could not be read \(.+\); left unchanged$/);
    }
    expect(existsSync(join(root, '.claude', 'skills', 'ctxo-understand', 'SKILL.md'))).toBe(true);
    expect(readdirSync(blocked)).toEqual([]);
    expect(skillStates(root, 'claude-code').map((s) => s.state)).toEqual(['current', 'missing', 'current']);
  });

  it('installSkills leaves a skill from a newer ctxo alone with a warning', () => {
    const root = makeTempDir();
    installSkills(root, 'claude-code');
    const newer = join(root, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md');
    writeFileSync(newer, '# Safe edit, as a newer ctxo writes it\n\n<!-- ctxo-skill v99.0 -->\n', 'utf-8');
    const before = readFileSync(newer);

    const results = installSkills(root, 'claude-code');

    expect(results).toEqual([
      { file: '.claude/skills/ctxo-understand/SKILL.md', action: 'skipped' },
      {
        file: '.claude/skills/ctxo-safe-edit/SKILL.md',
        action: 'skipped',
        warning: '.claude/skills/ctxo-safe-edit/SKILL.md: skill v99.0 comes from a newer ctxo; left unchanged',
      },
      { file: '.claude/skills/ctxo-review-pr/SKILL.md', action: 'skipped' },
    ]);
    expect(readFileSync(newer).equals(before)).toBe(true);
    expect(installSkills(root, 'claude-code', { dryRun: true })[1]).toEqual(results[1]);
    expect(skillStates(root, 'claude-code').map((s) => s.state)).toEqual(['current', 'newer', 'current']);
  });

  it('a skill without a version marker or with an older one is outdated and rewritten', () => {
    const root = makeTempDir();
    installSkills(root, 'claude-code');
    const unversioned = join(root, '.claude', 'skills', 'ctxo-understand', 'SKILL.md');
    const older = join(root, '.claude', 'skills', 'ctxo-review-pr', 'SKILL.md');
    const marker = `<!-- ctxo-skill v${SKILLS_TEMPLATE_VERSION} -->`;
    writeFileSync(unversioned, bundledSkill('ctxo-understand').replace(marker, ''), 'utf-8');
    writeFileSync(older, bundledSkill('ctxo-review-pr').replace(marker, '<!-- ctxo-skill v0.1 -->'), 'utf-8');

    expect(skillStates(root, 'claude-code').map((s) => s.state)).toEqual(['outdated', 'current', 'outdated']);
    expect(installSkills(root, 'claude-code').map((r) => r.action)).toEqual(['updated', 'skipped', 'updated']);
    expect(normalised(readFileSync(unversioned, 'utf-8'))).toBe(bundledSkill('ctxo-understand'));
    expect(normalised(readFileSync(older, 'utf-8'))).toBe(bundledSkill('ctxo-review-pr'));
  });

  it('skills does not report a skill from a newer ctxo', async () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'CLAUDE.md'), renderRulesBlock('compact') + '\n', 'utf-8');
    installSkills(root, 'claude-code');
    for (const skill of SKILLS) {
      writeFileSync(join(root, '.claude', 'skills', skill, 'SKILL.md'), `# ${skill} v99\n\n<!-- ctxo-skill v99.0 -->\n`, 'utf-8');
    }

    const result = await new SkillsCheck().run({ projectRoot: root, ctxoRoot: join(root, '.ctxo') });

    expect(result.status).toBe('pass');
    expect(result.message).not.toContain('outdated');
  });
});

describe('SKILL_PLATFORMS', () => {
  it('lists the platforms that get skills', () => {
    expect([...SKILL_PLATFORMS]).toEqual(['claude-code', 'cursor']);
  });
});

describe('skillStates', () => {
  it('reports missing, outdated and current skills', () => {
    const root = makeTempDir();
    expect(skillStates(root, 'claude-code').map(s => s.state)).toEqual(['missing', 'missing', 'missing']);

    installSkills(root, 'claude-code');
    expect(skillStates(root, 'claude-code').map(s => s.state)).toEqual(['current', 'current', 'current']);

    writeFileSync(join(root, '.claude', 'skills', 'ctxo-understand', 'SKILL.md'), 'edited\n', 'utf-8');
    rmSync(join(root, '.claude', 'skills', 'ctxo-review-pr', 'SKILL.md'));

    expect(skillStates(root, 'claude-code')).toEqual([
      { skill: 'ctxo-understand', file: '.claude/skills/ctxo-understand/SKILL.md', state: 'outdated' },
      { skill: 'ctxo-safe-edit', file: '.claude/skills/ctxo-safe-edit/SKILL.md', state: 'current' },
      { skill: 'ctxo-review-pr', file: '.claude/skills/ctxo-review-pr/SKILL.md', state: 'missing' },
    ]);
  });

  it('reports a copy that differs only in line endings or a BOM as current', () => {
    const root = makeTempDir();
    installSkills(root, 'claude-code');
    const crlf = join(root, '.claude', 'skills', 'ctxo-understand', 'SKILL.md');
    const bom = join(root, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md');
    writeFileSync(crlf, bundledSkill('ctxo-understand').replace(/\n/g, '\r\n'), 'utf-8');
    writeFileSync(bom, BOM + bundledSkill('ctxo-safe-edit'), 'utf-8');

    expect(skillStates(root, 'claude-code').map(s => s.state)).toEqual(['current', 'current', 'current']);
  });

  it('uses the cursor file names for cursor', () => {
    const root = makeTempDir();
    expect(skillStates(root, 'cursor').map(s => s.file)).toEqual(SKILLS.map(skill => `.cursor/rules/${skill}.mdc`));
  });

  it('returns an empty list for a platform without skill support', () => {
    expect(skillStates(makeTempDir(), 'amazonq')).toEqual([]);
  });

  it('does not treat an Object.prototype name as a skill platform', () => {
    const root = makeTempDir();
    expect(skillStates(root, 'constructor')).toEqual([]);
    expect(installSkills(root, 'toString')).toEqual([]);
  });
});

describe('bundled skills', () => {
  const GUIDE_TOOLS = [
    'get_logic_slice',
    'get_blast_radius',
    'get_architectural_overlay',
    'get_why_context',
    'get_change_intelligence',
    'find_dead_code',
    'get_context_for_task',
    'get_ranked_context',
    'search_symbols',
    'get_changed_symbols',
    'find_importers',
    'get_class_hierarchy',
    'get_symbol_importance',
    'get_pr_impact',
  ];

  it('ctxo-understand carries the tool selection guide for all 14 tools', () => {
    const text = bundledSkill('ctxo-understand');
    expect(text).toContain('## Which tool for which question');
    for (const tool of GUIDE_TOOLS) expect(text, tool).toContain(`\`${tool}`);
    expect(GUIDE_TOOLS).toHaveLength(14);
  });

  it('the guide tools are exactly the MCP tools the server registers', () => {
    // packages/cli/src/index.ts registers every tool with server.registerTool('<name>', ...).
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'index.ts'), 'utf-8');
    const registered = [...source.matchAll(/\bregisterTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect([...registered].sort()).toEqual([...GUIDE_TOOLS].sort());
  });

  it('ctxo-understand matches the narrowed rules wording', () => {
    const text = bundledSkill('ctxo-understand');
    expect(text).not.toContain('before reading source files');
    expect(text).toContain('Reading a file to see its contents needs no index call.');
  });

  it('no bundled skill contains an em dash', () => {
    for (const skill of SKILLS) expect(bundledSkill(skill), skill).not.toContain(EM_DASH);
  });

  it('no bundled skill starts with a BOM', () => {
    for (const skill of SKILLS) {
      expect(readFileSync(join(BUNDLED_SKILLS_DIR, skill, 'SKILL.md'), 'utf-8').startsWith(BOM), skill).toBe(false);
    }
  });

  it('every bundled skill ends with the skills template version marker', () => {
    expect(SKILLS_TEMPLATE_VERSION).toMatch(/^\d+\.\d+$/);
    for (const skill of SKILLS) {
      const text = bundledSkill(skill);
      expect(text.endsWith(`\n\n<!-- ctxo-skill v${SKILLS_TEMPLATE_VERSION} -->\n`), skill).toBe(true);
      expect(skillTemplateVersion(text), skill).toBe(SKILLS_TEMPLATE_VERSION);
    }
  });
});

describe('ensureClaudeHook', () => {
  it('creates .claude/settings.json with a PreToolUse Edit hook', () => {
    const root = makeTempDir();
    const res = ensureClaudeHook(root);
    expect(res.action).not.toBe('skipped');
    const cfg = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    const entry = cfg.hooks.PreToolUse[0];
    expect(entry.matcher).toBe('Edit');
    expect(entry.hooks[0].command).toContain('gate-hook');
  });

  it('is idempotent (no duplicate ctxo hook)', () => {
    const root = makeTempDir();
    ensureClaudeHook(root);
    ensureClaudeHook(root);
    const cfg = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    expect(cfg.hooks.PreToolUse.length).toBe(1);
  });

  it('leaves a corrupt settings.json unchanged and warns', () => {
    const root = makeTempDir();
    const file = writeClaudeSettings(root, 'settings.json', 'not json{{{');
    const before = readFileSync(file);

    const result = ensureClaudeHook(root);

    expect(result.action).toBe('skipped');
    expect(result.warning).toMatch(/not valid JSON/);
    expect(result.warning).toBe(UNREADABLE_SETTINGS_WARNING);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it.each([
    'null',
    '[]',
    '"text"',
    '{"hooks":[]}',
    '{"hooks":{"PreToolUse":{}}}',
    '{\n  // comment\n}',
    '{"hooks":{"PreToolUse":[null]}}',
    '{"hooks":{"PreToolUse":[{"hooks":"x"}]}}',
    '{"hooks":{"PreToolUse":[{"matcher":"Edit"}]}}',
  ])('treats valid JSON with an unexpected shape like corrupt JSON (%j)', (text) => {
    const root = makeTempDir();
    const file = writeClaudeSettings(root, 'settings.json', text);
    const before = readFileSync(file);

    let result: ReturnType<typeof ensureClaudeHook> | undefined;
    expect(() => { result = ensureClaudeHook(root); }).not.toThrow();

    expect(result?.action).toBe('skipped');
    expect(result?.warning).toBe(UNREADABLE_SETTINGS_WARNING);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(readClaudeGuardState(root)).toBe('unreadable');
  });

  it('keeps other settings and hooks when it adds the guard', () => {
    const root = makeTempDir();
    const writeEntry = { matcher: 'Write', hooks: [{ type: 'command', command: 'echo write' }] };
    const postEntry = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edited' }] };
    const settings = {
      permissions: { allow: ['Bash(pnpm test)'], deny: ['Read(.env)'] },
      hooks: { PreToolUse: [writeEntry], PostToolUse: [postEntry] },
    };
    writeClaudeSettings(root, 'settings.json', JSON.stringify(settings, null, 2) + '\n');

    const result = ensureClaudeHook(root);

    expect(result).toEqual({ file: '.claude/settings.json', action: 'updated' });
    const cfg = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    expect(cfg).toEqual({
      permissions: settings.permissions,
      hooks: { PreToolUse: [writeEntry, CTXO_GUARD_ENTRY], PostToolUse: [postEntry] },
    });
    expect(Object.keys(cfg)).toEqual(['permissions', 'hooks']);
    expect(ensureClaudeHook(root).action).toBe('skipped');
  });

  it('reads a settings.json with a UTF-8 BOM and keeps the BOM', () => {
    const root = makeTempDir();
    const settings = { permissions: { allow: ['Bash(pnpm test)'] } };
    const file = writeClaudeSettings(root, 'settings.json', BOM + JSON.stringify(settings, null, 2) + '\n');

    const result = ensureClaudeHook(root);

    expect(result).toEqual({ file: '.claude/settings.json', action: 'updated' });
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(JSON.parse(bytes.subarray(3).toString('utf-8'))).toEqual({
      ...settings,
      hooks: { PreToolUse: [CTXO_GUARD_ENTRY] },
    });
    expect(ensureClaudeHook(root).action).toBe('skipped');
  });

  it('writes the exact bytes of an updated settings file', () => {
    const root = makeTempDir();
    const file = writeClaudeSettings(root, 'settings.json', '{"permissions":{}}\n');

    expect(ensureClaudeHook(root)).toEqual({ file: '.claude/settings.json', action: 'updated' });

    expect(readFileSync(file, 'utf-8')).toBe(
      JSON.stringify({ permissions: {}, hooks: { PreToolUse: [CTXO_GUARD_ENTRY] } }, null, 2) + '\n',
    );
  });

  it('writes an updated settings file back with its BOM and CRLF line endings', () => {
    const root = makeTempDir();
    const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
    const settings = { permissions: { allow: ['Bash(pnpm test)'] } };
    const file = writeClaudeSettings(root, 'settings.json', BOM + crlf(JSON.stringify(settings, null, 2) + '\n'));

    expect(ensureClaudeHook(root)).toEqual({ file: '.claude/settings.json', action: 'updated' });

    const expected = { ...settings, hooks: { PreToolUse: [CTXO_GUARD_ENTRY] } };
    expect(readFileSync(file, 'utf-8')).toBe(BOM + crlf(JSON.stringify(expected, null, 2) + '\n'));
    expect(ensureClaudeHook(root).action).toBe('skipped');
  });

  it('finds a guard next to a malformed sibling entry and adds no second one', () => {
    const malformedSibling = { matcher: 'Write' };

    const local = makeTempDir();
    const localFile = writeClaudeSettings(local, 'settings.local.json', JSON.stringify({ hooks: { PreToolUse: [malformedSibling, CTXO_GUARD_ENTRY] } }));
    const localBefore = readFileSync(localFile);
    expect(readClaudeGuardState(local)).toBe('present');
    expect(ensureClaudeHook(local)).toEqual({ file: '.claude/settings.json', action: 'skipped' });
    expect(existsSync(join(local, '.claude', 'settings.json'))).toBe(false);
    expect(readFileSync(localFile).equals(localBefore)).toBe(true);

    const shared = makeTempDir();
    const sharedFile = writeClaudeSettings(shared, 'settings.json', JSON.stringify({ hooks: { PreToolUse: [CTXO_GUARD_ENTRY, malformedSibling] } }));
    const sharedBefore = readFileSync(sharedFile);
    expect(readClaudeGuardState(shared)).toBe('present');
    expect(ensureClaudeHook(shared)).toEqual({ file: '.claude/settings.json', action: 'skipped' });
    expect(readFileSync(sharedFile).equals(sharedBefore)).toBe(true);

    // Without the guard, the malformed entry still makes the file unreadable: it is never written.
    const unguarded = makeTempDir();
    writeClaudeSettings(unguarded, 'settings.json', JSON.stringify({ hooks: { PreToolUse: [malformedSibling] } }));
    expect(readClaudeGuardState(unguarded)).toBe('unreadable');
  });

  it('does not duplicate a guard registered in settings.local.json', () => {
    const root = makeTempDir();
    const local = writeClaudeSettings(root, 'settings.local.json', JSON.stringify({ hooks: { PreToolUse: [CTXO_GUARD_ENTRY] } }));
    const before = readFileSync(local);

    const result = ensureClaudeHook(root);

    expect(result).toEqual({ file: '.claude/settings.json', action: 'skipped' });
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
    expect(readFileSync(local).equals(before)).toBe(true);
  });

  it('dryRun writes nothing', () => {
    const empty = makeTempDir();
    expect(ensureClaudeHook(empty, { dryRun: true })).toEqual({ file: '.claude/settings.json', action: 'created' });
    expect(existsSync(join(empty, '.claude'))).toBe(false);

    const root = makeTempDir();
    const file = writeClaudeSettings(root, 'settings.json', '{"permissions":{}}\n');
    expect(ensureClaudeHook(root, { dryRun: true })).toEqual({ file: '.claude/settings.json', action: 'updated' });
    expect(readFileSync(file, 'utf-8')).toBe('{"permissions":{}}\n');

    const corrupt = makeTempDir();
    const corruptFile = writeClaudeSettings(corrupt, 'settings.json', 'not json{{{');
    expect(ensureClaudeHook(corrupt, { dryRun: true })).toEqual({
      file: '.claude/settings.json',
      action: 'skipped',
      warning: UNREADABLE_SETTINGS_WARNING,
    });
    expect(readFileSync(corruptFile, 'utf-8')).toBe('not json{{{');
  });
});

describe('readClaudeGuardState', () => {
  it('reports present, absent and unreadable', () => {
    const root = makeTempDir();
    expect(readClaudeGuardState(root)).toBe('absent');

    writeClaudeSettings(root, 'settings.json', '{"permissions":{}}');
    expect(readClaudeGuardState(root)).toBe('absent');

    ensureClaudeHook(root);
    expect(readClaudeGuardState(root)).toBe('present');

    writeClaudeSettings(root, 'settings.json', 'not json{{{');
    expect(readClaudeGuardState(root)).toBe('unreadable');

    writeClaudeSettings(root, 'settings.local.json', JSON.stringify({ hooks: { PreToolUse: [CTXO_GUARD_ENTRY] } }));
    expect(readClaudeGuardState(root)).toBe('present');

    const localOnly = makeTempDir();
    writeClaudeSettings(localOnly, 'settings.local.json', JSON.stringify({ hooks: { PreToolUse: [CTXO_GUARD_ENTRY] } }));
    expect(readClaudeGuardState(localOnly)).toBe('present');

    const corruptLocal = makeTempDir();
    writeClaudeSettings(corruptLocal, 'settings.local.json', 'not json{{{');
    expect(readClaudeGuardState(corruptLocal)).toBe('absent');
  });

  it('reads a BOM settings file', () => {
    const guarded = BOM + JSON.stringify({ hooks: { PreToolUse: [CTXO_GUARD_ENTRY] } }, null, 2) + '\r\n';

    const shared = makeTempDir();
    writeClaudeSettings(shared, 'settings.json', guarded);
    expect(readClaudeGuardState(shared)).toBe('present');

    const local = makeTempDir();
    writeClaudeSettings(local, 'settings.local.json', guarded);
    expect(readClaudeGuardState(local)).toBe('present');

    const unguarded = makeTempDir();
    writeClaudeSettings(unguarded, 'settings.json', BOM + '{"permissions":{}}');
    expect(readClaudeGuardState(unguarded)).toBe('absent');
  });
});

describe('resolveRulesTier', () => {
  it('is compact only with the guard, every skill and an enabled gate on disk', () => {
    const root = makeTempDir();
    expect(resolveRulesTier(root, 'claude-code')).toBe('full');

    ensureClaudeHook(root);
    installSkills(root, 'claude-code');
    expect(resolveRulesTier(root, 'claude-code')).toBe('compact');
    expect(resolveRulesTier(root, 'cursor')).toBe('full');

    mkdirSync(join(root, '.ctxo'), { recursive: true });
    writeFileSync(join(root, '.ctxo', 'config.yaml'), 'gate:\n  enabled: false\n', 'utf-8');
    expect(gateEnabled(root)).toBe(false);
    expect(resolveRulesTier(root, 'claude-code')).toBe('full');

    rmSync(join(root, '.ctxo', 'config.yaml'));
    expect(gateEnabled(root)).toBe(true);
    expect(resolveRulesTier(root, 'claude-code')).toBe('compact');

    const skill = join(root, '.claude', 'skills', 'ctxo-review-pr', 'SKILL.md');
    const skillText = readFileSync(skill);
    rmSync(skill);
    expect(resolveRulesTier(root, 'claude-code')).toBe('full');

    writeFileSync(skill, skillText);
    rmSync(join(root, '.claude', 'settings.json'));
    expect(resolveRulesTier(root, 'claude-code')).toBe('full');
  });

  it('counts planned guard and skills', () => {
    const root = makeTempDir();

    expect(resolveRulesTier(root, 'claude-code', { guard: true, skills: true })).toBe('compact');
    expect(resolveRulesTier(root, 'claude-code', { guard: true })).toBe('full');
    expect(resolveRulesTier(root, 'claude-code', { skills: true })).toBe('full');
    expect(resolveRulesTier(root, 'cursor', { guard: true, skills: true })).toBe('full');
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });
});

describe('linked rules files', () => {
  let gitEnv: IsolatedGitEnv | undefined;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
  });

  afterEach(() => {
    gitEnv?.restore();
    gitEnv = undefined;
  });

  /** Whether this machine lets the current user create a file symlink (Windows needs a privilege). */
  const canSymlink = ((): boolean => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-symlink-probe-'));
    try {
      writeFileSync(join(dir, 'target'), '', 'utf-8');
      symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file');
      return true;
    } catch {
      return false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();

  /** A git project whose AGENTS.md is CLAUDE.md under a second name, made by `link(existing, newPath)`. */
  function linkedProject(link: (existing: string, newPath: string) => void): string {
    const dir = makeTempDir();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n', 'utf-8');
    link(join(dir, 'CLAUDE.md'), join(dir, 'AGENTS.md'));
    return dir;
  }

  /** `ctxo init --only skills,guard,rules --tools claude-code,antigravity -y`; returns the rules rows as `<file> (<action>)`. */
  async function initRules(dir: string): Promise<string[]> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      await new InitCommand(dir).run({
        tools: ['claude-code', 'antigravity'],
        yes: true,
        noInstall: true,
        only: ['skills', 'guard', 'rules'],
      });
    } finally {
      spy.mockRestore();
    }
    return lines
      .map((line) => line.replace(/^\[ctxo\] \S+ /, ''))
      .filter((line) => line.startsWith('CLAUDE.md') || line.startsWith('AGENTS.md'));
  }

  async function expectConvergence(dir: string): Promise<void> {
    expect(linkedRulesPlatforms(dir, 'claude-code')).toEqual(['antigravity']);
    expect(linkedRulesPlatforms(dir, 'antigravity')).toEqual(['claude-code']);

    expect(await initRules(dir)).toEqual(['CLAUDE.md (updated)', 'AGENTS.md (unchanged)']);
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe('# Project\n\n' + renderRulesBlock('full') + '\n');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe(content);

    expect(await initRules(dir)).toEqual(['CLAUDE.md (unchanged)', 'AGENTS.md (unchanged)']);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(content);

    // Doctor reads the shared file once, under CLAUDE.md, and expects the full tier there.
    expect(readRulesStates(dir).map((s) => s.file)).toEqual(['CLAUDE.md']);
    expect(await new AiRulesCheck().run({ projectRoot: dir, ctxoRoot: join(dir, '.ctxo') })).toMatchObject({
      status: 'pass',
      message: `CLAUDE.md v${RULES_TEMPLATE_VERSION} full`,
    });
  }

  it('a hard-linked AGENTS.md and CLAUDE.md converge on the full tier in one run', async () => {
    await expectConvergence(linkedProject((existing, newPath) => linkSync(existing, newPath)));
  });

  it.skipIf(!canSymlink)('a symlinked AGENTS.md and CLAUDE.md converge on the full tier in one run', async () => {
    await expectConvergence(linkedProject((existing, newPath) => symlinkSync(existing, newPath, 'file')));
  });

  it('a hard-linked AGENTS.md is not written while CLAUDE.md is held', async () => {
    const dir = linkedProject((existing, newPath) => linkSync(existing, newPath));
    const preTier = '# Project\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';
    writeFileSync(join(dir, 'CLAUDE.md'), preTier, 'utf-8');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe(preTier);
    const held = (file: string): string =>
      `${file}: left unchanged until the guard and skills are installed; run "ctxo init --only rules,skills,guard" or "ctxo doctor --fix"`;

    // --only rules installs neither the guard nor the skills; a full block through AGENTS.md would
    // record an opt-out in CLAUDE.md. Whatever the tool order, and with AGENTS.md alone, nothing is written.
    for (const tools of [['claude-code', 'antigravity'], ['antigravity', 'claude-code'], ['antigravity']]) {
      const lines: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
      try {
        await new InitCommand(dir).run({ tools, yes: true, only: ['rules'] });
      } finally {
        spy.mockRestore();
      }
      expect(lines, tools.join(',')).toContain(`[ctxo] \u26a0 ${held('AGENTS.md')}`);
      expect(lines.join('\n')).not.toMatch(/(CLAUDE|AGENTS)\.md \((updated|created)\)/);
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(preTier);
    }

    // The dry run holds both names.
    const plan = new InitCommand(dir).plan({ tools: ['claude-code', 'antigravity'], only: ['rules'] });
    expect(plan.filter((row) => row.held === true).map((row) => row.file)).toEqual(['CLAUDE.md', 'AGENTS.md']);

    // Doctor agrees: it reads the file once, under CLAUDE.md, and --fix without the guard and skills holds it.
    expect(readRulesStates(dir).map((s) => s.file)).toEqual(['CLAUDE.md']);
    const fix = await applyFixes(
      { checks: [{ id: 'ai_rules', title: 'AI rules', status: 'warn', message: '' }], summary: { pass: 0, warn: 1, fail: 0 }, exitCode: 1 },
      { projectRoot: dir, ctxoRoot: join(dir, '.ctxo'), yes: true },
    );
    expect(fix.attempts.find((a) => a.name === 'AI rules')).toMatchObject({ status: 'skipped' });
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(preTier);

    // Once the guard and skills are in, the shared file gets the full tier under both names in one run.
    await initRules(dir);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# Project\n\n' + renderRulesBlock('full') + '\n');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe('# Project\n\n' + renderRulesBlock('full') + '\n');
  });

  it('the dry run gives a linked AGENTS.md the action the real run takes', async () => {
    const dir = linkedProject((existing, newPath) => linkSync(existing, newPath));
    const plan = new InitCommand(dir).plan({ tools: ['claude-code', 'antigravity'], only: ['skills', 'guard', 'rules'] });
    const plannedAction = (file: string): string | undefined => plan.find((row) => row.file === file)?.action;

    // The real run writes the shared file through CLAUDE.md, so AGENTS.md then reads as unchanged.
    expect([plannedAction('CLAUDE.md'), plannedAction('AGENTS.md')]).toEqual(['updated', 'skipped']);
    expect(await initRules(dir)).toEqual(['CLAUDE.md (updated)', 'AGENTS.md (unchanged)']);

    // In the other order the first name written is AGENTS.md; the dry run follows that too.
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n', 'utf-8');
    const reversed = new InitCommand(dir)
      .plan({ tools: ['antigravity', 'claude-code'], only: ['rules'] })
      .map((row) => `${row.file} ${row.action}`);
    expect(reversed).toEqual(['AGENTS.md updated', 'CLAUDE.md skipped']);
  });

  it('a linked CLAUDE.md resolves and is written in the full tier even when the guard and skills are installed', () => {
    const dir = linkedProject((existing, newPath) => linkSync(existing, newPath));
    ensureClaudeHook(dir);
    installSkills(dir, 'claude-code');

    expect(resolveRulesTier(dir, 'claude-code')).toBe('full');
    expect(resolveRulesTier(dir, 'claude-code', { guard: true, skills: true })).toBe('full');
    expect(installRules(dir, 'claude-code', { tier: 'compact' })).toEqual({ file: 'CLAUDE.md', action: 'updated' });
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe('# Project\n\n' + renderRulesBlock('full') + '\n');
  });

  it('separate files with equal content are not linked', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'CLAUDE.md'), '# Same\n', 'utf-8');
    writeFileSync(join(dir, 'AGENTS.md'), '# Same\n', 'utf-8');
    ensureClaudeHook(dir);
    installSkills(dir, 'claude-code');

    expect(linkedRulesPlatforms(dir, 'claude-code')).toEqual([]);
    expect(linkedRulesPlatforms(dir, 'windsurf')).toEqual([]);
    expect(resolveRulesTier(dir, 'claude-code')).toBe('compact');
    expect(readRulesStates(dir).map((s) => s.file)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });
});
