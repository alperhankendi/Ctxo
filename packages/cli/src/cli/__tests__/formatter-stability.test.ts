import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import prettier from 'prettier';
import { SKILLS, installSkills, skillStates } from '../ai-rules.js';
import { InitCommand } from '../init-command.js';
import { AiRulesCheck, ClaudeGuardHookCheck, SkillsCheck } from '../../adapters/diagnostics/checks/agent-setup-check.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';
import {
  LEGACY_RULE_BODY,
  RULES_TEMPLATE_VERSION,
  blockTier,
  classifyRulesBlock,
  guardAndSkillsExpected,
  renderRulesBlock,
  scanRulesBlocks,
  upsertRulesBlock,
  type UpsertResult,
} from '../../core/agent-rules/rules-block.js';

/*
 * Formatters such as Prettier (often run over *.md by lint-staged) must not turn the ctxo rules blocks
 * or the bundled skills into drift: the generated text is already in Prettier's layout, and the
 * comparison ignores what a formatter changes (line endings, trailing whitespace, blank lines, and
 * line wrapping under a non-default `proseWrap`).
 */

const BOM = String.fromCharCode(0xfeff);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-format-'));
  tempDirs.push(dir);
  return dir;
}

/** Prettier 2.8.8 with its defaults, as a repo's `prettier --write "**\/*.md"` would run it. */
function format(text: string): string {
  return prettier.format(text, { parser: 'markdown' });
}

/** packages/cli/skills, read as LF text so a CRLF checkout (core.autocrlf) gives the committed bytes. */
function bundledSkill(skill: string): string {
  const text = readFileSync(join(import.meta.dirname, '..', '..', '..', 'skills', skill, 'SKILL.md'), 'utf-8');
  return (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n/g, '\n');
}

/** What another formatter or an editor might leave: CRLF, trailing spaces and doubled blank lines. */
function reshape(text: string): string {
  return text.replace(/\n\n/g, '\n\n\n').replace(/\n/g, '  \n').replace(/\n/g, '\r\n');
}

function contentOf(result: UpsertResult): string {
  if (!('content' in result)) throw new Error(`expected content, got ${result.kind}`);
  return result.content;
}

describe('formatter stability', () => {
  it('rendered blocks and bundled skills are stable under Prettier', () => {
    const texts: Array<[string, string]> = [];
    for (const tier of ['compact', 'full'] as const) {
      texts.push([`${tier} block`, renderRulesBlock(tier) + '\n']);
      texts.push([`${tier} block in a file`, contentOf(upsertRulesBlock('# Project\n\nNotes.\n', renderRulesBlock(tier)))]);
    }
    for (const skill of SKILLS) texts.push([skill, bundledSkill(skill)]);

    for (const [name, text] of texts) expect({ name, text: format(text) }).toEqual({ name, text });
  });

  it('a Prettier-formatted compact block is still current', () => {
    const block = renderRulesBlock('compact');
    const formatted = format('# Project\n\n' + block + '\n');
    const reshaped = reshape('# Project\n\n' + block + '\n');

    for (const content of [formatted, reshaped]) {
      const scan = scanRulesBlocks(content);
      expect(scan.blocks).toHaveLength(1);
      const [found] = scan.blocks;
      if (!found) throw new Error('no block');
      expect(blockTier(found.body)).toBe('compact');
      expect(classifyRulesBlock(found)).toEqual({ state: 'current', tier: 'compact' });
      expect(guardAndSkillsExpected(found)).toBe(true);
      expect(upsertRulesBlock(content, block)).toEqual({ kind: 'unchanged', content });
    }
  });

  it('a Prettier-formatted skill is not reported outdated', () => {
    const root = makeTempDir();
    const claudeFiles = SKILLS.map((skill) => join(root, '.claude', 'skills', skill, 'SKILL.md'));
    const cursorFiles = SKILLS.map((skill) => join(root, '.cursor', 'rules', `${skill}.mdc`));
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    SKILLS.forEach((skill, i) => {
      mkdirSync(join(root, '.claude', 'skills', skill), { recursive: true });
      writeFileSync(claudeFiles[i] as string, format(bundledSkill(skill)), 'utf-8');
      writeFileSync(cursorFiles[i] as string, reshape(bundledSkill(skill)), 'utf-8');
    });
    const before = [...claudeFiles, ...cursorFiles].map((file) => readFileSync(file));

    expect(skillStates(root, 'claude-code').map((s) => s.state)).toEqual(['current', 'current', 'current']);
    expect(skillStates(root, 'cursor').map((s) => s.state)).toEqual(['current', 'current', 'current']);
    expect(installSkills(root, 'claude-code').map((r) => r.action)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(installSkills(root, 'cursor').map((r) => r.action)).toEqual(['skipped', 'skipped', 'skipped']);
    [...claudeFiles, ...cursorFiles].forEach((file, i) => expect(readFileSync(file).equals(before[i] as Buffer)).toBe(true));
  });

  describe('re-wrapped prose', () => {
    let gitEnv: IsolatedGitEnv | undefined;

    beforeEach(() => {
      gitEnv = isolateGitEnv();
    });

    afterEach(() => {
      gitEnv?.restore();
      gitEnv = undefined;
    });

    /** `ctxo init --only rules,skills,guard --tools claude-code -y`; returns its rows as `<file> (<action>)`. */
    async function initRows(dir: string): Promise<string[]> {
      const rows: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        rows.push(args.map(String).join(' ').replace(/^\[ctxo\] \S+ /, ''));
      });
      try {
        await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, only: ['rules', 'skills', 'guard'] });
      } finally {
        spy.mockRestore();
      }
      return rows;
    }

    it.each(['always', 'never'] as const)(
      'Prettier with proseWrap %s leaves the blocks and skills current: init reports unchanged and doctor passes',
      async (proseWrap) => {
        const dir = makeTempDir();
        execFileSync('git', ['init', '-q'], { cwd: dir });
        await initRows(dir);
        const files = ['CLAUDE.md', ...SKILLS.map((skill) => join('.claude', 'skills', skill, 'SKILL.md'))];
        for (const file of files) {
          const path = join(dir, file);
          const original = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
          const wrapped = prettier.format(original, { parser: 'markdown', proseWrap, printWidth: 40 });
          if (file === 'CLAUDE.md') expect(wrapped).not.toBe(original);
          writeFileSync(path, wrapped, 'utf-8');
        }
        const before = files.map((file) => readFileSync(join(dir, file)));

        const rows = await initRows(dir);

        expect(rows).toEqual([
          ...SKILLS.map((skill) => `.claude/skills/${skill}/SKILL.md (unchanged)`),
          '.claude/settings.json (unchanged)',
          'CLAUDE.md (unchanged)',
        ]);
        files.forEach((file, i) => expect(readFileSync(join(dir, file)).equals(before[i] as Buffer), file).toBe(true));
        const ctx = { projectRoot: dir, ctxoRoot: join(dir, '.ctxo') };
        expect(await new AiRulesCheck().run(ctx)).toMatchObject({ status: 'pass', message: `CLAUDE.md v${RULES_TEMPLATE_VERSION} compact` });
        expect(await new SkillsCheck().run(ctx)).toMatchObject({ status: 'pass' });
        expect(await new ClaudeGuardHookCheck().run(ctx)).toMatchObject({ status: 'pass' });
      },
    );
  });

  it('a reformatted legacy body is replaced in place', () => {
    const block = renderRulesBlock('full');
    const formatted = format(LEGACY_RULE_BODY + '\n');
    expect(formatted).not.toBe(LEGACY_RULE_BODY + '\n');

    for (const legacy of [formatted, reshape(LEGACY_RULE_BODY + '\n')]) {
      const eol = legacy.includes('\r\n') ? '\r\n' : '\n';
      const before = `# Project${eol}${eol}Intro.${eol}${eol}${legacy}${eol}Outro.${eol}`;
      const scan = scanRulesBlocks(before);
      expect(scan.blocks.map((b) => b.marked)).toEqual([false]);

      const result = upsertRulesBlock(before, block);

      const lf = (text: string): string => text.replace(/\r\n/g, '\n');
      expect(result.kind).toBe('replaced');
      expect(lf(contentOf(result))).toMatch(new RegExp(`^# Project\\n\\nIntro\\.\\n\\n<!-- ctxo-rules-start v`));
      expect(lf(contentOf(result)).split('<!-- ctxo-rules-start').length - 1).toBe(1);
      expect(contentOf(result)).not.toContain('ALWAYS use ctxo MCP tools');
      expect(lf(contentOf(result)).endsWith('Outro.\n')).toBe(true);
      expect(lf(contentOf(result))).toContain(block);
    }
  });
});
