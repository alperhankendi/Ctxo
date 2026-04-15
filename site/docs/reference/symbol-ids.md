---
title: "Symbol IDs"
description: "The deterministic id format for every symbol."
---

# Symbol IDs

Every symbol in the Ctxo index has a deterministic identifier with the shape `<relativeFile>::<name>::<kind>`. The id is stable across commits, across machines, and across re-indexes, which lets it act as a cache key, a cross-reference in edges, and a stable anchor for MCP tool inputs.

## Format

```
<relativeFile>::<name>::<kind>
```

| Segment | Description |
| --- | --- |
| `relativeFile` | Repo-relative path, **forward slashes**, no leading `./`. |
| `name` | Source-level identifier of the symbol. |
| `kind` | One of the six canonical [symbol kinds](#valid-kinds). |

The separator is a literal double colon (`::`). IDs are validated by a zod schema that splits on `::`, requires exactly three non-empty parts, and asserts the kind is in the allowed enum.

## Valid kinds

| Kind | Typical source |
| --- | --- |
| `function` | top-level function declaration |
| `class` | class declaration |
| `interface` | interface declaration |
| `method` | member of a class or interface |
| `variable` | top-level const/let/var or package-level var |
| `type` | type alias / type declaration |

These six kinds are the full enum. Language plugins map their native AST nodes onto this set at extraction time.

## Path normalisation

- Windows backslashes are normalised to `/`.
- Paths are always **repo-relative**. Absolute paths and `../` escapes are not permitted in IDs.
- Casing is preserved as it appears on disk.

```json
{ "symbolId": "packages/cli/src/core/logger.ts::createLogger::function" }
```

## Examples

```json
// TypeScript function
"packages/cli/src/core/logger.ts::createLogger::function"

// TypeScript class method
"packages/cli/src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class"
"packages/cli/src/adapters/storage/sqlite-storage-adapter.ts::upsertSymbol::method"

// Go package-level function
"internal/server/server.go::NewServer::function"

// C# class
"src/Ctxo.Roslyn/Analyzer.cs::Analyzer::class"

// Type alias
"packages/cli/src/core/types.ts::SymbolKind::type"
```

## Why deterministic

- **Cross-commit stability.** The same symbol in the same file yields the same id in HEAD and in a PR branch, so blast-radius queries, co-change analysis, and intent overlays survive rewrites of surrounding code.
- **Cache keys.** SQLite joins, PageRank maps, and the JSON index all key on `symbolId`. A deterministic formula removes the need for a separate id-allocation step.
- **Portable references.** Edges (`{ from, to, kind }`) reference symbols by id, so edges stay valid when a file is re-parsed.
- **Tool input.** Every MCP tool that takes a `symbolId` parameter (e.g. `get_blast_radius`, `find_importers`, `get_class_hierarchy`) accepts the exact string produced at indexing time.

::: tip
Use [`search_symbols`](/mcp-tools/search-symbols) or [`get_ranked_context`](/mcp-tools/get-ranked-context) to discover an id rather than constructing one by hand. The format is stable, but the surrounding file path may not be.
:::

::: warning
An id whose third segment is not a valid kind is rejected by the schema. If a plugin needs to represent a new language construct, map it to the closest existing kind rather than inventing a new one.
:::

## See also

- [Dependency Graph](/concepts/dependency-graph) - how IDs connect through edges
- [Edge Kinds](/reference/edge-kinds) - the companion enum for graph edges
