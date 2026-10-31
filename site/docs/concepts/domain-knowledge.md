---
title: "Domain Knowledge Layer"
description: "Named contexts, markdown cards and deterministic checks that keep domain knowledge in step with code."
---

# Domain Knowledge Layer

An agent changes the lending rules in code, and the card that describes them stays as it was. The
domain knowledge layer is the opt-in `@ctxo/domain` package that closes that gap. A team names its
bounded contexts in a registry, keeps one markdown card per context in its own repository, and Ctxo
checks the structure around them: that the code a session changed has a card update (or a commit that says
nothing changed), that rule IDs exist, that links resolve, that edges respect the contracts between
contexts.

Ctxo never writes domain text. No LLM calls, no generated card text, no fetching of external documentation.
Everything it derives can be rebuilt from the repository and its git history.

```shell
ctxo install domain
ctxo init --domain
```

## The pieces

| Piece | What it is |
| --- | --- |
| Registry | `docs/domain/contexts.yaml`: each context has an `id`, `paths`, a `card`, a `rung` and optional `contracts` |
| Card | A markdown file with five headings (Language; Rules and invariants; Boundary contracts; Decisions; Open questions); rules are `### LEND-03 title` headings |
| Fold guard | A Claude Code hook that blocks a session once when its commits changed a context without a card update |
| Trailer | `Domain-Unchanged: <id> (reason)` in a commit: the code changed, the behaviour did not |
| Loader rules | Generated, path-scoped pointers (`.claude/rules`, `.cursor/rules`) that send the agent to the card |
| CI gate | `ctxo verify-domain`: twelve structural checks |
| Boundaries and drift | Edges between contexts, checked against `contracts`, and each context's share of cross-context edges over time |

## What the agent sees

With `@ctxo/domain` and a registry, core tools carry additive fields: `context` on symbols in
`search_symbols`, `get_blast_radius`, `find_importers`, `get_logic_slice` and `get_pr_impact`;
`contextBoundaryViolations` on `get_pr_impact`; `contextDrift` on `get_why_context`. A repository without
the package or a registry sees none of them. The fold guard and the loader rules are what get the agent to
read the card in the first place.

## The domain graph

`ctxo index` (and the post-commit hook) turns the registry, the cards and the glossary into one artifact,
`.ctxo/index/domain/graph.json`: contexts, rules, terms and decisions, linked to code by symbol IDs, each link with
the source that produced it.

| Link | From | Sources |
| --- | --- | --- |
| Rule to test | A rule ID in a test | xUnit `Trait("Rule", ...)`, NUnit `Category`, MSTest `TestCategory`, JUnit `Tag`; test titles and `rule:` comments; plain mentions in test files; the card's `Tests:` line |
| Rule to code | A rule ID in the card or the code | The card's `Code:` line; a `rule: LEND-03` comment above or inside a declaration |
| Decision to provenance | A dated card decision | Relative links to repository files; `#123`, tracker keys and URLs kept as strings, never fetched |
| Term to identifiers | A `**Term**` in `Language` or the glossary | Symbol and table names that carry the term's words |

Code metrics (PageRank, communities, snapshots, dead code, the safe-edit gate's percentiles) never read the graph, so
editing a card never shifts code clusters. A running `ctxo watch` rebuilds it about a second after a card, glossary,
registry or `shadow-specs.yaml` edit (see [`ctxo watch`](/cli/watch#domain-artifacts-ctxo-domain)); without it, the
tools answer from the last graph and say `stale: true` until the next `ctxo index` or commit.

With a graph the agent gets:

- `rulesAffected` and `cardsToUpdate` on `get_blast_radius`, `decisions` on `get_why_context`, a `cardExcerpt`
  on `get_context_for_task`, and `contextsTouched`, `cardsChanged` and `rulesWithoutTests` on `get_pr_impact`;
- two tools, [`get_domain_context`](/mcp-tools/get-domain-context) and [`get_rule`](/mcp-tools/get-rule):
  together with the two loop tools below, Ctxo has 14 core tools, 18 with `@ctxo/domain`;
- `get_ranked_context` with [`scope: "domain"`](/mcp-tools/get-ranked-context#the-domain-scope): BM25 over card
  sections, glossary entries and the provenance files the cards link to.

## The agentic loop

A rule that lives only in code is invisible to every card: `if (loans.length >= 5)` is the loan limit whether
or not anyone wrote it down. With `@ctxo/domain`, the TypeScript, C#, Java and Go plugins report such code as
facts (literal comparisons in conditions, string normalization, retry and timeout values, public endpoints), and a
text scan covers the other languages. `ctxo index` turns them into shadow-spec candidates per context, next to the
tables and procedures a context owns and the rules that have no tests.

- **The Deletion Test.** [`find_shadow_specs`](/mcp-tools/find-shadow-specs) lists a context's open candidates,
  each with a line-independent fingerprint. For each one, the agent or the owner finds or writes the rule that pins
  it ([`get_rule`](/mcp-tools/get-rule) shows its tests) and links it with a card `Code:` line or a `rule:`
  comment, or records the outcome in `docs/domain/<context>/shadow-specs.yaml` (the fingerprint single-quoted, as
  `ctxo domain shadow-specs` prints it)
  (`{ rule: LEND-03 }` or `{ notARule: "<reason>" }`). A changed literal changes the fingerprint, so the candidate
  reopens; `ctxo verify-domain` check 12 warns about entries that no longer match.
- **The context map.** [`get_context_map`](/mcp-tools/get-context-map) reports per context its rules and tests,
  crossings, co-change, drift and open candidates, the owner's rung and a suggested one, with the status of each
  criterion: `pinned` (characterization tests reach the main paths), `named` (the card's terms are in the
  glossary), `bounded` (contract tests reach the contract symbols, no violations), `boring` (every rule tested,
  nothing open). The suggestion never changes the registry.
- **CLI faces.** `ctxo domain shadow-specs <context>` and `ctxo domain map` print the same answers.

Ctxo still writes no domain text: every resolution and every rule is written by a person.

## Adoption ladder

A context's `rung` in the registry says how far it has come. No level requires code changes.

- level 0: install and index
- 1: registry with paths
- 2: cards
- 3: rule IDs and test links, through card `Tests:` lines, test names or framework tags
- 4: contracts and shadow-spec resolutions (`shadow-specs.yaml`, checked by `verify-domain` check 12)

`verify-domain` is green on day one: unowned files and a missing context map are warnings until the team
sets `domain.coverage.unowned: error`. Boundary violations are errors only for the rungs in
`domain.boundaries.blockingRungs` (default `bounded` and `boring`) unless the mode is `report`.

## One copy

A repository without `package.json` (a .NET repository, say) installs globally:
`npm i -g @ctxo/cli @ctxo/domain @ctxo/lang-sql`, so the MCP server, the hooks and the CLI run the same
copy. `ctxo init` from a global install writes MCP entries that call the global `ctxo`. The `install_copies`
doctor check warns when the MCP entry and the hooks start different copies.

## Where to go next

- [Domain commands](/cli/domain): `verify-domain`, `contexts-touched`, `domain rules`, `domain discover`, `domain map`, `domain shadow-specs`
- [`ctxo init`](/cli/init): the `domain` part and `--domain`
- [Config schema](/reference/config-schema#domain): the `domain:` keys
- The feature doc in the repository, [Ctxo domain conventions v1](https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md#ctxo-domain-conventions-v1): the registry JSON Schema, the card template, the rule ID rules and the trailer
- [ADR-018](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-018-domain-knowledge-layer.md): the design record
