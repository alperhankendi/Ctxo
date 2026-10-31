import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { locateGitRoot } from './cli-paths.js';
import { loadModulesFor, readAllStdin, runModuleCommand, type FastRouteOptions } from './module-commands.js';

/**
 * The fast route of `ctxo domain-cursor-hook`, the Cursor fold reminder of `@ctxo/domain` (ADR-018 addendum
 * "The Cursor fold reminder"). Cursor runs `beforeSubmitPrompt` before every prompt and waits for it, so:
 *
 * - The route reads stdin once and tells the event from `hook_event_name`, else from the shape (`prompt`:
 *   beforeSubmitPrompt; `status` or `loop_count`: stop).
 * - Anything that is not a `stop` or another named event (beforeSubmitPrompt, unreadable or non-JSON input)
 *   is answered with exactly `{"continue":true}` on every path: the module missing, any thrown error, the guard
 *   disabled. Nothing else reaches stdout while the module runs.
 * - A repeat prompt costs one small file check: when the conversation's session record already exists, the
 *   route answers at once, without loading `@ctxo/domain` or spawning git. Only the first prompt of a
 *   conversation loads the module, which records the start.
 * - A `stop` runs the module command, which prints the reminder or nothing; any failure prints nothing.
 *
 * Contract with `@ctxo/domain`: the record of a conversation is
 * `<project>/.ctxo/.cache/domain-guard/<key>.json`, key `cursor-<conversation_id>` (else
 * `cursor-generation-<generation_id>`), every character outside `[a-zA-Z0-9_-]` replaced by `_`
 * (`GuardSessionStore`). Without an id the route always runs the module (the time-window fallback).
 */

export const CURSOR_CONTINUE_LINE = `${JSON.stringify({ continue: true })}\n`;

type RouteEvent = 'beforeSubmitPrompt' | 'stop' | 'other' | undefined;

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The same rule as `cursorEventOf` in `@ctxo/domain`. */
export function routeEventOf(payload: Record<string, unknown> | undefined): RouteEvent {
  if (payload === undefined) return undefined;
  const named = payload['hook_event_name'];
  if (typeof named === 'string' && named.length > 0) {
    return named === 'beforeSubmitPrompt' || named === 'stop' ? named : 'other';
  }
  if ('prompt' in payload) return 'beforeSubmitPrompt';
  if ('status' in payload || 'loop_count' in payload) return 'stop';
  return undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The project a payload points at: the git root of `workspace_roots[0]` (a Windows `/c:/...` normalised), else of `cwd`. */
export function routeProjectRoot(payload: Record<string, unknown> | undefined, cwd: string, platform: NodeJS.Platform = process.platform): string {
  const roots = payload?.['workspace_roots'];
  let root = Array.isArray(roots) ? nonEmpty(roots[0]) : undefined;
  if (root !== undefined && platform === 'win32' && /^\/[a-zA-Z]:[\\/]/.test(root)) root = root.slice(1);
  return (root !== undefined ? locateGitRoot(root) : null) ?? locateGitRoot(cwd) ?? cwd;
}

/** The session record file of the payload's conversation, or undefined without a conversation or generation id. */
export function conversationRecordPath(payload: Record<string, unknown> | undefined, projectRoot: string): string | undefined {
  const conversation = nonEmpty(payload?.['conversation_id']);
  const generation = nonEmpty(payload?.['generation_id']);
  const key = conversation !== undefined ? `cursor-${conversation}` : generation !== undefined ? `cursor-generation-${generation}` : undefined;
  if (key === undefined) return undefined;
  return join(projectRoot, '.ctxo', '.cache', 'domain-guard', `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

/** Runs `body` with `process.stdout.write` swallowed, so only the route decides what Cursor reads. */
async function withSilentStdout<T>(body: () => Promise<T>): Promise<T> {
  const original = process.stdout.write;
  process.stdout.write = ((..._args: unknown[]) => true) as typeof process.stdout.write;
  try {
    return await body();
  } finally {
    process.stdout.write = original;
  }
}

export interface CursorRouteOptions extends FastRouteOptions {
  /** Stands in for reading stdin (tests). */
  readonly readStdin?: () => Promise<string>;
  /** Stands in for writing stdout (tests). */
  readonly write?: (text: string) => void;
}

/** See the file comment. Always resolves to 0. */
export async function runCursorHookRoute(args: readonly string[], cwd: string, options: CursorRouteOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  let raw = '';
  try {
    raw = await (options.readStdin ?? readAllStdin)();
  } catch (err) {
    console.error(`[ctxo] domain-cursor-hook could not read stdin: ${(err as Error).message}`);
  }
  const payload = parseObject(raw);
  const event = routeEventOf(payload);

  const runModule = async (): Promise<void> => {
    const projectRoot = locateGitRoot(cwd) ?? cwd;
    const modules = await loadModulesFor(projectRoot, 'hook', { cliAnchor: options.cliAnchor });
    await runModuleCommand(args[0] ?? 'domain-cursor-hook', args.slice(1), { projectRoot, modules, readStdin: async () => raw });
  };

  if (event === 'stop' || event === 'other') {
    try {
      await runModule();
    } catch (err) {
      console.error(`[ctxo] domain-cursor-hook failed, staying quiet: ${(err as Error).message}`);
    }
    return 0;
  }

  // beforeSubmitPrompt, or an input whose event cannot be told: exactly {"continue":true}, whatever happens.
  try {
    const record = conversationRecordPath(payload, routeProjectRoot(payload, cwd));
    // An input whose event cannot be told has nothing to record; a prompt whose record exists is already done.
    if (event === 'beforeSubmitPrompt' && (record === undefined || !existsSync(record))) {
      await withSilentStdout(runModule);
    }
  } catch (err) {
    console.error(`[ctxo] domain-cursor-hook failed, allowing: ${(err as Error).message}`);
  }
  write(CURSOR_CONTINUE_LINE);
  return 0;
}
