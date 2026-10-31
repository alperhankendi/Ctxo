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
full batch-index cost. The keep-alive shuts itself down after a period without
requests; the next re-index restarts it once, and if that fails the file is
re-indexed with tree-sitter rather than written with zero symbols. Java full
tier also supports incremental keep-alive re-index, though very large projects may degrade to tree-sitter on timeout
(see the [Java language page](/languages/java) for details).

## Synopsis

```shell
ctxo watch
```

No flags. Press `Ctrl+C` to stop; the watcher drains pending re-index tasks,
disposes the Roslyn keep-alive (if active), and closes the SQLite handle
cleanly.

## Behavior

| Event | Action |
| --- | --- |
| Add or change | Debounced (300 ms) re-index via the registered language adapter |
| Delete | Remove the file's entry from both the JSON index and the SQLite cache |
| Unsupported extension | Ignored, unless `@ctxo/domain` reads it (see below) |

Each re-index also refreshes that file's commit history and anti-pattern list
so newly committed changes are reflected immediately.

## Domain artifacts (`@ctxo/domain`)

With `@ctxo/domain` installed, `ctxo watch` also runs the domain index pass, the
one `ctxo index` runs, so `.ctxo/index/domain/graph.json`, `maturity.json`,
`shadow-candidates.json`, `contexts.json` and `boundaries.json` follow your edits
and the domain tools stop answering `stale: true`. The pass never runs once per
file event:

| Change | When the pass runs |
| --- | --- |
| The registry (`domain.registry`), a card or the glossary | 1 s after the last such event, or twice the duration of the last pass when that is longer |
| Source files (indexed files, `domain.facts.textScanExtensions` files) | Once `watch.snapshotMinFileChanges` (default 5) distinct files changed, 5 s after the last event |
| Watch starts while the domain graph is stale against the registry, cards or glossary | Once, shortly after start (no pass when the artifacts are current) |

A due pass waits for pending re-indexes of source files but is never postponed
more than 30 s, and passes never overlap. `DEBUG=ctxo:watch` logs how long each
pass took. A `shadow-specs.yaml` edit needs no pass: resolutions apply when the
tools read them.

For the same index at the same commit, the watch pass writes the bytes `ctxo
index` writes. Watch has no change log, so moved files, the discovery result in
`maturity.json` and the per-commit history keep the values of the last `ctxo
index` until the next one or the next commit. The config is read once when
watch starts. A registry created while watch runs gets no pass (the plugins were
loaded without facts): this watch warns on each skipped pass until it is
restarted (run `ctxo index` too). A failing pass is
logged and the watcher keeps running. Without `@ctxo/domain` nothing changes.
See the [domain knowledge layer](/concepts/domain-knowledge).

## Examples

```shell
# Start the watcher in a second terminal while you work.
ctxo watch
```

```shell
# Narrow debug output to just plugin and storage events.
DEBUG=ctxo:plugin-loader,ctxo:storage ctxo watch
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
