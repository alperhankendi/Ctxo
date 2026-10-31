import { join } from 'node:path';
import type { CtxoHost, FileIndex, IGitPort, Logger, ModuleCommand, ModuleCommandContext } from '@ctxo/cli/internal';
import { GitChangeReader } from '../adapters/git-changes.js';
import { GuardSessionStore, type GuardSessionRecord } from '../adapters/guard-session-store.js';
import { readRegistry } from '../adapters/registry-reader.js';
import { resolveDomainConfig } from '../core/domain-config.js';
import { branchExclude, formatGuardReason, guardFingerprint, parseGuardPayload, type GuardPayload } from '../core/guard.js';
import { createOwnership } from '../core/ownership.js';
import { computeTouched, type TouchedContext } from '../core/touched.js';

const NAME = 'domain-guard-hook';
const LOG_NAMESPACE = 'ctxo:domain-guard';

const HELP = [
  'Usage: ctxo domain-guard-hook   (Claude Code hook; reads the hook payload on stdin)',
  '',
  '  Registered by "ctxo init --domain" for SessionStart, Stop and TaskCompleted. Blocks a Stop or a',
  '  TaskCompleted once when this session committed changes to a context without a card update or a',
  '  Domain-Unchanged trailer. Any internal error allows.',
];

export interface GuardResult {
  readonly exitCode: 0 | 2;
  readonly stdout?: string;
  readonly stderr?: string;
}

const ALLOW: GuardResult = { exitCode: 0 };

/**
 * The fold guard's decision for one hook event (spec 10.4, ADR-018 Decision 5). Never rejects: any error
 * allows, with the message on stderr through the logger.
 */
export async function evaluateGuard(
  payload: GuardPayload,
  env: { readonly host: CtxoHost; readonly projectRoot: string },
): Promise<GuardResult> {
  const log = env.host.services.createLogger(LOG_NAMESPACE);
  try {
    return await decide(payload, env.host, env.projectRoot, log);
  } catch (err) {
    log.error(`domain guard failed, allowing: ${err instanceof Error ? err.message : String(err)}`);
    return ALLOW;
  }
}

/** What one hook run reads and writes: the host, the project, the logger, the session store and git. */
export interface GuardSessionEnv {
  readonly host: CtxoHost;
  readonly projectRoot: string;
  readonly log: Logger;
  readonly store: GuardSessionStore;
  readonly git: IGitPort;
}

/** The session store under `<projectRoot>/.ctxo/.cache` and git for one hook run. */
export function openGuardSession(host: CtxoHost, projectRoot: string, log: Logger): GuardSessionEnv {
  const store = new GuardSessionStore(join(projectRoot, '.ctxo', '.cache'), (message) => log.error(message));
  return { host, projectRoot, log, store, git: host.services.createGit(projectRoot) };
}

/** Records where the session starts (HEAD, or null before the first commit); a resumed session keeps its record (`wx`). */
export async function recordSessionStart(env: GuardSessionEnv, session: string): Promise<void> {
  const head = await env.git.resolveCommit?.('HEAD');
  env.store.create(session, { version: 1, startHead: head ?? null, blocked: [] });
}

/**
 * Whether the fold guard would fire for the session now. `fire: true` carries the unresolved contexts, the
 * fingerprint and the record the caller extends; nothing is recorded for the fingerprint here, so the
 * Claude Code guard and the Cursor reminder share one decision and differ only in what they do with it.
 */
export type GuardVerdict =
  | { readonly fire: false }
  | {
      readonly fire: true;
      readonly unresolved: readonly TouchedContext[];
      readonly fingerprint: string;
      readonly record: GuardSessionRecord;
    };

const QUIET: GuardVerdict = { fire: false };

/**
 * Steps 3 to 7 of the guard (spec 10.4): the config and registry, the session record (created or re-anchored
 * here, as both write it), this session's commits in the branch range, and the fingerprint check. May throw;
 * the callers fail open.
 */
export async function assessGuard(env: GuardSessionEnv, session: string, options: { readonly subagent: boolean }): Promise<GuardVerdict> {
  const { host, projectRoot, log, store, git } = env;
  const services = host.services;
  const ctxoRoot = join(projectRoot, '.ctxo');

  // 3. Off, a subagent without opt-in, or no usable registry.
  const loaded = services.loadConfig(ctxoRoot);
  const { config } = resolveDomainConfig((loaded.config as Record<string, unknown>)['domain']);
  if (!config.guard.enabled) return QUIET;
  if (options.subagent && !config.guard.subagents) return QUIET;
  const registryFile = readRegistry(projectRoot, config.registry);
  const registry = registryFile?.registry;
  if (registryFile === undefined || registry === undefined || registryFile.problems.length > 0) return QUIET;

  // 4. No record: the hook was installed mid-session. Record HEAD and allow this turn.
  const head = await git.resolveCommit?.('HEAD');
  const record = store.read(session);
  if (record === undefined) {
    store.create(session, { version: 1, startHead: head ?? null, blocked: [] });
    return QUIET;
  }

  // 5. HEAD unresolvable; or the start is no longer below HEAD (rebase, amend, reset, branch switch): re-anchor (D10).
  if (head === undefined) return QUIET;
  if (record.startHead !== null && (await git.isAncestor?.(record.startHead, head)) !== true) {
    store.write(session, { ...record, startHead: head });
    return QUIET;
  }

  // 6. This session's commits, intersected with the branch range.
  const exclude: string[] = record.startHead !== null ? [record.startHead] : [];
  const refs = await git.getRefs?.();
  const range = branchExclude({
    branches: refs?.branches ?? [],
    ...(refs?.currentBranch !== undefined ? { currentBranch: refs.currentBranch } : {}),
    ...(refs?.originHead !== undefined ? { originHead: refs.originHead } : {}),
    ...(refs?.upstream !== undefined ? { upstream: refs.upstream } : {}),
    ...(config.guard.base !== undefined ? { configuredBase: config.guard.base } : {}),
  });
  if (range.kind === 'upstream' && range.ref !== undefined) exclude.push(range.ref);
  if (range.kind === 'merge-base' && range.ref !== undefined) {
    const base = await git.mergeBase?.(head, range.ref);
    if (base !== undefined) exclude.push(base);
  }
  const commits = await new GitChangeReader(git).committed(exclude);
  if (commits === undefined || commits.length === 0) return QUIET;

  let indices: FileIndex[] = [];
  try {
    indices = services.readIndex(ctxoRoot);
  } catch (err) {
    log.debug(`No index for the test-file check: ${(err as Error).message}`);
  }
  const report = computeTouched({
    registry,
    ownership: createOwnership(registry, services.makeGlobMatcher),
    isTestFile: services.createTestFileCheck(loaded.config, indices),
    commits,
    workingTree: [],
    mode: 'committed',
  });

  // 7. Fire once per fingerprint.
  const unresolved = report.contexts.filter((context) => context.status === 'unresolved');
  if (unresolved.length === 0) return QUIET;
  const fingerprint = guardFingerprint(head, unresolved.map((context) => context.id));
  if (record.blocked.includes(fingerprint)) return QUIET;
  return { fire: true, unresolved, fingerprint, record };
}

async function decide(payload: GuardPayload, host: CtxoHost, projectRoot: string, log: Logger): Promise<GuardResult> {
  const env = openGuardSession(host, projectRoot, log);
  const session = payload.sessionId;

  // 1. SessionStart records where the session starts.
  if (payload.event === 'SessionStart') {
    await recordSessionStart(env, session);
    return ALLOW;
  }

  // 2. Claude Code is already continuing because of a stop hook.
  if (payload.stopHookActive) return ALLOW;

  // 3 to 7, then block once per fingerprint.
  const verdict = await assessGuard(env, session, { subagent: payload.event === 'SubagentStop' });
  if (!verdict.fire) return ALLOW;
  const { record, fingerprint, unresolved } = verdict;
  const next: GuardSessionRecord = { version: 1, startHead: record.startHead, blocked: [...record.blocked, fingerprint] };
  env.store.write(session, next);

  const reason = formatGuardReason(unresolved);
  if (payload.event === 'TaskCompleted') return { exitCode: 2, stderr: `${reason}\n` };
  return { exitCode: 0, stdout: `${JSON.stringify({ decision: 'block', reason })}\n` };
}

/** `ctxo domain-guard-hook` (hidden): the Claude Code hook for SessionStart, Stop, TaskCompleted and opt-in SubagentStop. */
export function domainGuardHookCommand(host: CtxoHost): ModuleCommand {
  return {
    name: NAME,
    help: HELP,
    hidden: true,
    async run(_args: readonly string[], ctx: ModuleCommandContext): Promise<number> {
      const log = host.services.createLogger(LOG_NAMESPACE);
      try {
        const payload = parseGuardPayload(await ctx.readStdin());
        if (payload === undefined) return 0;
        const projectRoot = (payload.cwd !== undefined ? host.services.findGitRoot(payload.cwd) : undefined) ?? ctx.projectRoot;
        const result = await evaluateGuard(payload, { host, projectRoot });
        if (result.stdout !== undefined) process.stdout.write(result.stdout);
        if (result.stderr !== undefined) process.stderr.write(result.stderr);
        return result.exitCode;
      } catch (err) {
        log.error(`domain guard failed, allowing: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }
    },
  };
}
