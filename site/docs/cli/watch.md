---
title: "ctxo watch"
description: "File watcher for incremental re-index."
---

# ctxo watch

Starts a chokidar-based file watcher. Every time a supported source file is
added, changed, or removed, ctxo re-indexes just that file and updates both
the JSON index and the SQLite cache. Changes are debounced by 300 ms.

For C# projects on the full tier, `ctxo watch` starts a Roslyn keep-alive
server so each re-index round-trips in under 100 ms instead of paying the
full batch-index cost.

## Synopsis

```shell
npx ctxo watch
```

No flags. Press `Ctrl+C` to stop; the watcher drains pending re-index tasks,
disposes the Roslyn keep-alive (if active), and closes the SQLite handle
cleanly.

## Behavior

| Event | Action |
| --- | --- |
| Add or change | Debounced (300 ms) re-index via the registered language adapter |
| Delete | Remove the file's entry from both the JSON index and the SQLite cache |
| Unsupported extension | Ignored |

Each re-index also refreshes that file's commit history and anti-pattern list
so newly committed changes are reflected immediately.

## Examples

```shell
# Start the watcher in a second terminal while you work.
npx ctxo watch
```

```shell
# Narrow debug output to just plugin and storage events.
DEBUG=ctxo:plugin-loader,ctxo:storage npx ctxo watch
```

## When to use this vs. git hooks

| Scenario | Recommended |
| --- | --- |
| Active development, editor open | `ctxo watch` |
| Committed-only workflow | `ctxo init` git hooks (`post-commit`, `post-merge`) |
| CI | `ctxo index` (one-shot) |

## See also

- [`ctxo index`](./index.md) — the one-shot full indexer.
- [`ctxo init`](./init.md) — installs the git hooks that complement (or replace)
  the watcher.
