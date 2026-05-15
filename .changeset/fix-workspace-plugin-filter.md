---
"@ctxo/cli": patch
---

**Fix: `ctxo update` no longer tries to "upgrade" workspace-linked plugins.**

When the project's `package.json` declares a dep as `workspace:*` (or `workspace:^`, `workspace:~`, etc), the package's source lives locally and is intentionally not consumed from the registry. Previously, `ctxo update` would compare the workspace-link's discovered version to the npm registry's latest and propose a "fix" — installing a pinned registry version, which silently unlinks the workspace and downgrades to whatever npm has published.

Now those rows show up as `workspace link` with `(local)` in the LATEST column, and the install plan excludes them. Example in the Ctxo monorepo itself:

```
PACKAGE                CURRENT        LATEST (latest)  STATUS
@ctxo/cli              0.9.1          0.9.2            update
@ctxo/lang-csharp      0.7.0-alpha.0  (local)          workspace link
@ctxo/lang-go          0.8.0-alpha.0  (local)          workspace link
@ctxo/lang-typescript  0.7.0-alpha.0  (local)          workspace link

To update, run:
  pnpm add -D -w @ctxo/cli@0.9.2
```

Adds `readWorkspaceLinks(projectRoot)` to `core/install/package-manager.ts` and `markWorkspaceLinks(states, names)` plus a new `'workspace'` value in `PackageStatus` to `core/update/update-plan.ts`.
