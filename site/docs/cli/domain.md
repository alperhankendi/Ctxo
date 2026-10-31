---
title: "ctxo domain commands"
description: "verify-domain, contexts-touched, domain rules, domain discover, domain map and domain shadow-specs: the CLI of the opt-in @ctxo/domain package."
---

# Domain commands

These commands come with the opt-in `@ctxo/domain` package (`ctxo install domain`). They work on the
[domain knowledge layer](/concepts/domain-knowledge): a registry of named contexts, a markdown card per
context, and checks that keep the two in step with the code. Ctxo checks structure, never meaning.

Without the package, a known domain command name (`verify-domain`, `contexts-touched`, `domain`) prints an
install hint and exits 1, so CI never passes silently. With the package and no registry, the commands print
a hint and exit 0.

## ctxo verify-domain

The CI gate.

```shell
ctxo verify-domain [--since <ref>] [--boundaries by-rung|report] [--json]
```

| Flag | Description |
| --- | --- |
| `--since <ref>` | Also check that every context changed since the merge base of `<ref>` and `HEAD` has a card change or a `Domain-Unchanged` trailer (check 11) |
| `--boundaries <mode>` | `by-rung` or `report`; overrides `domain.boundaries.enforce` for this run |
| `--json` | Print the checks and the summary as JSON on stdout |

### The checks

| # | Check | Severity |
| --- | --- | --- |
| 1 | Registry schema valid, IDs unique and kebab-case, rungs valid; the `domain:` config valid | error |
| 2 | Every context with a rung above `fear` has a card; every listed card exists | error |
| 3 | Every `paths` glob matches at least one indexed file | error |
| 4a | No file owned by two contexts | error |
| 4b | No unowned file outside `unowned.allow` | `domain.coverage.unowned`: `warn` (default) or `error` |
| 5 | Cards have the five template H2 headings in order | error |
| 6 | Rule IDs match `domain.rules.idPattern`, are unique and match `rulePrefix`; IDs in structured test references exist in cards; every rule has a test link, a `Tests:` line or an `Untested:` line | error |
| 7 | Relative links and heading anchors in cards resolve (external URLs are not fetched) | error |
| 8 | Generated loader files match what `ctxo domain rules` would write, and no hand-written file blocks an expected path | error |
| 9 | `context-map.md` has a `Context` / `Rung` table that agrees with the registry (a missing file is a warning) | error |
| 10 | Boundaries: edges outside `contracts` | error for `blockingRungs` in `by-rung` mode, else warning |
| 11 | With `--since`: no unresolved touched contexts | error |
| 12 | Shadow-spec resolutions: a `shadow-specs.yaml` that does not parse; stale entries, unknown rules, files in folders of no context | error for a broken file, else warning |

Check 6 also covers the links of the domain graph:

- A `Tests:` or `Code:` value whose file does not exist (or names a directory) is an error:
  `LEND-03: Tests file "<file>" does not exist`, `LEND-03: Code file "<file>" does not exist`.
- A value with `::` is a symbol ID. One the index does not hold is a warning, and the link falls back to its file:
  `LEND-03: Code: "<value>" is not an indexed symbol; it links to its file`. C# symbol IDs differ between the
  Roslyn and tree-sitter tiers, so C# cards are safer with file paths in `Code:` lines.
- A `rule:` comment in production code that names an unknown rule warns (`rule: comment names unknown rule
  LEND-09`), but only when its prefix is a rule prefix, so `# rule: E501` in a linter comment stays silent.

Check 12 computes the shadow-spec candidates from the current index and repository (never from the stored
artifacts) and reads each context's `<registry folder>/<context>/shadow-specs.yaml`:

- A file that does not parse, is not a list, or cannot be read (outside the repository, over 1 MiB, binary, not
  valid UTF-8) is an error, and a broken item is an error (the valid items still apply).
- `stale resolution "<fingerprint>" matches no candidate of <id>` (warning): the code changed, so the entry no
  longer matches. Update the fingerprint from `ctxo domain shadow-specs <id>` or remove the entry.
- `resolution names unknown rule <ID>` (warning): no card defines the rule, so the entry resolves nothing.
- `<path> belongs to no context` (warning): a `shadow-specs.yaml` in a folder that is no context ID.
- `stale resolutions were not checked: <reason>` (warning): the candidates could not be built, so no entry can be
  called stale; given only when some `shadow-specs.yaml` has entries. The exit code stays 0 unless another finding
  is an error.

A registry that does not parse or validate skips checks 2 to 12. Day one is green: with the init skeleton (no contexts) or a partial registry,
unowned files and a missing context map are warnings until you set `domain.coverage.unowned: error`.

### Exit codes and `--json`

| Code | Meaning |
| --- | --- |
| `0` | No errors (warnings allowed), or no registry (a hint is printed) |
| `1` | At least one error, or a usage error |
| `2` | No index (run `ctxo index`), a base ref that cannot be found, a git failure, or an internal error (also a failure to build the domain graph that check 12 needs: checks 1 to 11 then do not report) |

The human report goes to stderr. With `--json`, stdout holds
`{ "registry", "checks", "summary", "exitCode" }` when the checks ran. **On exit 2 and on the no-registry path
stdout is empty** and the message is on stderr, so a script must read the exit code and not only parse stdout.

```shell
ctxo verify-domain --since origin/main --json > domain-report.json
echo "exit: $?"
```

In CI, check out with full history (`actions/checkout` with `fetch-depth: 0`); see
[CI integration](/reference/ci-integration#domain-gate).

## ctxo contexts-touched

Which named contexts a set of changes touched, and whether each is resolved.

```shell
ctxo contexts-touched [--since <ref>] [--committed | --staged] [--json] [--check]
```

| Flag | Description |
| --- | --- |
| `--since <ref>` | Compare against the merge base of `<ref>` and `HEAD` (default: `domain.guard.base`, else the merge base with `origin/HEAD`, else `main` or `master`) |
| `--committed` | Only the commits of the range, not the working tree |
| `--staged` | Only the staged changes |
| `--json` | Print the report as JSON on stdout |
| `--check` | Exit 1 when a touched context has no card change and no `Domain-Unchanged` trailer |

A context is touched when its `paths` hold a changed non-test file. Its `status` is `card-changed`,
`acknowledged` (a trailer in the range), `unresolved`, or `no-card` (a context at rung `fear` without a card
has nothing to fold into). Exit 2 means registry problems, a base that cannot be found, or a git failure.

A commit acknowledges a change that left behaviour as it was:

```text
Domain-Unchanged: lending (refactor only)
```

An empty commit (`git commit --allow-empty`) carries it just as well.

## ctxo domain rules

Generates one pointer file per context that has a card, so the agent reads the card before it edits the
context's code.

```shell
ctxo domain rules --write | --check
```

`--write` creates `.claude/rules/ctxo-context-<id>.md` (and `.cursor/rules/ctxo-context-<id>.mdc` when
`.cursor/` exists), rewrites outdated files and deletes stale ones. `--check` exits 1 when a generated file is
missing, outdated or stale, **or blocked**: a hand-written file without the generated marker at a path a
generated file belongs at. A blocked file is never overwritten; rename it or delete it, then run `--write`.
When only blocked files exist, `--check` prints that advice and not the "run --write" hint.

## ctxo domain discover

Proposes the conventions it finds in the repository: tracker prefixes (a prefix seen in 5 or more commit
subjects or branch names), `Trait` keys that carry rule-like IDs, test folders no default glob covers and test-kind
markers. Run it first when you adopt the domain layer or tune its config.

```shell
ctxo domain discover [--json] [--write]
```

It also proposes Characterization and Contract paths: folders named `Characterization`, `Contract`, `Contracts` or
`Contracts.Tests` that `domain.tests.characterization.paths` and `domain.tests.contract.paths` do not cover, as
`<folder>/**`, listed after the configured globs.

Beyond folders, it proposes test-kind markers for `domain.tests.characterization` and `domain.tests.contract`:

- `Trait`, `Category`, `TestCategory` and `Tag` values in test files that equal the kind or end with it, optionally
  followed by `Test` or `Tests` (`Contract`, `StorageContract`, `ContractTests`; not `ContractRenewal`), as
  `Trait:<Key>=<Value>` or `<Name>:<Value>` annotation matchers. Qualified names (`NUnit.Framework.Category`) count.
- Custom test attributes with the kind directly before a test attribute ending, such as `StorageContractFact` or
  `StorageContractTheory` (not `DataContract`), as annotation names.
- Test source files named `*ContractTests`, `*CharacterizationTests` (and `Test`), `*.contract.test.ts`,
  `*.contract.spec.ts` or `*_contract_test.go`, as `paths` globs such as `**/*ContractTests.cs`. A `names` marker
  matches test case names only, never file names. A file named after a non-test class of the index
  (`LoanContractTests.cs` next to `LoanContract`) tests an entity, so it is left out: the glob is proposed on the
  other files of its family, and not at all when every file is such a file. The printout and `--json`
  (`fileNames[].entityFiles`) name the files left out; the printout shows the first 5 and "and N more", `--json`
  lists them all.

Values a configured matcher or glob already covers are not proposed.

The rest is evidence only, with no config key:

- **External IDs.** Keys of a well-known external family (`ADR`, `BIP`, `CAPEC`, `CVE`, `CWE`, `EIP`, `GHSA`, `IEC`,
  `ISO`, `JSR`, `KEP`, `OWASP`, `PEP`, `RFC`) are references, not rule IDs: a plain mention never links as a rule ID,
  because only IDs that exist in a card link. They are counted, never proposed, and flagged when a family equals a
  card rule prefix. They no longer appear among the tracker-like keys.
- **GitHub issues.** Subjects with an issue reference (`#N` at the start, `(#N)`, or after fixes, closes, refs and
  similar words; not `step #1`), with their share and the `(#N)` squash suffixes, and `N-slug` or `type/N-slug`
  branches. With at least 5 references that outnumber every tracker-key family, the line names GitHub as the issue tracker.
- **Lowercase identifiers.** `name-NN` branch families seen in at least 3 branches, runtime names such as `node`
  left out; a family whose upper case is a known prefix is marked as a possible tracker key.

```text
  external IDs:       CWE (7), ISO (1)   <- references, not rule IDs; no config needed
  GitHub issues (#N): 40 of 72 subjects (56%), 40 with a (#N) suffix; 2 branches   <- the issue tracker (GitHub); no config key needed
  other identifiers:  acme-NN in 3 branches   <- lowercase identifiers; not proposed
Test kind markers     contract: values Trait:Category=StorageContract (2); attributes StorageContractFact (2); file names **/*ContractTests.cs (2)
```

It prints the evidence and a proposed config, and writes only with `--write`, which merges the proposal into
`.ctxo/config.yaml` (it adds values and removes none; remove a wrong value by hand, and expect discovery to propose it
again until the evidence changes). The printed config quotes every list value as a JSON string
(`paths: ["**/Contract/**", "**/Contracts.Tests/**"]`), so the block is valid YAML to paste. `--json` prints the
evidence and the proposal; the new evidence fields are `externalIds`, `githubIssues`, `otherIdentifiers` and
`testKindMarkers`, the new proposal fields `characterizationAnnotations` and `contractAnnotations`.

While the conventions are all at their defaults and the last `ctxo index` found that discovery would add something,
`ctxo domain map` and `get_context_map` add a hint that names this command; so do the "no registry" and "no domain
graph" answers of the domain tools.

## ctxo domain map

The context map from the last `ctxo index`: per context its rung, the suggested rung, rules with tests, open
shadow-spec candidates and the rung criteria. The CLI face of [`get_context_map`](/mcp-tools/get-context-map).

```shell
ctxo domain map [--json]
```

```text
[ctxo] Context map: 3 contexts (3 agree with the suggested rung)
  lending  rung pinned  suggested pinned  rules 5 (1 tested)  open candidates 4  pinned ✓ named ✗ bounded ✗ boring ✗
  billing  rung bounded  suggested bounded  rules 3 (0 tested)  open candidates 4  pinned ✓ named ✓ bounded ✓ boring ✗
  catalog  rung fear  suggested fear  rules 0 (0 tested)  open candidates 1  pinned ✗ named ✗ bounded ✗ boring ✗
```

`--json` prints the whole `get_context_map` body (no `_meta`, no truncation). The suggestion never changes the
registry.

## ctxo domain shadow-specs

The shadow-spec candidates of one context with their fingerprints and resolutions. The CLI face of
[`find_shadow_specs`](/mcp-tools/find-shadow-specs).

```shell
ctxo domain shadow-specs <context> [--kinds <k,...>] [--all] [--json]
```

| Flag | Description |
| --- | --- |
| `--kinds <k,...>` | Keep these kinds: `literal-comparison`, `normalization`, `retry-timeout`, `endpoint`, `data-resource`, `procedure`, `rule-without-tests`. Repeated options add up; an empty list means all |
| `--all` | Also list resolved candidates |
| `--json` | Print the `find_shadow_specs` body |

```text
[ctxo] lending: 2 open, 2 resolved shadow-spec candidates (docs/domain/lending/shadow-specs.yaml)
  open  endpoint  src/lending/api/loans.controller.ts:8  GET /loans/:id
      'endpoint | LoansController.find | GET /loans/:id'
  resolved  endpoint  src/lending/api/loans.controller.ts:14  POST /loans  [linked: LEND-03]
      'endpoint | LoansController.borrow | POST /loans'
  resolved  normalization  src/lending/member-directory.ts:2  email.trim()  [not a rule: input cleanup, not a business rule]
      'normalization | member-directory.memberKey | email.trim()'
  open  normalization  src/lending/member-directory.ts:3  trimmed.toLowerCase()
      'normalization | member-directory.memberKey | trimmed.toLowerCase()'
```

Both examples are `ctxo domain map` and `ctxo domain shadow-specs lending --kinds endpoint,normalization --all` on
the in-repo library-lending sample, TypeScript variant (`packages/domain/test-fixtures/library-lending/typescript`),
copied to a temp folder and indexed. A stale entry prints `  stale  '<fingerprint>' (line <n>)` and an entry naming
an unknown rule `  unknown rule  <ID>  '<fingerprint>' (line <n>)`.

Each candidate's fingerprint is on the line below it, printed as a YAML single-quoted scalar (`'...'`, a `'` inside
written `''`): paste it as it is after `fingerprint: ` in the context's `shadow-specs.yaml`, with
`resolution: { rule: <ID> }` or `resolution: { notARule: "<reason>" }`:

```yaml
- fingerprint: 'endpoint | LoansController.find | GET /loans/:id'
  resolution: { notARule: "read-only lookup" }
```

The quotes matter: fact text can hold double quotes, backslashes, `: ` or ` #`, which break a double-quoted or plain
scalar. `--json` prints the plain strings. The file is read on every run, so an
edit shows at once; the candidates themselves refresh on `ctxo index`, and under `ctxo watch` shortly after the edit. Output is not
masked, as for `ctxo contexts --json`.

**Exit codes (map and shadow-specs):**

| Exit | When |
| --- | --- |
| 0 | Done (stale data, such as cards edited since the last index, prints a hint and still exits 0), or no registry (a hint is printed) |
| 1 | Bad arguments, an unknown kind or an unknown context |
| 2 | Registry problems; no index data (`[ctxo] No context map yet; run "ctxo index".`, `[ctxo] No shadow-spec data yet; run "ctxo index".`, also after an index run that could not build the loop data and removed it); index data built from another registry (`[ctxo] The domain registry changed since the domain graph was built; run "ctxo index" to rebuild it (a running "ctxo watch" does this shortly after the edit).`); an internal error (`[ctxo] domain <name> failed: <message>`) |

## See also

- [Domain knowledge layer](/concepts/domain-knowledge) - the concepts and the adoption ladder
- [`ctxo init`](/cli/init) - `--domain` sets the layer up
- [Config schema](/reference/config-schema#domain) - the `domain:` keys
