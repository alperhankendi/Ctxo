---
"@ctxo/lang-typescript": minor
"@ctxo/lang-go": minor
"@ctxo/domain": patch
---

Endpoint facts cover more frameworks and join route prefixes. TypeScript: Koa (`@koa/router`, `koa-router`: `del`, named routes, the `prefix` option, nested `use`) and Hono (`route`, `basePath`) routes, and Express `app.use('/api', router)` mounts joined to the router's routes (nested mounts compose). Go, in both tiers: echo and chi routes, gin and echo `Group()` prefixes, chi `Route`, `Group`, `With` and `Mount`; the syntax tier takes framework routes only on receivers the file shows to be routers. `@ctxo/domain` text scan: a Flask Blueprint's same-file `url_prefix` is joined to its decorator routes (not when `register_blueprint` sets its own). Prefixes are joined only when the mount and the routes are in the indexed file and every segment is a constant string, so full and incremental runs write the same facts; otherwise the route keeps the path written at the call. Existing facts change only where a prefix now resolves: gin `r.Group("/v2").PUT("/x")` reads `PUT /v2/x` instead of `PUT /x`. The fingerprint of such an endpoint changes with its text, so a `shadow-specs.yaml` resolution recorded for it turns stale and must be recorded again.
