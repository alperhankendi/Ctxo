import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const HELPER_CSPROJ = resolve(import.meta.dirname, '../../../tools/ctxo-roslyn/ctxo-roslyn.csproj');
const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

// Restored so the framework (System.Attribute and friends) resolves; without
// project.assets.json the fixture attributes would only come from syntax.
const FIXTURE_PROJECTS = [
  'csharp-sample/CsharpSample.sln',
  'csharp-v2-sample/CsharpV2Sample.sln',
  'csharp-csproj-only/CsprojOnly.csproj',
].map(p => resolve(FIXTURES_DIR, p));

function dotnet(args: string[], what: string): void {
  try {
    execFileSync('dotnet', [...args, '--nologo', '-v', 'q'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
    });
  } catch (err) {
    const e = err as { message: string; stdout?: string; stderr?: string };
    throw new Error(`${what} failed: ${e.message}\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  }
}

/**
 * Global setup of the dotnet test project: builds the ctxo-roslyn helper once
 * and restores the fixtures before the integration files run. Each file then
 * starts the helper with `dotnet run`, which only checks that the build is up
 * to date, so the serial files never race for the helper's bin/ and obj/
 * files (Windows locks them). Without a .NET 8+ SDK the integration files
 * skip and nothing is built.
 */
export default function setup(): void {
  let version: string;
  try {
    version = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
  } catch {
    return;
  }
  if (parseInt(version.split('.')[0]!, 10) < 8) return;

  dotnet(['build', HELPER_CSPROJ], 'Building the ctxo-roslyn helper');
  // The fixtures target net8.0 and have no package references, so restore
  // only needs the net8.0 targeting pack (Microsoft.NETCore.App.Ref 8.x).
  // A .NET 8 SDK ships it; with only a newer SDK installed, restore fetches
  // it from NuGet and needs network access.
  for (const project of FIXTURE_PROJECTS) {
    dotnet(['restore', project], `Restoring ${project}`);
  }
}
