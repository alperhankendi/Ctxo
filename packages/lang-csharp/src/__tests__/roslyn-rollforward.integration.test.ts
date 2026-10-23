import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

/** Numeric parts of a runtime version; a prerelease sorts below its release. */
function versionKey(version: string): number[] {
  const [release, prerelease] = version.split('-');
  return [...release!.split('.').map(p => parseInt(p, 10) || 0), prerelease === undefined ? 1 : 0];
}

function compareVersions(a: string, b: string): number {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The newest installed Microsoft.NETCore.App runtime, from `dotnet --list-runtimes`. */
const NEWEST_RUNTIME = (() => {
  if (!HAS_DOTNET) return undefined;
  try {
    const out = execFileSync('dotnet', ['--list-runtimes'], { encoding: 'utf-8' });
    const versions = [...out.matchAll(/^Microsoft\.NETCore\.App (\S+) /gm)].map(m => m[1]!);
    return versions.sort(compareVersions).at(-1);
  } catch { return undefined; }
})();

const HAS_NEWER_RUNTIME = NEWEST_RUNTIME !== undefined && versionKey(NEWEST_RUNTIME)[0]! > 8;

const HELPER_DIR = resolve(import.meta.dirname, '../../tools/ctxo-roslyn');
const HELPER_CSPROJ = resolve(HELPER_DIR, 'ctxo-roslyn.csproj');
const OUTPUT_DIR = resolve(HELPER_DIR, 'bin/Debug/net8.0');
const CORPUS_DIR = resolve(import.meta.dirname, '../../../sql-extract/corpus');

describe.skipIf(!HAS_DOTNET || !HAS_NEWER_RUNTIME)('ctxo-roslyn on runtimes newer than .NET 8', () => {
  it('the helper asks for roll forward to newer major runtimes', () => {
    execFileSync('dotnet', ['build', HELPER_CSPROJ, '-c', 'Debug', '--nologo', '-v', 'q'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
    });
    const config = JSON.parse(readFileSync(resolve(OUTPUT_DIR, 'ctxo-roslyn.runtimeconfig.json'), 'utf-8')) as {
      runtimeOptions: { rollForward?: string };
    };
    expect(config.runtimeOptions.rollForward).toBe('Major');
  }, 600_000);

  it('the helper runs on the newest installed runtime', () => {
    const stdout = execFileSync(
      'dotnet',
      [
        'exec',
        '--fx-version', NEWEST_RUNTIME!,
        resolve(OUTPUT_DIR, 'ctxo-roslyn.dll'),
        '--sql-extract', resolve(CORPUS_DIR, 'select-join-alias.sql'),
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
    );
    const line = stdout.split(/\r?\n/).find(l => l.startsWith('{'));
    const result = JSON.parse(line!) as { type: string; reads: string[]; errors: number };
    expect(result.type).toBe('sqlExtract');
    expect(result.errors).toBe(0);
    expect(result.reads).toEqual(['dbo.loans', 'dbo.members']);
  }, 120_000);
});
