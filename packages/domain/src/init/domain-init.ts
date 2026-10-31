import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import type { ClaudeHookEntry, CtxoHost, InitContribution, InitFileResult, InitPartContext } from '@ctxo/cli/internal';
import { CURSOR_HOOKS_FILE, ensureCursorHooks } from '../adapters/cursor-hooks-file.js';
import { mergeDiscoveryProposal, mergeDomainDefaults } from '../adapters/config-writer.js';
import { gatherDiscoveryInput, readConfigText as readConfigFile, writeConfigText } from '../adapters/discovery-sources.js';
import { applyLoaderRules, loaderPlatforms, readExistingLoaderRules } from '../adapters/loader-rules-files.js';
import { leavesProject } from '../adapters/repo-files.js';
import { readRegistry } from '../adapters/registry-reader.js';
import { discoverConventions, formatDiscovery, proposalAddsSomething } from '../core/discovery.js';
import { diffLoaderRules, renderLoaderRules } from '../core/loader-rules.js';
import { resolveDomainConfig, type BoundaryMode, type DomainConfig } from '../core/domain-config.js';
import type { HookEvent } from '../core/guard.js';

/** The command `ctxo init --domain` registers for every fold-guard event (D16). */
export const DOMAIN_HOOK_COMMAND = 'ctxo domain-guard-hook';

/** The registry `ctxo init --domain` writes when there is none: no contexts and no cards (D15). */
export const REGISTRY_SKELETON = `# Ctxo domain registry: named contexts, their paths, cards and rungs.
# Conventions: https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md
version: 1
contexts: []
unowned:
  allow: []
glossary: docs/domain/glossary.md
contextMap: docs/domain/context-map.md
`;

const SKILL_NAME = 'ctxo-domain-fold';
const SKILL_PLATFORMS = ['claude-code', 'cursor'] as const;
const CONFIG_FILE = '.ctxo/config.yaml';
const BOM = String.fromCharCode(0xfeff);

const BOUNDARY_QUESTION = 'Boundary violations between named contexts';
const BOUNDARY_CHOICES: readonly { readonly value: BoundaryMode; readonly label: string }[] = [
  { value: 'by-rung', label: 'by-rung: fail verify-domain for bounded and boring contexts, warn for the others' },
  { value: 'report', label: 'report: warnings only' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `domain:` section of a config text, or undefined when the text does not parse. */
function domainSection(text: string): unknown {
  try {
    const parsed: unknown = parse(text.startsWith(BOM) ? text.slice(BOM.length) : text);
    return isRecord(parsed) ? parsed['domain'] : undefined;
  } catch {
    return undefined;
  }
}

/** `domain.boundaries.enforce` when the text holds a valid one. */
function configuredMode(text: string): BoundaryMode | undefined {
  const domain = domainSection(text);
  const boundaries = isRecord(domain) ? domain['boundaries'] : undefined;
  const enforce = isRecord(boundaries) ? boundaries['enforce'] : undefined;
  return enforce === 'by-rung' || enforce === 'report' ? enforce : undefined;
}

/** The config text, read once: '' when the file is missing (a dry run before the config exists). */
function readConfigText(projectRoot: string): string {
  try {
    return readFileSync(join(projectRoot, '.ctxo', 'config.yaml'), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Steps 1 to 3: the config file, the boundary mode and the domain defaults. Returns the row and the
 * domain config the later steps read (the defaults when the config cannot be merged).
 */
async function applyConfig(ctx: InitPartContext): Promise<{ readonly row: InitFileResult; readonly config: DomainConfig }> {
  const ensured = ctx.ensureConfigFile();
  if (ensured.warning !== undefined) {
    return { row: ensured, config: resolveDomainConfig(undefined).config };
  }
  let text: string;
  try {
    text = readConfigText(ctx.projectRoot);
  } catch (err) {
    const warning = `${CONFIG_FILE}: could not be read (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}); left unchanged`;
    return { row: { file: CONFIG_FILE, action: 'skipped', warning }, config: resolveDomainConfig(undefined).config };
  }

  const mode = ctx.boundaries ?? configuredMode(text) ?? (await ctx.prompt.select(BOUNDARY_QUESTION, BOUNDARY_CHOICES, 'by-rung'));
  let merged: { readonly text: string; readonly changed: boolean };
  try {
    merged = mergeDomainDefaults(text, mode);
  } catch (err) {
    const warning = `${CONFIG_FILE}: cannot add the domain defaults (${(err as Error).message}); left unchanged`;
    return { row: { file: CONFIG_FILE, action: 'skipped', warning }, config: resolveDomainConfig(undefined).config };
  }
  if (merged.changed && !ctx.dryRun) writeConfigText(join(ctx.projectRoot, '.ctxo', 'config.yaml'), merged.text);
  const action = ensured.action === 'created' ? 'created' : merged.changed ? 'updated' : 'skipped';
  return { row: { file: CONFIG_FILE, action }, config: resolveDomainConfig(domainSection(merged.text)).config };
}

/** Step 4: the registry skeleton at the configured path when there is no file; created in one step (`wx`). */
function applyRegistry(ctx: InitPartContext, registryPath: string): InitFileResult {
  const file = registryPath.replace(/\\/g, '/');
  const absolute = resolve(ctx.projectRoot, registryPath);
  const rel = relative(resolve(ctx.projectRoot), absolute);
  if (rel === '' || leavesProject(rel)) {
    return { file, action: 'skipped', warning: `${file}: the registry path must stay inside the project; not created` };
  }
  if (ctx.dryRun) return { file, action: existsSync(absolute) ? 'skipped' : 'created' };
  mkdirSync(dirname(absolute), { recursive: true });
  try {
    writeFileSync(absolute, REGISTRY_SKELETON, { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { file, action: 'skipped' };
    throw err;
  }
  return { file, action: 'created' };
}

const PROPOSAL_QUESTION = 'Apply the proposed conventions?';

/**
 * Step 5: discovers the repository's conventions and, after a confirmation (`--yes` accepts), merges the
 * proposal into `.ctxo/config.yaml`. Returns no row when the proposal adds nothing. A dry run only reports
 * what would change.
 */
async function applyDiscovery(host: CtxoHost, ctx: InitPartContext, config: DomainConfig): Promise<readonly InitFileResult[]> {
  try {
    const ctxoRoot = join(ctx.projectRoot, '.ctxo');
    const loaded = host.services.loadConfig(ctxoRoot);
    const input = await gatherDiscoveryInput(host, ctx.projectRoot, ctxoRoot, loaded, config);
    const { evidence, proposal } = discoverConventions(input);
    if (!proposalAddsSomething(proposal, config, input.indexTests)) return [];

    console.error(formatDiscovery(evidence, proposal, config));
    if (ctx.dryRun) return [{ file: CONFIG_FILE, action: 'updated' }];
    if (!ctx.yes && !(await ctx.prompt.confirm(PROPOSAL_QUESTION, true))) return [];

    const path = join(ctxoRoot, 'config.yaml');
    const merged = mergeDiscoveryProposal(readConfigFile(path) ?? '', proposal);
    if (!merged.changed) return [];
    writeConfigText(path, merged.text);
    return [{ file: CONFIG_FILE, action: 'updated' }];
  } catch (err) {
    return [{ file: CONFIG_FILE, action: 'skipped', warning: `${CONFIG_FILE}: conventions not discovered (${(err as Error).message})` }];
  }
}

const BLOCKED_WARNING = 'exists without the generated marker; rename or delete it, then run "ctxo domain rules --write"';

/** Step 6: the loader rules, when the registry is valid and a context has a card. One row per written, deleted or blocked file. */
function applyRules(ctx: { readonly projectRoot: string; readonly dryRun: boolean }, registryPath: string): readonly InitFileResult[] {
  try {
    const loaded = readRegistry(ctx.projectRoot, registryPath);
    const registry = loaded?.registry;
    if (registry === undefined || loaded!.problems.length > 0) return [];
    const expected = renderLoaderRules(registry, loaderPlatforms(ctx.projectRoot));
    const diff = diffLoaderRules(expected, readExistingLoaderRules(ctx.projectRoot));
    // Nothing to write, and no stale or blocked file to report: skip. Stale files are deleted even when the
    // last card is gone (verify-domain check 8 would fail on them in CI).
    if (expected.length === 0 && diff.stale.length === 0 && diff.blocked.length === 0) return [];
    const rows: InitFileResult[] = [];
    if (ctx.dryRun) {
      for (const file of diff.missing) rows.push({ file, action: 'created' });
      for (const file of diff.outdated) rows.push({ file, action: 'updated' });
      for (const file of diff.stale) rows.push({ file: `${file} (deleted)`, action: 'updated' });
    } else {
      for (const result of applyLoaderRules(ctx.projectRoot, expected, diff)) {
        if (result.action === 'deleted') rows.push({ file: `${result.file} (deleted)`, action: 'updated' });
        else rows.push({ file: result.file, action: result.action, ...(result.warning ? { warning: result.warning } : {}) });
      }
    }
    for (const file of diff.blocked) rows.push({ file, action: 'skipped', warning: `${file} ${BLOCKED_WARNING}` });
    return rows;
  } catch (err) {
    return [{ file: '.claude/rules', action: 'skipped', warning: `loader rules not written (${(err as Error).message})` }];
  }
}

/** The bundled skill text, found by walking up from this module's directory (`skills/` sits next to `dist/`). */
export function readBundledSkill(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'skills', SKILL_NAME, 'SKILL.md');
    try {
      return readFileSync(candidate, 'utf-8');
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate the bundled ${SKILL_NAME} skill`);
}

/**
 * The domain part of `ctxo init` (`--domain`, `--only domain`): the domain config defaults with the
 * boundary mode, the registry skeleton, the fold guard hooks for Claude Code, the fold reminder in
 * `.cursor/hooks.json` for Cursor and the `ctxo-domain-fold`
 * skill for Claude Code and Cursor. Every step honours `ctx.dryRun`.
 */
export function domainInit(host: CtxoHost): InitContribution {
  return {
    part: 'domain',
    async apply(ctx: InitPartContext): Promise<readonly InitFileResult[]> {
      const rows: InitFileResult[] = [];

      const { row, config } = await applyConfig(ctx);
      rows.push(row);

      rows.push(applyRegistry(ctx, config.registry));
      rows.push(...(await applyDiscovery(host, ctx, config)));
      rows.push(...applyAgentSetup(ctx, config));

      return rows;
    },
  };
}

/** What the agent-setup steps need: `ctxo init` and `ctxo doctor --fix` both provide it. */
export interface AgentSetupContext {
  readonly projectRoot: string;
  /** The agent platforms to set up (`claude-code`, `cursor`). */
  readonly toolIds: readonly string[];
  readonly dryRun: boolean;
  ensureClaudeHookEntry(entry: ClaudeHookEntry): InitFileResult;
  installSkill(platformId: string, name: string, content: string): InitFileResult | undefined;
  /** The platforms whose skill is (re)installed; all selected ones when absent. `ctxo doctor --fix` passes the ones it reported. */
  readonly skillPlatforms?: readonly string[];
}

/**
 * Steps 6 to 9, the agent setup: the loader rules, the fold guard hooks for Claude Code, the fold reminder
 * in `.cursor/hooks.json` for Cursor (not with `domain.guard.enabled: false`: it runs on every prompt, so a
 * disabled guard opts out of it) and the `ctxo-domain-fold` skill. Every step honours `ctx.dryRun`.
 */
export function applyAgentSetup(ctx: AgentSetupContext, config: DomainConfig): InitFileResult[] {
  const rows: InitFileResult[] = [];
  rows.push(...applyRules(ctx, config.registry));

  if (ctx.toolIds.includes('claude-code')) {
    const events: HookEvent[] = ['SessionStart', 'Stop', 'TaskCompleted'];
    if (config.guard.subagents) events.push('SubagentStop');
    for (const event of events) {
      const result = ctx.ensureClaudeHookEntry({ event, command: DOMAIN_HOOK_COMMAND });
      rows.push({ ...result, file: `${result.file} (${event})` });
    }
  }

  if (ctx.toolIds.includes('cursor') && config.guard.enabled) {
    try {
      rows.push(ensureCursorHooks(ctx.projectRoot, { dryRun: ctx.dryRun }));
    } catch (err) {
      rows.push({ file: CURSOR_HOOKS_FILE, action: 'skipped', warning: `${CURSOR_HOOKS_FILE}: fold reminder not registered (${(err as Error).message})` });
    }
  }

  const platforms = SKILL_PLATFORMS.filter((id) => ctx.toolIds.includes(id) && (ctx.skillPlatforms === undefined || ctx.skillPlatforms.includes(id)));
  if (platforms.length > 0) {
    let content: string | undefined;
    try {
      content = readBundledSkill();
    } catch (err) {
      rows.push({ file: SKILL_NAME, action: 'skipped', warning: `${SKILL_NAME} not installed: ${(err as Error).message}` });
    }
    if (content !== undefined) {
      for (const platformId of platforms) {
        const result = ctx.installSkill(platformId, SKILL_NAME, content);
        if (result !== undefined) rows.push(result);
      }
    }
  }
  return rows;
}
