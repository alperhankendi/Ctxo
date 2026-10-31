---
title: "Config Schema"
description: ".ctxo/config.yaml full reference."
---

# Config Schema

`.ctxo/config.yaml` is the committed team-level configuration for Ctxo. It is optional; every field has a default and the file itself can be absent. When invalid, the loader warns and falls back to defaults (warn-and-continue). Field-level problems surface through [`ctxo doctor`](/cli/doctor).

## File location

```
<repo-root>/.ctxo/config.yaml
```

The `.ctxo/` directory also holds the committed `index/` tree and the gitignored `.cache/` SQLite. See [`ctxo config.yaml`](/cli/config-yaml) for the CLI-facing view of this file.

## Full schema

```yaml
version: "1.0"

stats:
  enabled: true

index:
  ignore:
    - "packages/**/fixtures/**"
    - "tools/legacy-*/**"
  ignoreProjects:
    - "packages/experimental-*"
    - "examples/*"
  tests: []               # extra test-file globs, added to the shared defaults
  facts: false            # true asks plugins for code facts (protocol v2)

masking:
  clusterLabels: []       # globs; matching cluster labels become [masked-cluster-N]

watch:
  snapshotMinFileChanges: 5

gate:
  enabled: true
  sensitivity: balanced
  # minDependents: 3      # optional; overrides the sensitivity's floor
  # percentile: 15        # optional; overrides the sensitivity's top N%

cochange:
  maxCommits: 2000        # number or "all"
  # since: 12m            # optional; d, w, m, y
  maxFilesPerCommit: 30
  minShared: 2
  include: []
  exclude: []

communities:              # symbol-level Louvain
  resolution: 1.0
  godNodeMinBridged: 3
  godNodeMaxResults: 25

contextsView:             # candidate contexts (file level)
  weights: { dependency: 1.0, coChange: 1.0, data: 0 }
  exclude: []
  hubs: { auto: true, topPercent: 1, minDependents: 10, paths: [] }
  resolution: 1.0
  minCandidateFiles: 3
  technicalTerms: []      # replaces the default list

domain:                   # read only when @ctxo/domain is installed
  registry: docs/domain/contexts.yaml
  coverage:
    unowned: warn         # warn | error
  boundaries:
    enforce: by-rung      # by-rung | report
    blockingRungs: [bounded, boring]
  rules:
    idPattern: "^[A-Z][A-Z0-9]*-\\d+$"
    trackerPrefixes: []
  tests:
    ruleTraitKeys: [Rule]
    characterization:
      annotations: ["Trait:Kind=Characterization", "Tag:characterization"]
      paths: ["**/Characterization/**"]
      names: ["[characterization]"]
    contract:
      annotations: ["Trait:Kind=Contract", "Tag:contract"]
      paths: ["**/Contract/**", "**/Contracts.Tests/**"]
      names: ["[contract]"]
  rungs:
    pinnedCoverage: 0.8
  facts:
    trivialLiterals: [0, 1, -1, null, true, false, ""]
    normalizationMethods: [ToLower*, ToUpper*, Trim*, Normalize, toLowerCase, toUpperCase, trim, strings.ToLower, strings.TrimSpace, equalsIgnoreCase]
    textScanExtensions: [.dart, .ex, .exs, .groovy, .kt, .kts, .php, .py, .rb, .rs, .scala, .swift]
  guard:
    enabled: true
    # base: origin/main   # optional
    subagents: false
```

## Fields

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `version` | string or number | `"1.0"` | Schema version marker. Forward-compatible; unknown values are accepted. |
| `stats.enabled` | boolean | `true` | Session recording opt-out. Set `false` to disable local stats capture. |
| `index.ignore` | string[] | `[]` | Picomatch globs applied to file paths **after** `git ls-files`. |
| `index.ignoreProjects` | string[] | `[]` | Picomatch globs applied to workspace roots. Skipped workspaces are never enumerated. |
| `index.tests` | string[] | `[]` | Extra test-file globs added to the shared default list. Test files are never nodes of the contexts view. Test-framework annotations also mark test files; see [Test files](#test-files). Plugins receive the defaults plus these globs as `PluginContext.testGlobs`, so TypeScript test blocks follow them too. No `!` negation: a negated entry is skipped and `ctxo doctor` warns. |
| `index.facts` | boolean | `false` | Ask plugins for code facts (protocol v2). Sets `capabilities.facts`, so `ctxo index` and `ctxo watch` call `extractFacts` on plugins that implement it and write the results into the file's index JSON under `facts`. JSON only; SQLite is unchanged. A fact-capable plugin that finds nothing writes `facts: []`. The TypeScript, C#, Java and Go plugins implement `extractFacts`; an installed `@ctxo/domain` requests facts whatever this says, once its registry file (`domain.registry`) exists; without a registry it requests none. |
| `masking.clusterLabels` | string[] | `[]` | Picomatch globs matched against community and candidate-context labels. A matching label is replaced with `[masked-cluster-N]` in the responses of `get_architectural_overlay`, `get_blast_radius`, `get_pr_impact` and `get_why_context`, so sensitive folder names never reach the agent. |
| `watch.snapshotMinFileChanges` | integer >= 1 | `5` | `ctxo watch` recomputes the community snapshot only after this many distinct files were re-indexed since the last one. Raise it on large repositories, where a recompute blocks for about a second. |
| `gate.enabled` | boolean | `true` | Enable or disable the safe-edit guard PreToolUse hook. `false` also makes `ctxo init` write the full rules block for Claude Code, and `ctxo doctor` stops expecting the guard. |
| `gate.sensitivity` | `strict` \| `balanced` \| `lenient` | `balanced` | How aggressively the guard flags high-impact symbols. Sets `minDependents` and `percentile` (see [the levels](#gate-sensitivity-levels)). |
| `gate.minDependents` | integer >= 0 | from `sensitivity` (`3` for `balanced`) | Minimum confirmed + likely dependents before the guard can fire. Overrides the sensitivity's floor. |
| `gate.percentile` | integer 1 to 100 | from `sensitivity` (`15` for `balanced`) | The symbol must be in the top N% of the repository by PageRank. Overrides the sensitivity's percentile. |
| `cochange.maxCommits` | positive integer or `"all"` | `2000` | Co-change window: the last N non-merge commits from HEAD. Independent of `ctxo index --max-history`. |
| `cochange.since` | string (`30d`, `2w`, `12m`, `1y`) | unset | Also limit the window by age, counted back from HEAD's committer date (never the wall clock). Applies together with `maxCommits`. |
| `cochange.maxFilesPerCommit` | positive integer | `30` | A commit touching more analysed files than this is skipped as a mass change and counted in `massSkipped`. |
| `cochange.minShared` | positive integer | `2` | A file pair becomes an entry only after this many shared commits. |
| `cochange.include` | string[] | `[]` | Picomatch globs for extra **tracked** files that no language plugin indexes (for example scripts) to analyse for co-change. |
| `cochange.exclude` | string[] | `[]` | Picomatch globs for indexed files to leave out of co-change. Also removes files that `include` added. |
| `communities.resolution` | number > 0 | `1.0` | Louvain resolution for symbol-level communities: higher gives more, smaller communities. |
| `communities.godNodeMinBridged` | integer >= 1 | `3` | Minimum number of communities a symbol must bridge to count as a god node. |
| `communities.godNodeMaxResults` | integer >= 0 | `25` | Maximum number of god nodes reported. |
| `contextsView.weights.dependency` | number >= 0 | `1.0` | Weight of the dependency signal in a file-pair edge. |
| `contextsView.weights.coChange` | number >= 0 | `1.0` | Weight of the co-change signal in a file-pair edge. |
| `contextsView.weights.data` | number >= 0 | `0` | Weight of the data signal (`reads`, `writes`, `executes` edges between a file and the `.sql` file that defines the object) in a file-pair edge. At `0`, shared tables are reported but never pull candidates together. |
| `contextsView.exclude` | string[] | `[]` | Picomatch globs for files to leave out of the file graph. |
| `contextsView.hubs.auto` | boolean | `true` | Detect hubs automatically (fan-in and god nodes). |
| `contextsView.hubs.topPercent` | number > 0 and <= 100 | `1` | A file is a fan-in hub when it is in the top N% of files by dependents. |
| `contextsView.hubs.minDependents` | integer >= 1 | `10` | Minimum distinct dependent files for a fan-in hub. |
| `contextsView.hubs.paths` | string[] | `[]` | Picomatch globs for files that lose all their edges (configured hubs). |
| `contextsView.resolution` | number > 0 | `1.0` | Louvain resolution for the file graph. |
| `contextsView.minCandidateFiles` | integer >= 1 | `3` | Candidates with fewer files fold into the neighbour with the strongest weight. |
| `contextsView.technicalTerms` | string[] | built-in list | Words dropped from candidate terms (`Service`, `Repository`, `Controller`, `Handler`, `Manager`, `Dto`, `Impl`, `Async`). Replaces the default list. |
| `domain.registry` | string | `docs/domain/contexts.yaml` | Path of the context registry, relative to the repository root. |
| `domain.coverage.unowned` | `warn` \| `error` | `warn` | Severity of `verify-domain` check 4b: indexed files that belong to no context and are not in `unowned.allow`. |
| `domain.boundaries.enforce` | `by-rung` \| `report` | `by-rung` | `by-rung`: an edge outside the contracts is an error when either context's rung is in `blockingRungs`, else a warning. `report`: always a warning. |
| `domain.boundaries.blockingRungs` | string[] of rungs | `[bounded, boring]` | Rungs (`fear`, `pinned`, `named`, `bounded`, `boring`) that make a boundary violation an error in `by-rung` mode. |
| `domain.rules.idPattern` | regular expression | `^[A-Z][A-Z0-9]*-\d+$` | Shape of a rule ID in a card. |
| `domain.rules.trackerPrefixes` | string[] (`^[A-Z][A-Z0-9]*$`) | `[]` | Issue-tracker prefixes. A plain mention of an ID with such a prefix never links to a rule or raises an unknown-ID error; only structured references count. |
| `domain.tests.ruleTraitKeys` | string[] | `[Rule]` | `Trait` annotation keys whose value is a rule ID, for example `[Trait("Rule", "LEND-03")]`. |
| `domain.tests.characterization.annotations` | string[] | `[Trait:Kind=Characterization, Tag:characterization]` | Annotations that mark a characterization test: `Name`, `Name:value` (any argument) or `Name:key=value` (the first two arguments or a named one); ASCII case ignored in keys and values. |
| `domain.tests.characterization.paths` | string[] (globs) | `[**/Characterization/**]` | Test files under these globs hold characterization tests. |
| `domain.tests.characterization.names` | string[] | `[[characterization]]` | A marker in a test's name or declared title. |
| `domain.tests.contract.annotations` | string[] | `[Trait:Kind=Contract, Tag:contract]` | The same for contract tests. |
| `domain.tests.contract.paths` | string[] (globs) | `[**/Contract/**, **/Contracts.Tests/**]` | The same for contract tests. |
| `domain.tests.contract.names` | string[] | `[[contract]]` | The same for contract tests. |
| `domain.rungs.pinnedCoverage` | number from 0 to 1 | `0.8` | Share of a context's main paths (endpoint fact symbols and contract symbols) that characterization tests must reach for the suggested rung `pinned`. |
| `domain.facts.trivialLiterals` | array of numbers, strings, booleans, `null` | `[0, 1, -1, null, true, false, ""]` | Literals that never make a `literal-comparison` fact. Typed: the string `"0"` is not the number `0`. Handed to every plugin as `config.facts`. |
| `domain.facts.normalizationMethods` | string[] | the spec list above | Methods that make a `normalization` fact: `Name` exact, `Name*` prefix, `q.Name` only for calls written `q.Name(...)`. |
| `domain.facts.textScanExtensions` | string[] (`.ext`) | the list above | Extensions of tracked files no plugin indexes that the `@ctxo/domain` text scan reads for facts (lower-cased, deduplicated). |
| `domain.guard.enabled` | boolean | `true` | `false` turns the domain fold guard off. |
| `domain.guard.base` | string (a ref) | unset | Base ref of the branch range for the guard and for `contexts-touched` without `--since`. Else the merge base with `origin/HEAD`, else `main` or `master`. |
| `domain.guard.subagents` | boolean | `false` | Also run the guard on `SubagentStop`. |

### domain

The `domain` section is read by [`@ctxo/domain`](/concepts/domain-knowledge); without the package it is ignored. Each invalid key falls back to its default and is reported by [`ctxo verify-domain`](/cli/domain) (check 1) and by `ctxo doctor` (`domain_registry`), not by the core config check. An unknown key under `domain:` (a typo such as `domain.boundaires` or `domain.rules.trackerPrefix`) is ignored, so the key you meant to set keeps its default value; `ctxo doctor` (`domain_registry`) warns about each unknown key by dotted path, with a "did you mean" suggestion for a near miss. `ctxo verify-domain` does not report unknown keys. `ctxo init --domain` writes the defaults and never changes an existing value. `ctxo domain discover --write` adds `domain.rules.trackerPrefixes`, `domain.tests.ruleTraitKeys`, `domain.tests.characterization.paths`, `domain.tests.characterization.annotations`, `domain.tests.contract.paths`, `domain.tests.contract.annotations` and `index.tests` values and removes none (remove a wrong value by hand; discovery proposes it again until the evidence changes).

### cochange

The `cochange` section controls the co-change matrix (`.ctxo/index/co-changes.json`) that `ctxo index` builds from one `git log` pass. The matrix feeds `get_blast_radius`, `get_pr_impact`, `get_context_for_task`, `ctxo blast-radius` and the safe-edit guard.

- **Window.** `maxCommits` takes the newest N non-merge commits from HEAD (`"all"` takes every one). `since` narrows that to commits made within the duration before HEAD's committer date: `d` days, `w` weeks, `m` calendar months, `y` calendar years. When both are set, both apply. The same HEAD and config always give the same matrix. `commitsScanned` counts every non-merge commit of the repository, so in a monorepo a numeric `maxCommits` covers fewer relevant commits than its value suggests.
- **Which files count.** The files Ctxo indexes, plus tracked files matching `include`, minus files matching `exclude`. `exclude` is applied last, so it also vetoes files that `include` added. Deleted files drop out, and renames are followed.
- **Which commits count.** Merge commits are left out of the log. A commit whose remaining file count exceeds `maxFilesPerCommit` is skipped and counted in `massSkipped`. A pair needs `minShared` shared commits and `shared / min(countA, countB) >= 0.1`.
- **Overrides.** `ctxo index --cochange-commits <n|all>` and `--cochange-since <duration>` override `maxCommits` and `since` for one run. An invalid value exits with an error instead of running a different window.
- **Recorded.** The applied window is written to `co-changes.json` under `window` (`maxCommits`, `since`, `head`, `commitsScanned`, `commitsUsed`, `massSkipped`, `maxFilesPerCommit`, `minShared`).
- **Sparse checkout.** Files outside the cone are absent from the matrix, and their committed index entries are never pruned.

`ctxo index --max-history` still controls how many commits each file keeps in `intent[]`, and nothing else.

### communities

Tunes the symbol-level Louvain detection that `ctxo index` runs (`communities.json`, god nodes, drift and boundary signals). The defaults are the values it always used. Raise `resolution` for more, smaller communities; lower `godNodeMinBridged` to report more god nodes.

### contextsView

Tunes the [contexts view](/cli/contexts) that `ctxo index` writes to `.ctxo/index/contexts-view.json`.

- **Graph.** Nodes are indexed non-test files (see [Test files](#test-files)), minus `index.ignore` and `contextsView.exclude`, plus co-change-only files added by `cochange.include`. An edge between two files has weight `weights.dependency * dep + weights.coChange * co + weights.data * data`, where `dep` is the log-normalised count of distinct code edges, `co` is the pair's co-change frequency and `data` is the log-normalised count of distinct data edges (`reads`, `writes`, `executes`) between the two files. Setting `weights.coChange: 0` clusters by dependencies alone; the co-change signal depends on the [`cochange`](#cochange) window. `weights.data` defaults to `0`: shared tables are a boundary finding (`sharedTables`, `dataResources`), not a reason to merge candidates. Data edges never count in `crossEdges` or as hub dependents.
- **Hubs.** With `hubs.auto`, a file is a hub when it holds a god node, or when it is in the top `hubs.topPercent`% of files by distinct dependents and has at least `hubs.minDependents`. Every edge touching a hub is damped by `1 / log2(2 + dependents)`. Files matching `hubs.paths` lose all their edges. Hubs are listed separately and assigned to the candidate of their strongest remaining edge.
- **Clustering.** `resolution` is the Louvain resolution. Groups with fewer than `minCandidateFiles` files fold into the neighbour with the strongest total weight; files left with no edge are `unclustered`.
- **Terms.** `technicalTerms` replaces the default list of words dropped from candidate terms and collisions. A word is dropped anywhere in a type name, not only as a suffix.
- **Tuning.** Change one setting at a time and run `ctxo index` then `ctxo contexts`. The defaults were validated on a production repository; see the addendum of [ADR-016](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md).

### Test files

The contexts view leaves test files out. A file is a test file when one of the shared default globs or an `index.tests` glob matches it, or when any symbol in it carries a test-framework annotation. The annotation names match exactly: `Fact`, `Theory`, `SkippableFact`, `SkippableTheory`, `Test`, `TestCase`, `TestCaseSource`, `TestFixture`, `TestMethod`, `DataTestMethod`, `TestClass` (xUnit, NUnit and MSTest, as the [C# plugin](/languages/csharp#attribute-annotations) reports them).

- An annotated file is a test file whatever its path.
- Once any `.cs` file in the index carries annotations, a file matched only by the name globs `**/*Test.cs` or `**/*Tests.cs` is a test file only if it has a test annotation. Without that, it becomes a production node. Folder globs such as `**/tests/**` and `**/*.Tests/**` still decide on their own.
- A repository whose C# files have no annotations in the index keeps the plain glob behaviour.

Three cases need an `index.tests` glob: test classes that use only other attributes (for example FsCheck `[Property]`), test classes whose attributes derive from a known one when the C# file is indexed by the tree-sitter tier (the Roslyn tier resolves attribute base types), and an unannotated `*Tests.cs` file in a bare capital `Tests/` or `Test/` folder (`**/tests/**` is case-sensitive, so that folder is not a default test glob).

After upgrading `@ctxo/lang-csharp`, run a full `ctxo index` once. An incremental run (`--files`, `--commit`, the post-commit hook) annotates only the files it re-indexes, while the contexts view already counts the index as annotated, so name-only `*Test.cs` / `*Tests.cs` matches that were not re-indexed show up as production files until the full run.

`index.tests` serves the contexts view and the plugins: `ctxo index` and `ctxo watch` hand every plugin the default test globs followed by the valid `index.tests` globs as `PluginContext.testGlobs`, so `@ctxo/lang-typescript` indexes the `describe`, `it` and `test` blocks of a file only an `index.tests` glob names (re-index after a change). The [data-resource tie-break](/reference/symbol-ids#several-definitions-of-one-object) uses the default test globs only; to keep a test copy of a schema out of it, use `index.ignore`.

```yaml
index:
  tests:
    - "**/Tests/**"
    - "src/Lending.Properties/**"
```

### gate.sensitivity levels

| Level | PageRank percentile | Min dependents floor | Use case |
| --- | --- | --- | --- |
| `strict` | top 30% | 2 | Large shared codebases; flag nearly anything with dependents |
| `balanced` | top 15% | 3 | Default - catches genuinely high-impact symbols without too much noise |
| `lenient` | top 5% | 5 | Only block edits to truly critical symbols (god nodes, public APIs) |

Run `ctxo gate --preview` after changing `sensitivity` to see which symbols would be flagged.

Unknown fields at the root are ignored for forward compatibility. Unknown fields **inside** the `stats`, `index`, `masking`, `watch`, `gate`, `cochange`, `communities` or `contextsView` sections (and inside `contextsView.weights` and `contextsView.hubs`) are rejected as schema violations (typos surface immediately).

## Glob matching rules

`index.ignore`, `index.ignoreProjects`, `index.tests`, `cochange.include`, `cochange.exclude`, `contextsView.exclude` and `contextsView.hubs.paths` all use [picomatch](https://github.com/micromatch/picomatch) with `{ dot: true }`.

- Patterns are matched against **repo-relative, forward-slash paths**. Backslashes are normalised before matching.
- `index.ignore` runs per file, after the git-tracked file list is produced.
- `index.ignoreProjects` runs against workspace roots during discovery. A matched workspace is never visited, and its plugin dependencies are never imported.
- Each pattern is matched on its own and a path matches when any pattern does. Do not use `!` negation in `index.ignore`, `index.ignoreProjects`, `contextsView.exclude` or `contextsView.hubs.paths`: a negated pattern matches every other path, and `ctxo doctor` does not warn about it yet. `index.tests` does not support negation: a glob that starts with `!` (but not a `!(...)` extglob such as `!(fixtures)/**/*.check.ts`, which is kept) is skipped (it never reaches the contexts view or the plugins), and `ctxo doctor` (`config_file`) warns, naming it. To leave files out of the index, use `index.ignore`.

```yaml
index:
  ignore:
    - "**/*.generated.ts"      # extension match anywhere
    - "packages/**/dist/**"    # nested directories
    - "packages/*/generated/**" # any package
```

## Defaults

When `config.yaml` is missing, unreadable, or invalid, Ctxo uses:

```yaml
version: "1.0"
stats:
  enabled: true
index:
  ignore: []
  ignoreProjects: []
masking:
  clusterLabels: []
watch:
  snapshotMinFileChanges: 5
gate:
  enabled: true
  sensitivity: balanced
cochange:
  maxCommits: 2000
  maxFilesPerCommit: 30
  minShared: 2
  include: []
  exclude: []
```

`communities` and `contextsView` have no entry in the loaded defaults; their defaults are applied where they are read (see the table above), and `index.tests` is empty. `gate.minDependents` and `gate.percentile` come from `gate.sensitivity` unless they are set.

## Error handling

| Condition | Behaviour |
| --- | --- |
| File missing | Silent; defaults used. |
| YAML parse error | `ctxo doctor` emits a **warning**; defaults used. |
| Schema violation (unknown field in `stats`/`index`/`masking`/`watch`/`gate`/`cochange`/`communities`/`contextsView`, wrong type, `maxCommits` that is not a positive integer or `"all"`, a `since` that is not a duration) | `ctxo doctor` emits a **fail**; defaults used. |
| Invalid glob pattern (`index.*`, `cochange.include`/`exclude`, `contextsView.exclude` or `contextsView.hubs.paths`) | `ctxo doctor` emits a **warning**; the bad pattern is dropped, valid siblings still apply. |

All failure modes follow the warn-and-continue rule: indexing never aborts because of a config problem. The loaded config is available to core code as a `LoadedConfig` record with `errors` and `invalidGlobs` arrays for diagnostic consumers.

::: tip
Run `ctxo doctor` after editing `config.yaml` to surface every warning and fail in one report.
:::

::: warning
Do not use `index.ignore` to exclude files from a language plugin's parser. Plugins operate on the files Ctxo hands them; filtering happens at the index layer, not at the parser.
:::

## See also

- [`ctxo config.yaml`](/cli/config-yaml) - CLI-facing summary
- [`ctxo doctor`](/cli/doctor) - surfaces config warnings and schema fails
- [`ctxo index`](/cli/index) - consumer of the `index.ignore` list and the `cochange` window
- [`ctxo contexts`](/cli/contexts) - shows the result of the `contextsView` settings
