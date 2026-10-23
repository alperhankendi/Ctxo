import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';
import { detectDotnetSdkVersion, parseDotnetSdkMajor } from '../../../core/detection/detect-dotnet-sdk.js';
import { resolvePluginPackageJson } from '../../language/plugin-discovery.js';
import { findSourceFile } from './java-tier-check.js';

/** Restoring the helper can download the Roslyn and ScriptDom packages on a cold cache. */
const RESTORE_TIMEOUT_MS = 120_000;
const MAX_MESSAGE_LENGTH = 200;

export interface CSharpTierInputs {
  hasCSharp: boolean;
  sdkVersion: string | undefined;
  /** Absolute path of ctxo-roslyn.csproj, or null. */
  helperProject: string | null;
  /** Null when not probed. */
  restore: { ok: boolean; message?: string } | null;
}

/** Pure decision: map (C#-present, SDK, helper, restore probe) -> CheckResult. */
export function evaluateCSharpTier(i: CSharpTierInputs): CheckResult {
  const id = 'csharp_tier';
  const title = 'C# analysis tier';

  if (!i.hasCSharp) {
    return { id, title, status: 'pass', message: 'no C# sources detected' };
  }

  // No .NET 8+ SDK: syntax tier only, no nag (like Java without a JRE)
  const sdkMajor = i.sdkVersion === undefined ? undefined : parseDotnetSdkMajor(i.sdkVersion);
  if ((sdkMajor ?? 0) < 8) {
    return { id, title, status: 'pass', message: 'syntax tier (install the .NET 8+ SDK for the full tier)' };
  }

  // language_coverage already warns about a missing plugin
  if (i.helperProject === null) {
    return { id, title, status: 'pass', message: 'syntax tier (@ctxo/lang-csharp not installed)' };
  }

  // Null means the restore was not probed, so the message claims no restore.
  if (i.restore === null) {
    return { id, title, status: 'pass', message: `full tier (.NET SDK ${i.sdkVersion})` };
  }
  if (i.restore.ok) {
    return { id, title, status: 'pass', message: `full tier (.NET SDK ${i.sdkVersion}, Roslyn helper restores)` };
  }

  return {
    id,
    title,
    status: 'warn',
    message: `syntax tier: the Roslyn helper could not restore (${i.restore.message ?? 'unknown error'})`,
    fix: 'Make Microsoft.SqlServer.TransactSql.ScriptDom and the Microsoft.CodeAnalysis packages reachable from your NuGet sources (nuget.org or a mirror), then run "ctxo index"',
  };
}

/** `path` written with backslashes and with forward slashes (MSBuild may print either). */
function separatorVariants(path: string): string[] {
  return [...new Set([path, path.replace(/\//g, '\\'), path.replace(/\\/g, '/')])];
}

/** A Windows path: a drive letter or a UNC prefix. Windows paths compare without case. */
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** Every occurrence of `search` in `text` replaced by `replacement`; ignoring case when `ignoreCase` is set. */
function replaceAll(text: string, search: string, replacement: string, ignoreCase: boolean): string {
  if (!ignoreCase) return text.split(search).join(replacement);
  const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return text.replace(pattern, () => replacement);
}

/**
 * Replaces the helper project's absolute path with `ctxo-roslyn.csproj`, then
 * its directory with `ctxo-roslyn`, so the restore message keeps the error,
 * not a long node_modules path. A Windows path matches in any letter case,
 * since MSBuild may print the drive letter or a folder in another case.
 */
function withoutHelperPath(text: string, helperProject: string): string {
  const ignoreCase = isWindowsPath(helperProject);
  let out = text;
  for (const variant of separatorVariants(helperProject)) out = replaceAll(out, variant, 'ctxo-roslyn.csproj', ignoreCase);
  const helperDir = helperProject.replace(/[\\/][^\\/]*$/, '');
  if (helperDir && helperDir !== helperProject) {
    for (const variant of separatorVariants(helperDir)) out = replaceAll(out, variant, 'ctxo-roslyn', ignoreCase);
  }
  return out;
}

/** An MSBuild or NuGet error line: an `error NU1101`-style code or ` : error `, matched with case. */
const ERROR_LINE = /\berror [A-Z]+\d+\b| : error /;

/**
 * Why `dotnet restore` failed, trimmed and capped at 200 characters: the first
 * output line (stdout, then stderr) with an MSBuild error shape (`error NU1101`,
 * ` : error `), else the first line that contains "error" in any case;
 * `exit code <n>` when no line does, and `timed out` on a timeout. A warning
 * such as `warning NU1900: Error occurred ...` is therefore never picked over a
 * real error. The helper's absolute path is dropped from the output first.
 */
export function restoreFailureMessage(r: {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
  /** Absolute path of the ctxo-roslyn.csproj that was restored. */
  helperProject?: string;
}): string {
  if (r.timedOut) return 'timed out';
  const strip = (text: string): string => (r.helperProject ? withoutHelperPath(text, r.helperProject) : text);
  const lines = [...strip(r.stdout).split(/\r?\n/), ...strip(r.stderr).split(/\r?\n/)];
  const line = lines.find((l) => ERROR_LINE.test(l)) ?? lines.find((l) => /error/i.test(l));
  if (line !== undefined) return line.trim().slice(0, MAX_MESSAGE_LENGTH);
  return `exit code ${r.status}`;
}

/**
 * The ctxo-roslyn.csproj of the @ctxo/lang-csharp the plugin loader would load, or null.
 * Resolved the way the loader resolves a plugin: from the project first, then from the
 * CLI's own location (a global install in a repository without a package.json, a dev build).
 */
export function resolveHelperProject(projectRoot: string): string | null {
  try {
    const requireFromProject = createRequire(join(projectRoot, 'package.json'));
    const pkgJson = resolvePluginPackageJson('@ctxo/lang-csharp', requireFromProject);
    const csproj = join(dirname(pkgJson), 'tools', 'ctxo-roslyn', 'ctxo-roslyn.csproj');
    return existsSync(csproj) ? csproj : null;
  } catch {
    return null;
  }
}

/** A .sln or .csproj at the root, or a .cs file within depth 4 (same bounds as the Java scan). */
export function projectHasCSharp(root: string): boolean {
  try {
    if (readdirSync(root).some((name) => name.endsWith('.sln') || name.endsWith('.csproj'))) return true;
  } catch {
    return false;
  }
  return findSourceFile(root, '.cs', 4);
}

/** `dotnet restore` of the helper: the probe for a NuGet feed the helper's packages cannot come from. */
function probeRestore(helperProject: string): { ok: boolean; message?: string } {
  const r = spawnSync('dotnet', ['restore', helperProject, '--nologo', '-v', 'q'], {
    encoding: 'utf-8',
    timeout: RESTORE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (!r.error && r.status === 0) return { ok: true };
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return {
    ok: false,
    message: restoreFailureMessage({
      stdout: r.stdout ?? '',
      stderr: `${r.stderr ?? ''}${r.error && !timedOut ? `\nerror: ${r.error.message}` : ''}`,
      status: r.status,
      timedOut,
      helperProject,
    }),
  };
}

export class CSharpTierCheck implements IHealthCheck {
  readonly id = 'csharp_tier';
  readonly title = 'C# analysis tier';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const hasCSharp = projectHasCSharp(ctx.projectRoot);
    // No dotnet process at all for a project without C#
    const sdkVersion = hasCSharp ? detectDotnetSdkVersion() : undefined;
    const helperProject = hasCSharp ? resolveHelperProject(ctx.projectRoot) : null;
    // The restore probe runs only when outcomes 1-3 (no C#, no .NET 8+ SDK, no plugin) do not apply.
    const sdkReady = (parseDotnetSdkMajor(sdkVersion ?? '') ?? 0) >= 8;
    const restore = hasCSharp && sdkReady && helperProject !== null ? probeRestore(helperProject) : null;
    return evaluateCSharpTier({ hasCSharp, sdkVersion, helperProject, restore });
  }
}
