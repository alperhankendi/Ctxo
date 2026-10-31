import type { CtxoHost, CtxoModuleRegister, FactDetectorOptions } from '@ctxo/cli/internal';
import { contextsTouchedCommand } from './commands/contexts-touched-command.js';
import { domainCommand } from './commands/domain-command.js';
import { DEFAULT_DOMAIN_CONFIG, resolveDomainConfig, toFactDetectorOptions, type DomainConfig } from './core/domain-config.js';
import { domainCursorHookCommand } from './commands/domain-cursor-hook-command.js';
import { domainGuardHookCommand } from './commands/domain-guard-hook-command.js';
import { verifyDomainCommand } from './commands/verify-domain-command.js';
import { domainDoctorChecks, domainDoctorFixes } from './doctor/domain-checks.js';
import { domainIndexPass } from './index-pass/domain-index-pass.js';
import { domainInit } from './init/domain-init.js';
import { domainRankedScope } from './mcp/domain-scope.js';
import { createDomainState } from './mcp/domain-state.js';
import { domainTools } from './mcp/domain-tools.js';
import { createEnrichers } from './mcp/enrichers.js';
import { loopTools } from './mcp/loop-tools.js';
import { taskContextReservation } from './mcp/graph-enrichers.js';
import { DOMAIN_PACKAGE, domainVersion, sameMinor } from './version.js';
import { repoIsFile } from './adapters/repo-files.js';
import { createWatchPathClassifier } from './adapters/watch-paths.js';

/**
 * The domain config for the fact request and the watch classifier. Read only when the CLI asks for
 * `indexCapabilities` (`ctxo index`, `ctxo watch`) or classifies a watched path, never at register time,
 * so commands and the hook route do not read the config a second time (the CLI's `loadConfig` logs its own
 * warnings). Silent otherwise (W7): config problems are reported
 * by the index pass and doctor. Any failure gives the defaults.
 */
function factRequestConfig(host: CtxoHost): DomainConfig {
  try {
    const loaded = host.services.loadConfig(host.ctxoRoot);
    return resolveDomainConfig((loaded.config as Record<string, unknown>)['domain']).config;
  } catch {
    return DEFAULT_DOMAIN_CONFIG;
  }
}

/**
 * Whether the domain graph is stale against the current registry, cards or glossary (the state's hash checks).
 * No registry, an invalid one or no graph yet is not stale: a watch pass cannot fix those (`ctxo index` can).
 */
function artifactsStale(state: ReturnType<typeof createDomainState>): boolean {
  const result = state.load();
  return result.ok ? result.snapshot.staleCards : result.reason === 'stale-registry';
}

/**
 * The module entry the CLI loads (ADR-018). The module runs only against the CLI minor it was built for;
 * on a mismatch it warns and declines.
 */
export const register: CtxoModuleRegister = async (host) => {
  const version = domainVersion();
  if (!sameMinor(version, host.cliVersion)) {
    const [major, minor] = version.split('.');
    host.services
      .createLogger('ctxo:domain')
      .warn(
        `${DOMAIN_PACKAGE} ${version} needs @ctxo/cli ${major}.${minor}.x, running ${host.cliVersion}; staying inactive`,
      );
    return undefined;
  }
  // One state for the enrichers, the reservation, the tools and the scope; it does no I/O until a first load (P19).
  const state = createDomainState(host);
  let capabilities: { readonly value: { readonly facts: true; readonly factOptions: FactDetectorOptions } | undefined } | undefined;
  // One config read per process, shared by the fact request and the watch seams: under ctxo watch it happens
  // when the plugins load, so the classifier and the fact request agree with the config watch started with.
  let config: DomainConfig | undefined;
  const domainConfig = (): DomainConfig => (config ??= factRequestConfig(host));
  return {
    id: 'domain',
    // Lazy and read once: the config is loaded on the first fact request only. Facts are requested only when the
    // registry file exists, so a repository without one keeps the index JSON it has without the module (PR 3).
    get indexCapabilities() {
      if (capabilities === undefined) {
        const cfg = domainConfig();
        capabilities = {
          value: repoIsFile(host.projectRoot, cfg.registry) ? { facts: true, factOptions: toFactDetectorOptions(cfg) } : undefined,
        };
      }
      return capabilities.value;
    },
    indexPass: domainIndexPass(host),
    // ctxo watch: which changed paths the index pass reads, and whether the artifacts are stale at start.
    classifyWatchPath: createWatchPathClassifier(host.projectRoot, domainConfig),
    watchArtifactsStale: () => artifactsStale(state),
    registerCommands(registrar) {
      registrar.registerCommand(contextsTouchedCommand(host));
      registrar.registerCommand(domainGuardHookCommand(host));
      registrar.registerCommand(domainCursorHookCommand(host));
      registrar.registerCommand(domainCommand(host));
      registrar.registerCommand(verifyDomainCommand(host));
    },
    registerTools(registrar) {
      // The PR 3 tools, then the loop tools (W12: composed here, so domainTools keeps its two).
      for (const tool of [...domainTools(host, state), ...loopTools(host, state)]) registrar.registerTool(tool);
    },
    enrich: createEnrichers(host, state),
    reserveTaskContextTokens: taskContextReservation(state),
    rankedContextScopes: [domainRankedScope(host, state)],
    init: domainInit(host),
    doctorChecks: domainDoctorChecks(host),
    doctorFixes: domainDoctorFixes(host),
  };
};
