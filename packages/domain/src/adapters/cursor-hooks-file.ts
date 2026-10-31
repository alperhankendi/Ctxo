import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InitFileResult } from '@ctxo/cli/internal';
import type { CursorHookEvent } from '../core/guard.js';

/** The command `ctxo init --domain` registers in `.cursor/hooks.json` for the fold reminder. */
export const CURSOR_HOOK_COMMAND = 'ctxo domain-cursor-hook';

/** The events it runs on: the first prompt records the start, `stop` reminds. */
export const CURSOR_HOOK_EVENTS: readonly CursorHookEvent[] = ['beforeSubmitPrompt', 'stop'];

/** Cursor's project hooks file, repo-relative. */
export const CURSOR_HOOKS_FILE = '.cursor/hooks.json';

const BOM = String.fromCharCode(0xfeff);

export type CursorHooksState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly problem: string }
  | { readonly kind: 'ok'; readonly json: Record<string, unknown>; readonly bom: boolean; readonly crlf: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `.cursor/hooks.json`, read once. `unreadable` covers a file that cannot be read, is not JSON, is not an
 * object, has a `hooks` value that is not an object, or a reminder event whose value is not a list: none of
 * those is ever written.
 */
export function readCursorHooks(projectRoot: string): CursorHooksState {
  let text: string;
  try {
    text = readFileSync(join(projectRoot, CURSOR_HOOKS_FILE), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'unreadable', problem: `${CURSOR_HOOKS_FILE} cannot be read (${(err as Error).message})` };
  }
  const bom = text.startsWith(BOM);
  let json: unknown;
  try {
    json = JSON.parse(bom ? text.slice(1) : text);
  } catch {
    return { kind: 'unreadable', problem: `${CURSOR_HOOKS_FILE} is not valid JSON` };
  }
  if (!isPlainObject(json)) return { kind: 'unreadable', problem: `${CURSOR_HOOKS_FILE} is not a JSON object` };
  const hooks = json['hooks'];
  if (hooks !== undefined && !isPlainObject(hooks)) return { kind: 'unreadable', problem: `${CURSOR_HOOKS_FILE}: "hooks" is not an object` };
  for (const event of CURSOR_HOOK_EVENTS) {
    const list = isPlainObject(hooks) ? hooks[event] : undefined;
    if (list !== undefined && !Array.isArray(list)) return { kind: 'unreadable', problem: `${CURSOR_HOOKS_FILE}: "hooks.${event}" is not a list` };
  }
  return { kind: 'ok', json, bom, crlf: text.includes('\r\n') };
}

/** True when the entry runs the reminder command (`npx ctxo domain-cursor-hook` counts too). */
function isReminderEntry(entry: unknown): boolean {
  return isPlainObject(entry) && typeof entry['command'] === 'string' && entry['command'].includes(CURSOR_HOOK_COMMAND);
}

function eventList(json: Record<string, unknown>, event: CursorHookEvent): readonly unknown[] {
  const hooks = json['hooks'];
  const list = isPlainObject(hooks) ? hooks[event] : undefined;
  return Array.isArray(list) ? list : [];
}

/** The reminder events with no entry, and the events that hold it more than once (a hand-merged file). */
export function cursorHookProblems(state: CursorHooksState): { readonly missing: CursorHookEvent[]; readonly duplicated: CursorHookEvent[] } {
  if (state.kind === 'unreadable') return { missing: [], duplicated: [] };
  if (state.kind === 'missing') return { missing: [...CURSOR_HOOK_EVENTS], duplicated: [] };
  const missing: CursorHookEvent[] = [];
  const duplicated: CursorHookEvent[] = [];
  for (const event of CURSOR_HOOK_EVENTS) {
    const count = eventList(state.json, event).filter(isReminderEntry).length;
    if (count === 0) missing.push(event);
    if (count > 1) duplicated.push(event);
  }
  return { missing, duplicated };
}

/**
 * Registers the reminder in `.cursor/hooks.json` for `beforeSubmitPrompt` and `stop`, as
 * `{ "command": "ctxo domain-cursor-hook" }`, last in each list. Every other key, event and entry is kept,
 * a second copy of the reminder in one list is dropped, and the file's UTF-8 BOM and line endings are written
 * back. A file that already holds one entry per event is `skipped`; an unreadable one is `skipped` with a
 * warning and never overwritten. `dryRun` computes the same action and writes nothing.
 */
export function ensureCursorHooks(projectRoot: string, options: { readonly dryRun?: boolean } = {}): InitFileResult {
  const path = join(projectRoot, CURSOR_HOOKS_FILE);
  const state = readCursorHooks(projectRoot);
  if (state.kind === 'unreadable') {
    return { file: CURSOR_HOOKS_FILE, action: 'skipped', warning: `${state.problem}; left unchanged. Fix it, then run "ctxo init --only domain"` };
  }
  const entry = { command: CURSOR_HOOK_COMMAND };

  if (state.kind === 'missing') {
    if (!options.dryRun) {
      const hooks = Object.fromEntries(CURSOR_HOOK_EVENTS.map((event) => [event, [entry]]));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`, 'utf-8');
    }
    return { file: CURSOR_HOOKS_FILE, action: 'created' };
  }

  const { missing, duplicated } = cursorHookProblems(state);
  if (missing.length === 0 && duplicated.length === 0) return { file: CURSOR_HOOKS_FILE, action: 'skipped' };

  const hooks: Record<string, unknown> = { ...(isPlainObject(state.json['hooks']) ? state.json['hooks'] : {}) };
  for (const event of CURSOR_HOOK_EVENTS) {
    let seen = false;
    const kept = eventList(state.json, event).filter((item) => {
      if (!isReminderEntry(item)) return true;
      if (seen) return false;
      seen = true;
      return true;
    });
    hooks[event] = seen ? kept : [...kept, entry];
  }
  const updated = { ...('version' in state.json ? {} : { version: 1 }), ...state.json, hooks };
  if (!options.dryRun) {
    let body = `${JSON.stringify(updated, null, 2)}\n`;
    if (state.crlf) body = body.replace(/\n/g, '\r\n');
    writeFileSync(path, state.bom ? `${BOM}${body}` : body, 'utf-8');
  }
  return { file: CURSOR_HOOKS_FILE, action: 'updated' };
}
