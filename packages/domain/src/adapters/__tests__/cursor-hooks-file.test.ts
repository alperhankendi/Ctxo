import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURSOR_HOOK_COMMAND,
  CURSOR_HOOKS_FILE,
  cursorHookProblems,
  ensureCursorHooks,
  readCursorHooks,
} from '../cursor-hooks-file.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(hooksJson?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-cursor-hooks-'));
  dirs.push(dir);
  if (hooksJson !== undefined) {
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    writeFileSync(join(dir, CURSOR_HOOKS_FILE), hooksJson, 'utf-8');
  }
  return dir;
}

const read = (dir: string): string => readFileSync(join(dir, CURSOR_HOOKS_FILE), 'utf-8');

describe('ensureCursorHooks', () => {
  it('creates .cursor/hooks.json in the documented Cursor format', () => {
    const dir = project();
    expect(ensureCursorHooks(dir)).toEqual({ file: CURSOR_HOOKS_FILE, action: 'created' });
    expect(JSON.parse(read(dir))).toEqual({
      version: 1,
      hooks: { beforeSubmitPrompt: [{ command: CURSOR_HOOK_COMMAND }], stop: [{ command: CURSOR_HOOK_COMMAND }] },
    });
    expect(read(dir).endsWith('}\n')).toBe(true);
  });

  it('merges into an existing file and keeps every other key, event and entry', () => {
    const existing = {
      version: 1,
      custom: { keep: true },
      hooks: {
        afterFileEdit: [{ command: './hooks/format.sh' }],
        stop: [{ command: './hooks/audit.sh' }],
      },
    };
    const dir = project(JSON.stringify(existing, null, 2));
    expect(ensureCursorHooks(dir).action).toBe('updated');
    expect(JSON.parse(read(dir))).toEqual({
      version: 1,
      custom: { keep: true },
      hooks: {
        afterFileEdit: [{ command: './hooks/format.sh' }],
        stop: [{ command: './hooks/audit.sh' }, { command: CURSOR_HOOK_COMMAND }],
        beforeSubmitPrompt: [{ command: CURSOR_HOOK_COMMAND }],
      },
    });
  });

  it('is idempotent: a second run is skipped and writes nothing', () => {
    const dir = project();
    ensureCursorHooks(dir);
    const first = read(dir);
    expect(ensureCursorHooks(dir)).toEqual({ file: CURSOR_HOOKS_FILE, action: 'skipped' });
    expect(read(dir)).toBe(first);
  });

  it('counts an existing wrapped command (npx ctxo ...) as registered', () => {
    const text = JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: 'npx ctxo domain-cursor-hook' }], stop: [{ command: 'npx ctxo domain-cursor-hook' }] } });
    const dir = project(text);
    expect(ensureCursorHooks(dir).action).toBe('skipped');
    expect(read(dir)).toBe(text);
  });

  it('drops a second copy of the reminder in one list', () => {
    const dir = project(JSON.stringify({ version: 1, hooks: { stop: [{ command: CURSOR_HOOK_COMMAND }, { command: './x.sh' }, { command: CURSOR_HOOK_COMMAND }] } }));
    expect(ensureCursorHooks(dir).action).toBe('updated');
    const hooks = (JSON.parse(read(dir)) as { hooks: Record<string, unknown> }).hooks;
    expect(hooks['stop']).toEqual([{ command: CURSOR_HOOK_COMMAND }, { command: './x.sh' }]);
    expect(hooks['beforeSubmitPrompt']).toEqual([{ command: CURSOR_HOOK_COMMAND }]);
  });

  it('adds version 1 when the file has none, and keeps the BOM and CRLF line endings', () => {
    const dir = project(`﻿{\r\n  "hooks": {}\r\n}\r\n`);
    ensureCursorHooks(dir);
    const text = read(dir);
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect((JSON.parse(text.slice(1)) as { version: number }).version).toBe(1);
  });

  it.each([
    ['not JSON', '{ nope', 'is not valid JSON'],
    ['an array', '[]', 'is not a JSON object'],
    ['hooks not an object', '{"hooks": []}', '"hooks" is not an object'],
    ['stop not a list', '{"hooks": {"stop": {}}}', '"hooks.stop" is not a list'],
  ])('never writes an unreadable file (%s)', (_name, text, problem) => {
    const dir = project(text);
    const result = ensureCursorHooks(dir);
    expect(result.action).toBe('skipped');
    expect(result.warning).toContain(problem);
    expect(read(dir)).toBe(text);
  });

  it('dry run computes the action and writes nothing, not even the directory', () => {
    const dir = project();
    expect(ensureCursorHooks(dir, { dryRun: true }).action).toBe('created');
    expect(existsSync(join(dir, '.cursor'))).toBe(false);
  });
});

describe('cursorHookProblems', () => {
  it('lists the missing and the duplicated events', () => {
    expect(cursorHookProblems(readCursorHooks(project()))).toEqual({ missing: ['beforeSubmitPrompt', 'stop'], duplicated: [] });
    const dir = project(JSON.stringify({ hooks: { stop: [{ command: CURSOR_HOOK_COMMAND }, { command: CURSOR_HOOK_COMMAND }] } }));
    expect(cursorHookProblems(readCursorHooks(dir))).toEqual({ missing: ['beforeSubmitPrompt'], duplicated: ['stop'] });
  });
});
