# @ctxo/domain

## 0.17.2

### Patch Changes

- 18c48c0: `ctxo doctor` (`domain_registry`) now warns about every unknown key under `domain:` in `.ctxo/config.yaml`, named by dotted path (nested sections included) with a "did you mean" suggestion for a near miss, for example `domain.boundaires (did you mean domain.boundaries?)`. The loader is unchanged: it ignores the unknown key, so the key you meant to set keeps its default value.

## 0.17.1

## 0.17.0

### Minor Changes

- 301f045: Agents adopting the domain layer never found `ctxo domain discover`, and its proposal turned security IDs into tracker keys, missed the GitHub issue tracker and missed contract tests marked by attributes or file names. Now:

  - `@ctxo/cli`: when the domain layer is set up (a `domain` key in `.ctxo/config.yaml` or the default registry `docs/domain/contexts.yaml`, both committed; otherwise a loaded `@ctxo/domain`), the rules block `ctxo init` writes (compact and full) adds one line: "Adopting or tuning the domain layer? Run `ctxo domain discover` first (`--json` for the evidence, `--write` to merge the proposal)." Committed state decides first, so teammates with and without the package render the same block. Otherwise the block is unchanged under the same template version (a ctxo released before this treats the line as an edit and removes it). `ctxo doctor` (`ai_rules`) reports a block whose line does not match that state, and `ctxo doctor --fix` re-renders it.
  - The `ctxo-domain-fold` skill tells agents to run `ctxo domain discover` first when adopting or tuning the domain config. The `get_context_map` description names it, the "no registry" and "no domain graph" hints name it, and `get_context_map` and `ctxo domain map` add a hint while the conventions are all at their defaults and the last `ctxo index` found that discovery would add something (recorded in `maturity.json`).
  - Well-known external ID families (CWE, CVE, ADR, RFC, ISO, GHSA, OWASP and more) are reported as "external IDs: references, not rule IDs; no config needed" and never proposed. A plain mention of them never linked as a rule ID, since only IDs that exist in a card link; a family that equals a card rule prefix is flagged.
  - GitHub issue references (subjects, `(#N)` squash suffixes, `N-slug` branches) are reported with their share and named as the issue tracker when they are the largest family; lowercase `name-NN` branch families are reported as lowercase identifiers, marked as possible tracker keys when their upper case is a known prefix. Both are evidence only.
  - Characterization and contract tests are proposed from Trait or Category values that name the kind (`Trait:Category=StorageContract`), custom test attributes (`StorageContractFact`) and test file names (`**/*ContractTests.cs` as a path glob), not only from folders. A file named after a non-test class (`LoanContractTests.cs` next to `LoanContract`) and a value that only contains the word (`ContractRenewal`) are not proposed. `--write` still adds values and removes none; remove a wrong value by hand.
  - `--json`: external ID families no longer appear in `evidence.trackerKeys`. The evidence gains `externalIds`, `githubIssues`, `otherIdentifiers` and `testKindMarkers`, the proposal `characterizationAnnotations` and `contractAnnotations`; other fields are unchanged.

## 0.16.1

## 0.16.0

### Minor Changes

- 663f7ea: Business rules that live only in code are invisible to the cards an agent reads, so it can break them without breaking a test; this release finds them (#156 Phase 4). The TypeScript, C#, Java and Go plugins now detect literal comparisons, string normalization, retry and timeout values and public endpoints in every tier they have with one shared rule set (the analyzers collect evidence behind `--facts=`), and with `@ctxo/domain` and its registry file (`domain.registry`), or with `index.facts: true`, every indexed file of these languages gets a `facts` array (possibly empty) in its index JSON on the next re-index, so run a full `ctxo index` once after upgrading and again after adding the registry. Without a registry `@ctxo/domain` requests no facts, and the index is byte-identical to a run without the package. A fact extraction failure in any of the four plugins warns on stderr and gives `facts: []` for that file; TypeScript `typeof` guards give no facts; in `ctxo watch` a saved Go file takes its facts from the tree-sitter tier and a saved Java file reads the keep-alive analyzer's result without starting a second JVM. `@ctxo/domain` adds a text-scan fallback, `find_shadow_specs` and `get_context_map` (14 core tools, 18 with the package), `ctxo domain shadow-specs <context>`, `ctxo domain map`, `shadow-specs.yaml` resolutions and `ctxo verify-domain` check 12, plus the `domain.facts`, `domain.tests.characterization`, `domain.tests.contract` and `domain.rungs` config keys. Fingerprints go into `shadow-specs.yaml` as YAML single-quoted scalars (`- fingerprint: '...'`), the form `ctxo domain shadow-specs` prints. When `ctxo index` builds the domain graph but not the candidates or the maturity facts, it removes both loop artifacts, so the tools ask for a new `ctxo index` instead of serving old data. The `ctxo-domain-fold` skill marker moved to v0.16: run `ctxo init --domain` or `ctxo doctor --fix` after upgrading to refresh copies installed by 0.15.

## 0.15.0

### Minor Changes

- 2054a25: `@ctxo/domain` builds a domain graph from cards (rules, terms, decisions) linked to tests, code and provenance, adds `get_domain_context`, `get_rule` and a domain scope for `get_ranked_context`, and adds rule and card fields to `get_blast_radius`, `get_context_for_task`, `get_why_context` and `get_pr_impact` (#156). `@ctxo/cli` adds document search to its BM25 engine and three module seams (async enrichers, a token reservation for `get_context_for_task`, ranked-context scopes).

  Behaviour changes: `@ctxo/cli` no longer ships source maps in its npm package (about 2.1 MB to about 0.8 MB unpacked); `get_pr_impact` with an empty diff now carries `_meta` and goes through masking; `verify-domain` check 6 now errors on a `Code:` file that does not exist and on a `Tests:` or `Code:` value that names a directory, warns on a symbol ID the index does not hold (use `file#Name` for a plain test name, since `::` now marks a symbol ID) and on an unknown rule ID of a rule prefix in a production `rule:` comment; a `rule:` comment above a declaration links to that declaration; an H1 heading now ends a card's "Rules and invariants" section; and the `ctxo-domain-fold` skill marker moves to v0.15, so `ctxo doctor` reports older installed copies as outdated until `ctxo init --only domain` reinstalls them.

## 0.14.0

### Minor Changes

- 979bed8: The opt-in `@ctxo/domain` package adds a context registry, `contexts-touched`, a fold guard, `verify-domain`, loader rules and boundary checks by named context (#156). `@ctxo/cli` loads it through an internal API and supports one global install for MCP, hooks and CLI.
