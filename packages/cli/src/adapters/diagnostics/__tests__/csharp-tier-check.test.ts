import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateCSharpTier,
  restoreFailureMessage,
  resolveHelperProject,
  projectHasCSharp,
} from '../checks/csharp-tier-check.js';
import { findSourceFile, findJavaFile } from '../checks/java-tier-check.js';

const HELPER = '/work/lending/node_modules/@ctxo/lang-csharp/tools/ctxo-roslyn/ctxo-roslyn.csproj';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('evaluateCSharpTier', () => {
  it('pass: no C# sources, no nag', () => {
    const r = evaluateCSharpTier({ hasCSharp: false, sdkVersion: undefined, helperProject: null, restore: null });
    expect(r).toEqual({ id: 'csharp_tier', title: 'C# analysis tier', status: 'pass', message: 'no C# sources detected' });
  });

  it('pass(syntax): C# present but no .NET 8+ SDK', () => {
    for (const sdkVersion of [undefined, '6.0.428']) {
      const r = evaluateCSharpTier({ hasCSharp: true, sdkVersion, helperProject: HELPER, restore: null });
      expect(r.status).toBe('pass');
      expect(r.message).toBe('syntax tier (install the .NET 8+ SDK for the full tier)');
      expect(r.fix).toBeUndefined();
    }
  });

  it('pass(syntax): .NET 8+ SDK but @ctxo/lang-csharp is not installed', () => {
    const r = evaluateCSharpTier({ hasCSharp: true, sdkVersion: '8.0.404', helperProject: null, restore: null });
    expect(r.status).toBe('pass');
    expect(r.message).toBe('syntax tier (@ctxo/lang-csharp not installed)');
  });

  it('pass: full tier when the Roslyn helper restores', () => {
    const r = evaluateCSharpTier({ hasCSharp: true, sdkVersion: '10.0.100', helperProject: HELPER, restore: { ok: true } });
    expect(r.status).toBe('pass');
    expect(r.message).toBe('full tier (.NET SDK 10.0.100, Roslyn helper restores)');
  });

  it('pass: full tier with no restore claim when the restore was not probed', () => {
    const r = evaluateCSharpTier({ hasCSharp: true, sdkVersion: '8.0.404', helperProject: HELPER, restore: null });
    expect(r).toEqual({ id: 'csharp_tier', title: 'C# analysis tier', status: 'pass', message: 'full tier (.NET SDK 8.0.404)' });
  });

  it('warn: syntax tier when the Roslyn helper cannot restore', () => {
    const message = 'error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.';
    const r = evaluateCSharpTier({ hasCSharp: true, sdkVersion: '8.0.404', helperProject: HELPER, restore: { ok: false, message } });
    expect(r).toEqual({
      id: 'csharp_tier',
      title: 'C# analysis tier',
      status: 'warn',
      message: `syntax tier: the Roslyn helper could not restore (${message})`,
      fix: 'Make Microsoft.SqlServer.TransactSql.ScriptDom and the Microsoft.CodeAnalysis packages reachable from your NuGet sources (nuget.org or a mirror), then run "ctxo index"',
    });
  });
});

describe('restoreFailureMessage', () => {
  it('the restore message is capped at 200 characters', () => {
    const line = `  /work/lending/ctxo-roslyn.csproj : error NU1301: Unable to load the service index for source ${'https://loans.example/'.repeat(20)}  `;
    const message = restoreFailureMessage({ stdout: `Determining projects to restore...\n${line}\n`, stderr: '', status: 1, timedOut: false });
    expect(message).toHaveLength(200);
    expect(message).toBe(line.trim().slice(0, 200));
  });

  it('takes the first line containing error, stdout before stderr', () => {
    const message = restoreFailureMessage({
      stdout: 'Restoring members...\r\nhelper.csproj : error NU1101: Unable to find package Microsoft.Build.Locator.\r\n',
      stderr: 'error: the stderr line comes second\n',
      status: 1,
      timedOut: false,
    });
    expect(message).toBe('helper.csproj : error NU1101: Unable to find package Microsoft.Build.Locator.');

    expect(restoreFailureMessage({ stdout: 'holds queued\n', stderr: 'error: the feed is offline\n', status: 1, timedOut: false }))
      .toBe('error: the feed is offline');
  });

  it("the restore message drops the helper's absolute path", () => {
    const helperProject = 'C:\\x\\node_modules\\@ctxo\\lang-csharp\\tools\\ctxo-roslyn\\ctxo-roslyn.csproj';
    const stdout = [
      'C:/x/node_modules/@ctxo/lang-csharp/tools/ctxo-roslyn/obj/project.assets.json : warning NU1603: holds resolved late',
      `${helperProject} : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom. No packages exist with this id in source(s): lending-mirror`,
      '',
    ].join('\r\n');

    const message = restoreFailureMessage({ stdout, stderr: '', status: 1, timedOut: false, helperProject });

    expect(message.startsWith('ctxo-roslyn.csproj : error NU1101')).toBe(true);
    expect(message).toContain('Microsoft.SqlServer.TransactSql.ScriptDom');
    expect(message).not.toContain('node_modules');

    // The directory goes too, in either separator style.
    const dirOnly = restoreFailureMessage({
      stdout: 'C:/x/node_modules/@ctxo/lang-csharp/tools/ctxo-roslyn/obj/project.assets.json : error NU1105: loans project unreadable\n',
      stderr: '',
      status: 1,
      timedOut: false,
      helperProject,
    });
    expect(dirOnly).toBe('ctxo-roslyn/obj/project.assets.json : error NU1105: loans project unreadable');
  });

  it('a warning that mentions Error is not taken for the restore failure', () => {
    const stdout = [
      'ctxo-roslyn.csproj : warning NU1900: Error occurred while getting package vulnerability data: the lending feed is offline',
      'ctxo-roslyn.csproj : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.',
      '',
    ].join('\r\n');
    expect(restoreFailureMessage({ stdout, stderr: '', status: 1, timedOut: false }))
      .toBe('ctxo-roslyn.csproj : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.');

    // Without an MSBuild error shape, the first line that mentions error in any case still counts.
    expect(restoreFailureMessage({ stdout: 'warning NU1900: Error occurred\n', stderr: '', status: 1, timedOut: false }))
      .toBe('warning NU1900: Error occurred');
  });

  it('drops a Windows helper path printed in another letter case', () => {
    const helperProject = 'C:\\Lending\\node_modules\\@ctxo\\lang-csharp\\tools\\ctxo-roslyn\\ctxo-roslyn.csproj';
    const stdout = [
      'c:\\lending\\node_modules\\@ctxo\\lang-csharp\\tools\\ctxo-roslyn\\ctxo-roslyn.csproj : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.',
      'C:/LENDING/node_modules/@ctxo/lang-csharp/tools/ctxo-roslyn/obj/project.assets.json : error NU1105: loans project unreadable',
    ].join('\r\n');

    const message = restoreFailureMessage({ stdout, stderr: '', status: 1, timedOut: false, helperProject });
    expect(message).toBe('ctxo-roslyn.csproj : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.');
    const dirOnly = restoreFailureMessage({ stdout: stdout.split('\r\n')[1]!, stderr: '', status: 1, timedOut: false, helperProject });
    expect(dirOnly).toBe('ctxo-roslyn/obj/project.assets.json : error NU1105: loans project unreadable');

    // A POSIX path keeps its case: another case is another path there.
    const posix = '/work/Lending/node_modules/@ctxo/lang-csharp/tools/ctxo-roslyn/ctxo-roslyn.csproj';
    const other = `${posix.toLowerCase()} : error NU1101: missing`;
    expect(restoreFailureMessage({ stdout: other, stderr: '', status: 1, timedOut: false, helperProject: posix })).toBe(other);
  });

  it('falls back to the exit code, and reports a timeout', () => {
    expect(restoreFailureMessage({ stdout: 'loans restored\n', stderr: '', status: 3, timedOut: false })).toBe('exit code 3');
    expect(restoreFailureMessage({ stdout: 'error: partial\n', stderr: '', status: null, timedOut: true })).toBe('timed out');
  });
});

// The null case of resolveHelperProject and the run() paths live in csharp-tier-check.run.test.ts, with
// spawnSync and module resolution mocked, so they do not depend on what this machine has installed.
describe('resolveHelperProject', () => {
  it('returns the helper project beside the package the project resolves', () => {
    const root = tempDir('ctxo-cs-helper-');
    writeFileSync(join(root, 'package.json'), '{"name":"lending-app"}');
    const pkgDir = join(root, 'node_modules', '@ctxo', 'lang-csharp');
    mkdirSync(join(pkgDir, 'tools', 'ctxo-roslyn'), { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), '{"name":"@ctxo/lang-csharp","version":"0.0.0"}');
    expect(resolveHelperProject(root)).toBeNull(); // the package resolves, but the helper is missing

    const csproj = join(pkgDir, 'tools', 'ctxo-roslyn', 'ctxo-roslyn.csproj');
    writeFileSync(csproj, '<Project />');
    expect(resolveHelperProject(root)).toBe(csproj);
  });
});

describe('projectHasCSharp', () => {
  it('detects a solution or project file at the root, or a .cs file within depth 4', () => {
    const sln = tempDir('ctxo-cs-sln-');
    writeFileSync(join(sln, 'Lending.sln'), '');
    expect(projectHasCSharp(sln)).toBe(true);

    const csproj = tempDir('ctxo-cs-csproj-');
    writeFileSync(join(csproj, 'Lending.csproj'), '');
    expect(projectHasCSharp(csproj)).toBe(true);

    const nested = tempDir('ctxo-cs-nested-');
    mkdirSync(join(nested, 'src', 'Lending', 'Loans'), { recursive: true });
    writeFileSync(join(nested, 'src', 'Lending', 'Loans', 'Loan.cs'), '');
    expect(projectHasCSharp(nested)).toBe(true);

    expect(projectHasCSharp(tempDir('ctxo-cs-empty-'))).toBe(false);
  });

  it('skips obj and bin', () => {
    const dir = tempDir('ctxo-cs-obj-');
    for (const skip of ['obj', 'bin']) {
      mkdirSync(join(dir, skip), { recursive: true });
      writeFileSync(join(dir, skip, 'AssemblyInfo.cs'), '');
    }
    expect(projectHasCSharp(dir)).toBe(false);
  });
});

describe('findSourceFile', () => {
  it('scans for any extension and findJavaFile keeps its behaviour', () => {
    const dir = tempDir('ctxo-scan-');
    mkdirSync(join(dir, 'src', 'members'), { recursive: true });
    writeFileSync(join(dir, 'src', 'members', 'Member.cs'), '');
    expect(findSourceFile(dir, '.cs', 4)).toBe(true);
    expect(findSourceFile(dir, '.java', 4)).toBe(false);
    expect(findJavaFile(dir, 4)).toBe(false);
  });
});
