---
title: "Java"
description: "@ctxo/lang-java: Eclipse JDT Core (full tier) + tree-sitter-java fallback."
---

# Java

Plugin: **`@ctxo/lang-java`** ([npm](https://www.npmjs.com/package/@ctxo/lang-java))
Parser: **`@ctxo/lang-java-analyzer`** (Eclipse JDT Core, JRE 11+) with
**tree-sitter-java** fallback
Tier: **`full`** (advertised), downgrades to `syntax` when JRE 11+ or the analyzer package is absent
Extensions: `.java`

## What this plugin does

The Java plugin ships the **tree-sitter-java syntax tier** out of the box - zero
setup, always available. For full semantic resolution, install the companion
package **`@ctxo/lang-java-analyzer`**, which carries a prebuilt (~15 MB)
uber-JAR containing Eclipse JDT Core. The plugin resolves the JAR at runtime
from `node_modules` via `require.resolve` - no build toolchain required, only
a **JRE 11+** on your PATH to execute it.

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

`ctxo install java --global` installs the syntax tier plugin. If a JRE 11+ is
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
| `reads`, `writes`, `executes` | Constant SQL at known call sites, full tier with `@ctxo/lang-sql` installed ([below](#sql-at-call-sites)) |

In full tier, 2-part and name-reference targets are resolved through the JDT
type binding graph. In syntax tier, `calls` and `uses` targets are best-effort
based on name matching.

JDT `calls` and `uses` edges start at the enclosing type, so a method's own
dependencies (a test method's included) show at its class. Data edges start at
the method or constructor.

## Annotations

Annotations on types, methods and fields become symbol annotations in both
tiers (always on). Every fragment of a field declaration gets the
declaration's annotations, and `name` is the simple name.

- The `value` member (shorthand or explicit) goes to `args`, the other members
  to `named`. A member named `type` is dropped (`named.type` is reserved); a
  member named `member` is kept, because Java fields are symbols of their own.
- **Full tier (JDT):** declared values only, no defaults: strings as they are,
  numbers through `String.valueOf`, `true` or `false`, enum constants as
  `Type.MEMBER`, class literals as the qualified name (as written when
  unresolved). Arrays are flattened in `args` and joined with `,` in `named`;
  nested annotations and nulls are skipped. Without dependency JARs the
  annotation still comes from the syntax, with constant evaluation; a number
  JDT cannot evaluate keeps its raw token (`10L`, `0x10`).
- **Syntax tier (tree-sitter):** string literals (escapes decoded) and string
  arrays only. Non-string values such as `nullable = false` appear only in the
  full tier, and string constants and concatenation are not evaluated.
- Caps: 20 per symbol, 10 positional and 10 named entries, 200 characters per
  value.

```java
@Entity
@Table(name = "loans")
public class Loan { }
// Loan: [{ name: 'Entity' }, { name: 'Table', named: { name: 'loans' } }]
```

## Test symbols

The JDT analyzer walks the whole project root except build folders, so test
methods under `src/test/java` are method symbols with their annotations (the
syntax tier indexes them too). A JUnit `@Test` gives the annotation `Test`, one
of the test-framework names, so a file with a `@Test` method counts as a test
file for the contexts view and `find_dead_code` wherever it sits.

## SQL at call sites

With [`@ctxo/lang-sql`](/languages/sql) installed and the full tier active, the
analyzer reports constant SQL at known call sites, and the plugin adds `reads`,
`writes` and `executes` edges from the enclosing method or constructor (a
lambda belongs to its method), parsed by `@ctxo/sql-extract`. The tree-sitter
tier gives no SQL edges, and without `@ctxo/lang-sql` there are none.

| API | SQL text |
| --- | --- |
| JDBC `Connection.prepareStatement`, `prepareCall`; `Statement.execute*` | first argument |
| Spring `JdbcTemplate`, `NamedParameterJdbcTemplate`, `JdbcOperations`, `NamedParameterJdbcOperations` (`query*`, `update`, `batchUpdate`, `execute`) | first `String` argument; every argument of an all-`String` `batchUpdate` |
| `EntityManager.createNativeQuery` (`javax.persistence`, `jakarta.persistence`) | first argument |
| Spring Data `@Query(value = ..., nativeQuery = true)` | `value` |
| MyBatis `@Select`, `@Insert`, `@Update`, `@Delete` | `value`, array elements joined with a space |

- **Constants:** JDT constant evaluation, so literals, `static final`
  constants, concatenation and text blocks. A JDBC escape `{call name(...)}` or
  `{? = call name(...)}` gives an `executes` edge to the procedure.
- **Matching:** the receiver's static type, the binding's declaring class or any
  supertype. Without dependency JARs on the classpath, the declared type of the
  field, local variable or parameter, resolved through the single-type imports
  or the package. With a method binding, a member whose first parameter is not
  a `String` is no call site.
- **Limits:** without a binding, subclass receivers (`LoanJdbc extends
  JdbcTemplate`) and `super.update(...)` are missed, and array literals in
  `batchUpdate` are not expanded. MyBatis `<script>` and `${}` texts pass
  through as written. JPQL and Spring Data derived queries are not covered.
- **Counts:** non-constant SQL is counted in the analyzer's summary
  (`sql: { constant, nonConstant }`, debug log only), never guessed.

## Facts

When the host requests facts (`@ctxo/domain` installed with a registry file, or `index.facts: true`), the plugin reports
`literal-comparison`, `normalization`, `retry-timeout` and `endpoint` facts into each file's index JSON
(`facts: []` when it finds none), with the rules every official plugin shares (see [facts](https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md#facts)). They
feed [`find_shadow_specs`](/mcp-tools/find-shadow-specs). At most 500 facts per file, text at most 200 code
points, and no `retry-timeout` facts in test files.

| Kind | Java |
| --- | --- |
| `literal-comparison` | `if`, `while`, `do`, `for`, ternaries and `switch` labels (statements and expressions) |
| `normalization` | `trim`, `toLowerCase`, `equalsIgnoreCase` and the other configured methods; one fact per chain (the outermost call), none when the nearest consumer is a log or error sink, for display text sent to a sink or formatter, for path, character, hex or file-extension work, or in test files ([FC-4b](https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md#the-fact-contract)) |
| `retry-timeout` | Numeric constants bound to retry or timeout names (fields, locals, assignments, annotation members) and `Duration.of*(n)`, `Duration.of(n, ChronoUnit.X)` |
| `endpoint` | Spring `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping` (verbs from `method = RequestMethod.X`, the class mapping as prefix); JAX-RS `@GET` and friends with `@Path` on the class and the method |

The JDT tier collects evidence behind `--facts=`; the tree-sitter tier gives the same facts and ids (it now indexes
enum body members, interface constants, compact constructors and the members of anonymous and enum constant
bodies, as JDT does). Text blocks are decoded as the JLS says. An `int` expression that overflows, and a comparison
whose literal overflows `int`, give no fact. An analyzer JAR older than this release ignores `--facts=`: the plugin
prints `analyzer too old for facts; run ctxo install java --full-tier` once, and until then the full tier gives only
the endpoint facts it reads from annotations. In `ctxo watch` a save reads the keep-alive analyzer's result, with no
second JVM. A syntax-tier fact failure warns on stderr and gives `facts: []`.

## Full tier and the analyzer package

The full tier requires two things:

1. **`@ctxo/lang-java-analyzer`** installed in the project (or globally). This
   package ships the prebuilt JDT uber-JAR - no Maven, Gradle, or javac needed.
2. **JRE 11+** on your PATH. Run `java -version` to confirm.

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
| JRE 11+ not on PATH                      | Falls back to tree-sitter syntax tier                            |
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
