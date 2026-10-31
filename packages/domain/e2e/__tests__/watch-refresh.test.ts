import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertBuilt, childEnv, CLI_BIN, cleanupWorkspaces, SampleWorkspace } from './sample-workspace.js';

/**
 * `ctxo watch` refreshes the domain artifacts (roadmap rows "Domain graph refresh" and "Loop artifacts refresh in
 * ctxo watch"), driven through the built CLI on the TypeScript library-lending sample: the watch-time pass and the
 * pass of `ctxo index` (both through the CLI's `runModuleIndexPasses`) write the same bytes for the same input.
 */

const CARD = 'docs/domain/lending/domain.md';
const DOMAIN_DIR = '.ctxo/index/domain';

/** Every file under `.ctxo/index/domain/` (subfolders included), by relative path, as bytes. */
function domainArtifacts(ws: SampleWorkspace): Record<string, string> {
  const dir = ws.path(DOMAIN_DIR);
  const out: Record<string, string> = {};
  // A plain walk: Dirent.parentPath needs Node 20.12, the packages support 20.0. The entry type comes from the
  // directory read itself, so no separate stat call can race with the read.
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[relative(dir, full).split(sep).join('/')] = readFileSync(full).toString('base64');
    }
  };
  walk(dir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

class Watch {
  readonly stderr: string[] = [];
  private readonly child: ChildProcess;
  private readonly exited: Promise<void>;

  constructor(ws: SampleWorkspace) {
    this.child = spawn(process.execPath, [CLI_BIN, 'watch'], { cwd: ws.dir, env: childEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
    this.child.stderr!.setEncoding('utf-8');
    let partial = '';
    this.child.stderr!.on('data', (chunk: string) => {
      partial += chunk;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop()!;
      this.stderr.push(...lines);
    });
    this.exited = new Promise((resolve) => this.child.once('exit', () => resolve()));
  }

  count(pattern: RegExp): number {
    return this.stderr.filter((line) => pattern.test(line)).length;
  }

  async until(pattern: RegExp, times = 1, ms = 90_000): Promise<void> {
    const end = Date.now() + ms;
    while (this.count(pattern) < times) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${pattern}; stderr:\n${this.stderr.join('\n')}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async kill(): Promise<void> {
    this.child.kill();
    await this.exited;
  }
}

describe('ctxo watch refreshes the domain artifacts (built CLI)', () => {
  let ws: SampleWorkspace;

  beforeAll(() => {
    assertBuilt();
    ws = SampleWorkspace.create('typescript');
    ws.index();
  });

  afterAll(() => cleanupWorkspaces());

  it('the watch passes (at start and after a card edit) write the bytes ctxo index writes for the same input', async () => {
    // Fresh artifacts: watch starts without a pass.
    const fresh = new Watch(ws);
    try {
      // The start check runs before this line is printed, and a start pass is only ever scheduled with the
      // "stale" line, so its absence here proves no pass at start without a timed wait.
      await fresh.until(/Watching for file changes/);
      expect(fresh.count(/Module artifacts are stale/)).toBe(0);
    } finally {
      await fresh.kill();
    }

    // A card edited while watch was not running: the start pass refreshes it.
    ws.write(CARD, `${ws.read(CARD).replace(/\r\n/g, '\n')}\nEdited while watch was not running.\n`);
    const watch = new Watch(ws);
    let afterEdit: Record<string, string>;
    let afterStart: Record<string, string>;
    try {
      await watch.until(/Module artifacts are stale against their inputs/);
      await watch.until(/Module index pass after start \(stale artifacts\)/);
      afterStart = domainArtifacts(ws);

      // A card edit while watch runs: one pass, a quiet period after the edit.
      ws.write(CARD, `${ws.read(CARD)}\nEdited while watch runs.\n`);
      await watch.until(/Module index pass after 1 module input change\(s\)/);
      afterEdit = domainArtifacts(ws);
      expect(watch.count(/index pass failed/)).toBe(0);
    } finally {
      await watch.kill();
    }

    // The same input through ctxo index (full run, with the change log).
    ws.index();
    const fromIndex = domainArtifacts(ws);
    expect(Object.keys(afterEdit)).toEqual(Object.keys(fromIndex));
    for (const name of Object.keys(fromIndex)) expect({ name, bytes: afterEdit[name] }).toEqual({ name, bytes: fromIndex[name] });
    // The start pass saw another card text, so its graph differs from the final one.
    expect(afterStart['graph.json']).not.toEqual(fromIndex['graph.json']);
  });
});
