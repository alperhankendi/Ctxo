---
title: "get_context_map"
description: "Every named context with its metrics, the owner's rung, a suggested rung and the status of each criterion (needs @ctxo/domain)."
---

# get_context_map

A registry says each context is `pinned` or `bounded`, but nothing checks that the code agrees. A context marked
`bounded` with no contract tests and two boundary violations gives an agent false confidence. `get_context_map`
puts every context on one page: its card, rules and tests, its crossings, co-change and drift, its open shadow-spec
candidates, the owner's rung and a suggested rung, with the status of every criterion, so the team sees what blocks
the next rung.

::: info Needs @ctxo/domain
This tool is registered only when the opt-in [`@ctxo/domain`](/concepts/domain-knowledge) package is installed
(`ctxo install domain`). Ctxo has 14 core tools; 18 with the package. It reads the artifacts `ctxo index` writes
under `.ctxo/index/domain/` (`maturity.json`, `shadow-candidates.json`, `boundaries.json`, `contexts.json`,
`history/`). The suggestion never changes the registry.
:::

## Parameters

None.

## Response

From the in-repo library-lending sample, TypeScript variant
(`packages/domain/test-fixtures/library-lending/typescript`), copied to a temp folder, made a git repository and
indexed with `ctxo index`. Lending is shown in full; Billing and Catalog are trimmed to their rungs and criteria
(`_meta.workspace` trimmed):

```json
{
  "contextMap": [
    {
      "id": "lending",
      "name": "Lending",
      "rung": "pinned",
      "suggestedRung": "pinned",
      "card": { "path": "docs/domain/lending/domain.md", "present": true },
      "rules": { "count": 5, "withTests": 1, "share": 0.2 },
      "tests": { "characterization": 1, "contract": 0 },
      "crossContextEdges": { "in": 2, "out": 2 },
      "coChange": { "pairs": 0, "top": [] },
      "drift": { "crossShare": { "current": 0.118 }, "movedFiles": 0, "distinctCommits": 1, "confidence": "low" },
      "boundaryViolations": { "total": 2, "errors": 0, "warnings": 2 },
      "shadowSpecs": { "open": 4, "resolved": 7 },
      "criteria": {
        "pinned": { "met": true, "mainPaths": 2, "reached": 2, "coverage": 1, "threshold": 0.8, "characterizationTests": 1, "unreached": [] },
        "named": { "met": false, "card": true, "terms": 4, "inGlossary": 1, "missing": ["Member account", "Account", "Fine"] },
        "bounded": { "met": false, "contractSymbols": 0, "reached": 0, "unreached": [], "boundaryViolations": 2 },
        "boring": { "met": false, "rules": 5, "rulesWithoutTests": 4, "openCandidates": 4 }
      },
      "boundariesKnown": true
    },
    {
      "id": "billing",
      "name": "Billing",
      "rung": "bounded",
      "suggestedRung": "bounded",
      "criteria": {
        "pinned": { "met": true, "mainPaths": 1, "reached": 1, "coverage": 1, "threshold": 0.8, "characterizationTests": 1, "unreached": [] },
        "named": { "met": true, "card": true, "terms": 1, "inGlossary": 1, "missing": [] },
        "bounded": { "met": true, "contractSymbols": 1, "reached": 1, "unreached": [], "boundaryViolations": 0 },
        "boring": { "met": false, "rules": 3, "rulesWithoutTests": 3, "openCandidates": 4 }
      }
    },
    {
      "id": "catalog",
      "name": "Catalog",
      "rung": "fear",
      "suggestedRung": "fear",
      "card": { "present": false },
      "rules": { "count": 0, "withTests": 0, "share": null },
      "boundaryViolations": { "total": 2, "errors": 0, "warnings": 2 }
    }
  ],
  "summary": { "contexts": 3, "agree": 3, "suggestedAbove": 0, "suggestedBelow": 0 },
  "settings": { "pinnedCoverage": 0.8 },
  "_meta": { "totalItems": 3, "returnedItems": 3, "truncated": false, "totalBytes": 2753 }
}
```

Lending's characterization test reaches both main paths, so `pinned` is met and agrees with the owner's rung.
Every higher criterion is still reported: `named` misses glossary entries for three card terms, `bounded` fails on
two boundary violations (a Catalog edge into Lending outside its contracts), and `boring` waits for four untested
rules and four open candidates. Billing's contract test reaches its one contract symbol, so `bounded` holds.

| Field | Meaning |
| --- | --- |
| `rung`, `suggestedRung` | The owner's rung from the registry, and the highest rung whose criterion and every lower one are met |
| `card` | `path` and `present` (the file exists inside the repository) |
| `rules` | `count`, `withTests`, `share` (3 decimals, `null` without rules) |
| `tests` | Characterization and contract test counts (`domain.tests.characterization` and `domain.tests.contract`) |
| `crossContextEdges` | Edges `in` and `out` across the boundary |
| `coChange` | Co-change `pairs` with files of other contexts (frequency 0.5 or more) and the `top` 10 |
| `drift` | `crossShare`, `movedFiles`, `distinctCommits`, `confidence` from the domain history; `null` without history |
| `boundaryViolations` | `total`, `errors`, `warnings`, leading in or out |
| `shadowSpecs` | `open` and `resolved` candidates (see [`find_shadow_specs`](/mcp-tools/find-shadow-specs)) |
| `criteria` | One status per rung, each with `met` and its counts (below) |
| `boundariesKnown` | `false` without `boundaries.json`: the edge and violation counts are unknown and `bounded` is not met |
| `summary` | `contexts`, `agree`, `suggestedAbove`, `suggestedBelow` |
| `settings` | `pinnedCoverage` |

### The criteria

| Rung | Met when |
| --- | --- |
| `pinned` | At least `pinnedCoverage` (default 0.8) of the main paths (the symbols of the context's `endpoint` facts and its contract symbols) are reached from a characterization test over `calls`, `uses`, `imports`, `extends` and `implements` edges. Without main paths, one characterization test is enough |
| `named` | A card exists, its Language section has at least one term, and every such term has a glossary entry |
| `bounded` | Every contract symbol is reached from a contract test and no boundary violation leads in or out (met with no contract symbols and no violations) |
| `boring` | Every rule has a test link and no shadow-spec candidate is open |

The ladder is cumulative: `named` counts only when `pinned` is met, and so on. Tests that reach code over HTTP
create no graph edges, so a context tested only that way can stay below `pinned`.

## Graceful misses

| Situation | Response |
| --- | --- |
| No registry, a registry with problems, or no domain graph | `{ "found": false, "hint": "..." }` (the same hints as [`find_shadow_specs`](/mcp-tools/find-shadow-specs#graceful-misses)) |
| The registry changed since the last index (the graph was built from another registry) | `{ "found": false, "hint": "The domain registry changed since the domain graph was built; run \"ctxo index\" to rebuild it (a running \"ctxo watch\" does this shortly after the edit)." }` |
| No loop artifacts (not indexed with this release, or removed because the last `ctxo index` built the graph but not the candidates or the maturity facts) | `{ "found": false, "hint": "No shadow-spec data yet; run \"ctxo index\"." }` |
| No `boundaries.json` | The map, with `boundariesKnown: false` and a hint |
| `domain.rules.trackerPrefixes`, `domain.tests.ruleTraitKeys`, `domain.tests.characterization` and `domain.tests.contract` all at their defaults, and the last `ctxo index` found that `ctxo domain discover` would add something (`maturity.json` `discovery.addsSomething`) | The map, plus the hint `The domain conventions are still at their defaults; run "ctxo domain discover" to propose them from this repository.` (after the boundaries hint when both apply) |
| A loop artifact built for another registry than the current graph, or cards changed since the last index | The map, plus `stale: true` and a hint to run `ctxo index` |
| An unexpected failure | `{ "error": true, "message": "..." }` |

## Truncation

`contextMap` is truncatable; an entry can reach 4 to 5 KB, so a large registry may be cut, with
`_meta.hint`: `Run "ctxo domain map --json" for the full context map.`

## CLI

`ctxo domain map [--json]` prints the whole map with no truncation (see [domain commands](/cli/domain#ctxo-domain-map)).
Under `ctxo watch`, the map refreshes shortly after a card, glossary, registry or `shadow-specs.yaml` edit, and after
`watch.snapshotMinFileChanges` re-indexed source files.

## When to use

- Planning which context to harden next, and what blocks its rung.
- Checking whether the registry's rungs still match the code.
- Before tightening `domain.boundaries.blockingRungs`.

## Related tools

- [`find_shadow_specs`](/mcp-tools/find-shadow-specs): the open candidates behind `boring`.
- [`get_domain_context`](/mcp-tools/get-domain-context): one context's card.
- [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) with `mode: "contexts"`: candidate contexts found from the code.
