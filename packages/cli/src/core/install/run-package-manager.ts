import { spawn } from 'node:child_process';

/**
 * Spawn a package manager (npm / pnpm / yarn / bun) with the given args.
 *
 * Windows note: npm / pnpm / yarn ship as `.cmd` shim files. Since the
 * CVE-2024-27980 fix (Node >=18.20.2 / >=20.12.2 / all 21+), Node refuses to
 * spawn a `.cmd` / `.bat` file unless `shell: true` is set, otherwise it throws
 * `EINVAL`. But passing an argv ARRAY together with `shell: true` triggers the
 * DEP0190 deprecation (Node 22) because the args are concatenated unescaped.
 *
 * To satisfy both constraints on Windows we build a single command STRING and
 * let the shell resolve the shim (cmd.exe applies PATHEXT, so plain `npm`
 * resolves to `npm.cmd` and `bun` to `bun.exe`). The pieces come from
 * `buildInstallCommand` — package-manager subcommands and version specifiers
 * validated by `isSafeVersionSpecifier`, which rejects shell metacharacters and
 * whitespace — so no interpolated user input ever reaches the shell.
 *
 * On POSIX the binary is a normal executable on PATH, so we spawn it directly
 * with an argv array and `shell: false`.
 */
export function runPackageManager(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
        : spawn(command, [...args], { cwd, stdio: 'inherit', shell: false });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => reject(err));
  });
}
