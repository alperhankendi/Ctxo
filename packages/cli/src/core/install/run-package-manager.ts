import { spawn } from 'node:child_process';

/**
 * Spawn a package manager (npm / pnpm / yarn / bun) with the given args.
 *
 * Windows note: package managers ship as `.cmd` (npm, pnpm, yarn) or `.exe`
 * (bun, and pnpm's native binary) shim files. `spawn('pnpm', args)` with
 * `shell: false` would fail to resolve the .cmd extension via PATHEXT, but
 * `shell: true` is now deprecated when combined with an argv array (DEP0190
 * in Node 22) because args are concatenated unescaped.
 *
 * To avoid the deprecation warning while still resolving the right binary,
 * we append the appropriate extension on Windows and call `spawn` with
 * `shell: false`. The args we pass come from `buildInstallCommand`, which
 * only produces package-manager subcommands and version specifiers — both
 * validated upstream (`isSafeVersionSpecifier` rejects shell metacharacters).
 * No interpolated user input ever reaches this function.
 */
export function runPackageManager(command: string, args: readonly string[], cwd: string): Promise<number> {
  const resolved = resolveBinary(command);
  return new Promise((resolve, reject) => {
    const child = spawn(resolved, [...args], { cwd, stdio: 'inherit', shell: false });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => reject(err));
  });
}

function resolveBinary(command: string): string {
  if (process.platform !== 'win32') return command;
  // bun ships as bun.exe on Windows; npm / pnpm / yarn ship as .cmd shims.
  if (command === 'bun') return 'bun.exe';
  return `${command}.cmd`;
}
