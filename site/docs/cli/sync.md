---
title: "ctxo sync"
description: "Rebuild the SQLite cache from committed JSON."
---

# ctxo sync

Rebuilds `.ctxo/.cache/symbols.db` from the per-file JSON files under
`.ctxo/index/`. The JSON index is the source of truth and is committed; the
SQLite cache is a local, gitignored performance layer that needs to be
regenerated any time the JSON changes without the running process observing
it (most commonly after `git pull` or a fresh clone).

## Synopsis

```shell
npx ctxo sync
```

No flags.

## When to run

| Scenario | Why |
| --- | --- |
| After `git pull` | Your index JSON changed but your SQLite cache did not |
| Fresh clone | `.ctxo/.cache/` is gitignored, so it is always absent on first checkout |
| `ctxo doctor` reports missing or stale cache | The SQLite cache check failed |
| After deleting `.ctxo/.cache/` | Manually clearing a suspected-corrupt cache |

`ctxo init` installs a `post-merge` git hook that runs `ctxo sync` after every
`git pull` so you rarely need to invoke it by hand.

## Examples

```shell
npx ctxo sync
```

```shell
# Force a clean cache, then rebuild.
rm -rf .ctxo/.cache
npx ctxo sync
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Cache rebuilt |
| `1` | JSON index unreadable or disk write failed |

## See also

- [`ctxo index`](./index.md) — the only command that writes the JSON index.
- [`ctxo status`](./status.md) — reports whether the cache is present.
- [`ctxo doctor`](./doctor.md) — `--fix` runs `sync` automatically.
