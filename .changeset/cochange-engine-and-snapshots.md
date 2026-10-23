---
"@ctxo/cli": minor
---

Co-change now comes from one git pass with its own window (`cochange` config, `--cochange-commits`, `--cochange-since`), `ctxo index --files` and `--commit` re-index incrementally, the v2 post-commit hook runs `ctxo index --commit HEAD` once per commit (upgraded in place by `ctxo init` and `ctxo doctor --fix`, never written into a global or system `core.hooksPath`), history keeps one snapshot per commit with confidence counted in distinct commits, and every blast-radius caller uses co-change with a new `coChangedFiles` field on `get_blast_radius` (#157). On upgrade, the first index write removes older same-commit duplicates from `communities.history/` (no information is lost), and `ctxo verify-index` reports files with a rename in their history as stale until the next `ctxo index`.
