import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckContext, CheckResult, CtxoHost, IHealthCheck } from '@ctxo/cli/internal';
import { gatherDiscoveryInput } from '../adapters/discovery-sources.js';
import { loaderPlatforms, readExistingLoaderRules } from '../adapters/loader-rules-files.js';
import { readRegistry } from '../adapters/registry-reader.js';
import { discoverConventions, proposalAddsSomething, TRACKER_PREFIX_MIN } from '../core/discovery.js';
import {
  describeUnknownDomainKey,
  findUnknownDomainKeys,
  resolveDomainConfig,
  type DomainConfig,
  type UnknownDomainKey,
} from '../core/domain-config.js';
import type { HookEvent } from '../core/guard.js';
import { diffLoaderRules, renderLoaderRules } from '../core/loader-rules.js';
import type { LoadedRegistry } from '../core/registry.js';
import { DOMAIN_HOOK_COMMAND, readBundledSkill } from '../init/domain-init.js';

const SKILL_NAME = 'ctxo-domain-fold';
const REGISTRY_FIX = 'Run "ctxo verify-domain" for details';
const UNKNOWN_KEYS_FIX = 'Correct or remove the unknown keys in .ctxo/config.yaml; until then the keys you meant to set keep their defaults';
const AGENT_FIX = 'Run "ctxo init --only domain" and "ctxo domain rules --write"';
const CONVENTIONS_FIX = 'Review with "ctxo domain discover", then confirm with "--write"';
const SKILL_MARKER = /^<!-- ctxo-skill v(\d+)\.(\d+) -->[ \t]*$/m;

interface DomainState {
  /** The config as the host loaded it, kept so a check that needs the raw config does not load it twice. */
  readonly loaded: ReturnType<CtxoHost['services']['loadConfig']>;
  readonly config: DomainConfig;
  readonly configProblems: number;
  /** Keys under `domain:` the resolver does not read: a typo falls back to the default silently otherwise. */
  readonly unknownKeys: readonly UnknownDomainKey[];
  readonly registry: LoadedRegistry | undefined;
}

function load(host: CtxoHost, ctx: CheckContext): DomainState {
  const loaded = host.services.loadConfig(ctx.ctxoRoot);
  const raw = (loaded.config as Record<string, unknown>)['domain'];
  const { config, problems } = resolveDomainConfig(raw);
  return {
    loaded,
    config,
    configProblems: problems.length,
    unknownKeys: findUnknownDomainKeys(raw),
    registry: readRegistry(ctx.projectRoot, config.registry),
  };
}

/** A valid registry with at least one context: the other checks have nothing to check without one. */
function contextsOf(state: DomainState): LoadedRegistry['registry'] {
  const registry = state.registry;
  return registry?.registry !== undefined && registry.problems.length === 0 && registry.registry.contexts.length > 0
    ? registry.registry
    : undefined;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True when `.claude/settings.json` registers the domain guard command under the event. */
function hasHook(settings: unknown, event: string): boolean {
  if (typeof settings !== 'object' || settings === null) return false;
  const hooks = (settings as Record<string, unknown>)['hooks'];
  if (typeof hooks !== 'object' || hooks === null) return false;
  const entries = (hooks as Record<string, unknown>)[event];
  return entries !== undefined && JSON.stringify(entries).includes(DOMAIN_HOOK_COMMAND);
}

function readSettings(projectRoot: string): { readonly settings?: unknown; readonly problem?: string } {
  const path = join(projectRoot, '.claude', 'settings.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return { problem: `.claude/settings.json cannot be read (${(err as Error).message})` };
  }
  try {
    return { settings: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown };
  } catch {
    return { problem: '.claude/settings.json is not valid JSON' };
  }
}

function skillVersion(text: string): readonly [number, number] | undefined {
  const match = SKILL_MARKER.exec(text);
  return match === null ? undefined : [Number(match[1]), Number(match[2])];
}

/** Missing or outdated skill files for the platforms the project uses; each entry is a short phrase. */
function skillProblems(projectRoot: string, claudeExpected: boolean, cursorExpected: boolean): string[] {
  const bundled = readBundledSkill();
  const current = skillVersion(bundled);
  const targets: { readonly label: string; readonly path: string }[] = [];
  if (claudeExpected) targets.push({ label: `.claude/skills/${SKILL_NAME}`, path: join(projectRoot, '.claude', 'skills', SKILL_NAME, 'SKILL.md') });
  if (cursorExpected) targets.push({ label: `.cursor/rules/${SKILL_NAME}.mdc`, path: join(projectRoot, '.cursor', 'rules', `${SKILL_NAME}.mdc`) });
  const problems: string[] = [];
  for (const target of targets) {
    if (!existsSync(target.path)) {
      problems.push(`${SKILL_NAME} skill missing (${target.label})`);
      continue;
    }
    const have = skillVersion(readFileSync(target.path, 'utf-8'));
    const outdated = current !== undefined && (have === undefined || have[0] < current[0] || (have[0] === current[0] && have[1] < current[1]));
    if (outdated) problems.push(`${SKILL_NAME} skill outdated (${target.label})`);
  }
  return problems;
}

function warn(id: string, title: string, message: string, fix: string): CheckResult {
  return { id, title, status: 'warn', message, fix };
}

function guarded(id: string, title: string, fix: string, body: () => Promise<CheckResult> | CheckResult): Promise<CheckResult> {
  return (async () => {
    try {
      return await body();
    } catch (err) {
      return warn(id, title, `check failed: ${(err as Error).message}`, fix);
    }
  })();
}

function registryCheck(host: CtxoHost): IHealthCheck {
  const id = 'domain_registry';
  const title = 'Domain registry';
  return {
    id,
    title,
    run: (ctx) =>
      guarded(id, title, REGISTRY_FIX, () => {
        const state = load(host, ctx);
        const unknown = state.unknownKeys;
        if (state.registry === undefined && state.configProblems === 0 && unknown.length === 0) {
          return { id, title, status: 'pass', message: 'no registry (domain layer not set up)' };
        }
        const problems = state.configProblems + (state.registry?.problems.length ?? 0);
        const parts: string[] = [];
        const fixes: string[] = [];
        if (problems > 0) {
          parts.push(`${problems} registry or config problems`);
          fixes.push(REGISTRY_FIX);
        }
        if (unknown.length > 0) {
          parts.push(`unknown ${unknown.length === 1 ? 'key' : 'keys'} under domain: ${unknown.map(describeUnknownDomainKey).join(', ')}`);
          fixes.push(UNKNOWN_KEYS_FIX);
        }
        if (parts.length > 0) return warn(id, title, parts.join('; '), fixes.join('; '));
        return { id, title, status: 'pass', message: `${state.registry?.registry?.contexts.length ?? 0} contexts` };
      }),
  };
}

function agentSetupCheck(host: CtxoHost): IHealthCheck {
  const id = 'domain_agent_setup';
  const title = 'Domain agent setup';
  return {
    id,
    title,
    run: (ctx) =>
      guarded(id, title, AGENT_FIX, () => {
        const state = load(host, ctx);
        const registry = contextsOf(state);
        if (registry === undefined) return { id, title, status: 'pass', message: 'no contexts; nothing to set up' };

        const problems: string[] = [];
        const cursorExpected = isDirectory(join(ctx.projectRoot, '.cursor'));
        const claudeExpected = isDirectory(join(ctx.projectRoot, '.claude')) || !cursorExpected;

        if (claudeExpected) {
          const { settings, problem } = readSettings(ctx.projectRoot);
          if (problem !== undefined) problems.push(problem);
          else {
            const events: HookEvent[] = ['SessionStart', 'Stop', 'TaskCompleted'];
            if (state.config.guard.subagents) events.push('SubagentStop');
            const missing = events.filter((event) => !hasHook(settings, event));
            if (missing.length > 0) problems.push(`${DOMAIN_HOOK_COMMAND} not registered for ${missing.join(', ')}`);
          }
        }

        problems.push(...skillProblems(ctx.projectRoot, claudeExpected, cursorExpected));

        const expected = renderLoaderRules(registry, loaderPlatforms(ctx.projectRoot));
        const diff = diffLoaderRules(expected, readExistingLoaderRules(ctx.projectRoot));
        const loader: string[] = [];
        if (diff.missing.length > 0) loader.push(`${diff.missing.length} missing`);
        if (diff.outdated.length > 0) loader.push(`${diff.outdated.length} outdated`);
        if (diff.stale.length > 0) loader.push(`${diff.stale.length} stale`);
        if (diff.blocked.length > 0) loader.push(`${diff.blocked.length} blocked`);
        if (loader.length > 0) problems.push(`loader rules out of date (${loader.join(', ')})`);

        if (problems.length > 0) return warn(id, title, problems.join('; '), AGENT_FIX);
        return { id, title, status: 'pass', message: 'hooks, skill and loader rules are in place' };
      }),
  };
}

function conventionsCheck(host: CtxoHost): IHealthCheck {
  const id = 'domain_conventions';
  const title = 'Domain conventions';
  return {
    id,
    title,
    run: (ctx) =>
      guarded(id, title, CONVENTIONS_FIX, async () => {
        const state = load(host, ctx);
        if (contextsOf(state) === undefined) return { id, title, status: 'pass', message: 'no contexts; nothing to discover' };

        const input = await gatherDiscoveryInput(host, ctx.projectRoot, ctx.ctxoRoot, state.loaded, state.config);
        const { evidence, proposal } = discoverConventions(input);

        const configured = new Set(state.config.rules.trackerPrefixes);
        const overlapping = evidence.trackerKeys
          .filter((key) => key.occurrences >= TRACKER_PREFIX_MIN && key.overlapsRulePrefix && !configured.has(key.prefix))
          .map((key) => key.prefix);
        if (overlapping.length > 0) {
          return warn(id, title, `tracker prefix ${overlapping.join(', ')} overlaps a rule prefix and is not in domain.rules.trackerPrefixes`, CONVENTIONS_FIX);
        }
        if (proposalAddsSomething(proposal, state.config, input.indexTests)) {
          return warn(id, title, 'discovery proposes conventions the config does not hold', CONVENTIONS_FIX);
        }
        return { id, title, status: 'pass', message: 'configured conventions match the repository' };
      }),
  };
}

/** The three domain doctor checks: they report `pass` or `warn`, never write a file and report their own errors as `warn`. */
export function domainDoctorChecks(host: CtxoHost): IHealthCheck[] {
  return [registryCheck(host), agentSetupCheck(host), conventionsCheck(host)];
}
