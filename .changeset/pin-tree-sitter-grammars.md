---
"@ctxo/lang-csharp": patch
"@ctxo/lang-go": patch
"@ctxo/lang-java": patch
---

Pin tree-sitter grammar deps to exact versions to close the lockfile-regen landmine

The caret ranges on `tree-sitter-c-sharp` (`^0.23.1`), `tree-sitter-go` (`^0.23.4`),
and `tree-sitter-java` (`^0.23.5`) permitted newer grammar releases whose peer
`tree-sitter ^0.25.0` is not satisfied by the pinned `tree-sitter@^0.22.4` core.
Any lockfile regeneration (Dependabot rebase, `pnpm install`, `pnpm update`) could
silently pull in e.g. `tree-sitter-c-sharp@0.23.5`, which pnpm placed under a
peer-specific virtual path and skipped its native build script, breaking the DTS
build with `TS2307: Cannot find module 'tree-sitter-c-sharp'`. Pinning to exact
versions closes the landmine. A coordinated `tree-sitter@^0.25.0` ecosystem upgrade
is tracked separately (#106 Option 2).
