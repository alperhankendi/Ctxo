---
title: "find_shadow_specs"
description: "Business-looking code in a named context that no card rule pins yet, with fingerprints and resolutions: the Deletion Test (needs @ctxo/domain)."
---

# find_shadow_specs

A rule that lives only in code is a rule nobody can see. `if (loans.length >= 5)` is the loan limit whether or
not a card says so, and an agent that "simplifies" it breaks the business without breaking a test.
`find_shadow_specs` runs the Deletion Test on a context: it lists the code that looks like business logic (literal
comparisons, string normalization, retry and timeout values, endpoints, owned tables and procedures) and the rules
without tests, so each one can be pinned by a rule or recorded as not a rule.

::: info Needs @ctxo/domain
This tool is registered only when the opt-in [`@ctxo/domain`](/concepts/domain-knowledge) package is installed
(`ctxo install domain`). Ctxo has 14 core tools; 18 with the package: [`get_domain_context`](/mcp-tools/get-domain-context),
[`get_rule`](/mcp-tools/get-rule), `find_shadow_specs` and [`get_context_map`](/mcp-tools/get-context-map). It reads
`.ctxo/index/domain/shadow-candidates.json`, which `ctxo index` writes, and the context's `shadow-specs.yaml` on
every call.
:::

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `context` | string | yes | A context ID from the registry, for example `lending` |
| `kinds` | string[] | no | Candidate kinds to return: `literal-comparison`, `normalization`, `retry-timeout`, `endpoint`, `data-resource`, `procedure`, `rule-without-tests`. Omitted or an empty list returns all kinds |
| `includeResolved` | boolean | no | Also return resolved candidates with their resolution (default `false`) |

## Example

```json
{ "context": "lending" }
```

## Response

From the in-repo library-lending sample, TypeScript variant
(`packages/domain/test-fixtures/library-lending/typescript`), copied to a temp folder, made a git repository and
indexed with `ctxo index` (`_meta.workspace` trimmed). The sample's `docs/domain/lending/shadow-specs.yaml` already
resolves two candidates (shown with single-quoted fingerprints, the form to write):

```yaml
- fingerprint: 'literal-comparison | renewal-policy.canRenew | loanPeriods >= 2'
  resolution: { rule: LEND-05 }
- fingerprint: 'normalization | member-directory.memberKey | email.trim()'
  resolution: { notARule: "input cleanup, not a business rule" }
```

`{ "context": "lending" }` returns the four open candidates:

```json
{
  "context": { "id": "lending", "name": "Lending", "rung": "pinned" },
  "counts": {
    "open": 4,
    "resolved": 7,
    "byKind": {
      "literal-comparison": { "open": 0, "resolved": 1 },
      "normalization": { "open": 1, "resolved": 1 },
      "endpoint": { "open": 1, "resolved": 1 },
      "data-resource": { "open": 1, "resolved": 0 },
      "procedure": { "open": 1, "resolved": 0 },
      "rule-without-tests": { "open": 0, "resolved": 4 }
    }
  },
  "shadowSpecs": [
    {
      "fingerprint": "data-resource | dbo.loans | table dbo.loans",
      "kind": "data-resource",
      "file": "db/migrations/lending/001_create_loans.sql",
      "line": 1,
      "symbolId": "db/migrations/lending/001_create_loans.sql::dbo.loans::table",
      "text": "table dbo.loans",
      "source": "index"
    },
    {
      "fingerprint": "procedure | dbo.usp_closeloan | procedure dbo.usp_closeloan",
      "kind": "procedure",
      "file": "db/migrations/lending/001_create_loans.sql",
      "line": 10,
      "symbolId": "db/migrations/lending/001_create_loans.sql::dbo.usp_closeloan::procedure",
      "text": "procedure dbo.usp_closeloan",
      "source": "index"
    },
    {
      "fingerprint": "endpoint | LoansController.find | GET /loans/:id",
      "kind": "endpoint",
      "file": "src/lending/api/loans.controller.ts",
      "line": 8,
      "symbolId": "src/lending/api/loans.controller.ts::LoansController.find::method",
      "text": "GET /loans/:id",
      "detail": { "verb": "GET", "route": "/loans/:id" },
      "source": "native"
    },
    {
      "fingerprint": "normalization | member-directory.memberKey | email.trim().toLowerCase()",
      "kind": "normalization",
      "file": "src/lending/member-directory.ts",
      "line": 2,
      "symbolId": "src/lending/member-directory.ts::memberKey::function",
      "text": "email.trim().toLowerCase()",
      "detail": { "method": "toLowerCase" },
      "source": "native"
    }
  ],
  "resolutionFile": "docs/domain/lending/shadow-specs.yaml",
  "staleResolutions": [],
  "unknownRules": [],
  "resolutionProblems": [],
  "_meta": { "totalItems": 4, "returnedItems": 4, "truncated": false, "totalBytes": 1666 }
}
```

The seven resolved ones are hidden: four rules without tests carry an `Untested:` line, the `POST /loans` endpoint
is linked to LEND-03 by the `// rule: LEND-03` comment above it in `loans.controller.ts`, and the two entries above resolve the rest.
`{ "context": "lending", "kinds": ["literal-comparison"], "includeResolved": true }` shows one of them:

```json
{
  "context": { "id": "lending", "name": "Lending", "rung": "pinned" },
  "counts": { "open": 0, "resolved": 1, "byKind": { "literal-comparison": { "open": 0, "resolved": 1 } } },
  "shadowSpecs": [
    {
      "fingerprint": "literal-comparison | renewal-policy.canRenew | loanPeriods >= 2",
      "kind": "literal-comparison",
      "file": "src/lending/renewal-policy.ts",
      "line": 6,
      "symbolId": "src/lending/renewal-policy.ts::canRenew::function",
      "text": "loanPeriods >= 2",
      "detail": { "operator": ">=", "literal": "2" },
      "source": "native",
      "resolution": { "by": "shadow-specs", "rule": "LEND-05" }
    }
  ],
  "resolutionFile": "docs/domain/lending/shadow-specs.yaml",
  "staleResolutions": [],
  "unknownRules": [],
  "resolutionProblems": [],
  "_meta": { "totalItems": 1, "returnedItems": 1, "truncated": false, "totalBytes": 645 }
}
```

Change the limit in `renewal-policy.ts` to `loanPeriods >= 3` and run `ctxo index` again: the fingerprint changes,
so the candidate reopens and the old entry is stale (`ctxo verify-domain` check 12 warns about it):

```json
{
  "counts": { "open": 1, "resolved": 0, "byKind": { "literal-comparison": { "open": 1, "resolved": 0 } } },
  "shadowSpecs": [
    { "fingerprint": "literal-comparison | renewal-policy.canRenew | loanPeriods >= 3", "line": 6, "source": "native" }
  ],
  "staleResolutions": [{ "fingerprint": "literal-comparison | renewal-policy.canRenew | loanPeriods >= 2", "line": 3 }]
}
```

(trimmed to the changed fields). In the C# variant the same candidate is
`literal-comparison | RenewalPolicy.CanRenew | loanPeriods >= 2`.

| Field | Meaning |
| --- | --- |
| `context` | `id`, `name` and `rung` of the context |
| `counts` | `open`, `resolved` and `byKind` (`{ open, resolved }` for each kind that has candidates), after the `kinds` filter, counted per candidate |
| `shadowSpecs` | Open candidates (and resolved ones with `includeResolved`): `fingerprint`, `kind`, `file`, `line` (1-based), `symbolId` or `ruleId`, `text`, `detail`, `source`, `resolution` |
| `resolutionFile` | The context's `shadow-specs.yaml`, whether or not it exists |
| `staleResolutions` | Entries whose fingerprint matches no candidate: `fingerprint`, `line` |
| `unknownRules` | Entries naming a rule no card defines: `fingerprint`, `rule`, `line` |
| `resolutionProblems` | Problems of the file: `line`, `severity` (`error` or `warning`), `message` |

### Sources and resolutions

| `source` | Candidate |
| --- | --- |
| `native` | A fact the language plugin found |
| `text` | A fact the `@ctxo/domain` text scan found (no fact-capable plugin for the file) |
| `index` | A `table`, `view` (`data-resource`) or `procedure` symbol in a file the context owns |
| `card` | A rule of the context's card without tests (`rule-without-tests`) |

| `resolution.by` | Set when |
| --- | --- |
| `rule-link` | A rule's card `Code:` line or a `rule:` comment links to the candidate's symbol (`rules` lists them) |
| `untested` | The rule has an `Untested:` line (`reason`) |
| `shadow-specs` | An entry of `shadow-specs.yaml` has the candidate's fingerprint (`rule` or `notARule`) |

Fingerprints are `kind | symbol | normalized text` and do not depend on line numbers. Copy each one verbatim into
`shadow-specs.yaml` as a YAML single-quoted scalar (`fingerprint: '...'`, with a `'` inside written `''`): fact text
can hold double quotes, backslashes, `: ` or ` #`, which break a double-quoted or plain scalar.
`ctxo domain shadow-specs` prints them in that form. `%7C` and `%25` in the kind and symbol parts are an encoded `|`
and `%`. A multi-dot file name stays one segment of the symbol part (`loan.service.ts::withRetry` gives
`loan.service.withRetry`), and code outside every declaration has the basename alone (`app.ts` gives `app`,
`api.loan.service.ts` gives `api.loan.service`). Several candidates may
share one fingerprint (overloads, the same text twice), and one entry resolves them all. An entry with an unknown rule
that matches no candidate is listed in both `staleResolutions` and `unknownRules`. See
[the Deletion Test loop](https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md#the-deletion-test-loop)
for the fingerprint rules and the file format.

## Graceful misses

| Situation | Response |
| --- | --- |
| No registry | `{ "found": false, "hint": "No domain registry at docs/domain/contexts.yaml. Create one with \"ctxo init --domain\". To propose the domain config from this repository, run \"ctxo domain discover\"." }` |
| A registry with problems | `{ "found": false, "hint": "The domain registry at <path> has problems; run \"ctxo verify-domain\"." }` |
| No domain graph | `{ "found": false, "hint": "No domain graph yet; run \"ctxo index\". To propose the domain config from this repository, run \"ctxo domain discover\"." }` |
| The registry changed since the last index (the graph was built from another registry) | `{ "found": false, "hint": "The domain registry changed since the domain graph was built; run \"ctxo index\" to rebuild it (a running \"ctxo watch\" does this shortly after the edit)." }` |
| No loop artifacts (not indexed with this release, or removed because the last `ctxo index` built the graph but not the candidates or the maturity facts) | `{ "found": false, "hint": "No shadow-spec data yet; run \"ctxo index\"." }` |
| A context the registry does not name | `{ "found": false, "hint": "No context <id> in the registry; get_context_map lists the contexts." }` |
| A blank `context` (empty or whitespace) | Rejected by the input schema (an MCP input validation error) |
| A loop artifact built for another registry than the current graph, or cards changed since the last index | The answer, plus `stale: true` and a hint to run `ctxo index` |
| An unexpected failure | `{ "error": true, "message": "The shadow-spec data could not be read: ..." }` |

## Truncation

`shadowSpecs` is truncatable: when the response exceeds the limit it is cut and `_meta.hint` says how to narrow
the query (`kinds`). `staleResolutions`, `unknownRules` and `resolutionProblems` are capped at 50 at the source, with
`staleResolutionsTotal`, `unknownRulesTotal` and `resolutionProblemsTotal` when cut.

## CLI

`ctxo domain shadow-specs <context> [--kinds <k,...>] [--all] [--json]` prints the same body without `_meta`
(see [domain commands](/cli/domain#ctxo-domain-shadow-specs)). Under `ctxo watch`, candidates refresh shortly after a
card, glossary, registry or `shadow-specs.yaml` edit, and after `watch.snapshotMinFileChanges` re-indexed source files.

## When to use

- Before tightening a context's rung: what business logic does no rule state yet?
- After writing a rule: add a `Code:` line or a `rule:` comment, and the candidate resolves itself.
- In review: `includeResolved: true` shows what was marked `notARule` and why.

## Related tools

- [`get_rule`](/mcp-tools/get-rule): the rule a candidate belongs to, with its tests.
- [`get_context_map`](/mcp-tools/get-context-map): open candidates per context and what blocks `boring`.
- [`get_domain_context`](/mcp-tools/get-domain-context): the card of the context.
