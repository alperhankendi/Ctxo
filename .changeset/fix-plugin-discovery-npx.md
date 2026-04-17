---
'@ctxo/cli': patch
---

Fix plugin discovery failing under `npx @ctxo/cli` when language plugins are installed in the consumer project. Bare specifiers like `@ctxo/lang-csharp` were resolved relative to the CLI bundle's location (inside the npm `_npx` cache), not the user's project, so installed plugins reported `Cannot find package`. Discovery now anchors resolution at the consumer's `package.json` via `createRequire`, so plugins load regardless of where the CLI itself is executing.
