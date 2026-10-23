---
"@ctxo/plugin-api": minor
"@ctxo/cli": minor
"@ctxo/lang-csharp": minor
"@ctxo/sql-extract": minor
"@ctxo/lang-sql": minor
"@ctxo/lang-typescript": patch
"@ctxo/lang-go": patch
"@ctxo/lang-java": patch
"@ctxo/lang-java-analyzer": patch
---

Plugin protocol v2 and data coupling (#156 Phase 1): `@ctxo/plugin-api` adds the data kinds (`table`, `view`, `procedure` with `reads`, `writes` and `executes` edges), typed symbol annotations, an opt-in facts channel and host capabilities, and the new `@ctxo/lang-sql` plugin (built on the zero-dependency `@ctxo/sql-extract` library, installed with `ctxo install sql`) indexes T-SQL definitions and the tables their bodies read and write. `@ctxo/lang-csharp` reports attribute annotations, adds SQL edges at known ADO.NET, Dapper, `SqlBulkCopy` and EF Core call sites when `@ctxo/lang-sql` is installed, and falls back to tree-sitter when its Roslyn helper cannot restore or build. The CLI puts data edges in the confirmed blast-radius tier, reports shared tables, ownership and external resources in the contexts view, recognises test files by test-framework annotations and adds the `csharp_tier` doctor check, and the other official plugins widen their `@ctxo/plugin-api` peer range.
