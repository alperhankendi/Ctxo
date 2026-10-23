import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PACKAGE_DIR = resolve(import.meta.dirname, '../..');
const HELPER_DIR = resolve(PACKAGE_DIR, 'tools/ctxo-roslyn');

interface PackResult {
  files: Array<{ path: string }>;
}

describe('npm package contents', () => {
  it('the npm tarball ships the helper project and every helper source file', () => {
    // execSync runs through a shell, which resolves npm.cmd on Windows.
    const stdout = execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: PACKAGE_DIR,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const [result] = JSON.parse(stdout) as PackResult[];
    const packed = result!.files.map(f => f.path.replace(/\\/g, '/'));

    expect(packed).toContain('tools/ctxo-roslyn/ctxo-roslyn.csproj');

    const sources = readdirSync(HELPER_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.cs'))
      .map(e => `tools/ctxo-roslyn/${e.name}`);
    expect(sources.length).toBeGreaterThan(1);
    for (const source of sources) {
      expect(packed, source).toContain(source);
    }

    expect(packed.filter(p => /(^|\/)(bin|obj)\//.test(p))).toEqual([]);
  }, 60_000);
});
