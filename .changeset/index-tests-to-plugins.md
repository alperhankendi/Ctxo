---
"@ctxo/plugin-api": patch
"@ctxo/cli": minor
"@ctxo/lang-typescript": minor
---

`index.tests` globs now reach the language plugins. `@ctxo/plugin-api` adds an optional `PluginContext.testGlobs` (type-only and additive, so the plugin peer ranges are unchanged); `@ctxo/cli` sets it in `ctxo index` and `ctxo watch` to the default test globs followed by the valid `index.tests` globs, each once. `@ctxo/lang-typescript` decides test blocks (`describe`, `it`, `test`), their edges, SQL call-site scopes and fact owners with those globs, so `index.tests: ["spec/**/*.check.ts"]` makes the blocks of `spec/loans/policy.check.ts` test symbols. With an older CLI, which does not set the field, the TypeScript plugin keeps its built-in default rule. Re-run `ctxo index` after changing `index.tests`.
