---
"@ctxo/lang-typescript": patch
---

Resolve extensionless, `.tsx` and directory-index relative imports through the symbol registry, so `extends`, `implements` and import edges stay correct in single-file runs (`ctxo index --files` / `--commit`, post-commit hook). Previously an extensionless `extends` target became a non-existent file such as `src/base::Base::class`, and import edges to `./Button` (`Button.tsx`) or `./utils` (`utils/index.ts`) guessed a `.ts` path and kind.
