---
title: "get_domain_context"
description: "The domain card of the named context that owns a symbol or file (needs @ctxo/domain)."
---

# get_domain_context

Before an agent changes code in a named context, it should know the rules that code keeps, the words the team
uses for it, the contracts it may cross and the decisions behind it. `get_domain_context` returns all of that
for the context that owns a symbol or a file, from the domain graph `ctxo index` builds out of the team's cards.

::: info Needs @ctxo/domain
This tool is registered only when the opt-in [`@ctxo/domain`](/concepts/domain-knowledge) package is installed
(`ctxo install domain`). Ctxo has 14 core tools; 18 with the package (`get_domain_context`, [`get_rule`](/mcp-tools/get-rule),
[`find_shadow_specs`](/mcp-tools/find-shadow-specs) and [`get_context_map`](/mcp-tools/get-context-map)). It reads the registry (`docs/domain/contexts.yaml`) and the domain graph
(`.ctxo/index/domain/graph.json`); it never writes domain text and never fetches external links.
:::

## Parameters

| Name       | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `symbolId` | string | no       | A symbol ID (`<file>::<name>::<kind>`). Its file part selects the context; the symbol itself need not be in the index |
| `path`     | string | no       | A repo-relative file path (an absolute path inside the project also works), or a context's card path |

- `symbolId` wins over `path`. With neither, the tool lists every context.
- A file selects the one context whose `paths` match it. A card path selects the context of that card.

## Example

```json
{ "path": "src/lending/loan-limit.ts" }
```

## Response

The response below comes from the synthetic library-lending sample (TypeScript variant), trimmed.

```json
{
  "context": {
    "id": "lending",
    "name": "Lending",
    "rung": "pinned",
    "card": "docs/domain/lending/domain.md",
    "rulePrefix": "LEND",
    "paths": ["src/lending/**", "db/migrations/lending/**"]
  },
  "terms": [
    {
      "term": "Loan",
      "key": "loan",
      "definitions": [
        { "text": "one book held by one member until its due date.", "file": "docs/domain/lending/domain.md", "line": 7, "origin": "card" },
        { "text": "one copy lent to a member", "file": "docs/domain/glossary.md", "line": 7, "origin": "glossary" }
      ],
      "identifiers": [
        "db/migrations/lending/001_create_loans.sql::dbo.loans::table",
        "db/migrations/lending/001_create_loans.sql::dbo.usp_closeloan::procedure",
        "src/lending/loan-limit.ts::MAX_LOANS::variable",
        "src/lending/loan-service.ts::LoanService::class"
      ],
      "identifierCount": 4
    }
  ],
  "rules": [
    {
      "ruleId": "LEND-03",
      "title": "A member holds at most five loans",
      "line": 20,
      "tests": [
        {
          "file": "src/lending/__tests__/loan-limit.test.ts",
          "sources": [{ "source": "card-tests", "file": "docs/domain/lending/domain.md", "line": 21 }]
        },
        {
          "file": "src/lending/__tests__/loan-limit.test.ts",
          "symbolId": "src/lending/__tests__/loan-limit.test.ts::loan limit > LEND-03 rejects the sixth loan::function",
          "testName": "LEND-03 rejects the sixth loan",
          "sources": [{ "source": "test-title", "file": "src/lending/__tests__/loan-limit.test.ts", "line": 5 }]
        }
      ],
      "testCount": 2,
      "code": [
        {
          "file": "src/lending/loan-limit.ts",
          "symbolId": "src/lending/loan-limit.ts::canBorrow::function",
          "sources": [{ "source": "card-code", "file": "docs/domain/lending/domain.md", "line": 22 }]
        }
      ],
      "codeCount": 1
    },
    {
      "ruleId": "LEND-05",
      "title": "A loan can be renewed once",
      "line": 27,
      "untested": "no test covers it yet",
      "tests": [],
      "testCount": 0,
      "code": [],
      "codeCount": 0
    }
  ],
  "contracts": {
    "outbound": [{ "target": "billing", "files": ["src/billing/charge-service.ts"] }],
    "inbound": [],
    "text": "Lending asks Billing to charge a fine through the charge service only (`src/billing/charge-service.ts`). See the [context map](../context-map.md).",
    "references": ["src/billing/charge-service.ts"]
  },
  "decisions": [
    {
      "id": "decision:lending/2026-10-01-1",
      "date": "2026-10-01",
      "text": "Any unpaid fine blocks a new loan, whatever the amount (LEND-04). https://example.com/issues/45",
      "card": "docs/domain/lending/domain.md",
      "line": 38,
      "rules": ["LEND-04"],
      "provenance": [{ "kind": "external", "value": "https://example.com/issues/45" }]
    }
  ],
  "openQuestions": [{ "text": "Should renewals count as new loans?", "line": 43 }],
  "_meta": { "totalItems": 5, "returnedItems": 5, "truncated": false }
}
```

| Field | Meaning |
| --- | --- |
| `context` | `id`, `name`, `rung`, `card`, `rulePrefix` (when set) and `paths` from the registry |
| `terms` | The terms of the card's `Language` section and the glossary entries marked `(context: <id>)`, in card order. `definitions` keep their origin (`card` or `glossary`) and location. `identifiers` lists up to 15 symbols whose name carries the term (exact matches and types first); `identifierCount` is the count in the graph |
| `rules` | Every rule of the card in card order, with `untested` when the card gives a reason, up to 10 `tests` and 10 `code` links each, and the full `testCount` and `codeCount` |
| `contracts` | `outbound` (this context's registry `contracts`), `inbound` (other contexts whose contracts point here), the `Boundary contracts` text and the file `references` in it |
| `decisions` | The card's dated decisions, newest first, each with the rule IDs written in it and its provenance. Capped at 50, with `decisionsTotal` when cut |
| `openQuestions` | The card's open questions with their lines |

Each link carries its **sources**: how Ctxo knows it. Test links: `annotation` (an xUnit `Trait` rule key), `category`
(NUnit `Category`, MSTest `TestCategory`, JUnit `Tag`), `test-title` (a test title that starts with the ID),
`rule-comment` (a `rule: LEND-03` comment in a test file), `mention` (the ID in a test file) and `card-tests` (the
card's `Tests:` line). Code links: `card-code` (the card's `Code:` line) and `rule-comment` (a `rule:` comment in
production code, linked to the declaration right below it). A link with `fallback: true` names a symbol ID the
index does not hold, so it points at the file.

With neither parameter the response lists every context in registry order:

```json
{
  "contexts": [
    { "id": "lending", "name": "Lending", "rung": "pinned", "card": "docs/domain/lending/domain.md", "ruleCount": 5, "rulesWithTests": 1, "termCount": 4, "decisionCount": 2 },
    { "id": "billing", "name": "Billing", "rung": "bounded", "card": "docs/domain/billing/domain.md", "ruleCount": 3, "rulesWithTests": 0, "termCount": 1, "decisionCount": 0 },
    { "id": "catalog", "name": "Catalog", "rung": "fear", "ruleCount": 0, "rulesWithTests": 0, "termCount": 0, "decisionCount": 0 }
  ]
}
```

## Graceful misses

Every miss is `{ "found": false, "hint": "..." }`. An unexpected failure (an unreadable graph) is `{ "error": true, "message": "..." }`. The misses:

| Situation | Hint |
| --- | --- |
| No registry | `No domain registry at docs/domain/contexts.yaml. Create one with "ctxo init --domain". To propose the domain config from this repository, run "ctxo domain discover".` |
| The registry has problems | `The domain registry at <path> has problems; run "ctxo verify-domain".` |
| No graph yet | `No domain graph yet; run "ctxo index". To propose the domain config from this repository, run "ctxo domain discover".` |
| The registry changed since the last index | `The domain registry changed since the domain graph was built; run "ctxo index" to rebuild it (a running "ctxo watch" does this shortly after the edit).` |
| No context owns the file | `No named context owns src/main.ts.` |
| Two contexts own the file | `<path> belongs to 2 contexts (a, b); fix the registry, see "ctxo verify-domain".` |
| A path outside the project | `<path> is outside the project.` |
| A symbol ID without a file part | `<id> names no file; pass a symbol ID of the form file::name::kind, or a path.` |

When a card or the glossary changed after the last `ctxo index`, the answer still comes from the graph and adds
`stale: true` with the hint `Cards or the glossary changed since the domain graph was built; run "ctxo index" to refresh rule links (a running "ctxo watch" does this shortly after the edit).`

## Shared cards

When two contexts name the same card, the card's rules belong to the first of them by context id (`ctxo index`
and `ctxo verify-domain` warn once). The other context lists no rules and adds a hint that names the owning
context; it still lists the shared card's terms, decisions and open questions and counts them in its
`decisionCount`. Pass the card path to get the owner's view.

## Truncation

`contexts`, `terms`, `rules` and `openQuestions` are truncatable: when the response exceeds the limit
(`CTXO_RESPONSE_LIMIT`, 8 KB by default), the largest of them is cut and `_meta.hint` tells the agent where to
look next (for rules: `get_rule` with a ruleId). `decisions` is capped at the source instead.

## When to use

- Before changing code in a named context: what rules does this code keep, and which tests pin them?
- To learn the team's words for a part of the code (the terms and the symbols that carry them).
- Before crossing a context boundary: the contracts say which files of another context you may depend on.

## Related tools

- [`get_rule`](/mcp-tools/get-rule): one rule with every test, symbol, decision and provenance file.
- [`get_ranked_context`](/mcp-tools/get-ranked-context) with `scope: "domain"`: search the cards by words.
- [`get_blast_radius`](/mcp-tools/get-blast-radius): `rulesAffected` and `cardsToUpdate` for a change.
- [Domain knowledge](/concepts/domain-knowledge): the registry, the cards and the checks.
