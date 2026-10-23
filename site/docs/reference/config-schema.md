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

gate:
  enabled: true
  sensitivity: balanced

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
```

## Fields

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `version` | string or number | `"1.0"` | Schema version marker. Forward-compatible; unknown values are accepted. |
| `stats.enabled` | boolean | `true` | Session recording opt-out. Set `false` to disable local stats capture. |
| `index.ignore` | string[] | `[]` | Picomatch globs applied to file paths **after** `git ls-files`. |
| `index.ignoreProjects` | string[] | `[]` | Picomatch globs applied to workspace roots. Skipped workspaces are never enumerated. |
| `index.tests` | string[] | `[]` | Extra test-file globs added to the shared default list. Test files are never nodes of the contexts view. Test-framework annotations also mark test files; see [Test files](#test-files). |
| `index.facts` | boolean | `false` | Ask plugins for code facts (protocol v2). Sets `capabilities.facts`, so `ctxo index` and `ctxo watch` call `extractFacts` on plugins that implement it and write the results into the file's index JSON under `facts`. JSON only; SQLite is unchanged. No official plugin implements `extractFacts` yet. |
| `gate.enabled` | boolean | `true` | Enable or disable the safe-edit guard PreToolUse hook. |
| `gate.sensitivity` | `strict` \| `balanced` \| `lenient` | `balanced` | How aggressively the guard flags high-impact symbols. |
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

Three cases need an `index.tests` glob: test classes that use only other attributes (for example FsCheck `[Property]`), test classes whose attributes derive from `Fact` or `Theory` (names match exactly; attribute base types are not resolved), and an unannotated `*Tests.cs` file in a bare capital `Tests/` or `Test/` folder (`**/tests/**` is case-sensitive, so that folder is not a default test glob).

After upgrading `@ctxo/lang-csharp`, run a full `ctxo index` once. An incremental run (`--files`, `--commit`, the post-commit hook) annotates only the files it re-indexes, while the contexts view already counts the index as annotated, so name-only `*Test.cs` / `*Tests.cs` matches that were not re-indexed show up as production files until the full run.

`index.tests` serves the contexts view. The [data-resource tie-break](/reference/symbol-ids#several-definitions-of-one-object) uses the default test globs only; to keep a test copy of a schema out of it, use `index.ignore`.

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

Unknown fields at the root are ignored for forward compatibility. Unknown fields **inside** the `stats`, `index`, `gate`, `cochange`, `communities` or `contextsView` sections (and inside `contextsView.weights` and `contextsView.hubs`) are rejected as schema violations (typos surface immediately).

## Glob matching rules

`index.ignore`, `index.ignoreProjects`, `index.tests`, `cochange.include`, `cochange.exclude`, `contextsView.exclude` and `contextsView.hubs.paths` all use [picomatch](https://github.com/micromatch/picomatch) with `{ dot: true }`.

- Patterns are matched against **repo-relative, forward-slash paths**. Backslashes are normalised before matching.
- `index.ignore` runs per file, after the git-tracked file list is produced.
- `index.ignoreProjects` runs against workspace roots during discovery. A matched workspace is never visited, and its plugin dependencies are never imported.
- Each pattern is matched on its own and a path matches when any pattern does. Do not use `!` negation in any of these lists (`index.ignore`, `index.ignoreProjects`, `index.tests`, `contextsView.exclude`, `contextsView.hubs.paths`): a negated pattern matches every other path, and `ctxo doctor` does not warn about it yet.

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
cochange:
  maxCommits: 2000
  maxFilesPerCommit: 30
  minShared: 2
  include: []
  exclude: []
```

`communities` and `contextsView` have no entry in the loaded defaults; their defaults are applied where they are read (see the table above), and `index.tests` is empty.

## Error handling

| Condition | Behaviour |
| --- | --- |
| File missing | Silent; defaults used. |
| YAML parse error | `ctxo doctor` emits a **warning**; defaults used. |
| Schema violation (unknown field in `stats`/`index`/`gate`/`cochange`/`communities`/`contextsView`, wrong type, `maxCommits` that is not a positive integer or `"all"`, a `since` that is not a duration) | `ctxo doctor` emits a **fail**; defaults used. |
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
