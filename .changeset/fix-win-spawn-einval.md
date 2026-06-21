---
"@ctxo/cli": patch
---

Fix `spawn EINVAL` on Windows during `ctxo install` / `ctxo update` / `ctxo init` plugin installs. Node's CVE-2024-27980 hardening (>=18.20.2 / >=20.12.2 / all 21+) refuses to spawn the `.cmd` package-manager shims (npm, pnpm, yarn) without a shell, so the install aborted with `[ctxo] ERROR Fatal: spawn EINVAL`. The package-manager runner now spawns a single shell command string on Windows so the shell resolves the shim, while POSIX keeps the direct argv + `shell:false` path. This avoids both the EINVAL crash and the DEP0190 deprecation that a `shell:true` + argv-array combination would raise on Node 22.
