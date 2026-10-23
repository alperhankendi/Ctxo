# @ctxo/sql-extract

Zero-dependency T-SQL tokenizer and data-access recognizers shared by [Ctxo](https://github.com/alperhankendi/Ctxo) language plugins.

This is a library, not a plugin. It has no runtime dependencies and is never discovered by the Ctxo CLI. [`@ctxo/lang-sql`](https://github.com/alperhankendi/Ctxo/tree/master/packages/lang-sql) builds on it, and so do the other language hosts that recognize embedded SQL. It is the one package a Ctxo language plugin may depend on besides `@ctxo/plugin-api` ([ADR-017](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md)).

It exposes two functions:

- `extractSqlAccesses(text)`: the `reads`, `writes` and `executes` accesses of a SQL text, as canonical names.
- `extractSqlDefinitions(source)`: the tables, views, procedures and functions a SQL file defines, with table columns and the accesses of each body.

Names are canonicalized as `schema.name`: delimiters removed, ASCII A-Z folded to lowercase (every other character kept), default schema `dbo` (`DEFAULT_SQL_SCHEMA`). The dialect is T-SQL (`SQL_DIALECT`). The [conformance corpus](https://github.com/alperhankendi/Ctxo/tree/master/packages/sql-extract/corpus) pins the rules, and the C# plugin's ScriptDom parser runs the same cases.
