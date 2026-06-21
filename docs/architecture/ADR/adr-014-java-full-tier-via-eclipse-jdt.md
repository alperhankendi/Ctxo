# ADR-014: Java Full-Tier Analysis via Eclipse JDT Core Sidecar

| Field          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| **Status**     | Accepted                                                               |
| **Date**       | 2026-04-20 (proposed), 2026-06-21 (accepted + revised)                 |
| **Deciders**   | Alper Hankendi                                                         |
| **Decision**   | Ship `@ctxo/lang-java` as a **single deliverable** combining a tree-sitter syntax tier and a standalone Java uber-JAR (`ctxo-jdt-analyzer`) that uses Eclipse JDT Core (ASTParser + `resolveBindings`) to emit semantic symbols and edges as JSON. The analyzer is a **single prebuilt JAR** (one runtime tier, JRE 17 base — JDT/ECJ analyzes source levels Java 8→21 independent of the running JRE) **downloaded on opt-in from GitHub Releases and verified by SHA-256**; tree-sitter is the always-present baseline and the fallback when JRE 17 is absent or the download fails. Java analog of ADR-007 (Roslyn) and ADR-013 (Go). |
| **Relates to** | Issue #69, [ADR-007](adr-007-csharp-roslyn-lsp.md), [ADR-012](adr-012-plugin-architecture-and-monorepo.md), [ADR-013](adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md) |

> **Build sequencing (2026-06-21):** This ADR originally treated PR #74 (syntax-tier baseline) as a merged prerequisite. That dependency is dropped — the syntax tier (tree-sitter) and full tier (JDT) are now built together in one shot inside `@ctxo/lang-java`. References to PR #74 below are historical context only, not a blocker.

> **Revision (2026-06-21, party-mode architecture review):** A facilitated multi-agent debate (Duke / Aydın / Theo / Demir, refereed by evidence research) revised two earlier decisions: (1) the **two-runtime-tier JDT JAR (jdt17/jdt21) is dropped in favour of a single JRE-17-base JAR** — a single JDT build on JRE 17 analyzes Java 8→21 because source level is independent of the running JRE, so the second tier added complexity with no coverage gain; (2) **distribution is locked to prebuilt download + SHA-256 verification**, with the "build from source on the user's machine" (Maven/`mvnw`) option explicitly rejected (its only real advantage over download — offline / no-infra — is false, since `mvnw` still fetches the Maven distribution and JDT deps from the network on first run, giving it a *larger* download surface than one JAR). JRE 21 as a future second tier is deferred for re-evaluation, not adopted. Full SLSA provenance + cosign signing are deferred as nice-to-have; SHA-256 is the proportionate integrity control for a local dev indexer. Sections below reflect the revised decisions; superseded wording is called out inline.

## Context

A tree-sitter **syntax tier** for Java emits symbols (classes, interfaces, enums, records, methods, constructors), `imports`, `extends`, `implements` edges, and cyclomatic complexity — all via `tree-sitter-java`. It does **not** emit resolved `calls` or `uses` edges, because those require type resolution that tree-sitter cannot provide. `@ctxo/lang-java` is built as a single package delivering this syntax tier **and** the JDT full tier together (the syntax tier doubles as the broken-code / missing-JDK fallback layer).

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
| Minimum runtime                        | JRE 17 (single JDT build; analyzes Java 8→21)           | Any JDK matching the target source level           |
| Overload / generic / lambda accuracy   | ~99.5% — ECJ implements JLS with documented rare deltas vs javac (`lambda$0` naming, some preview feature timing) | 100% — the reference implementation |
| Cross-file project model               | **Yes** — `IJavaProject` hierarchy                      | No — caller aggregates                             |
| Prior art in Ctxo-adjacent tools       | jdt.ls, VS Code Java, javalens-mcp — all use JDT        | No comparable MCP / indexer project                |
| Learning curve                         | Medium                                                  | Hard — compiler phase orchestration required       |
| Sensitivity to consumer's JDK version  | Low — JDT ships its own compiler (ECJ)                  | **High** — user JDK may not understand newer syntax |

**JDT wins on the two dimensions Ctxo cares about most:**

1. **Partial bindings on broken builds.** Consumer projects are frequently in a mid-edit state (missing dependencies, syntax errors in one file). javac returns no binding information when ANALYZE fails; JDT still resolves what it can and marks the rest as unresolved. For an indexer that must tolerate imperfect source, this is a correctness-critical capability, not a nice-to-have.
2. **Built-in incremental model.** `ctxo watch` re-indexes files on change. JDT's project-aware dep graph re-analyzes only affected compilation units. javac would require reimplementing an incremental scheduler from scratch.

Binary size (~15MB) is accepted as the cost. The JAR is **not bundled in the npm tarball** (that would impose ~15MB on every `npm install` regardless of whether the consumer uses Java). Instead it is a **prebuilt artifact downloaded on opt-in** from GitHub Releases into `~/.ctxo/cache/lang-java/<version>/` and verified by a SHA-256 hash pinned in the plugin package. See *Distribution* below.

### Single runtime tier — JRE 17 base (one JDT build, not two)

> *Supersedes the earlier two-tier (jdt17/jdt21) proposal — see the 2026-06-21 revision note at the top.*

The fallback to tree-sitter is governed by the **execution runtime** present on the consumer's machine, **not** by the source level of the analyzed code. JDT/ECJ bundles its own compiler, so it analyzes source levels independent of the local `javac`; what it needs is a JRE new enough to *run the analyzer JAR*.

The decisive fact: **a single JDT Core build running on JRE 17 analyzes source levels Java 8 through 21.** Eclipse JDT Core 4.28+ requires JRE 17 as its minimum execution environment, and the same build's compile/analysis target is independent of the running JVM (ecj 3.39 on JRE 17 resolves Java 21 sources). A second JRE-21 tier would therefore add a parallel artifact, a doubled CI matrix, and a "which build loaded?" support axis **with no coverage gain** — the source levels it would unlock are already covered by the JRE-17 build.

| Detected Java major | Behaviour                                                    | Tier delivered     |
| ------------------- | ----------------------------------------------------------- | ------------------ |
| ≥ 17                | download + run the single `ctxo-jdt-analyzer.jar` (opt-in)  | **full**           |
| < 17 or no JRE      | no download; stay on tree-sitter                            | tree-sitter syntax |

- `toolchain-detect.ts` parses `java -version` to a major number; ≥ 17 enables the full-tier path, below 17 stays on tree-sitter.
- **JRE 21 as a future second tier is deferred for re-evaluation**, not adopted. If newest-Java preview/lambda-binding fidelity ever proves to need a current-JDT build, a JRE-21 tier can be added behind the same download+detect machinery without reworking the adapter (the JSON contract is runtime-agnostic).

### Two-layer composite adapter

Mirrors `CSharpCompositeAdapter` and `GoCompositeAdapter`: the plugin selects full-tier at `initialize()` if JDT is available, otherwise falls back to tree-sitter.

| Layer                                 | Owns                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Tree-sitter (syntax tier)             | Symbol inventory + cyclomatic complexity + broken-code tolerance + fallback when JRE < 17 or JDK toolchain missing  |
| `ctxo-jdt-analyzer` JAR (full tier)   | Semantic edges (`calls`, `uses`, `implements`, `extends`), cross-file IDs, generics, partial bindings   |

Neither layer subsumes the other. Tree-sitter still owns complexity metrics (JDT does not expose cyclomatic/cognitive out of the box) and keeps producing useful output on mid-edit broken files when the project-level classpath is unresolvable.

### Distribution — prebuilt download + SHA-256 (not build-from-source)

> *Diverges from the Go (`go build`) and C# (`dotnet run`) repo precedents — see the 2026-06-21 revision note. The divergence is deliberate.*

The JAR reaches the user as a **prebuilt artifact**, not by compiling on the user's machine:

1. **Tree-sitter ships as the always-present baseline** — zero network, zero JRE, zero download. Every Java project gets symbol inventory + complexity + `imports`/`extends`/`implements` edges on day one with no setup.
2. **Full tier is opt-in.** The JDT JAR is **not** silently downloaded on first index (that would surprise offline/CI users with a ~15MB fetch). It is acquired by an explicit action — a flag / `ctxo install` step (`ctxo install java --full-tier`) or an interactive "download full-tier analyzer?" prompt on first Java index; non-interactive runs decline and stay on tree-sitter.
3. **Acquisition = download + verify.** Our CI builds `ctxo-jdt-analyzer.jar` hermetically and publishes it to GitHub Releases per `@ctxo/lang-java` version. The plugin downloads it to `~/.ctxo/cache/lang-java/<version>/` and verifies it against a **SHA-256 hash pinned in the plugin package**. Hash mismatch → reject + degrade to tree-sitter.
4. **Offline / firewall** → download fails → clean, messaged degradation to tree-sitter. The index never blocks.

**Why prebuilt download, not build-from-source (Maven/`mvnw`):**

- The dominant pattern for this exact tool class is prebuilt: Eclipse JDT-LS / vscode-java, Sourcegraph scip-java, Spotless, google-java-format, PMD, Checkstyle all ship a prebuilt JAR (download or bundle); **none build the analyzer on the user's machine.**
- "Download a prebuilt artifact on first use" is the accepted npm-ecosystem norm (esbuild, swc, better-sqlite3, node-jre, wiremock npm-jar-wrapper).
- `mvnw` removes the *pre-installed-Maven* requirement (JDK only) but **still fetches the Maven distribution + all JDT transitive deps from the network on first run** — so build-from-source has a *larger* download surface (hundreds of jars) and *more* failure points (corporate proxy, Nexus mirror, JDK version mismatch, compile error) than a single verified 15MB JAR. Its only claimed edge over download — offline / no-infra — is false.
- The Go/C# precedents build on the user's machine only because those toolchains are already present and fast (`go build` is seconds; `dotnet run` JITs). Java is the "build once, run anywhere" ecosystem; shipping a compiled artifact is idiomatic, and JDK presence is not guaranteed the way Go/.NET toolchains are for their users.

**Integrity scope:** SHA-256 verification of the pinned hash is the day-one mandatory control — proportionate to the threat model of a *local* developer indexer (the practical threat is "was the downloaded JAR tampered in transit"). Full SLSA provenance attestation + cosign signing are **deferred** as nice-to-have; they target multi-party CI-release distribution, a heavier blast radius than this tool warrants today.

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
5. **Last resort** — tree-sitter syntax tier for the whole project (the syntax-tier layer built alongside the full tier in this package).

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
| **Bundle JAR inside npm tarball**                  | +15MB on `npm install` hot path regardless of whether the consumer even uses Java. Opt-in prebuilt download on first use imposes cost only on actual Java users.                                                                                     |
| **Build JAR from source on the user's machine (Maven / `mvnw`)** | Mirrors the Go (`go build`) / C# (`dotnet run`) repo precedent, but rejected for Java: `mvnw` still fetches the Maven distribution + all JDT transitive deps from the network on first run, so its only edge over download (offline / no-infra) is false while its download surface (hundreds of jars) and failure points (proxy, Nexus, JDK mismatch, compile error) are larger. The whole comparable tool class (JDT-LS, scip-java, Spotless, PMD) ships prebuilt. See *Distribution*. |

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
- **Java runtime required for full tier.** A JRE ≥ 17 on `PATH` enables the full-tier path; below 17 or absent → tree-sitter (the always-present baseline). The gate is keyed on the *runtime* major version, never on the analyzed code's source level (one JRE-17 build analyzes Java 8→21). `ctxo doctor` surfaces the detected runtime and an install hint when below 17. (JRE 21 as a future second tier is deferred for re-evaluation.)
- **We maintain a Java uber-JAR** (~1500 LOC estimate) plus the Maven build — **one artifact, one `maven-shade` build, one pinned JDT Core line (JRE-17 base)**. Mitigation: JDT Core API is stable across minor versions; minimal custom logic beyond AST visiting and binding walking.
- **Prebuilt download dependency.** Full tier requires downloading the JAR once from GitHub Releases (SHA-256 verified). Offline/firewall first-run cannot acquire it → degrades to tree-sitter. This shifts a publishing responsibility onto CI (hermetic build + SHA manifest per release) that the Go/C# plugins do not have.
- **Rare ECJ↔javac divergences** on lambda/preview features. Documented limitation; acceptable because blast-radius precision degrades gracefully (extra or missing edge on a pattern-matching edge case, never project-wide breakage).
- **Classpath heuristics are lossy** when neither IDE metadata nor local-repo JARs are present (fresh clone, no `mvn install` run). Documented in README with remediation: run `mvn dependency:resolve` once, or provide explicit classpath in `.ctxo/config.yaml`.
- **Annotation processors are skipped.** Generated sources (Lombok, MapStruct, Dagger) will not appear in the index until the consumer has run the build once to materialize them on disk. Same limitation as jdt.ls at startup.

## Resolved decisions

Locked at acceptance (2026-06-21). Implemented together in the single `@ctxo/lang-java` deliverable.

| # | Question                                            | Decision                                                                                                                                    |
| - | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | Multi-module Maven reactor / Gradle subprojects     | Detect reactor POMs (`<modules>` element) and Gradle `settings.gradle` `include` directives; build one `IJavaProject` per module.          |
| 2 | JAR build + distribution strategy                   | **Prebuilt download + SHA-256 verify** (build-from-source rejected — see *Distribution* and the 2026-06-21 revision note). CI builds one hermetic `ctxo-jdt-analyzer.jar` (JRE-17 base) and publishes it per `@ctxo/lang-java` version to GitHub Releases. Opt-in acquisition (flag / prompt, not silent) downloads it to `~/.ctxo/cache/lang-java/<version>/` and verifies against a SHA-256 hash pinned in the plugin package. No postinstall hook. SLSA/cosign deferred. |
| 3 | Keep-alive timeout for watch mode                   | 30s idle timeout (matches `@ctxo/lang-csharp`). Stdin JSON request loop: `{fileUri, content}` → re-analyze affected compilation units via JDT incremental builder. |
| 4 | Binding resolution failure behaviour                | Per-file fallback: if JDT fails for file F, composite re-runs tree-sitter on F only (not the whole project). Surface aggregate via `_meta.hint`. |
| 5 | Generics edge representation                        | **Option A** (matches ADR-013): `List[Integer]` and `List[String]` both emit `uses` edges to unconstructed `List`; type arguments preserved on edge metadata for future tooling. |
| 6 | Observability schema                                | `ctxo doctor --json` exposes `{tier, backend: "jdt", jdtVersion, javaVersion, jarVerified, classpathSource, classpathResolved, classpathJars, bindingsResolved, bindingsUnresolved, avgFileMs}`. |
| 7 | Java source level support                           | The single JRE-17 JDT build analyzes source levels Java 8→21 (source level is independent of the running JRE). Default: auto-detect from `pom.xml` `<maven.compiler.source>` or Gradle `sourceCompatibility`; fall back to the highest level the build supports. |
| 8 | Runtime tier & minimum JRE                           | **Single tier, JRE-17 base** (see *Single runtime tier*). JRE ≥ 17 → download + run the full-tier JAR (opt-in); < 17 / absent → tree-sitter. `toolchain-detect.ts` parses `java -version` to a major number. JRE-21 second tier deferred for future re-evaluation. |
| 9 | Follow-up issue dependencies                        | #70 (plugin-api `SymbolKind`/`EdgeKind` extensions), #72 (shared `TreeSitterAdapter`), #73 (hardcoded language tables) are independent — no blocking coupling.       |

## Rollout

Built as one deliverable — no PR #74 prerequisite. Syntax tier and full tier land together.

1. **Scaffold `packages/lang-java/`** — mirror `packages/lang-go` layout: `tree-sitter-adapter.ts` (syntax tier via `tree-sitter-java`), `composite-adapter.ts`, `analyzer/` (full tier), `toolchain-detect.ts`, `logger.ts`, `index.ts`, `tools/ctxo-jdt-analyzer/`.
2. **`packages/lang-java/tools/ctxo-jdt-analyzer/`** — Maven project, `pom.xml` with a single `maven-shade` build producing one uber-JAR (pinned JDT Core line, JRE-17 base); JSON schema matching `RoslynBatchResult` / `GoAnalyzerBatchResult`.
3. **`ClasspathResolver.java`** — user override → IDE metadata → local-repo scan → empty (syntax-only) → tree-sitter fallback. **No `mvn`/`gradle` spawn by default.**
4. **`Analyzer.java`** — `ASTParser.createASTs(...)` batch mode, `resolveBindings(true)`, emit symbols + edges + complexity as JSONL.
5. **`Main.java`** — stdio protocol loop: batch mode (read files list, emit results, exit) + keep-alive mode (accept JSON requests on stdin).
6. **TypeScript side:** `JavaAdapter` (tree-sitter syntax tier, new), `JdtAdapter` (sibling of `RoslynAdapter`), `JdtProcess` (sibling of `RoslynProcess`), `JavaCompositeAdapter` wrapping `JavaAdapter`.
7. **Toolchain detection:** `toolchain-detect.ts` parses `java -version` → major number → ≥ 17 enables full tier, below 17 stays on tree-sitter; `ctxo doctor` reports the detected runtime with an install hint below 17.
8. **JAR distribution:** CI hermetically builds one JAR + emits a SHA-256 manifest, published per `@ctxo/lang-java` version to GitHub Releases. Opt-in (flag / first-index prompt, not silent) download + SHA-256 verify into `~/.ctxo/cache/lang-java/<version>/`; offline/verify-fail → degrade to tree-sitter.
9. **CI regression test:** fixture Maven project where tree-sitter emits 0 `calls` edges but JDT must emit ≥ 50. Floor check prevents silent degradation. Run the JDT path on a JRE 17 leg (the supported floor) and confirm it resolves a Java 21 source fixture.
10. **Validation:** reproduce ADR-007's before/after blast-radius table on a real Java service (Spring Boot backend candidate).
11. Register `@ctxo/lang-java` in plugin discovery, add a changeset, close Issue #69 referencing this ADR.

## References

- Issue #69 — [`lang-java: full tier (JDT/javac analyzer) for resolved call/use edges`](https://github.com/alperhankendi/Ctxo/issues/69)
- PR #74 — original syntax-tier `@ctxo/lang-java` baseline (superseded; syntax + full tier now built together, see *Build sequencing* note above)
- [packages/lang-go/](../../../packages/lang-go/) — closest structural template (tree-sitter + sidecar + lazy-download cache + `toolchain-detect.ts`)
- [ADR-007](adr-007-csharp-roslyn-lsp.md) — sibling decision for C# (Roslyn sidecar pattern)
- [ADR-012](adr-012-plugin-architecture-and-monorepo.md) — plugin boundaries enforced here
- [ADR-013](adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md) — sibling decision for Go (sidecar pattern)
- [packages/lang-csharp/tools/ctxo-roslyn/](../../../packages/lang-csharp/tools/ctxo-roslyn/) — closest reference implementation (Java and C# share the project-file + semantic-compiler shape)
- [packages/lang-csharp/src/composite-adapter.ts](../../../packages/lang-csharp/src/composite-adapter.ts) — reference composite adapter with keep-alive
