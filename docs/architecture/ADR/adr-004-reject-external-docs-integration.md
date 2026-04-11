# ADR-004: External Docs Integration Rejected

| Field        | Value          |
| ------------ | -------------- |
| **Status**   | Rejected       |
| **Date**     | 2026-04-11     |
| **Deciders** | Alper Hankendi |

## Context

Phase 5 of the competitive analysis roadmap proposed an "External Docs Integration" feature: fetching framework/library documentation from URLs, converting HTML to markdown, chunking into searchable segments, and indexing alongside code symbols in the FTS5 knowledge base. The AI assistant would then receive blended results from `get_ranked_context` — code symbols and doc chunks together.

Proposed scope:
- `index_url` MCP tool (fetch URL → markdown → chunk → index with 24h TTL cache)
- Markdown/HTML/JSON chunking algorithms (heading hierarchy, paragraph boundary splitting, 4KB max chunks)
- Blend doc chunks into `get_ranked_context` results with source tagging ("code" vs "docs")
- `--docs` flag on `ctxo index` for bulk URL indexing from config
- Optional enable during `ctxo init` for offline/air-gapped environments

Estimated effort: 1 week. Dependency: FTS5 search engine (ADR-003, currently on Hold).

## Decision

**Rejected.** We will not implement External Docs Integration.

## Rationale

### 1. LLMs already know popular framework APIs

Claude, GPT-4, and Gemini have extensive training data covering mainstream frameworks (Express, React, Next.js, Prisma, Django, Spring, etc.). The scenario where an AI assistant hallucinates an API because it lacks documentation access is rare for popular libraries and decreasing with each model generation.

### 2. WebFetch already solves the runtime case

Every major AI coding assistant (Claude Code, Cursor, Copilot) has a built-in `WebFetch` or equivalent tool that can retrieve documentation pages on demand. This is a single tool call — no indexing infrastructure needed. The AI already knows when it needs to check docs and can fetch them in-context.

### 3. Context windows make chunking unnecessary

With 1M token context windows (Claude Opus/Sonnet 4.6, Gemini), fetching an entire documentation page (5-10K tokens) is trivially cheap. The chunking, indexing, and retrieval pipeline that was necessary when context windows were 4K-8K tokens is now solving a problem that no longer exists.

### 4. Misaligned with Ctxo's mission

Ctxo is a **code intelligence** tool — symbol graphs, dependency analysis, blast radius, git intent. Document indexing is a **content management** problem with fundamentally different requirements (HTML parsing, heading hierarchy detection, staleness management, URL routing). Adding this capability dilutes the product focus without strengthening the core value proposition.

### 5. Offline/air-gapped environments are not a valid use case

The initial justification was offline environments where WebFetch is unavailable. However:
- If the environment has no internet, the AI assistant itself cannot reach its cloud API (Claude API, OpenAI API). No AI assistant = no Ctxo consumer.
- Self-hosted LLM setups (Ollama, vLLM) are extremely niche and these users typically build custom RAG pipelines tailored to their specific needs.
- Adding an `ctxo init` prompt for this scenario adds UX complexity for a near-zero user segment.

### 6. Dependency on FTS5 (Hold)

Quality doc search requires FTS5 with Porter stemming for natural language content. FTS5 is on Hold (ADR-003) pending monorepo demand. Building a feature on top of a deferred dependency creates a chain of unresolved work.

### 7. Maintenance cost exceeds value

The feature introduces ongoing maintenance burden:
- HTML→markdown conversion library dependency (fragile, frequent updates)
- URL TTL cache management (staleness, invalidation, storage cleanup)
- Doc version tracking (framework v4 docs vs v5 docs)
- Chunk boundary edge cases (code blocks split across chunks, nested headings)
- Test fixtures for diverse documentation formats

## Consequences

- Ctxo remains focused exclusively on code intelligence — no document indexing, no URL fetching, no content management
- AI assistants use their built-in WebFetch/browse capabilities for documentation needs
- The `get_ranked_context` tool searches code symbols only, not external content
- No `index_url` MCP tool, no `--docs` flag on `ctxo index`, no doc-related init prompts
- Phase 5 is removed from the roadmap permanently
- If a genuine need emerges (e.g., enterprise customers with strict network isolation AND self-hosted LLMs), this decision can be revisited as a separate product initiative, not a Ctxo core feature
