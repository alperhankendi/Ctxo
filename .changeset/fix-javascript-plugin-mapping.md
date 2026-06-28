---
"@ctxo/cli": patch
---

Fix `ctxo init`/`install` trying to install a non-existent `@ctxo/lang-javascript` package (npm 404). JavaScript files are handled by `@ctxo/lang-typescript`, so `javascript` now resolves to that plugin. Install specifiers are also deduped so a project surfacing both TypeScript and JavaScript no longer requests `@ctxo/lang-typescript` twice.
