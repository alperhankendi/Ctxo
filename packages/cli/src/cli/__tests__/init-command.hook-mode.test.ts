import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InitCommand } from '../init-command.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

// Windows has no POSIX exec bit to observe, so the chmod calls themselves are what this file pins.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, chmodSync: vi.fn(actual.chmodSync) };
});

let dir: string;
let gitEnv: IsolatedGitEnv;

beforeEach(() => {
  gitEnv = isolateGitEnv();
  dir = fs.mkdtempSync(join(tmpdir(), 'ctxo-init-mode-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  vi.mocked(fs.chmodSync).mockClear();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  gitEnv.restore();
});

describe('InitCommand - hook file mode', () => {
  it('chmods 755 on a fresh install', () => {
    new InitCommand(dir).installHooks();

    const chmodded = vi.mocked(fs.chmodSync).mock.calls.map((call) => [String(call[0]), call[1]]);
    expect(chmodded).toContainEqual([expect.stringMatching(/post-commit$/), 0o755]);
    expect(chmodded).toContainEqual([expect.stringMatching(/post-merge$/), 0o755]);
  });

  it('chmods 755 even when the hook content is already current', () => {
    new InitCommand(dir).installHooks();
    vi.mocked(fs.chmodSync).mockClear();

    new InitCommand(dir).installHooks();

    const chmodded = vi.mocked(fs.chmodSync).mock.calls.map((call) => [String(call[0]), call[1]]);
    expect(chmodded).toContainEqual([expect.stringMatching(/post-commit$/), 0o755]);
    expect(chmodded).toContainEqual([expect.stringMatching(/post-merge$/), 0o755]);
  });
});
