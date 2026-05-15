---
"@ctxo/cli": minor
---

**`ctxo update` — self-update mechanism.** Checks `registry.npmjs.org` for newer versions of `@ctxo/cli` and every installed `@ctxo/lang-*` / `ctxo-lang-*` plugin, then either runs the install or prints the install command for the user to run.

- Flags: `--check`, `--print`, `--global`, `--json`, `--pm <npm|pnpm|yarn|bun>`, `--force`.
- Per-package channel detection (alpha stays on alpha, stable stays on stable) with explicit `(latest)` annotation when the chosen channel is not published.
- Auto-execute when the project lists `@ctxo/*` in `package.json`; otherwise prints the global install command without mutating an unrelated workspace.
- Single JSON document in `--json` mode.
- Defence-in-depth: rejects npm version specifiers containing shell metacharacters before passing them to the package manager.
- Internal: extracted shared `runPackageManager` helper from `install-command.ts`; both `install` and `update` now route through `core/install/run-package-manager.ts`.

Spec: `docs/superpowers/specs/2026-05-15-ctxo-update-design.md`. User docs: [`site/docs/cli/update.md`](https://ctxo.dev/cli/update.html).
