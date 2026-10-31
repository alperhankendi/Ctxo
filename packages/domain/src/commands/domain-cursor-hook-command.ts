import type { CtxoHost, ModuleCommand, ModuleCommandContext } from '@ctxo/cli/internal';
import {
  CURSOR_REMINDER_WINDOW_MS,
  cursorEventOf,
  cursorSessionKey,
  formatCursorReminder,
  parseCursorPayload,
  type CursorPayload,
} from '../core/guard.js';
import { assessGuard, openGuardSession, recordSessionStart } from './domain-guard-hook-command.js';

const NAME = 'domain-cursor-hook';
const LOG_NAMESPACE = 'ctxo:domain-guard';

const HELP = [
  'Usage: ctxo domain-cursor-hook   (Cursor hook; reads the hook payload on stdin)',
  '',
  '  Registered in .cursor/hooks.json by "ctxo init --domain" for beforeSubmitPrompt and stop. On a stop',
  '  with status "completed" it prints {"followup_message": ...} once per conversation when the Claude Code',
  '  fold guard would block: this conversation committed changes to a context without a card update or a',
  '  Domain-Unchanged trailer. It never blocks. A stop prints nothing otherwise; every other input, errors',
  '  included, gets exactly {"continue":true}.',
];

/** What `beforeSubmitPrompt` always answers: the prompt goes through. */
export const CURSOR_CONTINUE = `${JSON.stringify({ continue: true })}\n`;

export interface CursorHookResult {
  /** The JSON line for Cursor, or undefined for no output. */
  readonly stdout?: string;
}

const NOTHING: CursorHookResult = {};
const CONTINUE: CursorHookResult = { stdout: CURSOR_CONTINUE };

/**
 * The fold reminder for one Cursor hook event. `beforeSubmitPrompt` records where the conversation starts
 * (the Claude Code guard's SessionStart) once, reading the record first so a repeat prompt spawns no git, and
 * lets the prompt through. `stop` with `status: "completed"` asks the guard's own decision (`assessGuard`) and,
 * when it would fire and this conversation has had no reminder yet, answers with a `followup_message`; an
 * aborted, errored or unknown stop stays quiet and records nothing. Never rejects: any error gives the quiet
 * answer, with the message on stderr.
 */
export async function evaluateCursorHook(
  payload: CursorPayload,
  env: { readonly host: CtxoHost; readonly projectRoot: string; readonly now?: () => number },
): Promise<CursorHookResult> {
  const log = env.host.services.createLogger(LOG_NAMESPACE);
  const quiet = payload.event === 'beforeSubmitPrompt' ? CONTINUE : NOTHING;
  try {
    const session = openGuardSession(env.host, env.projectRoot, log);
    const { key, windowed } = cursorSessionKey(payload);

    if (payload.event === 'beforeSubmitPrompt') {
      if (session.store.read(key) === undefined) await recordSessionStart(session, key);
      return CONTINUE;
    }

    // Only a turn that finished normally: a reminder after the user stopped the agent (or after an error)
    // would restart it against the user's intent. Claude Code's Stop fires on a normal finish only.
    if (payload.status !== 'completed') return NOTHING;

    // A follow-up from a stop hook is already running (Claude Code's stop_hook_active).
    if (payload.loopCount > 0) return NOTHING;

    // At most once per conversation (or generation); without an id, at most once per time window.
    const now = (env.now ?? Date.now)();
    const before = session.store.read(key);
    if (before?.remindedAt !== undefined && (!windowed || now - before.remindedAt < CURSOR_REMINDER_WINDOW_MS)) return NOTHING;

    const verdict = await assessGuard(session, key, { subagent: false });
    if (!verdict.fire) return NOTHING;
    const { record, fingerprint, unresolved } = verdict;
    session.store.write(key, { version: 1, startHead: record.startHead, blocked: [...record.blocked, fingerprint], remindedAt: now });
    return { stdout: `${JSON.stringify({ followup_message: formatCursorReminder(unresolved) })}\n` };
  } catch (err) {
    log.error(`domain reminder failed, staying quiet: ${err instanceof Error ? err.message : String(err)}`);
    return quiet;
  }
}

/** True when the raw input is a `stop` or another named event: the only inputs that get no `{"continue":true}`. */
function isStopOrOther(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const event = cursorEventOf(value as Record<string, unknown>);
    return event === 'stop' || event === 'other';
  } catch {
    return false;
  }
}

/**
 * `ctxo domain-cursor-hook` (hidden): the Cursor hook for beforeSubmitPrompt and stop. Always exits 0. A
 * `stop` (or another named event) prints the reminder or nothing; everything else, unreadable input and
 * errors included, prints exactly `{"continue":true}`.
 */
export function domainCursorHookCommand(host: CtxoHost): ModuleCommand {
  return {
    name: NAME,
    help: HELP,
    hidden: true,
    async run(_args: readonly string[], ctx: ModuleCommandContext): Promise<number> {
      const log = host.services.createLogger(LOG_NAMESPACE);
      let raw = '';
      try {
        raw = await ctx.readStdin();
        const payload = parseCursorPayload(raw);
        if (payload === undefined) {
          log.debug('domain reminder: not a beforeSubmitPrompt or stop payload; ignored');
          if (!isStopOrOther(raw)) process.stdout.write(CURSOR_CONTINUE);
          return 0;
        }
        const projectRoot =
          (payload.workspaceRoot !== undefined ? host.services.findGitRoot(payload.workspaceRoot) : undefined) ?? ctx.projectRoot;
        const result = await evaluateCursorHook(payload, { host, projectRoot });
        if (result.stdout !== undefined) process.stdout.write(result.stdout);
      } catch (err) {
        log.error(`domain reminder failed, staying quiet: ${err instanceof Error ? err.message : String(err)}`);
        if (!isStopOrOther(raw)) process.stdout.write(CURSOR_CONTINUE);
      }
      return 0;
    },
  };
}
