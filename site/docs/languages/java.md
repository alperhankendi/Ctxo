---
title: "Java"
description: "@ctxo/lang-java: Eclipse JDT Core (full tier) + tree-sitter-java fallback."
---

# Java

Plugin: **`@ctxo/lang-java`** ([npm](https://www.npmjs.com/package/@ctxo/lang-java))
Parser: **`@ctxo/lang-java-analyzer`** (Eclipse JDT Core, JRE 17+) with
**tree-sitter-java** fallback
Tier: **`full`** (advertised), downgrades to `syntax` when JRE 17+ or the analyzer package is absent
Extensions: `.java`

## What this plugin does

The Java plugin ships the **tree-sitter-java syntax tier** out of the box - zero
setup, always available. For full semantic resolution, install the companion
package **`@ctxo/lang-java-analyzer`**, which carries a prebuilt (~15 MB)
uber-JAR containing Eclipse JDT Core. The plugin resolves the JAR at runtime
from `node_modules` via `require.resolve` - no build toolchain required, only
a **JRE 17+** on your PATH to execute it.

This differs from the Go and C# plugins, which compile or restore their analyzer
from a local toolchain. Java ships a prebuilt JAR with npm-native integrity and
provenance, so the only runtime prerequisite is a Java runtime.

One JDT build analyzes Java source levels 8 through 21. The source level used
for analysis is independent of the JRE version running the JAR.

Complexity is always computed by tree-sitter. The JDT analyzer intentionally
emits empty complexity values, matching the Go plugin's approach.

## Install

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-java
```
```bash [npm]
npm install --save-dev @ctxo/lang-java
```
```bash [yarn]
yarn add -D @ctxo/lang-java
```
:::

Or, for a Java / Maven / Gradle project (which has no `package.json`), install
globally with `--global`:

```bash
ctxo install java --global --yes
```

`ctxo install java --global` installs the syntax tier plugin. If a JRE 17+ is
detected on your PATH it also installs `@ctxo/lang-java-analyzer` (full tier).
To force full tier installation regardless of detection:

```bash
ctxo install java --full-tier --global
```

To skip the analyzer and stay on tree-sitter only:

```bash
ctxo install java --syntax-only --global
```

## What it extracts

### Symbols

| Kind        | Sources                                                               |
| ----------- | --------------------------------------------------------------------- |
| `class`     | `class` declarations, `record` declarations                           |
| `interface` | `interface` declarations, `@interface` (annotation types)             |
| `type`      | `enum` declarations                                                   |
| `method`    | Methods and constructors                                              |
| `variable`  | Fields (instance and static)                                         |

### Edges

| Kind         | Notes                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| `imports`    | `import` statements (single-type and on-demand)                                   |
| `extends`    | Class inheritance (`extends` clause)                                               |
| `implements` | Interface implementation (`implements` clause)                                     |
| `calls`      | Method invocations, constructor calls; resolved via JDT type bindings in full tier |
| `uses`       | Type references in fields, parameters, generic arguments, annotations              |

In full tier, 2-part and name-reference targets are resolved through the JDT
type binding graph. In syntax tier, `calls` and `uses` targets are best-effort
based on name matching.

## Full tier and the analyzer package

The full tier requires two things:

1. **`@ctxo/lang-java-analyzer`** installed in the project (or globally). This
   package ships the prebuilt JDT uber-JAR - no Maven, Gradle, or javac needed.
2. **JRE 17+** on your PATH. Run `java -version` to confirm.

When both are present, the plugin launches the JAR as a subprocess at index
time, performs one batch analysis pass over the project, and caches per-file
results. Individual `extractSymbols` / `extractEdges` calls then read from the
cache, keeping the `ILanguageAdapter` per-file contract intact while invoking
JDT only once per index.

`ctxo index` output, `ctxo doctor` (java tier check), and the MCP `_meta` field
all report the active tier so you can confirm full tier is running.

## Classpath resolution

The analyzer resolves dependency JARs using the following strategy, in order:

1. **IDE metadata** - reads `.classpath` (Eclipse) and `.idea/` (IntelliJ) if present
2. **Local repository scan** - parses `pom.xml` / `build.gradle` for declared
   dependencies, then locates JARs in `~/.m2` (Maven local repo) and the Gradle
   cache
3. **Empty classpath** - analysis continues with unresolved external types

Build tools (`mvn`, `gradle`) are never executed by default. If your project
relies on generated sources or processor output, pre-generate those before
indexing.

## Graceful degradation

| Condition                                | Result                                                           |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `@ctxo/lang-java-analyzer` not installed | Falls back to tree-sitter syntax tier                            |
| JRE 17+ not on PATH                      | Falls back to tree-sitter syntax tier                            |
| JAR fails to load or verify              | Falls back to tree-sitter syntax tier, warn                      |
| Analyzer batch times out                 | Marks batch `timedOut`, uses partial results                     |

The active tier is reported by `ctxo doctor` (look for the Java language
coverage check, which also prints an actionable hint when degraded).

## Known issues

- **Watch performance on large projects:** the full tier supports incremental
  keep-alive re-index. However, on very large projects each file change
  triggers a full project re-analysis for cross-file binding resolution. The
  watcher degrades gracefully to tree-sitter on timeout to avoid blocking.
- **tree-sitter peer version:** `tree-sitter@0.22.x` and the native
  `tree-sitter-java` binding may advertise mismatched peer ranges in the pnpm
  dependency graph. Installs succeed but may emit a peer warning. This is a
  known upstream issue and does not affect runtime behaviour.
- **Annotation processors:** generated sources in `target/generated-sources`
  or `build/generated` are indexed if they are tracked by git. Add these paths
  to `.ctxo/config.yaml#index.ignore` if you do not want them in the graph.

## Related

- [Dependency graph](/concepts/dependency-graph)
- [Edge kinds](/reference/edge-kinds)
- [Symbol IDs](/reference/symbol-ids)
- [Languages overview](/languages/overview)
