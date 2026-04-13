# Ctxo — Roadmap

> Single source of truth for **what's next** and **what we've explicitly decided not to do**.
>
> - **Shipped work** — see [CHANGELOG.md](../CHANGELOG.md) and [prd.md § Delivered Phases](artifacts/prd.md#delivered-phases-post-v1)
> - **Per-story delivery status** — see [epics.md § Delivery Status](artifacts/epics.md#delivery-status-as-of-2026-04-13)
> - **Architectural decisions behind deferrals/rejections** — see [ADRs](architecture/ADR/)
>
> Consolidated 2026-04-13 from `todo.md` (competitive analysis) + `docs/todo-visibility.md` + epic audit remaining items. Originals archived in [archive/todo/](archive/todo/).

---

## Active Development (next candidates)

Items on deck for v0.7.x / v0.8. No strict ordering — picked by impact + readiness.

### Code intelligence

- **Go full-tier via gopls MCP composition** — currently tree-sitter syntax-only; upgrade to type-aware cross-package resolution. Tracked under CLAUDE.md "Remaining".
- **Community detection / graph clustering** — Leiden/Louvain on the symbol graph to enrich `get_architectural_overlay` with data-driven layer detection and expose "god nodes" + "surprising connections" (cross-cluster edges). Complements PageRank; surfaces hidden coupling and architectural drift. Source: graphify competitive learnings.

### Platform & transport

- **Streamable HTTP transport** — for remote/cloud MCP usage. Today Ctxo is stdio-only. Needed for hosted scenarios and non-local clients.

### Ecosystem

- **Monorepo workspace support (Phase 1)** — pnpm-workspace.yaml auto-detection + per-package plugin aggregation. Forward-compat hooks landed in v0.7.0 (`IWorkspace`, parameterized plugin discovery); full implementation pending user demand. See [prd.md § Phase 3](artifacts/prd.md#phase-3-monorepo-workspace-support).

---

## Quality & verification backlog

Open loops from the Epic 6 audit (2026-04-13). Small-to-medium tasks; clearing these closes the "Cross-Client Compat & Release" epic cleanly.

- **Cross-client smoke-test matrix** — Auto-registration works (v0.5.1) but no captured smoke-test record. Run all 14 MCP tools against Claude Code / Cursor / VS Code Copilot / Windsurf against a reference fixture; commit the result into `docs/runbook/mcp-validation/test-sessions/`.
- **Published p95 baseline per MCP tool** — Benchmark harness exists (`pnpm --filter @ctxo/cli bench`); no baseline numbers in docs. Run once on a reference machine, publish table under [architecture.md](artifacts/architecture.md) NFR-1 budgets.
- **CI matrix coverage verification** — Confirm current GitHub Actions matrix covers Node 18 / 20 / 22 × macOS + Linux (test strategy claims this; verify + document).

---

## Deferred (not started, scope clarified)

Work that's been scoped and explicitly parked. Each has a known trigger to reactivate.

| Item | Source | Trigger to reactivate |
|---|---|---|
| **Phase 1 Tier 3 — FTS5 search** | todo.md Phase 1 Tier 3 | Monorepos or codebases with 25K+ symbols where in-memory BM25 degrades. See [ADR-003](architecture/ADR/adr-003-fts5-search-deferred.md). |
| **Python / Java plugins** (Phase B) | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | User demand post-v0.7; plugin protocol v1 already stable. |
| **Framework-aware analysis** (Spring / Django ORM) | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | Requires plugin protocol v2 (semantic hooks); out of scope until multiple plugins exist. |
| **Community plugin registry** | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | v0.8+; gate on first third-party plugin request. |
| **Automated release pipeline** | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | Currently using changesets + manual tag; automate when release cadence exceeds ~monthly. |
| **Go deep analysis / C# beyond current full-tier** | prd.md Language Matrix | After Go gopls composition lands (see Active). |

---

## Rejected (ADR-backed)

| Item | Decision | Reason |
|---|---|---|
| **Session continuity** (pre-compaction snapshots, SessionDB) | Rejected | Stateless tools make session state unnecessary. See [ADR-002](architecture/ADR/adr-002-reject-session-continuity.md). |
| **External docs integration** (URL fetch + index) | Rejected | LLMs + client-side WebFetch already solve this; misaligned with code intelligence mission. See [ADR-004](architecture/ADR/adr-004-reject-external-docs-integration.md). |
| **Webhook HTTP listener** (Epic 8) | Rejected | CI gate (`ctxo index --check`) + `post-commit` git hook deliver the same guarantee with zero server overhead. See [epics.md § Epic 8](artifacts/epics.md#epic-8-event-driven-index-updates-github--gitlab-integration). |

---

## Visibility & ecosystem (marketing / outreach)

Not product work, but tracked here so it doesn't get lost.

### MCP directory listings

- [ ] **awesome-mcp-servers** — open PR: [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) (Developer Tools section)
- [ ] **glama.ai** — submit: <https://glama.ai/mcp>
- [ ] **smithery.ai** — submit: <https://smithery.ai>
- [ ] **mcp.so** — submit: <https://mcp.so>
- [ ] **pulsemcp.com** — submit: <https://pulsemcp.com>
- [ ] **mcpservers.org** — submit: <https://mcpservers.org>
- [ ] **mcpmarket.com** — submit: <https://mcpmarket.com>
- [ ] **modelcontextprotocol/servers** — open PR: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

### GitHub repo polish

- [x] Topics (13 topics added)
- [x] Discussions enabled
- [x] Social preview uploaded
- [x] CONTRIBUTING.md
- [ ] Demo GIF / video embedded in README
- [ ] npm README badges (downloads, stars, license)
- [ ] Issue templates (bug report, feature request)
- [ ] PR template
- [ ] SECURITY.md
- [ ] FUNDING.yml (GitHub Sponsors)

### External

- [ ] "How I built Ctxo" post on Dev.to / Hashnode
- [ ] Reddit post (r/programming, r/MachineLearning)

---

## How this document is used

- **Adding work:** append under the right section with enough context that a cold reader knows why. Link to ADRs / epics / PRDs rather than re-explaining rationale.
- **Finishing work:** move the bullet out of this file into [CHANGELOG.md](../CHANGELOG.md); if it was a phase, also update [prd.md § Delivered Phases](artifacts/prd.md#delivered-phases-post-v1).
- **Rejecting or deferring work:** require an ADR or epic note before moving to "Deferred" / "Rejected". No silent deletions — history goes in archive.
