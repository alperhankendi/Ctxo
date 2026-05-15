---
"@ctxo/cli": patch
---

**Fix: `ctxo install` / `ctxo update` now work inside pnpm workspaces.**

Two bugs surfaced when running these commands inside a pnpm monorepo:

- **`ERR_PNPM_ADDING_TO_ROOT`** — pnpm 8+ requires `-w` for `pnpm add -D` at a workspace root. ctxo never appended the flag, so installs failed with the pnpm safety check. Fix: detect workspace root (`pnpm-workspace.yaml` or `package.json.workspaces`) and append `-w` to the pnpm command when applicable. Global installs and non-workspace projects are unaffected. Other package managers (npm / yarn / bun) need no equivalent flag.
- **`DEP0190` deprecation warning** on Node 22+ — `spawn(cmd, args, { shell: true })` is now deprecated because args are concatenated unescaped. Fix: drop `shell: true`; on Windows, append the right extension manually (`.cmd` for npm/pnpm/yarn, `.exe` for bun). No security regression — `isSafeVersionSpecifier` already filters shell metacharacters upstream.

Exposes a new `isWorkspaceRoot(projectRoot)` helper in `core/install/package-manager.ts` and extends `buildInstallCommand` with a `workspaceRoot` option (defaults to `false`).
