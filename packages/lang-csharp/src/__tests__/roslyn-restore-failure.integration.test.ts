import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runBatchIndex } from '../roslyn/roslyn-process.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const HELPER_DIR = resolve(import.meta.dirname, '../../tools/ctxo-roslyn');
const FIXTURE_SOLUTION = resolve(import.meta.dirname, 'fixtures/csharp-sample/CsharpSample.sln');

function emptyFeedConfig(feedDir: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<configuration>',
    '  <packageSources>',
    '    <clear />',
    `    <add key="empty-lending-feed" value="${feedDir}" />`,
    '  </packageSources>',
    '</configuration>',
    '',
  ].join('\n');
}

describe.skipIf(!HAS_DOTNET)('Roslyn helper restore failure', () => {
  it('runBatchIndex reports failure when the helper cannot restore', async () => {
    // A copy of the helper (sources only, never bin/ or obj/) whose only NuGet source is an empty
    // folder, with an empty package cache: nothing the helper references can be restored.
    const helperCopy = mkdtempSync(join(tmpdir(), 'ctxo-roslyn-norestore-'));
    const feedDir = mkdtempSync(join(tmpdir(), 'ctxo-nuget-empty-feed-'));
    const packagesDir = mkdtempSync(join(tmpdir(), 'ctxo-nuget-empty-cache-'));
    const savedPackages = process.env['NUGET_PACKAGES'];
    try {
      for (const name of readdirSync(HELPER_DIR)) {
        if (name === 'ctxo-roslyn.csproj' || name.endsWith('.cs')) {
          copyFileSync(join(HELPER_DIR, name), join(helperCopy, name));
        }
      }
      writeFileSync(join(helperCopy, 'nuget.config'), emptyFeedConfig(feedDir), 'utf-8');
      process.env['NUGET_PACKAGES'] = packagesDir;

      const result = await runBatchIndex(helperCopy, FIXTURE_SOLUTION);

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/NU1101|NU1301|NU1100/);
      expect(result.files).toEqual([]);
    } finally {
      if (savedPackages === undefined) delete process.env['NUGET_PACKAGES'];
      else process.env['NUGET_PACKAGES'] = savedPackages;
      for (const dir of [helperCopy, feedDir, packagesDir]) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  }, 300_000);
});
