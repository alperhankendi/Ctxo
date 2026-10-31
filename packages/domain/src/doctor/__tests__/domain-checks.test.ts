import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckResult, CtxoHost, IHealthCheck } from '@ctxo/cli/internal';
import { createModuleHost } from '@ctxo/cli/internal';
import { applyLoaderRules, loaderPlatforms, readExistingLoaderRules } from '../../adapters/loader-rules-files.js';
import { readRegistry } from '../../adapters/registry-reader.js';
import { diffLoaderRules, renderLoaderRules } from '../../core/loader-rules.js';
import { DOMAIN_HOOK_COMMAND, readBundledSkill } from '../../init/domain-init.js';
import { register } from '../../index.js';
import { domainVersion } from '../../version.js';
import { domainDoctorChecks, domainDoctorFixes } from '../domain-checks.js';
import { CURSOR_HOOKS_FILE, ensureCursorHooks } from '../../adapters/cursor-hooks-file.js';

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    card: docs/domain/lending.md
    paths: ["src/Lending/**"]
    rung: named
    rulePrefix: LEND
unowned:
  allow: []
`;
const CARD = '# Lending\n\n## Rules and invariants\n### LEND-01 A member holds at most five loans\nUntested: manual\n';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function put(root: string, file: string, content: string): void {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-domain-doctor-'));
  dirs.push(dir);
  return dir;
}

/** A project with the registry and card; `subjects` become git commits so discovery has tracker evidence. */
function setup(options: { registry?: string | null; subjects?: string[] } = {}): string {
  const root = project();
  const registry = options.registry === undefined ? REGISTRY : options.registry;
  if (registry !== null) {
    put(root, 'docs/domain/contexts.yaml', registry);
    put(root, 'docs/domain/lending.md', CARD);
  }
  put(root, '.ctxo/config.yaml', 'version: "1.0"\n');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };
  git('init', '-q');
  (options.subjects ?? ['initial']).forEach((subject, i) => {
    put(root, `f${i}.txt`, `${i}\n`);
    git('add', '.');
    git('commit', '-q', '-m', subject);
  });
  return root;
}

function settings(events: readonly string[]): string {
  const hooks: Record<string, unknown> = {};
  for (const event of events) hooks[event] = [{ hooks: [{ type: 'command', command: DOMAIN_HOOK_COMMAND }] }];
  return JSON.stringify({ hooks }, null, 2);
}

function writeAgentSetup(root: string, events: readonly string[] = ['SessionStart', 'Stop', 'TaskCompleted']): void {
  put(root, '.claude/settings.json', settings(events));
  put(root, '.claude/skills/ctxo-domain-fold/SKILL.md', readBundledSkill());
  const loaded = readRegistry(root, 'docs/domain/contexts.yaml')!;
  const expected = renderLoaderRules(loaded.registry!, loaderPlatforms(root));
  applyLoaderRules(root, expected, diffLoaderRules(expected, readExistingLoaderRules(root)));
}

/** The bundled skill with its version marker rewritten to an older one, whatever the bundled version is. */
function oldSkill(): string {
  const bundled = readBundledSkill();
  const old = bundled.replace(/<!-- ctxo-skill v\d+\.\d+ -->/, '<!-- ctxo-skill v0.1 -->');
  expect(old).not.toBe(bundled);
  return old;
}

function checks(root: string): Record<string, IHealthCheck> {
  const host: CtxoHost = createModuleHost({ projectRoot: root, mode: 'cli', cliVersion: domainVersion() });
  return Object.fromEntries(domainDoctorChecks(host).map((check) => [check.id, check]));
}

async function run(root: string, id: string): Promise<CheckResult> {
  return checks(root)[id]!.run({ projectRoot: root, ctxoRoot: join(root, '.ctxo') });
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[full.slice(root.length)] = readFileSync(full, 'utf-8');
    }
  };
  walk(root);
  return out;
}

describe('domainDoctorChecks', () => {
  it('exposes the three checks with their ids and titles, and register wires them', async () => {
    const host = createModuleHost({ projectRoot: process.cwd(), mode: 'cli', cliVersion: domainVersion() });
    const list = domainDoctorChecks(host);
    expect(list.map((c) => [c.id, c.title])).toEqual([
      ['domain_registry', 'Domain registry'],
      ['domain_agent_setup', 'Domain agent setup'],
      ['domain_conventions', 'Domain conventions'],
    ]);
    const registration = await register(host);
    expect(registration?.doctorChecks?.map((c) => c.id)).toEqual(['domain_registry', 'domain_agent_setup', 'domain_conventions']);
  });
});

describe('domain_registry', () => {
  it('passes without a registry', async () => {
    const result = await run(setup({ registry: null }), 'domain_registry');
    expect(result).toMatchObject({ id: 'domain_registry', title: 'Domain registry', status: 'pass', message: 'no registry (domain layer not set up)' });
  });

  it('passes with the context count', async () => {
    const result = await run(setup(), 'domain_registry');
    expect(result).toMatchObject({ status: 'pass', message: '1 contexts' });
  });

  it('warns on registry problems', async () => {
    const result = await run(setup({ registry: 'version: 1\ncontexts:\n  - id: Bad Id\n' }), 'domain_registry');
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/^\d+ registry or config problems$/);
    expect(result.fix).toBe('Run "ctxo verify-domain" for details');
  });

  it('warns on config problems', async () => {
    const root = setup();
    put(root, '.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  boundaries:\n    enforce: sometimes\n');
    const result = await run(root, 'domain_registry');
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/registry or config problems$/);
  });

  it('warns on unknown keys under domain:, with a suggestion for a near miss, even without a registry', async () => {
    const root = setup({ registry: null });
    put(root, '.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  boundaires:\n    enforce: report\n  rules:\n    trackerPrefix: [JIRA]\n  colour: red\n');
    const result = await run(root, 'domain_registry');
    expect(result.status).toBe('warn');
    expect(result.message).toBe(
      'unknown keys under domain: domain.boundaires (did you mean domain.boundaries?), ' +
        'domain.rules.trackerPrefix (did you mean domain.rules.trackerPrefixes?), domain.colour',
    );
    expect(result.fix).toBe('Correct or remove the unknown keys in .ctxo/config.yaml; until then the keys you meant to set keep their defaults');
  });

  it('reports registry problems and an unknown key together', async () => {
    const root = setup({ registry: 'version: 1\ncontexts:\n  - id: Bad Id\n' });
    put(root, '.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  tests:\n    contract:\n      pathz: ["x/**"]\n');
    const result = await run(root, 'domain_registry');
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(
      /^\d+ registry or config problems; unknown key under domain: domain\.tests\.contract\.pathz \(did you mean domain\.tests\.contract\.paths\?\)$/,
    );
    expect(result.fix).toBe(
      'Run "ctxo verify-domain" for details; Correct or remove the unknown keys in .ctxo/config.yaml; until then the keys you meant to set keep their defaults',
    );
  });

  it('passes with a valid full domain section and with an empty one', async () => {
    const root = setup();
    const full = [
      'version: "1.0"',
      'domain:',
      '  registry: docs/domain/contexts.yaml',
      '  coverage: { unowned: warn }',
      '  boundaries: { enforce: by-rung, blockingRungs: [bounded, boring] }',
      "  rules: { idPattern: '^[A-Z][A-Z0-9]*-\\d+$', trackerPrefixes: [] }",
      '  tests:',
      '    ruleTraitKeys: [Rule]',
      '    characterization: { annotations: ["Tag:characterization"], paths: ["**/Characterization/**"], names: ["[characterization]"] }',
      '    contract: { annotations: ["Tag:contract"], paths: ["**/Contract/**"], names: ["[contract]"] }',
      '  rungs: { pinnedCoverage: 0.8 }',
      '  facts: { trivialLiterals: [0, 1], normalizationMethods: [trim], textScanExtensions: [.py] }',
      '  guard: { enabled: true, base: origin/main, subagents: false }',
      '',
    ].join('\n');
    put(root, '.ctxo/config.yaml', full);
    expect(await run(root, 'domain_registry')).toMatchObject({ status: 'pass', message: '1 contexts' });
    put(root, '.ctxo/config.yaml', 'version: "1.0"\ndomain: {}\n');
    expect(await run(root, 'domain_registry')).toMatchObject({ status: 'pass', message: '1 contexts' });
  });
});

describe('domain_agent_setup', () => {
  it('passes when there are no contexts', async () => {
    const result = await run(setup({ registry: null }), 'domain_agent_setup');
    expect(result.status).toBe('pass');
  });

  it('passes with hooks, skill and loader rules in place', async () => {
    const root = setup();
    writeAgentSetup(root);
    const result = await run(root, 'domain_agent_setup');
    expect(result).toMatchObject({ id: 'domain_agent_setup', title: 'Domain agent setup', status: 'pass' });
  });

  it('warns for a missing hook event', async () => {
    const root = setup();
    writeAgentSetup(root, ['SessionStart', 'Stop']);
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('TaskCompleted');
    expect(result.fix).toBe('Run "ctxo doctor --fix" (or "ctxo init --only domain" and "ctxo domain rules --write")');
  });

  it('warns for a missing skill', async () => {
    const root = setup();
    writeAgentSetup(root);
    rmSync(join(root, '.claude', 'skills'), { recursive: true });
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('ctxo-domain-fold');
  });

  it('warns for an outdated skill', async () => {
    const root = setup();
    writeAgentSetup(root);
    put(root, '.claude/skills/ctxo-domain-fold/SKILL.md', oldSkill());
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/outdated/);
  });

  it('warns for a loader-rules diff', async () => {
    const root = setup();
    writeAgentSetup(root);
    rmSync(join(root, '.claude', 'rules', 'ctxo-context-lending.md'));
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/loader rules/);
  });

  it('expects SubagentStop when domain.guard.subagents is true', async () => {
    const root = setup();
    put(root, '.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  guard:\n    subagents: true\n');
    writeAgentSetup(root);
    const missing = await run(root, 'domain_agent_setup');
    expect(missing.status).toBe('warn');
    expect(missing.message).toContain('not registered for SubagentStop');

    writeAgentSetup(root, ['SessionStart', 'Stop', 'TaskCompleted', 'SubagentStop']);
    expect((await run(root, 'domain_agent_setup')).status).toBe('pass');
  });

  it('does not expect SubagentStop by default', async () => {
    const root = setup();
    writeAgentSetup(root);
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('pass');
    expect(result.message).not.toContain('SubagentStop');
  });

  it('warns for a missing Cursor skill when .cursor/ exists, and for an outdated one', async () => {
    const root = setup();
    put(root, '.cursor/.keep', '');
    writeAgentSetup(root);
    const missing = await run(root, 'domain_agent_setup');
    expect(missing.status).toBe('warn');
    expect(missing.message).toContain('ctxo-domain-fold skill missing (.cursor/rules/ctxo-domain-fold.mdc)');
    expect(missing.message).not.toContain('.claude/skills');

    put(root, '.cursor/rules/ctxo-domain-fold.mdc', oldSkill());
    const outdated = await run(root, 'domain_agent_setup');
    expect(outdated.status).toBe('warn');
    expect(outdated.message).toContain('ctxo-domain-fold skill outdated (.cursor/rules/ctxo-domain-fold.mdc)');

    put(root, '.cursor/rules/ctxo-domain-fold.mdc', readBundledSkill());
    ensureCursorHooks(root);
    expect((await run(root, 'domain_agent_setup')).status).toBe('pass');
  });

  it('reports a loader rule without the generated marker as blocked', async () => {
    const root = setup();
    writeAgentSetup(root);
    put(root, '.claude/rules/ctxo-context-lending.md', '# written by hand\n');
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('loader rules out of date (1 blocked)');
  });

  it('warns, and does not throw, when .claude/settings.json is not valid JSON', async () => {
    const root = setup();
    writeAgentSetup(root);
    put(root, '.claude/settings.json', '{ not json');
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('.claude/settings.json is not valid JSON');
    expect(result.message).not.toContain('check failed');
  });

  it('reports the Cursor fold reminder when .cursor/ exists: missing, partial, duplicated, unreadable', async () => {
    const root = setup();
    put(root, '.cursor/rules/ctxo-domain-fold.mdc', readBundledSkill());
    writeAgentSetup(root);

    const missing = await run(root, 'domain_agent_setup');
    expect(missing.status).toBe('warn');
    expect(missing.message).toContain(`ctxo domain-cursor-hook not registered in ${CURSOR_HOOKS_FILE} for beforeSubmitPrompt, stop`);

    put(root, CURSOR_HOOKS_FILE, JSON.stringify({ version: 1, hooks: { stop: [{ command: 'ctxo domain-cursor-hook' }] } }));
    expect((await run(root, 'domain_agent_setup')).message).toContain('for beforeSubmitPrompt');

    put(
      root,
      CURSOR_HOOKS_FILE,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: 'ctxo domain-cursor-hook' }],
          stop: [{ command: 'ctxo domain-cursor-hook' }, { command: 'npx ctxo domain-cursor-hook' }],
        },
      }),
    );
    expect((await run(root, 'domain_agent_setup')).message).toContain('registered more than once in .cursor/hooks.json for stop');

    put(root, CURSOR_HOOKS_FILE, '{ nope');
    const unreadable = await run(root, 'domain_agent_setup');
    expect(unreadable.message).toContain('.cursor/hooks.json is not valid JSON');
    expect(unreadable.message).not.toContain('check failed');

    rmSync(join(root, CURSOR_HOOKS_FILE));
    ensureCursorHooks(root);
    expect((await run(root, 'domain_agent_setup')).status).toBe('pass');
  });

  it('does not expect the Cursor fold reminder without .cursor/', async () => {
    const root = setup();
    writeAgentSetup(root);
    const result = await run(root, 'domain_agent_setup');
    expect(result.status).toBe('pass');
    expect(existsSync(join(root, CURSOR_HOOKS_FILE))).toBe(false);
  });
});

describe('domainDoctorFixes', () => {
  function fixOf(root: string) {
    const host: CtxoHost = createModuleHost({ projectRoot: root, mode: 'cli', cliVersion: domainVersion() });
    const [fix] = domainDoctorFixes(host);
    return fix!;
  }

  /** The two writers the CLI hands the fix, kept minimal: the Claude hook entry and the skill file. */
  function fixContext(root: string) {
    return {
      projectRoot: root,
      ctxoRoot: join(root, '.ctxo'),
      ensureClaudeHookEntry: (entry: { event: string; command: string }) => {
        const path = join(root, '.claude', 'settings.json');
        const json = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as { hooks?: Record<string, unknown[]> }) : {};
        const hooks = json.hooks ?? {};
        const list = hooks[entry.event] ?? [];
        if (JSON.stringify(list).includes(entry.command)) return { file: '.claude/settings.json', action: 'skipped' as const };
        put(root, '.claude/settings.json', JSON.stringify({ ...json, hooks: { ...hooks, [entry.event]: [...list, { hooks: [{ type: 'command', command: entry.command }] }] } }));
        return { file: '.claude/settings.json', action: 'updated' as const };
      },
      installSkill: (platformId: string, name: string, content: string) => {
        const file = platformId === 'cursor' ? `.cursor/rules/${name}.mdc` : `.claude/skills/${name}/SKILL.md`;
        if (existsSync(join(root, file)) && readFileSync(join(root, file), 'utf-8') === content) return { file, action: 'skipped' as const };
        put(root, file, content);
        return { file, action: 'created' as const };
      },
    };
  }

  it('answers domain_agent_setup and is wired by register', async () => {
    const root = setup();
    const fix = fixOf(root);
    expect(fix.checkId).toBe('domain_agent_setup');
    expect(fix.name).toBe('Domain agent setup');
    const host = createModuleHost({ projectRoot: root, mode: 'cli', cliVersion: domainVersion() });
    expect((await register(host))?.doctorFixes?.map((f) => f.checkId)).toEqual(['domain_agent_setup']);
  });

  it('repairs a Cursor project: the reminder entries are merged in, other hooks kept, and the check passes', async () => {
    const root = setup();
    put(root, '.cursor/.keep', '');
    writeAgentSetup(root);
    put(root, CURSOR_HOOKS_FILE, JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }], stop: [{ command: './audit.sh' }] } }));
    expect((await run(root, 'domain_agent_setup')).status).toBe('warn');

    const rows = await fixOf(root).apply(fixContext(root));
    expect(rows).toContainEqual({ file: CURSOR_HOOKS_FILE, action: 'updated' });
    const hooks = JSON.parse(readFileSync(join(root, CURSOR_HOOKS_FILE), 'utf-8')) as { hooks: Record<string, { command: string }[]> };
    expect(hooks.hooks['afterFileEdit']).toEqual([{ command: './format.sh' }]);
    expect(hooks.hooks['stop']).toEqual([{ command: './audit.sh' }, { command: 'ctxo domain-cursor-hook' }]);
    expect(hooks.hooks['beforeSubmitPrompt']).toEqual([{ command: 'ctxo domain-cursor-hook' }]);
    expect((await run(root, 'domain_agent_setup')).status).toBe('pass');

    // A second run changes nothing.
    const again = await fixOf(root).apply(fixContext(root));
    expect(again.every((row) => row.action === 'skipped')).toBe(true);
  });

  it('drops a duplicated reminder entry', async () => {
    const root = setup();
    put(root, '.cursor/rules/ctxo-domain-fold.mdc', readBundledSkill());
    writeAgentSetup(root);
    put(
      root,
      CURSOR_HOOKS_FILE,
      JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: 'ctxo domain-cursor-hook' }], stop: [{ command: 'ctxo domain-cursor-hook' }, { command: 'ctxo domain-cursor-hook' }] } }),
    );
    await fixOf(root).apply(fixContext(root));
    const hooks = JSON.parse(readFileSync(join(root, CURSOR_HOOKS_FILE), 'utf-8')) as { hooks: Record<string, unknown[]> };
    expect(hooks.hooks['stop']).toEqual([{ command: 'ctxo domain-cursor-hook' }]);
    expect((await run(root, 'domain_agent_setup')).status).toBe('pass');
  });

  it('leaves an unreadable hooks.json alone and reports it as a warning row', async () => {
    const root = setup();
    put(root, '.cursor/.keep', '');
    writeAgentSetup(root);
    put(root, CURSOR_HOOKS_FILE, '{ nope');
    const rows = await fixOf(root).apply(fixContext(root));
    const row = rows.find((r) => r.file === CURSOR_HOOKS_FILE);
    expect(row?.action).toBe('skipped');
    expect(row?.warning).toContain('is not valid JSON');
    expect(readFileSync(join(root, CURSOR_HOOKS_FILE), 'utf-8')).toBe('{ nope');
  });

  it('changes nothing without contexts', async () => {
    const root = setup({ registry: null });
    put(root, '.cursor/.keep', '');
    const before = snapshot(root);
    expect(await fixOf(root).apply(fixContext(root))).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });
});

describe('domain_conventions', () => {
  const five = ['LEND-1 a', 'LEND-2 b', 'LEND-3 c', 'LEND-4 d', 'LEND-5 e'];

  it('passes when the proposal adds nothing', async () => {
    const result = await run(setup(), 'domain_conventions');
    expect(result).toMatchObject({ id: 'domain_conventions', title: 'Domain conventions', status: 'pass' });
  });

  it('warns when a tracker prefix at 5 overlaps a rule prefix and is not configured', async () => {
    const result = await run(setup({ subjects: five }), 'domain_conventions');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('LEND');
    expect(result.fix).toBe('Review with "ctxo domain discover", then confirm with "--write"');
  });

  it('passes once the prefix is configured', async () => {
    const root = setup({ subjects: five });
    put(root, '.ctxo/config.yaml', 'version: "1.0"\ndomain:\n  rules:\n    trackerPrefixes: [LEND]\n');
    const result = await run(root, 'domain_conventions');
    expect(result.status).toBe('pass');
  });

  it('warns when the proposal adds a prefix that does not overlap a rule prefix', async () => {
    const root = setup({ subjects: five.map((s) => s.replace('LEND', 'OPS')) });
    const result = await run(root, 'domain_conventions');
    expect(result.status).toBe('warn');
  });
});

describe('every check', () => {
  it('never writes files', async () => {
    const root = setup({ subjects: ['LEND-1 a', 'LEND-2 b', 'LEND-3 c', 'LEND-4 d', 'LEND-5 e'] });
    put(root, '.claude/settings.json', settings(['Stop']));
    const before = snapshot(root);
    for (const id of ['domain_registry', 'domain_agent_setup', 'domain_conventions']) await run(root, id);
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(root, '.claude', 'rules'))).toBe(false);
  });

  it('a check that hits an error reports warn', async () => {
    const root = setup();
    const host = createModuleHost({ projectRoot: root, mode: 'cli', cliVersion: domainVersion() });
    const broken: CtxoHost = {
      ...host,
      services: {
        ...host.services,
        loadConfig() {
          throw new Error('boom');
        },
      },
    };
    for (const check of domainDoctorChecks(broken)) {
      const result = await check.run({ projectRoot: root, ctxoRoot: join(root, '.ctxo') });
      expect(result.status).toBe('warn');
      expect(result.message).toContain('boom');
    }
  });
});
