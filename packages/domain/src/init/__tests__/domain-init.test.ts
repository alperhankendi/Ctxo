import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { ClaudeHookEntry, CtxoHost, InitFileResult, InitPartContext } from '@ctxo/cli/internal';
import { createModuleHost } from '@ctxo/cli/internal';
import { DOMAIN_HOOK_COMMAND, REGISTRY_SKELETON, domainInit } from '../domain-init.js';
import { register } from '../../index.js';
import { domainVersion } from '../../version.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-domain-init-'));
  dirs.push(dir);
  return dir;
}

const BASE_CONFIG = 'version: "1.0"\n';

interface Recording {
  readonly ctx: InitPartContext;
  readonly hooks: ClaudeHookEntry[];
  readonly skills: Array<{ platformId: string; name: string; content: string }>;
  readonly questions: string[];
  configCalls: number;
}

/** An InitPartContext that records what the contribution asks for; `ensureConfigFile` writes a base config. */
function recording(root: string, overrides: Partial<InitPartContext> & { answer?: 'by-rung' | 'report' } = {}): Recording {
  const rec: Recording = {
    hooks: [],
    skills: [],
    questions: [],
    configCalls: 0,
    ctx: undefined as unknown as InitPartContext,
  };
  const dryRun = overrides.dryRun ?? false;
  const ctx: InitPartContext = {
    projectRoot: root,
    toolIds: ['claude-code'],
    dryRun,
    yes: false,
    prompt: {
      async confirm(message, initial) {
        rec.questions.push(message);
        return initial;
      },
      async select(message, _options, initial) {
        rec.questions.push(message);
        return (overrides.answer ?? initial) as typeof initial;
      },
    },
    ensureConfigFile(): InitFileResult {
      rec.configCalls += 1;
      const file = join(root, '.ctxo', 'config.yaml');
      if (existsSync(file)) return { file: '.ctxo/config.yaml', action: 'skipped' };
      if (!dryRun) {
        mkdirSync(join(root, '.ctxo'), { recursive: true });
        writeFileSync(file, BASE_CONFIG);
      }
      return { file: '.ctxo/config.yaml', action: 'created' };
    },
    ensureClaudeHookEntry(entry): InitFileResult {
      rec.hooks.push(entry);
      return { file: '.claude/settings.json', action: 'created' };
    },
    installSkill(platformId, name, content): InitFileResult | undefined {
      rec.skills.push({ platformId, name, content });
      return platformId === 'claude-code' || platformId === 'cursor'
        ? { file: `${platformId}/${name}`, action: 'created' }
        : undefined;
    },
    ...overrides,
  };
  (rec as { ctx: InitPartContext }).ctx = ctx;
  return rec;
}

const host: CtxoHost = createModuleHost({ projectRoot: process.cwd(), mode: 'cli', cliVersion: domainVersion() });

function config(root: string): Record<string, any> {
  return parse(readFileSync(join(root, '.ctxo', 'config.yaml'), 'utf-8'));
}

describe('domainInit', () => {
  it('register exposes the init contribution for the domain part', async () => {
    const registration = await register(host);
    expect(registration?.init?.part).toBe('domain');
    expect(DOMAIN_HOOK_COMMAND).toBe('ctxo domain-guard-hook');
  });

  it('writes config defaults with the chosen boundary mode', async () => {
    const root = project();
    const rec = recording(root, { answer: 'report' });

    const rows = await domainInit(host).apply(rec.ctx);

    expect(rec.configCalls).toBe(1);
    expect(rec.questions).toEqual(['Boundary violations between named contexts']);
    expect(config(root).domain.boundaries.enforce).toBe('report');
    expect(readFileSync(join(root, '.ctxo', 'config.yaml'), 'utf-8').startsWith(BASE_CONFIG)).toBe(true);
    expect(rows[0]).toEqual({ file: '.ctxo/config.yaml', action: 'created' });

    // A second run keeps the mode in the config and asks nothing.
    const again = recording(root);
    const second = await domainInit(host).apply(again.ctx);
    expect(again.questions).toEqual([]);
    expect(second[0]).toEqual({ file: '.ctxo/config.yaml', action: 'skipped' });
    expect(config(root).domain.boundaries.enforce).toBe('report');
  });

  it('uses --boundaries without prompting', async () => {
    const root = project();
    mkdirSync(join(root, '.ctxo'));
    writeFileSync(join(root, '.ctxo', 'config.yaml'), 'domain:\n  boundaries:\n    enforce: by-rung\n');
    const rec = recording(root, { boundaries: 'report' });

    const rows = await domainInit(host).apply(rec.ctx);

    expect(rec.questions).toEqual([]);
    // An existing value is never changed; --boundaries only fills a missing one.
    expect(config(root).domain.boundaries.enforce).toBe('by-rung');
    expect(rows[0]).toEqual({ file: '.ctxo/config.yaml', action: 'updated' });

    const fresh = project();
    await domainInit(host).apply(recording(fresh, { boundaries: 'report' }).ctx);
    expect(config(fresh).domain.boundaries.enforce).toBe('report');

    const newOnly = project();
    await domainInit(host).apply(recording(newOnly, { boundaries: 'new-only' }).ctx);
    expect(config(newOnly).domain.boundaries.enforce).toBe('new-only');
  });

  it('creates the registry skeleton only when missing', async () => {
    const root = project();
    const rows = await domainInit(host).apply(recording(root).ctx);

    expect(readFileSync(join(root, 'docs', 'domain', 'contexts.yaml'), 'utf-8')).toBe(REGISTRY_SKELETON);
    expect(rows).toContainEqual({ file: 'docs/domain/contexts.yaml', action: 'created' });

    writeFileSync(join(root, 'docs', 'domain', 'contexts.yaml'), 'version: 1\ncontexts: []\n');
    const again = await domainInit(host).apply(recording(root).ctx);
    expect(again).toContainEqual({ file: 'docs/domain/contexts.yaml', action: 'skipped' });
    expect(readFileSync(join(root, 'docs', 'domain', 'contexts.yaml'), 'utf-8')).toBe('version: 1\ncontexts: []\n');

    // A configured registry path is used; one outside the project is refused.
    const custom = project();
    mkdirSync(join(custom, '.ctxo'));
    writeFileSync(join(custom, '.ctxo', 'config.yaml'), 'domain:\n  registry: domain/registry.yaml\n');
    await domainInit(host).apply(recording(custom).ctx);
    expect(readFileSync(join(custom, 'domain', 'registry.yaml'), 'utf-8')).toBe(REGISTRY_SKELETON);

    // A folder whose name starts with two dots is inside the project (M2).
    const dotted = project();
    mkdirSync(join(dotted, '.ctxo'));
    writeFileSync(join(dotted, '.ctxo', 'config.yaml'), 'domain:\n  registry: ..docs/contexts.yaml\n');
    await domainInit(host).apply(recording(dotted).ctx);
    expect(readFileSync(join(dotted, '..docs', 'contexts.yaml'), 'utf-8')).toBe(REGISTRY_SKELETON);

    const outside = project();
    mkdirSync(join(outside, '.ctxo'));
    writeFileSync(join(outside, '.ctxo', 'config.yaml'), 'domain:\n  registry: ../escape.yaml\n');
    const refused = await domainInit(host).apply(recording(outside).ctx);
    expect(refused).toContainEqual({
      file: '../escape.yaml',
      action: 'skipped',
      warning: '../escape.yaml: the registry path must stay inside the project; not created',
    });
  });

  it('registers SessionStart, Stop and TaskCompleted, plus SubagentStop when guard.subagents is true', async () => {
    const root = project();
    const rec = recording(root);
    const rows = await domainInit(host).apply(rec.ctx);

    expect(rec.hooks).toEqual([
      { event: 'SessionStart', command: DOMAIN_HOOK_COMMAND },
      { event: 'Stop', command: DOMAIN_HOOK_COMMAND },
      { event: 'TaskCompleted', command: DOMAIN_HOOK_COMMAND },
    ]);
    expect(rows.map((row) => row.file)).toEqual(
      expect.arrayContaining(['.claude/settings.json (SessionStart)', '.claude/settings.json (Stop)', '.claude/settings.json (TaskCompleted)']),
    );

    const sub = project();
    mkdirSync(join(sub, '.ctxo'));
    writeFileSync(join(sub, '.ctxo', 'config.yaml'), 'domain:\n  guard:\n    subagents: true\n');
    const withSub = recording(sub);
    await domainInit(host).apply(withSub.ctx);
    expect(withSub.hooks.map((h) => h.event)).toEqual(['SessionStart', 'Stop', 'TaskCompleted', 'SubagentStop']);

    // Without Claude Code no hook is registered.
    const cursorOnly = recording(project(), { toolIds: ['cursor'] });
    await domainInit(host).apply(cursorOnly.ctx);
    expect(cursorOnly.hooks).toEqual([]);
  });

  it('registers the Cursor fold reminder in .cursor/hooks.json only when Cursor is selected', async () => {
    const claudeOnly = project();
    await domainInit(host).apply(recording(claudeOnly).ctx);
    expect(existsSync(join(claudeOnly, '.cursor', 'hooks.json'))).toBe(false);

    const root = project();
    mkdirSync(join(root, '.cursor'));
    writeFileSync(join(root, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './fmt.sh' }] } }));
    const rows = await domainInit(host).apply(recording(root, { toolIds: ['claude-code', 'cursor'] }).ctx);
    expect(rows).toContainEqual({ file: '.cursor/hooks.json', action: 'updated' });
    expect(JSON.parse(readFileSync(join(root, '.cursor', 'hooks.json'), 'utf-8'))).toEqual({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: './fmt.sh' }],
        beforeSubmitPrompt: [{ command: 'ctxo domain-cursor-hook' }],
        stop: [{ command: 'ctxo domain-cursor-hook' }],
      },
    });

    // A rerun is idempotent.
    const again = await domainInit(host).apply(recording(root, { toolIds: ['cursor'] }).ctx);
    expect(again).toContainEqual({ file: '.cursor/hooks.json', action: 'skipped' });

    // domain.guard.enabled: false opts out of the reminder.
    const off = project();
    mkdirSync(join(off, '.ctxo'));
    writeFileSync(join(off, '.ctxo', 'config.yaml'), 'domain:\n  guard:\n    enabled: false\n');
    const offRows = await domainInit(host).apply(recording(off, { toolIds: ['cursor'] }).ctx);
    expect(offRows.map((row) => row.file)).not.toContain('.cursor/hooks.json');
    expect(existsSync(join(off, '.cursor', 'hooks.json'))).toBe(false);

    // A dry run plans the file and writes nothing.
    const dry = project();
    const planned = await domainInit(host).apply(recording(dry, { toolIds: ['cursor'], dryRun: true }).ctx);
    expect(planned).toContainEqual({ file: '.cursor/hooks.json', action: 'created' });
    expect(existsSync(join(dry, '.cursor'))).toBe(false);
  });

  it('installs the skill for each selected platform', async () => {
    const rec = recording(project(), { toolIds: ['claude-code', 'cursor', 'windsurf'] });
    const rows = await domainInit(host).apply(rec.ctx);

    expect(rec.skills.map((s) => [s.platformId, s.name])).toEqual([
      ['claude-code', 'ctxo-domain-fold'],
      ['cursor', 'ctxo-domain-fold'],
    ]);
    const content = rec.skills[0]!.content;
    expect(content).toContain('name: ctxo-domain-fold');
    expect(content).toContain(
      'description: Use BEFORE changing code under a named domain context, BEFORE finishing a branch, and when adopting or tuning the domain config, to read the context\'s card, fold behaviour changes back into it and discover the repository\'s conventions.',
    );
    // #191: the skill names the discovery command, dry run first, then hand edits or --write.
    expect(content).toContain('## When adopting or tuning the domain config');
    expect(content).toContain('Run `ctxo domain discover` first');
    expect(content).toContain('ctxo domain discover --write');
    expect(content).toContain('## Before changing a context\'s code');
    expect(content).toContain('## When behaviour changes');
    expect(content).toContain('## At branch finish');
    expect(content).toContain('ctxo contexts-touched --since <base>');
    expect(content).toContain('Domain-Unchanged: <id> (reason)');
    expect(content).toContain('<!-- ctxo-skill v0.17 -->');
    expect(content).not.toContain(String.fromCharCode(0x2014));
    expect(rows).toContainEqual({ file: 'claude-code/ctxo-domain-fold', action: 'created' });
  });

  it('a dry run writes nothing', async () => {
    const root = project();
    const rec = recording(root, { dryRun: true });

    const rows = await domainInit(host).apply(rec.ctx);

    expect(existsSync(join(root, '.ctxo'))).toBe(false);
    expect(existsSync(join(root, 'docs'))).toBe(false);
    expect(rows.slice(0, 2)).toEqual([
      { file: '.ctxo/config.yaml', action: 'created' },
      { file: 'docs/domain/contexts.yaml', action: 'created' },
    ]);

    // With a config on disk the dry run plans the merge and still writes nothing.
    mkdirSync(join(root, '.ctxo'));
    writeFileSync(join(root, '.ctxo', 'config.yaml'), BASE_CONFIG);
    const planned = await domainInit(host).apply(recording(root, { dryRun: true }).ctx);
    expect(planned[0]).toEqual({ file: '.ctxo/config.yaml', action: 'updated' });
    expect(readFileSync(join(root, '.ctxo', 'config.yaml'), 'utf-8')).toBe(BASE_CONFIG);
  });

  it('leaves an unparseable config unchanged with a warning and still sets up the rest', async () => {
    const root = project();
    mkdirSync(join(root, '.ctxo'));
    writeFileSync(join(root, '.ctxo', 'config.yaml'), 'a: [\n');

    const rows = await domainInit(host).apply(recording(root).ctx);

    expect(rows[0]).toMatchObject({ file: '.ctxo/config.yaml', action: 'skipped' });
    expect(rows[0]!.warning).toMatch(/^\.ctxo\/config\.yaml: cannot add the domain defaults/);
    expect(readFileSync(join(root, '.ctxo', 'config.yaml'), 'utf-8')).toBe('a: [\n');
    expect(readFileSync(join(root, 'docs', 'domain', 'contexts.yaml'), 'utf-8')).toBe(REGISTRY_SKELETON);
  });
});

describe('domainInit: discovered conventions and loader rules', () => {
  const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending.md
    paths: ["src/Lending/**"]
    rung: named
unowned:
  allow: []
`;
  const CARD = '# Lending\n\n## Rules and invariants\n### LEND-01 A member holds at most five loans\nUntested: manual\n';

  function put(root: string, file: string, content: string): void {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }

  /** A git repo whose five commit subjects carry LEND keys, so discovery proposes the LEND tracker prefix. */
  function domainRepo(withRegistry = true): string {
    const root = project();
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...args], {
        cwd: root,
        stdio: 'ignore',
      });
    };
    git('init', '-q');
    for (let i = 1; i <= 5; i++) {
      put(root, `f${i}.txt`, `${i}\n`);
      git('add', '.');
      git('commit', '-q', '-m', `LEND-${i} change`);
    }
    if (withRegistry) {
      put(root, 'docs/domain/contexts.yaml', REGISTRY);
      put(root, 'docs/domain/lending.md', CARD);
    }
    return root;
  }

  it('--yes accepts the discovery proposal', async () => {
    const root = domainRepo();
    const rec = recording(root, { yes: true });
    const rows = await domainInit(host).apply(rec.ctx);

    expect(rec.questions).not.toContain('Apply the proposed conventions?');
    expect(config(root).domain.rules.trackerPrefixes).toEqual(['LEND']);
    expect(rows.filter((row) => row.file === '.ctxo/config.yaml').map((row) => row.action)).toContain('updated');
  });

  it('a declined proposal leaves the config unchanged', async () => {
    const root = domainRepo();
    const rec = recording(root, {
      prompt: {
        async confirm(message) {
          rec.questions.push(message);
          return false;
        },
        async select(_message, _options, initial) {
          return initial;
        },
      },
    });
    await domainInit(host).apply(rec.ctx);

    expect(rec.questions).toContain('Apply the proposed conventions?');
    expect(config(root).domain.rules?.trackerPrefixes ?? []).toEqual([]);
    expect(readFileSync(join(root, '.ctxo', 'config.yaml'), 'utf-8')).not.toContain('LEND');
  });

  it('an accepted proposal is applied through the prompt', async () => {
    const root = domainRepo();
    const rec = recording(root);
    await domainInit(host).apply(rec.ctx);
    expect(rec.questions).toContain('Apply the proposed conventions?');
    expect(config(root).domain.rules.trackerPrefixes).toEqual(['LEND']);
  });

  it('asks nothing when the proposal adds nothing', async () => {
    const root = domainRepo();
    await domainInit(host).apply(recording(root, { yes: true }).ctx);
    const again = recording(root);
    await domainInit(host).apply(again.ctx);
    expect(again.questions).not.toContain('Apply the proposed conventions?');
  });

  it('loader rules are written when contexts with cards exist', async () => {
    const root = domainRepo();
    const rows = await domainInit(host).apply(recording(root, { yes: true }).ctx);

    expect(existsSync(join(root, '.claude', 'rules', 'ctxo-context-lending.md'))).toBe(true);
    expect(rows).toContainEqual({ file: '.claude/rules/ctxo-context-lending.md', action: 'created' });

    const again = await domainInit(host).apply(recording(root, { yes: true }).ctx);
    expect(again.map((row) => row.file)).not.toContain('.claude/rules/ctxo-context-lending.md');
  });

  it('deletes the stale loader rules when the last card is removed (M6)', async () => {
    const root = domainRepo();
    await domainInit(host).apply(recording(root, { yes: true }).ctx);
    const rule = join(root, '.claude', 'rules', 'ctxo-context-lending.md');
    expect(existsSync(rule)).toBe(true);

    put(root, 'docs/domain/contexts.yaml', REGISTRY.replace(/^\s*card:.*\n/gm, ''));
    const rows = await domainInit(host).apply(recording(root, { yes: true }).ctx);

    expect(existsSync(rule)).toBe(false);
    expect(rows).toContainEqual({ file: '.claude/rules/ctxo-context-lending.md (deleted)', action: 'updated' });
  });

  it('init writes .ctxo/config.yaml through a temp file that does not stay behind (M7)', async () => {
    const root = domainRepo();
    await domainInit(host).apply(recording(root, { yes: true }).ctx);
    expect(readdirSync(join(root, '.ctxo')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(join(root, '.ctxo', 'config.yaml'))).toBe(true);
  });

  it('writes no loader rules for a registry without cards', async () => {
    const root = domainRepo(false);
    const rows = await domainInit(host).apply(recording(root, { yes: true }).ctx);
    expect(rows.some((row) => row.file.includes('ctxo-context-'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'rules'))).toBe(false);
  });

  it('never overwrites an unmarked file at an expected path', async () => {
    const root = domainRepo();
    put(root, '.claude/rules/ctxo-context-lending.md', '# mine\n');
    const rows = await domainInit(host).apply(recording(root, { yes: true }).ctx);
    expect(readFileSync(join(root, '.claude', 'rules', 'ctxo-context-lending.md'), 'utf-8')).toBe('# mine\n');
    const row = rows.find((r) => r.file === '.claude/rules/ctxo-context-lending.md');
    expect(row?.action).toBe('skipped');
    expect(row?.warning).toMatch(/generated marker/);
  });

  it('a dry run writes nothing', async () => {
    const root = domainRepo();
    put(root, '.ctxo/config.yaml', BASE_CONFIG);
    const rows = await domainInit(host).apply(recording(root, { dryRun: true, yes: true }).ctx);

    expect(readFileSync(join(root, '.ctxo', 'config.yaml'), 'utf-8')).toBe(BASE_CONFIG);
    expect(existsSync(join(root, '.claude', 'rules'))).toBe(false);
    expect(rows).toContainEqual({ file: '.claude/rules/ctxo-context-lending.md', action: 'created' });
  });
});
