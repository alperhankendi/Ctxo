---
title: "ctxo status"
description: "Show the index manifest and freshness."
---

# ctxo status

Prints a summary of the current index: schema version, per-file counts, SQLite
cache state, and a list of indexed files with their `lastModified` timestamps.
Files present in the index but no longer tracked by git are flagged as
`[orphaned]`.

## Synopsis

```shell
npx ctxo status
```

No flags.

## Example output

```text
[ctxo] Index Status
  Schema version: 3
  Indexed files:  412
  Total symbols:  5,128
  Total edges:    9,847
  SQLite cache:   present

  Files:
    packages/cli/src/cli/index-command.ts  2026-04-13T12:01:44.000Z  (24 symbols, 61 edges)
    packages/cli/src/core/logger.ts        2026-04-12T08:32:17.000Z  (3 symbols, 2 edges)
    packages/legacy/old-feature.ts         2025-11-02T10:00:00.000Z  (5 symbols, 0 edges) [orphaned]
    ...
```

## Fields

| Field | Source |
| --- | --- |
| `Schema version` | `.ctxo/.schema-version` |
| `Indexed files` | Count of JSON files under `.ctxo/index/` |
| `Total symbols` / `Total edges` | Summed from every `FileIndex` |
| `SQLite cache` | `present` if `.ctxo/.cache/symbols.db` exists, otherwise `missing (run ctxo sync)` |
| `[orphaned]` | The file is in the index but `git ls-files` does not know about it |

## Examples

```shell
# Quickly verify that the project is indexed.
npx ctxo status
```

```shell
# Post-pull check: if cache shows "missing", run sync.
npx ctxo status && npx ctxo sync
```

## Exit codes

Always `0`. If the index directory is missing, `ctxo status` prints a hint to
run `ctxo index` and exits `0`.

## See also

- [`ctxo index`](./index.md), [`ctxo sync`](./sync.md),
  [`ctxo doctor`](./doctor.md).
