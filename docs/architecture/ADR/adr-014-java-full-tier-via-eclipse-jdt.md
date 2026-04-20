# ADR-014: Java Full-Tier Analysis via Eclipse JDT Core Sidecar

| Field          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| **Status**     | Proposed                                                               |
| **Date**       | 2026-04-20                                                             |
| **Deciders**   | Alper Hankendi                                                         |
| **Decision**   | Ship a standalone Java uber-JAR (`ctxo-jdt-analyzer`) bundled with `@ctxo/lang-java` that uses Eclipse JDT Core (ASTParser + `resolveBindings`) to emit semantic symbols and edges as JSON. Tree-sitter retained as a co-equal fallback layer. Java analog of ADR-007 (Roslyn) and ADR-013 (Go). |
| **Relates to** | Issue #69, [ADR-007](adr-007-csharp-roslyn-lsp.md), [ADR-012](adr-012-plugin-architecture-and-monorepo.md), [ADR-013](adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md) |

## Context

`@ctxo/lang-java` (added in PR #74) ships at **syntax tier** only. It emits symbols (classes, interfaces, enums, records, methods, constructors), `imports`, `extends`, `implements` edges, and cyclomatic complexity — all via `tree-sitter-java`. It does **not** emit resolved `calls` or `uses` edges, because those require type resolution that tree-sitter cannot provide.

The consequence mirrors the C# problem documented in ADR-007: on Java projects, `get_blast_radius`, `get_logic_slice`, `find_importers` (for method-level callers), `get_symbol_importance`, and `find_dead_code` all operate on an incomplete graph. The two most valuable Ctxo tools — blast radius and logic-slice — lose their edge over simple grep when cross-method and cross-file call relationships are invisible.

Capabilities unreachable without a Java type checker:

- **Method call resolution** — overload selection, generic method dispatch, inherited method lookup, method references (`Type::method`), and lambda target type inference all require the full Java Language Specification semantics.
- **Cross-file symbol ID resolution** — package-qualified names must be bound to actual compilation units across the project. The syntax-tier plugin uses a name-keyed registry walk (same pattern as `@ctxo/lang-csharp` pre-Roslyn), which works for `extends`/`implements` but breaks down on method invocations with overloads.
- **Type-level `uses` edges** — generic arguments (`List<Bar>`), field types, parameter/return types, `throws` clauses, and annotation references all need resolved type bindings.
- **Reliable dead-code detection** — reachability analysis requires a call graph; without it, any unused-symbol claim is unreliable.

## Decision

Ship a **standalone Java uber-JAR** (`ctxo-jdt-analyzer`) bundled inside the `@ctxo/lang-java` package. The plugin spawns the JAR via `java -jar` in batch mode per index run, reads JSONL results, and converts them to `SymbolNode` / `GraphEdge` shapes defined by `@ctxo/plugin-api`. A keep-alive mode (matching `@ctxo/lang-csharp`) supports `ctxo watch`.

### Backend choice: Eclipse JDT Core (not javac)

JDT and javac were both evaluated. Summary of the decisive differences:

| Dimension                              | JDT Core                                                | javac (JavacTask)                                  |
| -------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Partial bindings on broken builds      | **Yes** — returns best-effort bindings                  | No — ANALYZE phase fails, no bindings emitted      |
| Built-in incremental compilation       | **Yes** — project-aware dep graph, native to JDT        | No — caller must maintain state                    |
| Batch multi-file API                   | **Yes** — `ASTParser.createASTs(files[], bindingKeys[], requestor)` single call | No — one `JavacTask` per compilation |
| External dependency footprint          | ~15MB uber-JAR (JDT + transitive)                       | Zero — lives inside the JDK                        |
| Minimum runtime                        | JRE 21                                                  | Any JDK matching the target source level           |
| Overload / generic / lambda accuracy   | ~99.5% — ECJ implements JLS with documented rare deltas vs javac (`lambda$0` naming, some preview feature timing) | 100% — the reference implementation |
| Cross-file project model               | **Yes** — `IJavaProject` hierarchy                      | No — caller aggregates                             |
| Prior art in Ctxo-adjacent tools       | jdt.ls, VS Code Java, javalens-mcp — all use JDT        | No comparable MCP / indexer project                |
| Learning curve                         | Medium                                                  | Hard — compiler phase orchestration required       |
| Sensitivity to consumer's JDK version  | Low — JDT ships its own compiler (ECJ)                  | **High** — user JDK may not understand newer syntax |

**JDT wins on the two dimensions Ctxo cares about most:**

1. **Partial bindings on broken builds.** Consumer projects are frequently in a mid-edit state (missing dependencies, syntax errors in one file). javac returns no binding information when ANALYZE fails; JDT still resolves what it can and marks the rest as unresolved. For an indexer that must tolerate imperfect source, this is a correctness-critical capability, not a nice-to-have.
2. **Built-in incremental model.** `ctxo watch` re-indexes files on change. JDT's project-aware dep graph re-analyzes only affected compilation units. javac would require reimplementing an incremental scheduler from scratch.

Binary size (~15MB) is accepted as the cost. Consumers receive the JAR via lazy download (`~/.ctxo/cache/`) rather than bundling in the npm tarball — mirrors the Go binary cache strategy from ADR-013.

### Two-layer composite adapter

Mirrors `CSharpCompositeAdapter` and `GoCompositeAdapter`: the plugin selects full-tier at `initialize()` if JDT is available, otherwise falls back to tree-sitter.

| Layer                                 | Owns                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Tree-sitter (existing, PR #74)        | Symbol inventory + cyclomatic complexity + broken-code tolerance + fallback when JDK toolchain missing  |
| `ctxo-jdt-analyzer` JAR (new)         | Semantic edges (`calls`, `uses`, `implements`, `extends`), cross-file IDs, generics, partial bindings   |

Neither layer subsumes the other. Tree-sitter still owns complexity metrics (JDT does not expose cyclomatic/cognitive out of the box) and keeps producing useful output on mid-edit broken files when the project-level classpath is unresolvable.

### Plugin boundary rule — `@ctxo/cli` takes zero new dependencies

All Java concerns stay inside `@ctxo/lang-java`:

- JAR sources (`tools/ctxo-jdt-analyzer/`) ship inside the plugin package (mirrors `packages/lang-csharp/tools/ctxo-roslyn/` and `packages/lang-go/tools/ctxo-go-analyzer/`).
- JAR distribution, discovery, spawning, JSON parsing, toolchain detection — all inside the plugin.
- `@ctxo/cli` sees only the `ILanguageAdapter` interface exposed by `@ctxo/plugin-api`.
- No new npm dependency lands in `packages/cli/package.json`.
- No `java` / JDT logic leaks into `packages/cli/src/`.

This is a hard rule per [ADR-012](adr-012-plugin-architecture-and-monorepo.md).

### Classpath / project discovery strategy

Java has no single source of truth for project dependencies the way `.sln` (C#) or `go.mod` (Go) does. The analyzer tries the following sources in order, stopping at the first that produces a usable classpath:

1. **User override** in `.ctxo/config.yaml` (`java.classpath: [...]`) — highest priority, escape hatch.
2. **IDE metadata** — Eclipse `.classpath`, IntelliJ `.idea/libraries/*.xml`. Fast and trustworthy when present.
3. **Local repository scan** — `~/.m2/repository` and `~/.gradle/caches/modules-2/files-2.1` walked based on declared dependencies parsed from `pom.xml` (XML) or `build.gradle` (regex extraction of `implementation "..."` coordinates).
4. **Fallback** — empty classpath. JDT runs in syntax-only mode (bindings partial, intra-file only); still better than tree-sitter because JDT resolves same-file method overloads correctly.
5. **Last resort** — tree-sitter syntax tier for the whole project (existing PR #74 code path).

**Maven and Gradle child processes are disabled by default.** Spawning `mvn dependency:build-classpath` or `gradle -q dependencies` runs arbitrary user-defined build scripts, plugin goals, and classloaders — an unacceptable code-execution risk for a read-only indexer. Opt-in via `ctxo index --allow-build-tools` or `java.allowBuildToolExecution: true` in config.

### Edge semantic conventions

Java → Ctxo edge kind mapping, fixed in `packages/lang-java/docs/edge-semantics.md`:

| Java construct                           | Edge kind(s)                                      |
| ---------------------------------------- | ------------------------------------------------- |
| `import a.b.C;`                          | `imports`                                         |
| `import static a.b.C.foo;`               | `imports` (to `C`)                                |
| `class A extends B`                      | `extends`                                         |
| `class A implements I`                   | `implements`                                      |
| `interface I extends J`                  | `extends`                                         |
| `new Foo()`                              | `calls` (constructor) + `uses` (type)             |
| `Foo.staticMethod()`                     | `calls`                                           |
| `instance.method()`                      | `calls`                                           |
| `Type::method` (method reference)        | `calls`                                           |
| Lambda with target type `I`              | `implements` (to `I`)                             |
| `@Annotation`                            | `uses`                                            |
| `List<Bar>` (generic argument)           | `uses` (to `Bar`)                                 |
| Field type, parameter type, return type  | `uses`                                            |
| `throws E`                               | `uses`                                            |

### Alternatives rejected

| Option                                             | Why not                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **javac via JavacTask**                            | No partial bindings on broken builds; no built-in incremental model; higher sensitivity to consumer JDK version. JDT's "ships its own compiler" property is decisive for an indexer that must tolerate imperfect source. Dimensions detailed above. |
| **JavaParser + Symbol Solver**                     | Pure Java library, lighter than JDT. Rejected on correctness: documented accuracy issues with JAR-based classpath resolution (issue #1943 and adjacent), generic method dispatch edge cases, and lambda type inference. Ctxo's blast-radius value collapses if false-negative call resolution is non-trivial. |
| **`tree-sitter-stack-graphs-java`**                 | Archived by GitHub on 2025-09-09. Not maintained. Eliminated.                                                                                                                                                                                       |
| **Talk to `jdt.ls` over LSP**                      | Editor-oriented; request/response per file → N+1 pattern over 100s-1000s of files; batch indexing infeasible. Same rationale as ADR-007 rejecting Roslyn LSP and ADR-013 rejecting gopls LSP.                                                       |
| **Stay tree-sitter + heuristics**                  | `calls` and type-resolved `uses` edges are unreachable without a type checker; blast-radius and logic-slice values on Java remain at grep-equivalent quality.                                                                                         |
| **Consume SCIP-Java output**                       | Adds a third-party indexer dependency (SCIP-Java) plus SCIP→Ctxo schema translation. Maintenance outside our control; delivery cadence depends on Sourcegraph's roadmap.                                                                             |
| **Use Maven/Gradle to execute dependency resolution** | Runs arbitrary consumer build scripts → code-execution risk. Opt-in flag only; never the default.                                                                                                                                                   |
| **Bundle JAR inside npm tarball**                  | +15MB on `npm install` hot path regardless of whether the consumer even uses Java. Lazy cache download on first use is the Go-binary pattern from ADR-013 and imposes cost only on actual Java users.                                                |

## Consequences

### Positive

- Full semantic coverage: every graph tool works on Java at the fidelity C# reached with Roslyn.
- Consistent three-language mental model (`ctxo-roslyn`, `ctxo-go-analyzer`, `ctxo-jdt-analyzer`).
- Batch-optimized single-pass indexing, not N+1 over LSP.
- Plugin boundary intact: zero impact on `@ctxo/cli`.
- Partial bindings tolerate mid-edit broken projects — `ctxo watch` stays useful during active development.
- JDT's incremental model makes watch-mode re-index near-instant on single-file changes.

### Negative / accepted costs

- **Indexing time +10-30s on medium repos** (classpath resolution + bindings). Tool runtime unaffected — index is heavy, tools read JSON.
- **Memory peak ~500MB on 1K-file projects** with bindings retained. Transient; released after JSON emission. `-Xmx` configurable via `java.maxHeapMb` (default 1024).
- **Java runtime required.** JRE 21+ must be on `PATH`. Missing JDK → composite falls back to tree-sitter (existing behaviour); `ctxo doctor` surfaces the gap with an install hint.
- **We maintain a Java uber-JAR** (~1500 LOC estimate) plus the Maven build. Mitigation: JDT Core API is stable across minor versions; minimal custom logic beyond AST visiting and binding walking.
- **Rare ECJ↔javac divergences** on lambda/preview features. Documented limitation; acceptable because blast-radius precision degrades gracefully (extra or missing edge on a pattern-matching edge case, never project-wide breakage).
- **Classpath heuristics are lossy** when neither IDE metadata nor local-repo JARs are present (fresh clone, no `mvn install` run). Documented in README with remediation: run `mvn dependency:resolve` once, or provide explicit classpath in `.ctxo/config.yaml`.
- **Annotation processors are skipped.** Generated sources (Lombok, MapStruct, Dagger) will not appear in the index until the consumer has run the build once to materialize them on disk. Same limitation as jdt.ls at startup.

## Open questions (to resolve before implementation)

| # | Question                                            | Proposed answer                                                                                                                            |
| - | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | Multi-module Maven reactor / Gradle subprojects     | Detect reactor POMs (`<modules>` element) and Gradle `settings.gradle` `include` directives; build one `IJavaProject` per module.          |
| 2 | JAR build + distribution strategy                   | **Lazy download + hash-keyed cache.** First `initialize()` downloads prebuilt `ctxo-jdt-analyzer.jar` from GitHub Releases to `~/.ctxo/cache/lang-java/<version>/`. Cache key = analyzer version + SHA-256. No postinstall hook. |
| 3 | Keep-alive timeout for watch mode                   | 30s idle timeout (matches `@ctxo/lang-csharp`). Stdin JSON request loop: `{fileUri, content}` → re-analyze affected compilation units via JDT incremental builder. |
| 4 | Binding resolution failure behaviour                | Per-file fallback: if JDT fails for file F, composite re-runs tree-sitter on F only (not the whole project). Surface aggregate via `_meta.hint`. |
| 5 | Generics edge representation                        | **Option A** (matches ADR-013): `List[Integer]` and `List[String]` both emit `uses` edges to unconstructed `List`; type arguments preserved on edge metadata for future tooling. |
| 6 | Observability schema                                | `ctxo doctor --json` exposes `{tier, backend: "jdt", jdtVersion, javaVersion, classpathSource, classpathResolved, classpathJars, bindingsResolved, bindingsUnresolved, avgFileMs}`. |
| 7 | Java source level support                           | JDT parses source levels 1.3 through Java 23. Default: auto-detect from `pom.xml` `<maven.compiler.source>` or Gradle `sourceCompatibility`; fall back to Java 21. |
| 8 | Follow-up issue dependencies                        | #70 (plugin-api `SymbolKind`/`EdgeKind` extensions), #72 (shared `TreeSitterAdapter`), #73 (hardcoded language tables) are independent — no blocking coupling.       |

## Rollout

1. **Merge PR #74** (syntax-tier `@ctxo/lang-java`) — prerequisite; full-tier composes on top of it.
2. **Scaffold `packages/lang-java/tools/ctxo-jdt-analyzer/`** — Maven project, `pom.xml` with `maven-shade-plugin` to produce uber-JAR, JSON schema matching `RoslynBatchResult` / `GoAnalyzerBatchResult`.
3. **`ClasspathResolver.java`** — user override → IDE metadata → local-repo scan → empty (syntax-only) → tree-sitter fallback. **No `mvn`/`gradle` spawn by default.**
4. **`Analyzer.java`** — `ASTParser.createASTs(...)` batch mode, `resolveBindings(true)`, emit symbols + edges + complexity as JSONL.
5. **`Main.java`** — stdio protocol loop: batch mode (read files list, emit results, exit) + keep-alive mode (accept JSON requests on stdin).
6. **TypeScript side:** `JdtAdapter` (sibling of `RoslynAdapter`), `JdtProcess` (sibling of `RoslynProcess`), `JavaCompositeAdapter` wrapping existing `JavaAdapter` (tree-sitter from PR #74).
7. **Toolchain detection:** `java -version` probe in `ctxo doctor`; graceful degradation when absent or < 21.
8. **JAR distribution:** GitHub Releases artifact per `@ctxo/lang-java` version; lazy download on first `initialize()`.
9. **CI regression test:** fixture Maven project where tree-sitter emits 0 `calls` edges but JDT must emit ≥ 50. Floor check prevents silent degradation.
10. **Validation:** reproduce ADR-007's before/after blast-radius table on a real Java service (Spring Boot backend candidate).
11. Close Issue #69 referencing this ADR; ship in the release after PR #74 merges.

## References

- Issue #69 — [`lang-java: full tier (JDT/javac analyzer) for resolved call/use edges`](https://github.com/alperhankendi/Ctxo/issues/69)
- PR #74 — syntax-tier `@ctxo/lang-java` baseline
- [ADR-007](adr-007-csharp-roslyn-lsp.md) — sibling decision for C# (Roslyn sidecar pattern)
- [ADR-012](adr-012-plugin-architecture-and-monorepo.md) — plugin boundaries enforced here
- [ADR-013](adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md) — sibling decision for Go (sidecar pattern)
- [packages/lang-csharp/tools/ctxo-roslyn/](../../../packages/lang-csharp/tools/ctxo-roslyn/) — closest reference implementation (Java and C# share the project-file + semantic-compiler shape)
- [packages/lang-csharp/src/composite-adapter.ts](../../../packages/lang-csharp/src/composite-adapter.ts) — reference composite adapter with keep-alive
