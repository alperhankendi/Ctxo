---
"@ctxo/cli": minor
"@ctxo/domain": minor
---

`domain.boundaries.enforce: new-only` and `ctxo verify-domain --boundaries new-only`: the rung rules of `by-rung` decide the severities, but with `--since <ref>` only the boundary violations the merge base lacks fail the gate; the base's are reported as existing warnings. The base's violations come from its committed `.ctxo/index`, read from git without a checkout, when it is current for that commit, else from an index built in a temporary git worktree that ctxo removes; when that fails, or without `--since`, the run falls back to `by-rung` and says so. A violation is keyed by its contexts, symbol IDs and edge kind (no line numbers), and file renames on the branch are followed. Check 10 lists new violations first, the text report adds a `N new, M existing` line and `--json` adds a `boundaries` object with `new` and `existing`. `ctxo init --domain --boundaries new-only` and the init prompt offer the mode. The module host gains `readIndexAtCommit` and `indexCommitInWorktree`.
