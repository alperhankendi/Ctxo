# Real-world validation runbook

PRD §8.3 Step 40 — validate `@ctxo/cli` plus the three Tier 1 plugins on
real open-source projects before a stable v0.7.0 `latest` tag.

The intent is to catch scaling issues (large-repo index builds, edge-case
AST patterns, memory ceilings) that synthetic benchmarks miss.

## Candidate projects

Pick at least one per language. Current picks target mid-sized repos —
big enough to stress the indexer, small enough to inspect results by hand.

| Language | Repo | Size (approx) | Reason |
|---|---|---|---|
| TypeScript | [vitejs/vite](https://github.com/vitejs/vite) | ~80k LOC | Active, strict TS, packed with type-level tricks |
| TypeScript | [prisma/prisma](https://github.com/prisma/prisma) | ~200k LOC | Monorepo, heavy generics, would surface IWorkspace edge cases later |
| Go | [spf13/cobra](https://github.com/spf13/cobra) | ~20k LOC | Canonical CLI library; mix of interfaces + structs + methods |
| Go | [tidwall/gjson](https://github.com/tidwall/gjson) | ~5k LOC | Small; good smoke test for the Go plugin |
| C# | [MicrosoftDocs/csharpsamples](https://github.com/dotnet/samples) | varies | Small standalone projects suitable for Roslyn launcher |
| C# | [dapper-aspnet/Dapper](https://github.com/DapperLib/Dapper) | ~30k LOC | Mature .NET library; exercises Roslyn cross-file edges |

When Phase B lands: add Django PetClinic for Python and Spring PetClinic for Java.

## Procedure

1. Clone candidate into `/tmp/ctxo-validate/<repo>`
2. Install Ctxo in the project:
   ```bash
   cd /tmp/ctxo-validate/<repo>
   npm i -D @ctxo/cli@next @ctxo/lang-typescript@next  # or lang-go / lang-csharp
   ```
3. Build the index, recording wall time:
   ```bash
   time npx ctxo index
   ```
4. Run doctor and capture the report:
   ```bash
   npx ctxo doctor --json > doctor.json
   ```
5. Smoke the main MCP tools against a hand-picked hot symbol:
   ```bash
   npx ctxo search symbols "<hot-symbol-name>"
   # note symbolId
   # call get_blast_radius, get_logic_slice, get_context_for_task via your MCP client
   ```
6. Measure file + symbol count, compare against the benchmark SLOs from Step 39.

## Result template

Append a new section to `validation-results.md` (create if absent) with:

```markdown
### <repo> @ <commit-sha>
- Date: <YYYY-MM-DD>
- Plugin versions: @ctxo/cli@X.Y.Z, @ctxo/lang-<lang>@X.Y.Z
- Indexed files / symbols / edges: N / N / N
- Index build wall time: Xs (cold), Ys (incremental single-file)
- Doctor summary: N pass, N warn, N fail
- MCP tool p95 on hot symbol: logic_slice Xms, blast_radius Xms, ...
- Failures / surprises: bullet list, link to issue if filed
- Overall verdict: ✅ / ⚠ / ❌
```

## Gating v0.7.0 `latest` tag

At least one TS + one Go + one C# repo must pass before flipping the dist-tag
from `next` to `latest`. "Pass" = doctor returns 0 failures and all MCP tool
calls against hot symbols stay within the Step 39 p95 budgets.

## Follow-ups when a run flags an issue

- Index build OOM or > 5 min → `ctxo index --skip-history`, file bug with
  `ctxo stats` output
- Doctor orphaned-files fail → `ctxo doctor --fix` (implemented in Phase A Step 22)
- Missing symbols for a concrete pattern → attach the source file + expected
  symbolId to a GitHub issue, reproduce with a failing unit test in the
  relevant lang-* package

No results are recorded yet; this runbook is the scaffolding for the first
pass when we prepare the `latest` tag cut.
