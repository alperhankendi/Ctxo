---
title: "CI Integration"
description: "ctxo index --check as a CI gate."
---

# CI Integration

`ctxo index --check` is the supported way to wire Ctxo into continuous integration. It exits non-zero when the committed `.ctxo/index/` tree is out of sync with the tracked source files, which stops PRs from landing with stale dependency data.

## Why gate on the index

The committed JSON index is the canonical source for every MCP tool. If a PR renames symbols, adds files, or changes imports without re-indexing, downstream agents will see yesterday's graph. `--check` makes that mismatch a CI failure rather than a silent regression.

## How `--check` works

The command performs a dry-run index and compares against the committed `.ctxo/index/` contents:

| Condition | Exit code |
| --- | --- |
| Index matches source tree | `0` |
| Index is stale (missing, extra, or out-of-date files) | `1` |

No files are written. `--check` is read-only and safe to run in any CI stage.

## GitHub Actions example

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [master]

jobs:
  ctxo-index-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # history needed for intent and anti-patterns

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Verify Ctxo index is up to date
        run: pnpm exec ctxo index --check
```

The `fetch-depth: 0` line matters: without full history, `ctxo index` cannot populate `intent` and `antiPatterns` for each file, and the committed index will not match the regenerated one.

## Pre-push git hook

Wire the same check into a local pre-push hook so regressions are caught before they hit CI.

```bash
# .git/hooks/pre-push
#!/usr/bin/env bash
set -e
npx ctxo index --check || {
  echo "ctxo index is stale. Run 'ctxo index' and commit the result." >&2
  exit 1
}
```

`ctxo init` can install a pre-push hook automatically. See [`ctxo init`](/cli/init).

## Fast modes for CI

For large repos, `--check` still walks the full tree. If the gate is too slow, split into two jobs:

- **PR job:** `ctxo index --check --skip-history` - fastest, ignores commit history drift.
- **Nightly job:** `ctxo index --check` - full check including intent and anti-patterns.

```yaml
- name: Fast staleness gate (PRs)
  if: github.event_name == 'pull_request'
  run: pnpm exec ctxo index --check --skip-history

- name: Full staleness gate (main)
  if: github.event_name == 'push'
  run: pnpm exec ctxo index --check
```

## Failure output

A stale index produces a diff summary on stderr listing added, removed, and modified files. The expected remediation is:

```bash
npx ctxo index
git add .ctxo/index
git commit -m "chore: refresh ctxo index"
```

::: tip
Run `ctxo index --install-missing` locally before re-indexing if a new language plugin landed on the target branch. The CI runner will have the plugin; your local sandbox may not.
:::

::: warning
Do not commit the `.ctxo/.cache/` SQLite file. Only `.ctxo/config.yaml` and `.ctxo/index/` are tracked. The cache is rebuilt from JSON on first run.
:::

## See also

- [`ctxo index`](/cli/index) - full flag reference
- [`ctxo doctor`](/cli/doctor) - broader health checks suitable for a separate CI job
