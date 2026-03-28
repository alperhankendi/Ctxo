---
stepsCompleted: [1, 2, 3, 4, 5, 6]
workflow_completed: true
inputDocuments: []
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'Ctxo Core Stack — AST Parsers, MCP SDK, and Dependency Graph Construction'
research_goals: 'Validate technology choices for Ctxo: Tree-sitter vs alternatives, MCP SDK architecture, and AST-based dependency graph construction in TypeScript'
user_name: 'Alper Hankendi'
date: '2026-03-28'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical

**Date:** 2026-03-28
**Author:** Alper Hankendi
**Research Type:** Technical

---

## Executive Summary

Ctxo is a Logic-Slice based MCP server that delivers dependency-aware, intent-enriched, safety-annotated context to AI agents — replacing brute-force file reading with surgical precision. This research validates and finalizes the complete technical stack required to build Ctxo.

**The central finding:** TypeScript with a Hexagonal Architecture is the only viable choice. `ts-morph` — the TypeScript Compiler API wrapper — provides type-aware cross-file dependency resolution that no other language or library can match for the Logic-Slice core. All surrounding infrastructure (MCP SDK, SQLite, git integration, file watching) has mature, well-tested TypeScript-native libraries. Multi-language support (Go, C#) is achievable via a Language Adapter plugin system: tree-sitter-language-pack for syntax-level analysis, gopls MCP composition for Go semantic depth, and Roslyn LSP for C# (dotnet pre-installed confirmed acceptable).

**Key Technical Findings:**
- `ts-morph` + `tree-sitter` hybrid is the definitive parser strategy — type awareness for TypeScript, incremental parsing for everything else
- `@modelcontextprotocol/sdk` with `StdioServerTransport` is the correct MCP integration — stdio for local subprocess, Streamable HTTP for future cloud
- `better-sqlite3` with WAL mode + recursive SQL provides blast radius calculation without a graph database
- `gopls` v0.20+ ships a native MCP server — Ctxo composes with it rather than reimplementing Go analysis
- Hexagonal architecture with a Language Adapter registry enables adding new languages without touching core domain logic
- Lazy initialization (< 100ms startup) and hybrid in-memory/SQLite storage are non-negotiable for MCP subprocess performance

**Top 5 Recommendations:**
1. Ship TypeScript-only V1 with full Logic-Slice, blast radius, intent layer, and privacy masking
2. Add tree-sitter syntax-level adapters for Go + C# in V1.5 (zero new dependencies)
3. Compose with gopls MCP for Go deep analysis in V2 (free semantic tier via peer MCP server)
4. Use Roslyn LSP for C# deep analysis in V2 (dotnet pre-installed, confirmed acceptable)
5. Test with `vitest` + `InMemoryTransport` pattern — unit/integration/E2E layers clearly separated

---

## Research Overview

**Research Topic:** Ctxo Core Stack — AST Parsers, MCP SDK, and Dependency Graph Construction
**Research Goals:** Validate technology choices for Ctxo: Tree-sitter vs alternatives, MCP SDK architecture, and AST-based dependency graph construction in TypeScript
**Date:** 2026-03-28
**Sources:** Web-verified, multi-source, current as of March 2026

### Scope Confirmed
- Architecture Analysis — design patterns, frameworks, system architecture
- Implementation Approaches — development methodologies, coding patterns
- Technology Stack — languages, frameworks, tools, platforms
- Integration Patterns — APIs, protocols, interoperability
- Performance Considerations — scalability, optimization, patterns

---

## Technology Stack Analysis

---

### Topic 1: AST Parser Selection — Tree-sitter vs Alternatives

#### Parser Landscape Overview

| Parser | Language | Primary Purpose | TypeScript Support |
|---|---|---|---|
| **Tree-sitter** | C (WASM bindings) | Universal incremental parser | ✅ Via grammar (2 dialects: TS + TSX) |
| **ts-morph** | TypeScript | TypeScript Compiler API wrapper | ✅ Native, type-aware |
| **SWC** | Rust | Fast JS/TS compiler | ✅ Full, Rust-speed |
| **Babel** | JavaScript | JS/TS transpiler | ✅ Via plugins |
| **tsc** | TypeScript | Official TS compiler | ✅ Authoritative |
| **oxc** | Rust | Next-gen JS/TS toolchain | ✅ Emerging |

#### Performance Benchmarks

Based on current benchmarks (2025):
- **tsc**: Fastest for TypeScript-only — 2× faster than Babel
- **SWC/oxc**: Rust-based, fastest for transpilation/build pipelines; FFI overhead reduces advantage for pure parsing
- **Tree-sitter**: Performance ≈ Babel for TypeScript; excels at incremental re-parsing (up to **70% faster** than full re-parse on edits)
- **ts-morph**: Wraps tsc — inherits tsc's performance; adds memory overhead for in-memory manipulation

> ⚠️ Key finding: Native Rust parsers (SWC) are not always faster in JS/TypeScript contexts due to FFI and serde overhead proportional to file size.

#### Tree-sitter: Strengths and Weaknesses for Ctxo

**Strengths:**
- **Incremental parsing** — reuses unchanged tree nodes; critical for git-hook-triggered re-indexing
- **Multi-language** — supports TypeScript, JavaScript, TSX, Python, Go, Rust, Java, C++ via grammar files. One parser engine for polyglot monorepos
- **Error recovery** — produces valid syntax trees even for incomplete/mid-edit code
- **Production-proven** — used by GitHub (symbol resolution), VS Code, Neovim, Emacs
- **Real-world scale** — Helix-Lint processed 1M lines in under 10s; 45% performance improvement, 65% fewer false positives vs regex-based parsers
- **WASM support** — can run in browser-based tooling

**Weaknesses:**
- No type system knowledge — cannot resolve TypeScript types, generics, or inferred types
- Not unist-compatible (breaks unified ecosystem tools)
- Performance declines with very large files in async scenarios
- Grammar maintenance per language

#### ts-morph: Strengths and Weaknesses for Ctxo

**Strengths:**
- **Full TypeScript type awareness** — resolves inferred types, generics, overloads, module resolution
- **High-level API** — `.getClasses()`, `.getImportDeclarations()`, `.getDescendantsOfKind()` — no low-level node traversal required
- **Cross-file resolution** — follows import chains across the entire TypeScript project via `tsconfig.json`
- **In-memory mutations** — all changes buffered until explicit `.save()` — safe for analysis without side effects
- **Active ecosystem** — MCP servers already exist using ts-morph for TypeScript code analysis

**Weaknesses:**
- TypeScript-only — cannot parse Python, Go, Rust, etc.
- Higher memory footprint — loads full TypeScript program into memory
- Slower than Tree-sitter for pure syntax-level tasks

#### Ctxo Recommendation: Hybrid Parser Strategy

**Primary:** `ts-morph` for TypeScript/JavaScript files
- Type-aware dependency resolution (critical for Logic-Slice accuracy)
- Cross-file import chain following via tsconfig
- Contract extraction (types, interfaces, function signatures)
- Handles `.ts`, `.tsx`, `.js`, `.jsx`, `.d.ts`

**Secondary:** `tree-sitter` for all other languages
- Python, Go, Rust, Java, C++, YAML, JSON for polyglot monorepos
- Syntax-level dependency extraction (import statements, function calls)
- Incremental re-parsing on file changes (git hook integration)

**Architecture:** ts-morph handles the TypeScript program graph; Tree-sitter handles language expansion. Both feed into Ctxo's unified dependency graph.

_Sources: [Benchmark TypeScript Parsers](https://dev.to/herrington_darkholme/benchmark-typescript-parsers-demystify-rust-tooling-performance-2go8) · [Tree-sitter GitHub](https://github.com/tree-sitter/tree-sitter) · [Incremental Parsing Tree-sitter](https://dasroot.net/posts/2026/02/incremental-parsing-tree-sitter-code-analysis/) · [ts-morph docs](https://ts-morph.com/)_

---

### Topic 2: MCP SDK Architecture & Context Delivery Patterns

#### Protocol Overview

The Model Context Protocol (MCP) is an open standard introduced by Anthropic (November 2024), donated to the **Linux Foundation / Agentic AI Foundation (December 2025)**. As of 2026, it is the de facto standard for AI-to-tool context delivery, adopted by OpenAI, Microsoft, and the broader ecosystem.

**Architecture:** Client-host-server, built on **JSON-RPC 2.0**. Inspired by the Language Server Protocol (LSP). Bidirectional — both client and server expose protocol primitives.

#### Three Core Primitives

| Primitive | Direction | Purpose | Ctxo Use |
|---|---|---|---|
| **Tools** | Server → LLM | Actions, computation, side effects | `get_context`, `get_blast_radius`, `get_impact_analysis` |
| **Resources** | Server → Client | Read-only data for LLM context | Codebase schema, architectural overlay, symbol index |
| **Prompts** | Server → Client | Reusable interaction templates | "Analyze this function with full context", "Review this PR" |

#### TypeScript SDK

Official SDK: `@modelcontextprotocol/sdk` (npm)
- Peer dependency: **Zod v4** for schema validation
- Full MCP spec implementation: tools, resources, prompts, sampling, elicitation
- Current spec version: 2025-11-25

```bash
npm install @modelcontextprotocol/sdk zod
```

#### Transport Selection for Ctxo

| Transport | Use Case | Recommendation |
|---|---|---|
| **stdio** | Local server spawned as child process | ✅ **Ctxo primary** — Claude Code spawns Ctxo locally |
| **Streamable HTTP** | Remote/cloud server | For future Ctxo Cloud offering |
| **HTTP + SSE** | Legacy compatibility | Supported but deprecated path |

For Ctxo's initial use case (Claude Code, Cursor, local IDE integration), **stdio transport** is correct — zero network overhead, simplest setup, no HTTP server required.

#### FastMCP vs Official SDK

| | Official SDK | FastMCP |
|---|---|---|
| **Control** | Maximum | Less |
| **Speed to build** | Slower | Faster |
| **Recommendation for Ctxo** | ✅ Preferred | For prototyping only |

Ctxo has specific architectural requirements (lazy indexing, graph queries, incremental updates) that warrant the official SDK for full control.

#### Context Delivery Patterns (Applied to Ctxo)

**Pattern 1: Tool Catalog / Adapter Hub**
Ctxo exposes a catalog of context tools: `get_logic_slice`, `get_dependency_graph`, `get_blast_radius`, `get_why_context`, `get_architectural_overlay`. AI selects deterministically based on tool metadata.

**Pattern 2: RAG / Retrieval Server**
Ctxo's symbol index acts as a retrieval server — `search_symbols`, `get_symbol`, `get_callers`, `get_callees`. Firewall-safe: source code stays local, only context bundles are delivered.

**Pattern 3: Capability-Based Negotiation**
Ctxo declares capabilities at session init: which languages are indexed, which features are available (git history, privacy masking, blast radius). AI adapts its requests based on declared capabilities.

#### Security Considerations

- localhost MCP servers are vulnerable to **DNS rebinding attacks** — use `@modelcontextprotocol/express` or `@modelcontextprotocol/hono` middleware for Host header validation
- Tool annotations (`readOnlyHint: true`) should be set for read-only Ctxo tools — prevents AI from treating analysis tools as action tools
- Stateless transport (new `StreamableHTTPServerTransport` per request) ensures no shared state leakage between sessions

_Sources: [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) · [TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) · [MCP codilime overview](https://codilime.com/blog/model-context-protocol-explained/) · [FastMCP](https://github.com/punkpeye/fastmcp) · [MCP 1-year anniversary post](https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/)_

---

### Topic 3: AST-Based Dependency Graph Construction in TypeScript

#### Core Architecture: Two-Pass Analysis

The established pattern for cross-file dependency graph construction is a **two-pass approach**:

**Pass 1 — File-level AST parsing:**
Parse each file independently. Extract: classes, interfaces, functions, types, imports, exports. Store as nodes with byte offsets.

**Pass 2 — Cross-file relationship resolution:**
Resolve import declarations to actual file paths. Build edges: `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `USES_TYPE`. This pass requires following module resolution (tsconfig paths, node_modules, barrel files).

This pattern is used by CodeGraph (ChrisRoyse), Code Graph Context MCP server, and GraphAware's TypeScript refactoring tooling.

#### Implementation with ts-morph

ts-morph's cross-file analysis follows TypeScript's own module resolution:

```typescript
const project = new Project({ tsConfigFilePath: './tsconfig.json' });
const sourceFiles = project.getSourceFiles();

for (const file of sourceFiles) {
  // Import resolution — ts-morph follows tsconfig paths automatically
  const imports = file.getImportDeclarations();
  for (const imp of imports) {
    const resolved = imp.getModuleSpecifierSourceFile(); // Cross-file resolution
    // Build graph edge: file → resolved
  }

  // Symbol extraction
  const functions = file.getFunctions();
  const classes = file.getClasses();
  const interfaces = file.getInterfaces();
}
```

Key capability: `getModuleSpecifierSourceFile()` follows TypeScript's module resolution including path aliases, barrel files, and declaration files.

#### Graph Storage Options

| Option | Use Case | Trade-offs |
|---|---|---|
| **In-memory (Map/Set)** | Small-medium repos (<100k LOC) | Fast, zero deps, volatile |
| **SQLite (via better-sqlite3)** | Medium repos, persistent index | Simple, embedded, queryable |
| **Neo4j** | Large enterprise, complex graph queries | Powerful Cypher queries, separate process |
| **DuckDB** | Analytical queries on graph data | Columnar, fast aggregations |

**Ctxo Recommendation:** Start with **SQLite** for the persistent index. Simple to embed, no separate process, supports complex join queries for dependency resolution. Neo4j as optional enterprise tier.

#### Handling Dependency Graph Challenges

**Dynamic imports:**
```typescript
// Static analysis cannot resolve: import(variablePath)
const mod = await import(getModulePath()); // ⚠️ Unresolvable statically
```
Strategy: Flag as `dynamic: true` in the graph; mark dependent context bundles as "potentially incomplete."

**Barrel files (index.ts re-exports):**
ts-morph's `getModuleSpecifierSourceFile()` handles these natively — follows through barrel files to the actual declaration.

**Monorepo (multiple tsconfig.json):**
Create a `Project` per `tsconfig.json`, then merge graphs. Cross-package dependencies resolved via `references` in tsconfig.

**Circular dependencies:**
Use DFS with a visited set. Circular deps are valid TypeScript — mark cycles in the graph as `cyclic: true` and surface as a warning in blast radius calculations.

#### Existing MCP Implementations to Study

| Project | Stack | Notable Features |
|---|---|---|
| [CodeGraph](https://github.com/ChrisRoyse/CodeGraph) | ts-morph + Neo4j + MCP | Two-pass analysis, Cypher NL queries |
| [Code Graph Context](https://glama.ai/mcp/servers/@drewdrewH/code-graph-context) | ts-morph + Neo4j + embeddings | Semantic search + graph traversal |
| [typescript-graph](https://github.com/ysk8hori/typescript-graph) | TypeScript | CLI visualization of file dependencies |
| [Tree-sitter MCP Server](https://www.pulsemcp.com/servers/wrale-tree-sitter) | Tree-sitter + MCP | Multi-language code analysis via MCP |

**Key insight from CodeGraph:** It already combines ts-morph + Neo4j + MCP. Ctxo's differentiation over CodeGraph is the **intent layer** (git history, anti-pattern memory), **blast radius scoring**, **progressive detail levels**, and **hallucination fingerprinting** — not the basic graph construction.

_Sources: [How I Built CodeRAG with Tree-Sitter](https://medium.com/@shsax/how-i-built-coderag-with-dependency-graph-using-tree-sitter-0a71867059ae) · [ts-morph Navigation](https://ts-morph.com/navigation/) · [Graph-assisted TypeScript Refactoring](https://graphaware.com/blog/graph-assisted-typescript-refactoring/) · [CodeGraph GitHub](https://github.com/ChrisRoyse/CodeGraph) · [Code Graph Context MCP](https://glama.ai/mcp/servers/@drewdrewH/code-graph-context)_

---

### Integration Pattern: Ctxo Full Stack

```
┌─────────────────────────────────────────────────┐
│                  Claude Code / Cursor            │
│                   (MCP Client)                   │
└────────────────────┬────────────────────────────┘
                     │ stdio / JSON-RPC 2.0
┌────────────────────▼────────────────────────────┐
│              Ctxo MCP Server                     │
│         (@modelcontextprotocol/sdk)              │
│                                                  │
│  Tools: get_logic_slice, get_blast_radius,       │
│         get_why_context, get_impact_analysis     │
│  Resources: schema, architectural_overlay        │
│  Prompts: review_context, debug_context          │
└──────┬───────────────────────────┬───────────────┘
       │                           │
┌──────▼──────┐           ┌────────▼────────┐
│  Parser     │           │  Index Store    │
│  Layer      │           │  (SQLite)       │
│             │           │                 │
│  ts-morph   │           │  Symbols        │
│  (TS/JS)    │           │  Edges          │
│             │           │  Intent         │
│  tree-sitter│           │  Contracts      │
│  (others)   │           │  Byte offsets   │
└──────┬──────┘           └────────▲────────┘
       │  Two-pass AST analysis    │
┌──────▼───────────────────────────┴──────────────┐
│              Source Files (git repo)             │
│         + Git History (simple-git)               │
└─────────────────────────────────────────────────┘
```

---

## Integration Patterns Analysis

### Integration 1: MCP Server ↔ AI Client (stdio)

**Pattern: Subprocess spawning with JSON-RPC over stdin/stdout**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'ctxo', version: '1.0.0' });

// Register Logic-Slice tool
server.tool(
  'get_logic_slice',
  'Get dependency-aware context bundle for a symbol',
  { symbol: z.string(), depth: z.number().optional() },
  async ({ symbol, depth = 2 }) => {
    const slice = await buildLogicSlice(symbol, depth);
    return { content: [{ type: 'text', text: JSON.stringify(slice) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Critical rules for stdio MCP servers:**
- `stdout` is exclusively for JSON-RPC messages — **never** `console.log()` to stdout
- All debug/diagnostic output goes to `stderr` only
- Messages are **newline-delimited JSON** — no embedded newlines in payloads
- Lazy initialization: defer heavy work (index loading) until first tool call to minimize startup latency
- Tool annotations: set `readOnlyHint: true` on all Ctxo analysis tools

**Capability declaration pattern:**
```typescript
// Declare what Ctxo supports during handshake
const server = new McpServer({
  name: 'ctxo',
  version: '1.0.0',
  capabilities: {
    tools: { listChanged: true },     // tools can appear/disappear (e.g., when index completes)
    resources: { subscribe: true },   // clients can subscribe to resource changes
  }
});
```

_Sources: [MCP Transports Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) · [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [MCP Server Docs](https://ts.sdk.modelcontextprotocol.io/documents/server.html)_

---

### Integration 2: Ctxo ↔ Git History (simple-git)

**Pattern: Incremental commit history fetch for Why-Driven Context**

`simple-git` is the correct choice — full TypeScript types, Promise API, custom log format support.

```typescript
import simpleGit from 'simple-git';

const git = simpleGit('/path/to/repo');

// Fetch commit history for a specific file with custom format
const log = await git.log({
  file: 'src/payment/processPayment.ts',
  format: {
    hash: '%H',
    date: '%ai',
    message: '%s',
    author: '%an',
    body: '%b',
  },
  '--max-count': '20',
});

// Incremental: only fetch commits since last indexed commit
const sinceHash = getLastIndexedCommit(filePath);
const recentLog = await git.log({
  file: filePath,
  from: sinceHash,
  format: { hash: '%H', message: '%s', date: '%ai' },
});
```

**Anti-Pattern Memory integration:**
```typescript
// Detect revert commits — key signal for Anti-Pattern Memory
const revertCommits = log.all.filter(c =>
  c.message.toLowerCase().startsWith('revert') ||
  c.message.toLowerCase().includes('rollback')
);

// Extract the reverted commit hash from standard revert message format
// "Revert 'feat: add X'" → find original commit for context
```

**Git blame for Constraint Provenance:**
```typescript
// Map line numbers to commit hashes for constraint origin stories
const blame = await git.raw(['blame', '--porcelain', filePath]);
```

_Sources: [simple-git npm](https://www.npmjs.com/package/simple-git) · [simple-git TypeScript support](https://deepwiki.com/elastic/simple-git/8-typescript-support)_

---

### Integration 3: Ctxo ↔ Index Store (better-sqlite3)

**Pattern: Persistent symbol index with WAL mode and UPSERT incremental updates**

`better-sqlite3` is the right choice: synchronous API (simplifies MCP tool implementation), fastest SQLite binding for Node.js, embedded (no separate process).

```typescript
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

class CtxoIndex {
  private db: DB;

  constructor(indexPath: string) {
    this.db = new Database(indexPath);
    this.db.pragma('journal_mode = WAL');     // Concurrent reads during writes
    this.db.pragma('synchronous = NORMAL');   // Safe + fast
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id          TEXT PRIMARY KEY,
        file_path   TEXT NOT NULL,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL,          -- function | class | interface | type
        start_byte  INTEGER NOT NULL,       -- O(1) retrieval
        end_byte    INTEGER NOT NULL,
        last_modified INTEGER NOT NULL,
        signature   TEXT,                   -- For L2 progressive detail
        summary     TEXT,                   -- For L1 progressive detail (the Lede)
        blast_radius INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

      CREATE TABLE IF NOT EXISTS edges (
        from_id TEXT NOT NULL,
        to_id   TEXT NOT NULL,
        kind    TEXT NOT NULL,             -- imports | calls | extends | implements
        PRIMARY KEY (from_id, to_id, kind)
      );

      CREATE TABLE IF NOT EXISTS intent (
        symbol_id   TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        message     TEXT NOT NULL,
        author      TEXT,
        date        INTEGER,
        kind        TEXT DEFAULT 'commit', -- commit | antipattern | constraint
        PRIMARY KEY (symbol_id, commit_hash)
      );
    `);
  }

  // Incremental upsert — only updates changed files
  upsertSymbols(symbols: SymbolRecord[]) {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (id, file_path, name, kind, start_byte, end_byte, last_modified, signature, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        start_byte = excluded.start_byte,
        end_byte = excluded.end_byte,
        last_modified = excluded.last_modified,
        signature = excluded.signature,
        summary = excluded.summary
      WHERE excluded.last_modified > symbols.last_modified
    `);
    const upsertAll = this.db.transaction((items: SymbolRecord[]) => {
      for (const s of items) stmt.run(s.id, s.filePath, s.name, s.kind,
        s.startByte, s.endByte, s.lastModified, s.signature, s.summary);
    });
    upsertAll(symbols);
  }
}
```

**Blast radius query (pure SQL):**
```sql
-- Count all symbols that transitively depend on a given symbol
WITH RECURSIVE deps(id) AS (
  SELECT to_id FROM edges WHERE from_id = ? AND kind = 'imports'
  UNION
  SELECT e.to_id FROM edges e JOIN deps d ON e.from_id = d.id
)
SELECT COUNT(*) AS blast_radius FROM deps;
```

_Sources: [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) · [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) · [@types/better-sqlite3](https://www.npmjs.com/package/@types/better-sqlite3)_

---

### Integration 4: Ctxo ↔ File System (Chokidar v5)

**Pattern: TypeScript-aware incremental re-indexing on file change**

Chokidar v5 (ESM-only, Node.js ≥20). Use `@poppinss/chokidar-ts` for TypeScript-project awareness.

```typescript
import { watch } from '@poppinss/chokidar-ts';

// TypeScript-aware watcher — respects tsconfig.json includes/excludes
const watcher = watch('/path/to/repo', {
  tsConfigPath: '/path/to/repo/tsconfig.json'
});

watcher.on('source:change', async (filePath: string) => {
  // Only re-index the changed file and its direct dependents
  await reindexFile(filePath);
  await updateBlastRadiusForDependents(filePath);
});

watcher.on('source:add', async (filePath: string) => {
  await indexNewFile(filePath);
});

watcher.on('source:unlink', (filePath: string) => {
  removeFileFromIndex(filePath);
  // Surface dangling dependencies as warnings
  flagDanglingEdges(filePath);
});

watcher.startWatching();
```

**Git hook integration (post-commit):**
```bash
#!/bin/sh
# .git/hooks/post-commit
# Trigger Ctxo index update for staged files only
STAGED=$(git diff --name-only HEAD~1 HEAD --diff-filter=ACM)
echo "$STAGED" | xargs ctxo index --files
```

The file watcher handles dev-time changes; the git hook handles CI/CD and batch updates. Together they ensure the index is always current.

_Sources: [chokidar GitHub](https://github.com/paulmillr/chokidar) · [@poppinss/chokidar-ts npm](https://www.npmjs.com/package/@poppinss/chokidar-ts) · [Migrating chokidar 3→4](https://dev.to/43081j/migrating-from-chokidar-3x-to-4x-5ab5)_

---

### Integration 5: Ctxo ↔ Runtime Traces (OpenTelemetry) — Future V2

**Pattern: Execution-path slicing via OTel span correlation**

This is the foundation for **Execution-Path Slicing** (FP #2) from the brainstorming session. Deferred to V2 but the integration pattern is well-established.

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Must run BEFORE any application code
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();

// Custom span for business logic correlation
import { trace } from '@opentelemetry/api';
const tracer = trace.getTracer('ctxo-runtime-tracer');

// Wrap critical functions to capture execution paths
const span = tracer.startSpan('processPayment');
try {
  // business logic
} finally {
  span.end();
}
```

**Ctxo V2 integration point:** Collect OTel traces → correlate span names with AST symbol IDs → build "hot path" context bundles weighted by actual execution frequency.

_Sources: [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/) · [opentelemetry-js GitHub](https://github.com/open-telemetry/opentelemetry-js)_

---

### Full Integration Pipeline

```
Source Code Changes
        │
        ├─── [Dev-time] chokidar v5 / @poppinss/chokidar-ts
        │         └── file:change → reindexFile(path)
        │
        └─── [Commit-time] git post-commit hook
                  └── staged files → ctxo index --files

                          │
                          ▼
              ┌─────────────────────┐
              │   Parser Pipeline   │
              │  ts-morph (TS/JS)   │
              │  tree-sitter (rest) │
              │  Two-pass analysis  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   better-sqlite3    │
              │   WAL mode index    │
              │   UPSERT pattern    │
              │   Blast radius SQL  │
              └──────────┬──────────┘
                         │
                         ├── simple-git → intent layer
                         │   (commit history, revert detection)
                         │
                         ▼
              ┌─────────────────────┐
              │   MCP Server        │
              │   stdio transport   │
              │   JSON-RPC 2.0      │
              │   Tools/Resources   │
              └──────────┬──────────┘
                         │
                         ▼
              Claude Code / Cursor / AI Client
```

---

## Architectural Patterns and Design

### System Architecture: Hexagonal (Ports & Adapters)

Ctxo's core domain — Logic-Slice, Blast Radius, Intent Layer, Privacy Masking — must never depend on specific parsers, storage engines, or transport protocols. The architecture follows **Hexagonal (Ports & Adapters)** so any external dependency can be swapped without touching business logic.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CTXO CORE DOMAIN                         │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ LogicSlicer │  │ BlastRadius  │  │    IntentExtractor     │ │
│  │  (domain)   │  │  Calculator  │  │   (Why-Driven layer)   │ │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬────────────┘ │
│         │                │                       │              │
│  ┌──────▼────────────────▼───────────────────────▼────────────┐ │
│  │              PORT INTERFACES (abstractions)                 │ │
│  │  ILanguageAdapter  IIndexStore  IGitProvider  IMaskEngine   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                │               │              │
         ▼                ▼               ▼              ▼
  ┌─────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
  │  ADAPTERS   │  │   ADAPTERS   │  │ ADAPTERS │  │ ADAPTERS │
  │             │  │              │  │          │  │          │
  │ TypeScript  │  │  SQLite      │  │ simple-  │  │ Regex    │
  │ (ts-morph)  │  │  (better-    │  │ git      │  │ + ML     │
  │             │  │  sqlite3)    │  │          │  │ masking  │
  │ Go          │  │              │  │          │  │          │
  │ (tree-sitter│  │  In-Memory   │  │          │  │          │
  │  + gopls)   │  │  (session)   │  │          │  │          │
  │             │  │              │  │          │  │          │
  │ C#          │  │              │  │          │  │          │
  │ (tree-sitter│  │              │  │          │  │          │
  │  + Roslyn)  │  │              │  │          │  │          │
  └─────────────┘  └──────────────┘  └──────────┘  └──────────┘
         │
         ▼
  ┌─────────────────────────────────────┐
  │         MCP TRANSPORT LAYER         │
  │   StdioServerTransport (primary)    │
  │   StreamableHTTP (future cloud)     │
  └─────────────────────────────────────┘
```

**Why Hexagonal for Ctxo:**
- Adding a new language = write one adapter implementing `ILanguageAdapter` — core domain untouched
- Swapping SQLite for Neo4j (enterprise tier) = swap one adapter — zero core changes
- Testing = inject fake adapters — no real files, no real database, no real git

_Sources: [Hexagonal Architecture Node.js Dec 2025](https://medium.com/@shreevedhas/hexagonal-architecture-in-node-js-microservices-a-practical-guide-e3419f2c94b3) · [Clean Node.js Architecture](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/)_

---

### Language Adapter Plugin Architecture

Each language is a self-contained plugin implementing a typed interface. The plugin system is TypeScript-generic for compile-time safety.

```typescript
// Core port — the contract every language adapter must fulfill
interface ILanguageAdapter {
  readonly language: string;           // 'typescript' | 'go' | 'csharp' | ...
  readonly tier: 'full' | 'syntax';    // full = type-aware, syntax = tree-sitter only

  // Symbol extraction
  extractSymbols(filePath: string): Promise<Symbol[]>;

  // Dependency graph edges from a file
  extractImports(filePath: string): Promise<ImportEdge[]>;

  // Cross-file resolution (full-tier only)
  resolveImport?(importPath: string, fromFile: string): Promise<string | null>;

  // Type-aware contract extraction (full-tier only)
  extractContract?(symbolId: string): Promise<Contract | null>;

  // Supported file extensions
  readonly extensions: string[];
}

// Plugin registry — loaded lazily on first file encounter
class LanguageAdapterRegistry {
  private adapters = new Map<string, ILanguageAdapter>();

  register(adapter: ILanguageAdapter): void {
    for (const ext of adapter.extensions) {
      this.adapters.set(ext, adapter);
    }
  }

  // Lazy: adapter loaded only when a file with that extension is first seen
  getAdapter(filePath: string): ILanguageAdapter | null {
    const ext = path.extname(filePath);
    return this.adapters.get(ext) ?? null;
  }
}

// V1: Only TypeScript adapter registered by default
registry.register(new TypeScriptAdapter());  // ts-morph — full tier

// V1.5: tree-sitter fallback for all other extensions
registry.register(new TreeSitterAdapter(['go', 'cs', 'py', 'rs', 'java'])); // syntax tier

// V2: Rich adapters opt-in
registry.register(new GoAdapter());           // tree-sitter + gopls MCP — full tier
registry.register(new CSharpAdapter());       // tree-sitter + Roslyn LSP — full tier
```

**Plugin lifecycle:**
```
Plugin discovered → lazy-loaded on first file → initialize() → ready
File changes     → adapter.extractSymbols() → index updated
Session ends     → adapter.shutdown() → resources released
```

_Sources: [Plugin Architecture Node.js Expert Guide](https://www.n-school.com/plugin-based-architecture-in-node-js/) · [TypeScript Plugin System](https://github.com/gr2m/javascript-plugin-architecture-with-typescript-definitions)_

---

### Storage Architecture: Hybrid In-Memory + SQLite

Research confirms the optimal pattern for local code intelligence tools: **in-memory for active session traversals, SQLite for persistence**.

```
┌─────────────────────────────────────────────────────┐
│                  STORAGE LAYER                       │
│                                                     │
│  ┌─────────────────────┐   ┌─────────────────────┐  │
│  │   IN-MEMORY LAYER   │   │   SQLITE LAYER      │  │
│  │   (session-scoped)  │   │   (persistent)      │  │
│  │                     │   │                     │  │
│  │  Active graph for   │   │  Full symbol index  │  │
│  │  current session    │   │  Dependency edges   │  │
│  │                     │   │  Intent records     │  │
│  │  Blast radius cache │   │  Contract data      │  │
│  │                     │   │  Byte offsets       │  │
│  │  Query result cache │   │  Blast radius scores│  │
│  └──────────┬──────────┘   └──────────┬──────────┘  │
│             │                         │             │
│             └────────── sync ─────────┘             │
└─────────────────────────────────────────────────────┘

Startup:   Load hot symbols from SQLite → in-memory cache
Query:     Check in-memory first → SQLite fallback
Commit:    File changes → update SQLite → invalidate memory cache
Session:   Memory cleared on session end → SQLite persists
```

**SQLite schema design (final):**
```sql
-- Core tables
symbols   (id, file_path, name, kind, start_byte, end_byte,
           last_modified, signature, summary, blast_radius)
edges     (from_id, to_id, kind)           -- IMPORTS | CALLS | EXTENDS | IMPLEMENTS
intent    (symbol_id, commit_hash, message, author, date, kind)
contracts (symbol_id, inputs, outputs, side_effects, invariants)
sessions  (id, created_at, context_log)   -- Privilege log for auditing

-- Indexes
idx_symbols_file, idx_symbols_name, idx_edges_from, idx_edges_to
```

**Blast radius via recursive SQL (no graph library needed):**
```sql
WITH RECURSIVE dependents(id, depth) AS (
  SELECT from_id, 1 FROM edges WHERE to_id = ?
  UNION ALL
  SELECT e.from_id, d.depth + 1
  FROM edges e JOIN dependents d ON e.to_id = d.id
  WHERE d.depth < 10  -- max traversal depth
)
SELECT COUNT(DISTINCT id) AS blast_radius FROM dependents;
```

_Sources: [SQLite Graph Hybrid Architecture](https://www.sqliteforum.com/p/sqlite-and-graph-hybrids) · [LiteGraph AI-native DB](https://litegraphdb.com/) · [Code Intelligence MCP Patterns](https://github.com/DeusData/codebase-memory-mcp)_

---

### Lazy Initialization Architecture

Ctxo must start in < 100ms (stdio MCP subprocess startup constraint). All heavy work deferred.

```
MCP Client connects
       │
       ▼
Ctxo starts (< 100ms)
  - Load SQLite connection
  - Register language adapters (not initialized)
  - Announce capabilities to MCP client
  - Start background indexer (if index stale)
       │
       ▼
First tool call: get_logic_slice('processPayment')
  - Check SQLite index for 'processPayment'
  - If found: serve immediately (O(1) byte-offset fetch)
  - If not found: trigger lazy index of owning file
  - While indexing: stream partial results back
       │
       ▼
Background indexer (parallel, non-blocking)
  - Walk file tree incrementally
  - Parse + index files in priority order:
      1. Files recently modified (git status)
      2. Files in current git branch changes
      3. All remaining files (low priority)
  - Update SQLite + in-memory cache
  - Announce progress via MCP resource notification
```

**Index freshness strategy:**
```typescript
async function getIndexFreshness(repoPath: string): Promise<'fresh' | 'stale' | 'empty'> {
  const lastIndexed = await db.getLastIndexTime();
  const lastCommit  = await git.log({ maxCount: 1 });

  if (!lastIndexed) return 'empty';
  if (lastCommit.date > lastIndexed) return 'stale';
  return 'fresh';
}
// fresh  → serve from SQLite immediately
// stale  → serve from SQLite + background re-index
// empty  → lazy-build as requests arrive
```

_Sources: [MCP Lazy Loading Patterns](https://bytebridge.medium.com/managing-mcp-servers-at-scale-the-case-for-gateways-lazy-loading-and-automation-06e79b7b964f) · [MCP Architecture Overview](https://modelcontextprotocol.io/docs/learn/architecture)_

---

### Incremental Indexing Architecture

**Dual-trigger pattern** — dev-time watcher + commit-time hook:

```
DEV-TIME (long-running watcher):
  chokidar @poppinss/chokidar-ts
       │
       ├── source:change → reindexFile(path) + updateEdges(path)
       ├── source:add    → indexNewFile(path)
       └── source:unlink → removeFromIndex(path) + flagDanglingEdges(path)

COMMIT-TIME (one-shot hook):
  .git/hooks/post-commit
       │
       └── git diff HEAD~1 HEAD → ctxo index --files [staged-files]

BOTH triggers feed into the same indexing pipeline:
       │
       ▼
  1. Parse file with appropriate language adapter
  2. Extract symbols + compute byte offsets
  3. Extract import edges
  4. UPSERT into SQLite (only if file newer than last index)
  5. Recompute blast radius for changed symbols + their dependents
  6. Update in-memory cache (invalidate stale entries)
  7. Emit MCP resource change notification (if session active)
```

---

### Go Adapter Architecture (V2)

Go analysis uses a **composition pattern** — gopls MCP runs alongside Ctxo, both registered as MCP servers. Ctxo orchestrates, gopls provides Go semantics.

```
AI Client (Claude Code)
    │
    ├── calls ctxo:get_logic_slice('handler.go')
    │       │
    │       └── Ctxo fetches tree-sitter symbols for .go file
    │           + calls gopls:go_references for cross-file refs
    │           + adds intent layer (git history)
    │           + adds blast radius
    │           └── returns complete Logic-Slice
    │
    └── calls gopls:go_package_api('net/http')
            └── gopls handles directly (no Ctxo involvement)
```

**In user's MCP config:**
```json
{
  "mcpServers": {
    "ctxo":  { "command": "ctxo", "args": ["serve"] },
    "gopls": { "command": "gopls", "args": ["mcp"] }
  }
}
```

Ctxo is the orchestrator that adds what gopls lacks — intent, blast radius, privacy masking. gopls provides what Ctxo cannot do cheaply — full Go type resolution.

---

### C# Adapter Architecture (V2)

```
V1.5 (tree-sitter):
  .cs files → tree-sitter-c-sharp grammar
           → extract using directives, class/interface/method declarations
           → basic dependency graph (file-level, no type resolution)
           → feeds into Ctxo's standard Logic-Slice pipeline

V2 (Roslyn LSP):
  Ctxo spawns: dotnet /path/to/omnisharp/OmniSharp.exe
  Communicates: LSP JSON-RPC over stdio
  Gets:         textDocument/definition, textDocument/references,
                callHierarchy/incomingCalls, workspace/symbol
  Adds:         Ctxo intent layer + blast radius + privacy masking
  Prerequisite: dotnet SDK installed (confirmed acceptable)
```

**C# module resolution via .csproj:**
```typescript
// Parse .sln → find all .csproj files → map project references
// This gives the cross-project dependency graph even before Roslyn
async function parseSolution(slnPath: string): Promise<ProjectGraph> {
  const content = await fs.readFile(slnPath, 'utf-8');
  const projectRefs = extractProjectReferences(content); // regex on .sln format
  return buildProjectGraph(projectRefs);
}
```

---

### Security Architecture

```
Privacy-First Masking Pipeline (all context passes through):
  Raw context bundle
       │
       ▼
  Pattern scanner (regex: API keys, IPs, connection strings, JWTs)
       │
       ▼
  Contextual analyzer (is this a test fixture or production secret?)
       │
       ▼
  Confidence scoring (0.0 → 1.0, threshold configurable)
       │
       ├── confidence > 0.9 → auto-mask → [MASKED:api_key_sha256:abc123]
       ├── confidence 0.5-0.9 → flag for review → surface as warning
       └── confidence < 0.5 → pass through
       │
       ▼
  Privilege log entry (what was masked, why, confidence score)
       │
       ▼
  Sanitized context → MCP response
```

**Zero-trust context model (V2):**
- All context starts masked by default
- Explicit `GRANT symbol access for task` unlocks sensitive areas
- Session-scoped: grants expire when session ends
- Audit trail: every grant logged with task context

---

### Deployment Architecture

**V1 — Local-first, single binary:**
```
npm install -g ctxo          # or npx ctxo
ctxo init                    # creates .ctxo/ in repo root
                             # adds .git/hooks/post-commit

# MCP config (claude_desktop_config.json):
{
  "mcpServers": {
    "ctxo": { "command": "ctxo", "args": ["serve"] }
  }
}
```

Zero infrastructure. No Docker. No cloud. No external process (except dotnet for C# in V2).

**V2 — With language server composition:**
```json
{
  "mcpServers": {
    "ctxo":  { "command": "ctxo",  "args": ["serve"] },
    "gopls": { "command": "gopls", "args": ["mcp"] }
  }
}
```

**V3 — Ctxo Cloud (future):**
- Streamable HTTP transport instead of stdio
- Shared team index (pre-warmed, always current)
- Cross-repo dependency tracing
- Hallucination Fingerprinting data aggregation

---

### Architecture Decision Records (Key ADRs)

| # | Decision | Chosen | Rejected | Rationale |
|---|---|---|---|---|
| ADR-1 | Core architecture | Hexagonal | Layered MVC | Language adapters are external dependencies — must be swappable |
| ADR-2 | Primary parser (TS) | ts-morph | tree-sitter | Type awareness is non-negotiable for Logic-Slice accuracy |
| ADR-3 | Index store | SQLite (better-sqlite3) | Neo4j, in-memory only | Zero-setup, embedded, recursive SQL for blast radius |
| ADR-4 | MCP transport | stdio | HTTP | Local tool — client spawns Ctxo as subprocess |
| ADR-5 | Plugin system | Interface + registry | npm packages | Compile-time safety, no runtime loading overhead |
| ADR-6 | Go deep analysis | Compose with gopls | Re-implement | gopls v0.20 ships native MCP — free semantic analysis |
| ADR-7 | C# deep analysis | Roslyn LSP | OmniSharp Node | OmniSharp deprecated; Roslyn LSP is the future path |
| ADR-8 | Startup strategy | Lazy initialization | Eager | MCP subprocess must start in < 100ms |
| ADR-9 | Storage mode | Hybrid in-memory + SQLite | Pure SQLite | Session-speed traversals in memory, durability from SQLite |
| ADR-10 | Multi-language V1 | TypeScript only | All languages | Ship fast, prove value, expand via adapter pattern |

---

## Implementation Approaches and Technology Adoption

### Development Workflow

**Recommended toolchain for Ctxo:**

```bash
# Package manager
pnpm                          # Faster than npm, better monorepo support

# Build
tsup                          # Zero-config bundler — outputs both ESM + CJS
                              # Critical: Chokidar v5 is ESM-only (Node 20+)

# Testing
vitest                        # Faster than Jest, native ESM, TypeScript-first
@modelcontextprotocol/inspector  # Live UI for testing MCP tools interactively

# Release
release-it                    # Automates versioning + npm publish
```

**Project structure:**
```
ctxo/
├── src/
│   ├── core/                 # Domain logic (hex core)
│   │   ├── logic-slicer.ts
│   │   ├── blast-radius.ts
│   │   ├── intent-extractor.ts
│   │   └── privacy-masker.ts
│   ├── ports/               # Interfaces (ILanguageAdapter, IIndexStore...)
│   ├── adapters/
│   │   ├── language/        # TypeScript, Go, CSharp adapters
│   │   ├── storage/         # SQLite, in-memory adapters
│   │   ├── git/             # simple-git adapter
│   │   └── mcp/             # StdioServerTransport wiring
│   ├── index.ts             # MCP server entry point
│   └── cli.ts               # CLI entry point (ctxo init, ctxo index)
├── test/
│   ├── unit/                # Core domain tests (fake adapters)
│   ├── integration/         # Adapter tests (real SQLite, real git)
│   └── e2e/                 # Full MCP server tests (InMemoryTransport)
├── tsup.config.ts
├── vitest.config.ts
└── package.json
```

---

### Testing Strategy

**Three-layer testing pyramid:**

**Layer 1 — Unit tests (core domain):**
```typescript
// No real files, no real DB, no real git — pure domain logic
import { LogicSlicer } from '../src/core/logic-slicer';
import { FakeLanguageAdapter, FakeIndexStore } from './fakes';

test('logic slice includes transitive dependencies', async () => {
  const store = new FakeIndexStore([
    symbol('processPayment', ['TokenValidator', 'AuditLogger']),
    symbol('TokenValidator', []),
    symbol('AuditLogger', []),
  ]);
  const slicer = new LogicSlicer(store, new FakeLanguageAdapter());
  const slice = await slicer.slice('processPayment', { depth: 2 });
  expect(slice.symbols).toContain('TokenValidator');
  expect(slice.symbols).toContain('AuditLogger');
});
```

**Layer 2 — Integration tests (adapters):**
```typescript
// Real SQLite, real tree-sitter, real temp git repo
import Database from 'better-sqlite3';
import { SQLiteIndexStore } from '../src/adapters/storage/sqlite';

test('upsert updates blast radius correctly', () => {
  const db = new Database(':memory:');
  const store = new SQLiteIndexStore(db);
  store.upsertSymbols([...]);
  store.upsertEdges([{ from: 'A', to: 'B', kind: 'imports' }]);
  expect(store.getBlastRadius('B')).toBe(1);
});
```

**Layer 3 — E2E tests (full MCP):**
```typescript
// Uses MCP SDK InMemoryTransport — no process spawning
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCtxoServer } from '../src/index';

test('get_logic_slice returns dependencies', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = await createCtxoServer({ repoPath: TEST_REPO });
  await server.connect(serverTransport);

  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);

  const result = await client.callTool('get_logic_slice', { symbol: 'processPayment' });
  expect(result.content[0].text).toContain('TokenValidator');
});
```

**Coverage targets (vitest.config.ts):**
```typescript
coverage: {
  provider: 'v8',
  thresholds: { lines: 90, functions: 85, branches: 80, statements: 90 }
}
```

_Sources: [MCP Server Testing Guide](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/) · [Vitest MCP Best Practices](https://steipete.me/posts/2025/mcp-best-practices) · [TypeScript MCP E2E Testing](https://creati.ai/mcp/mcp-server-e2e-testing-example/)_

---

### Distribution and Packaging

**Package configuration:**
```json
{
  "name": "ctxo",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ctxo": "./dist/cli.js" },
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "engines": { "node": ">=20.0.0" },
  "files": ["dist/", "README.md"],
  "scripts": {
    "build": "tsup src/index.ts src/cli.ts --format esm,cjs --dts",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

**Node.js ≥20 requirement:** Non-negotiable — required by Chokidar v5 (ESM-only) and OTel `--import` flag. Clearly documented in README and enforced via `engines` field.

**ESM-first, CJS fallback:** `tsup` dual-outputs both. The MCP SDK and Chokidar v5 require ESM; older tooling may need CJS.

**Release automation:**
```bash
# Automated via release-it or GitHub Actions
npm version minor    # bumps package.json
git push --tags      # triggers CI publish workflow
```

_Sources: [TypeScript CLI Publishing 2026](https://dev.to/chengyixu/the-complete-guide-to-building-developer-cli-tools-in-2026-a96) · [ESM npm packaging 2025](https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing)_

---

### Implementation Roadmap

**Sprint 1 — Core Engine (V1 MVP):**
- [ ] Project scaffold (tsup + vitest + hexagonal structure)
- [ ] SQLite index store with schema + WAL mode
- [ ] TypeScript language adapter (ts-morph, two-pass analysis)
- [ ] Basic Logic-Slice (symbol + direct dependencies)
- [ ] MCP server with `get_logic_slice` tool (stdio transport)
- [ ] Git hook integration (post-commit incremental update)
- [ ] Unit + integration test suite

**Sprint 2 — Differentiation (V1 Full):**
- [ ] Blast radius scoring (recursive SQL)
- [ ] Progressive detail levels (L1→L4)
- [ ] Why-Driven Context (simple-git commit history)
- [ ] Anti-Pattern Memory (revert commit detection)
- [ ] Privacy masking pipeline
- [ ] Lazy initialization (< 100ms startup)
- [ ] Chokidar file watcher (dev-time incremental index)
- [ ] E2E test suite

**Sprint 3 — Multi-Language (V1.5):**
- [ ] tree-sitter-language-pack integration
- [ ] Go syntax adapter (tree-sitter-go)
- [ ] C# syntax adapter (tree-sitter-c-sharp)
- [ ] Language adapter registry (lazy loading)
- [ ] `ctxo init` CLI command (scaffolds config + git hook)

**Sprint 4 — Deep Analysis (V2):**
- [ ] gopls MCP composition (Go full-tier adapter)
- [ ] Roslyn LSP adapter (C# full-tier)
- [ ] Contract extraction (auto from TypeScript types)
- [ ] Contract violation detection
- [ ] Hallucination fingerprinting (session outcome logging)

---

### Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| ts-morph memory usage on large monorepos | High | Lazy project loading; per-tsconfig isolation |
| Startup latency (MCP subprocess) | High | Lazy init; SQLite cache; defer parsing to background |
| ESM/CJS compatibility (Chokidar v5) | Medium | tsup dual output; Node 20 hard requirement |
| gopls MCP API instability (experimental) | Medium | Version-pin gopls; tree-sitter fallback always available |
| C# Roslyn LSP migration (OmniSharp deprecated) | Medium | V1.5 ships tree-sitter only; Roslyn LSP in V2 |
| SQLite concurrency (multiple AI sessions) | Low | WAL mode handles concurrent reads; single writer |
| dotnet SDK version mismatches (C#) | Low | Document minimum version; graceful degradation to syntax-level |

---

### Success Metrics

| Metric | V1 Target | V2 Target |
|---|---|---|
| Startup time (MCP subprocess) | < 100ms | < 100ms |
| First context response (warm index) | < 500ms | < 200ms |
| First context response (cold index) | < 5s (lazy) | < 2s |
| Logic-Slice token reduction vs raw file | > 70% | > 85% |
| Blast radius accuracy | TypeScript only | TS + Go + C# |
| Test coverage | ≥ 85% | ≥ 90% |
| npm install → first useful context | < 30s | < 10s |

---

## Technical Research Conclusion

### Confirmed Technology Stack

```
Language:       TypeScript (Node.js ≥ 20)
Architecture:   Hexagonal (Ports & Adapters)
MCP SDK:        @modelcontextprotocol/sdk + StdioServerTransport
Parser (TS/JS): ts-morph (type-aware, cross-file)
Parser (other): tree-sitter + tree-sitter-language-pack (170+ langs)
Index Store:    better-sqlite3 (WAL mode, recursive SQL for blast radius)
Git:            simple-git (custom log format, incremental history)
File Watcher:   chokidar v5 + @poppinss/chokidar-ts
Go (V2):        tree-sitter-go (V1.5) + gopls MCP composition (V2)
C# (V2):        tree-sitter-c-sharp (V1.5) + Roslyn LSP (V2)
Runtime traces: @opentelemetry/sdk-node (V2 feature)
Testing:        vitest + InMemoryTransport (unit/integration/E2E)
Build:          tsup (ESM + CJS dual output)
Release:        release-it + npm publish
```

### The One-Liner

> **jCodeMunch gets the code. Ctxo gets the context.**

### Next Step

Research complete. The architecture is validated and implementation-ready. Proceed to `/bmad-create-architecture` (Winston) to produce the formal technical architecture document, then `/bmad-create-prd` (John) for product requirements.

---

**Research Completion Date:** 2026-03-28
**Steps Completed:** 6/6
**Sources Verified:** 40+ web sources, current as of March 2026
**Confidence Level:** High — all core technology choices validated by multiple independent sources and existing implementations

### Technology Adoption Trends

- **MCP**: Became Linux Foundation project Dec 2025. OpenAI, Microsoft, Google all adopted. Fastest-growing AI integration standard.
- **Tree-sitter**: GitHub uses it for symbol resolution at scale. Neovim made it default. Standard for editor-grade parsing.
- **ts-morph**: Active maintenance (v23+). Standard for TypeScript code intelligence tooling.
- **SQLite**: Resurgence as embedded analytics DB (libSQL, Turso). Ideal for local-first developer tools.
- **AST + graph DB pattern**: Multiple MCP servers already using ts-morph + Neo4j. Validated pattern for code intelligence.
