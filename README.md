# Ctxo

**Code intelligence for AI agents — one call instead of hundreds.**

AI coding assistants waste context window reading files one by one, still missing dependencies. Ctxo gives them the full picture in a single MCP call: symbol graphs, blast radius, git intent, and risk scores.

```
Context per query set (full codebase investigation):

Manual   ████████████████████████████████████████  140,000 tokens
Ctxo     █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    2,900 tokens  → 48x less

Tool calls per query set:

Manual   ████████████████████████████████████████  409+ calls
Ctxo     █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    8 calls       → 51x fewer

Context after 10 investigation rounds:

Manual   ██████████████████████████████████████████ 140% — OOM at round 7
Ctxo     █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2.9% — 97% free for coding
```

## Quick Start

```Shell
# 1. Index your codebase
npx ctxo-mcp index

# 2. Add to your IDE's MCP config
# (see IDE Setup below)

# 3. Start using — your AI assistant now has 14 code intelligence tools
```

## IDE Setup

**Claude Code / Cursor / Windsurf / Cline** — `.mcp.json`:

```JSON
{ "mcpServers": { "ctxo": { "command": "npx", "args": ["-y", "ctxo-mcp"] } } }
```

**VS Code (Copilot)** — `.vscode/mcp.json`:

```JSON
{ "servers": { "ctxo": { "type": "stdio", "command": "npx", "args": ["-y", "ctxo-mcp"] } } }
```

**Zed** — `settings.json`:

```JSON
{ "context_servers": { "ctxo": { "command": { "path": "npx", "args": ["-y", "ctxo-mcp"] } } } }
```

## 14 Tools

| Tool                        | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `get_logic_slice`           | Symbol + transitive dependencies (L1-L4 progressive detail)      |
| `get_blast_radius`          | What breaks if this changes (3-tier: confirmed/likely/potential) |
| `get_architectural_overlay` | Project layer map (Domain/Infrastructure/Adapter)                |
| `get_why_context`           | Git commit intent + anti-pattern warnings (reverts, rollbacks)   |
| `get_change_intelligence`   | Complexity x churn composite score                               |
| `find_dead_code`            | Unreachable symbols, unused exports, scaffolding markers         |
| `get_context_for_task`      | Task-optimized context (fix/extend/refactor/understand)          |
| `get_ranked_context`        | BM25 + PageRank search within token budget                       |
| `search_symbols`            | Symbol name/regex search across index                            |
| `get_changed_symbols`       | Symbols in recently changed files (git diff)                     |
| `find_importers`            | Reverse dependency lookup ("who uses this?")                     |
| `get_class_hierarchy`       | Class inheritance tree (ancestors + descendants)                 |
| `get_symbol_importance`     | PageRank centrality ranking                                      |
| `get_pr_impact`             | Full PR risk assessment in a single call                         |

## Tool Selection Guide

```
Reviewing a PR?           → get_pr_impact
About to modify code?     → get_blast_radius → get_why_context
Understanding a symbol?   → get_context_for_task(taskType: "understand")
Fixing a bug?             → get_context_for_task(taskType: "fix")
Refactoring?              → get_context_for_task(taskType: "refactor")
Don't know the name?      → search_symbols or get_ranked_context
Finding unused code?      → find_dead_code
Safe to delete?           → find_importers
Onboarding?               → get_architectural_overlay → get_symbol_importance
```

## CLI Commands

```Shell
npx ctxo-mcp index                # Build full codebase index
npx ctxo-mcp index --check        # CI gate: fail if index stale
npx ctxo-mcp index --skip-history # Fast re-index without git history
npx ctxo-mcp watch                # File watcher for incremental re-index
npx ctxo-mcp init                 # Install git hooks (post-commit, post-merge)
npx ctxo-mcp status               # Show index manifest
npx ctxo-mcp sync                 # Rebuild SQLite cache from committed JSON
```

## Features

**Response Envelope** — All responses include `_meta` with item counts, truncation info, and drill-in hints. Large results auto-truncated at 8KB (configurable via `CTXO_RESPONSE_LIMIT`).

**Intent Filtering** — 4 tools accept `intent` parameter for keyword-based result filtering. `get_blast_radius(symbolId, intent: "test")` returns only test-related impacts.

**Tool Annotations** — All tools declare `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` for safe auto-approval in agent frameworks.

**Privacy Masking** — AWS keys, GCP service accounts, Azure connection strings, JWTs, private IPs, env secrets automatically redacted. Extensible via `.ctxo/masking.json`.

**Debug Mode** — `DEBUG=ctxo:*` for all debug output, or `DEBUG=ctxo:git,ctxo:storage` for specific namespaces.

**Per-tool savings vs manual approach:**

```
                        Manual Tokens   Ctxo Tokens   Savings
get_logic_slice         ████████ 1,950  █ 150         92%
get_blast_radius        ███ 800         ██ 600        25%
get_overlay             ████████████ 25K██ 500        98%
get_why_context         █ 200           █ 200          0%
get_change_intelligence ████████ 2,100  ▏ 50          98%
find_dead_code          █████████ 5,000 ████ 2,000    60%
────────────────────────────────────────────────────────────
TOTAL                   35,050 tokens   3,500 tokens  90%
                        329+ calls      6 calls       98%
```

## Agentic AI Usage

**Claude Agent SDK:**

```TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Analyze the blast radius of AuthService",
  options: {
    mcpServers: { ctxo: { command: "npx", args: ["-y", "ctxo-mcp"] } },
    allowedTools: ["mcp__ctxo__*"]
  }
})) { /* ... */ }
```

**OpenAI Agents SDK:**

```Python
from agents import Agent, Runner
from agents.mcp import MCPServerStdio

async with MCPServerStdio(params={"command": "npx", "args": ["ctxo-mcp"]}) as ctxo:
    agent = Agent(name="Reviewer", mcp_servers=[ctxo])
    result = await Runner.run(agent, "Review the PR impact")
```

See [Agentic AI Integration Guide](docs/agentic-ai-integration.md) for LangChain, raw MCP client, and CI/CD examples.

## Multi-Language Support

| Language              | Parser      | Tier   | Features                                                         |
| --------------------- | ----------- | ------ | ---------------------------------------------------------------- |
| TypeScript/JavaScript | ts-morph    | Full   | Type-aware resolution, cross-file imports, `this.method()` calls |
| Go                    | tree-sitter | Syntax | Structs, interfaces, functions, methods, import edges            |
| C#                    | tree-sitter | Syntax | Classes, interfaces, methods, enums, namespace qualification     |

## How It Works

Ctxo builds a **committed JSON index** (`.ctxo/index/`) that captures symbols, dependency edges, git history, and co-change data. The MCP server reads this index to answer queries — no runtime parsing, no external services.

```
.ctxo/
  index/          ← committed (per-file JSON, reviewable in PRs)
  .cache/         ← gitignored (local SQLite, auto-rebuilt)
  config.yaml     ← committed (team settings)
  masking.json    ← committed (custom masking patterns)
```

## Links

* [npm](https://www.npmjs.com/package/ctxo-mcp)
* [Changelog](CHANGELOG.md)
* [LLM Reference](llms-full.txt)
* [Validation Runbook](docs/runbook/mcp-validation/mcp-validation.md)
* [Architecture](docs/artifacts/architecture.md)
* [PRD](docs/artifacts/prd.md)

## License

MIT
