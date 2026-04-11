# ADR-002: Session Continuity Rejected

| Field        | Value          |
| ------------ | -------------- |
| **Status**   | Rejected       |
| **Date**     | 2026-04-11     |
| **Deciders** | Alper Hankendi |

## Context

During competitive analysis, we evaluated a "Session Continuity" feature that some MCP servers implement to preserve AI assistant state across context window compactions. The feature involves:

1. **SessionDB** — a per-project SQLite database recording every tool call, its parameters, and a summary of results (15 event categories, 4 priority tiers)
2. **Pre-compaction snapshot** — a <2KB XML/JSON summary built before context overflow, containing analyzed symbols, key findings, and pre-built search queries
3. **Session resume** — after compaction, the snapshot is injected so the AI can recover state by querying the SessionDB instead of re-running tools
4. **`get_session_context`** **MCP tool** — a new tool the AI calls post-compaction to retrieve the snapshot

Estimated effort: 2 weeks (SessionDB schema, event extraction from all 14 tool handlers, snapshot builder, new MCP tool, new port interface, cleanup lifecycle).

## Decision

**Rejected.** We will not implement Session Continuity.

## Rationale

### 1. Ctxo tools are stateless and idempotent

Every Ctxo MCP tool reads from a committed JSON index and returns a deterministic result. After compaction, re-calling `get_blast_radius("AuthService")` costs <500ms and returns the exact same data. There is no accumulated session state to lose — the index *is* the state, and it survives compaction because it lives on disk.

Session Continuity solves a real problem for **stateful** tools (sandbox execution history, incremental file edits, multi-step workflows). For stateless, idempotent query tools like Ctxo's, re-querying is cheaper than maintaining a parallel persistence layer.

### 2. Context windows are growing, compaction is declining

* Claude: 1M tokens (Opus/Sonnet 4.6)
* Gemini: 1M tokens
* GPT-4: 128K tokens

Most developer sessions last 15-30 minutes. Compaction events are increasingly rare with these window sizes. Building infrastructure for a shrinking problem is poor ROI.

### 3. Platform hook dependency

The `preCompact` hook (required to build the snapshot before context is lost) is only available in Claude Code. Cursor, VS Code Copilot, Windsurf, Augment, Amazon Q, and other platforms Ctxo supports have no equivalent hook. Building a feature that works on 1 of 7 supported platforms contradicts our multi-platform strategy.

### 4. Complexity/value ratio is unfavorable

The implementation touches every layer of the architecture:

* New port interface (`ISessionPort`)
* New storage adapter (SessionDB with 3 tables, event extraction, cleanup lifecycle)
* Modifications to all 14 MCP tool handlers (event recording)
* New MCP tool (`get_session_context`)
* Snapshot builder with size budgeting

This is 2 weeks of work for a feature that benefits a narrow slice of users (long sessions on Claude Code only) when a 500ms re-query achieves the same outcome.

## Alternatives Considered

| Alternative                                       | Verdict                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| Full SessionDB + snapshot system                  | Rejected (this ADR)                                              |
| Lightweight "last 5 queries" in `_stats` response | Possible future addition, \~2 days effort, no new infrastructure |
| Rely on AI assistants' built-in memory/summary    | Current approach — works well enough with stateless tools        |

## Consequences

* Ctxo remains fully stateless — no session database, no event tracking, no compaction hooks
* AI assistants that experience compaction will re-call Ctxo tools as needed (<500ms each)
* The `ctxo stats` command (already implemented) tracks aggregate usage across sessions, which covers the observability need without per-query persistence
* If context windows shrink or a cross-platform `preCompact` standard emerges, this decision can be revisited

