---
"@ctxo/plugin-api": patch
"@ctxo/cli": minor
"@ctxo/lang-typescript": minor
---

`index.tests` globs now reach the language plugins. `@ctxo/plugin-api` adds an optional `PluginContext.testGlobs` (type-only and additive, so the plugin peer ranges are unchanged); `@ctxo/cli` sets it in `ctxo index` and `ctxo watch` to the default test globs followed by the valid `index.tests` globs, each once. `@ctxo/lang-typescript` decides test blocks (`describe`, `it`, `test`), their edges, SQL call-site scopes and fact owners with those globs, so `index.tests: ["spec/**/*.check.ts"]` makes the blocks of `spec/loans/policy.check.ts` test symbols. With a CLI that predates the field, the TypeScript plugin keeps its built-in default rule. Behaviour change: a current CLI sends all its default test globs, including `**/*.Tests/**` and `**/*.Test/**`, so TypeScript files under such folders now get test blocks. `index.tests` does not support negation: a `!` entry is skipped (it no longer turns every other file into a test file in the contexts view), the TypeScript plugin skips one too, and `ctxo doctor` warns and names it (use `index.ignore` to leave files out). Re-run `ctxo index` after upgrading or changing `index.tests`.
