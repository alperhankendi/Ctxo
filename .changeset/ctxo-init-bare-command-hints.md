---
"@ctxo/cli": patch
---

**`ctxo init` next-steps now use bare `ctxo` commands.** After `ctxo init` completes, the "Next steps" box shown to the user now prints `ctxo index` and `ctxo doctor` instead of `npx ctxo …`. This matches the recommended setup (global install via `npm install -g @ctxo/cli`) and the rest of the documentation. The shorter form also works for users who installed `@ctxo/cli` as a devDependency, since pnpm/npm expose the `ctxo` bin in `node_modules/.bin/` on PATH for shell sessions inside the project.

Internal: `http-server-transport.ts` JSDoc examples switched to the bare `ctxo` form for consistency (no runtime effect).
