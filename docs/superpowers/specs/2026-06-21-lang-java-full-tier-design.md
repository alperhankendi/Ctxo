# Design — `@ctxo/lang-java` Full-Tier (single deliverable)

| Field | Value |
|---|---|
| **Date** | 2026-06-21 |
| **Status** | Approved (brainstorming complete; ready for implementation plan) |
| **Author** | Alper Hankendi |
| **Decision record** | [ADR-014](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md) (decisions + rationale) |
| **Scope** | This spec is the buildable implementation design. ADR-014 holds the *why*; this holds the *what to build*. |

## Goal

Ship `@ctxo/lang-java` as one deliverable that gives Java projects the same full-tier
fidelity C# reached with Roslyn: resolved `calls`/`uses` edges, cross-file symbol IDs,
generics, and partial bindings on broken builds — via an Eclipse JDT Core sidecar JAR —
with a tree-sitter syntax tier as the always-present, zero-setup baseline.

No PR #74 prerequisite: syntax tier and full tier land together.

## Key locked decisions (from ADR-014, post party-mode review)

1. **Distribution = prebuilt download + SHA-256 verify.** Build-from-source (Maven/`mvnw`) rejected.
2. **Single runtime tier, JRE-17 base.** One JDT build analyzes Java 8→21 (source level is independent of the running JRE). JRE-21 second tier deferred for future re-evaluation.
3. **tree-sitter is the always-present baseline; full tier is opt-in** (flag / first-index prompt, never a silent download).
4. **SHA-256 mandatory; SLSA provenance + cosign deferred** as nice-to-have.
5. **Classpath resolution: full 5-source strategy** (config → IDE metadata → local-repo scan → empty → tree-sitter).
6. **Watch/keep-alive included** in this deliverable (not deferred).
7. **plugin-api untouched** — Java constructs map onto the existing 6 `SymbolKind`s / 5 `EdgeKind`s (issue #70 not triggered).

## Package structure (mirrors `packages/lang-go`)

```
packages/lang-java/
├── package.json                         # @ctxo/lang-java; deps: @ctxo/plugin-api, tree-sitter, tree-sitter-java
├── src/
│   ├── index.ts                         # plugin entry → JavaCompositeAdapter factory; isSupported('.java')
│   ├── composite-adapter.ts             # JavaCompositeAdapter: picks full(JDT) | tree-sitter at initialize()
│   ├── tree-sitter-adapter.ts           # JavaAdapter: syntax tier (symbols, imports/extends/implements, complexity)
│   ├── logger.ts                        # minimal logger (NO @ctxo/cli runtime dep)
│   ├── analyzer/
│   │   ├── jdt-adapter.ts               # JdtAdapter (sibling of RoslynAdapter / GoAnalyzerAdapter)
│   │   ├── jdt-process.ts               # runBatchIndex() + JdtKeepAlive (watch)
│   │   ├── jar-download.ts              # ensureAnalyzerJar(): opt-in download + SHA-256 verify + cache
│   │   └── toolchain-detect.ts          # detectJavaRuntime(): parse `java -version` → major; gate ≥ 17
│   └── __tests__/
└── tools/ctxo-jdt-analyzer/             # Java source (built in CI, NOT shipped in npm tarball)
    ├── pom.xml                          # single maven-shade build, pinned JDT Core (JRE-17 base)
    ├── Main.java                        # stdio loop: batch mode + keep-alive mode
    ├── Analyzer.java                    # ASTParser.createASTs(...) + resolveBindings(true) → JSONL
    └── ClasspathResolver.java           # 5-source classpath resolution
```

**Boundary rule:** `@ctxo/cli` sees only `ILanguageAdapter` from `@ctxo/plugin-api`. Zero new
dependency in `packages/cli/package.json`. No `java`/JDT logic in `packages/cli/src/`.

## Components & responsibilities

### TypeScript side

| Unit | Responsibility | Depends on |
|---|---|---|
| `index.ts` | Export the plugin factory returning `JavaCompositeAdapter`; declare `.java` support. | composite |
| `JavaCompositeAdapter` | At `initialize(rootDir)`: run `detectJavaRuntime()`; if ≥ 17 **and** a verified JAR is cached, activate `JdtAdapter` (full); else activate `JavaAdapter` (tree-sitter). Delegate `extractSymbols`/`extractEdges` to the active tier. **`extractComplexity` ALWAYS from tree-sitter.** Expose `getTier()`. | JdtAdapter, JavaAdapter, toolchain-detect |
| `JavaAdapter` (tree-sitter) | Syntax tier via `tree-sitter-java`: symbols (incl. enum/record/annotation/constructor/field), `imports`/`extends`/`implements`, cyclomatic complexity. Broken-code tolerant. Standalone-usable. | tree-sitter |
| `JdtAdapter` | Full tier. `initialize()` uses the **already-cached, verified** JAR (it does NOT auto-download — acquisition is the separate opt-in flow); classpath resolution is delegated to the JAR (`ClasspathResolver.java`); spawns batch. `isReady()` false when no usable JAR. Maps JAR JSONL → `SymbolNode`/`GraphEdge`. | jdt-process, toolchain-detect |
| `JdtProcess` | `runBatchIndex(projectDir, classpath, timeout)` (one-shot) + `JdtKeepAlive` (watch: stdin `{file}` → JSONL `file` result; 30s idle shutdown; per-request timeout). | node:child_process |
| `jar-download.ts` | `ensureAnalyzerJar(version)`: opt-in download from GitHub Releases → SHA-256 verify against hash pinned in package → cache `~/.ctxo/cache/lang-java/<version>/`. Returns path or null (degrade). | node:crypto, node:fs, https |
| `toolchain-detect.ts` | `detectJavaRuntime()`: parse `java -version` → `{available, major, version}`; `available = major ≥ 17`. | node:child_process |
| `logger.ts` | `createLogger('ctxo:lang-java')` — bundled minimal logger (no `@ctxo/cli` dep). | — |

### Java side (`tools/ctxo-jdt-analyzer/`)

| Unit | Responsibility |
|---|---|
| `Main.java` | stdio protocol. Batch mode: read file list + classpath, emit JSONL (`file`/`progress`/`done`), exit. Keep-alive mode (`--keep-alive`): accept `{file}` requests on stdin, re-analyze affected compilation units, emit `file` results; `ready` on startup. |
| `Analyzer.java` | `ASTParser.createASTs(files[], ...)` batch, `resolveBindings(true)`. Emit **symbols + edges** as JSONL (complexity omitted — sourced from tree-sitter, mirrors lang-go). Partial-binding tolerant: unresolved bindings marked, never fatal. |
| `ClasspathResolver.java` | Resolve dependency JARs in order: (1) `.ctxo/config.yaml` `java.classpath` override → (2) IDE metadata (`.classpath`, `.idea/libraries/*.xml`) → (3) local-repo scan (`~/.m2/repository`, `~/.gradle/caches/...`) keyed off coordinates parsed from `pom.xml` (XML) / `build.gradle` (regex) → (4) empty (intra-file bindings only) → (signal caller to) tree-sitter. **No `mvn`/`gradle` child process by default** (`--allow-build-tools` / `java.allowBuildToolExecution` opts in). Multi-module: reactor POM `<modules>` + Gradle `settings.gradle` `include` → one `IJavaProject` per module. |

## Data flow

**Index (batch):**
```
cli → JavaCompositeAdapter.extractSymbols/Edges
    → (full) JdtAdapter → JdtProcess.runBatchIndex → `java -jar ctxo-jdt-analyzer.jar batch`
    → JSONL → map to SymbolNode / GraphEdge
complexity → JavaAdapter (tree-sitter) always
```

**Watch (keep-alive):**
```
cli watcher → JavaCompositeAdapter → JdtKeepAlive.analyzeFile({file, content})
    → JDT incremental builder re-analyzes affected compilation units → JSONL file result
30s idle → keep-alive shuts down
```

**Tier selection (`initialize`):** `detectJavaRuntime() ≥ 17` AND verified JAR cached → full; else tree-sitter.

## Acquisition / opt-in flow

1. tree-sitter active day-one (zero network/JDK/download).
2. Full tier requested explicitly: `ctxo install java --full-tier` **or** interactive "download full-tier analyzer?" prompt on first Java index (non-interactive declines → tree-sitter).
3. `ensureAnalyzerJar`: download from GitHub Releases → SHA-256 verify (hash pinned in plugin package) → cache. Mismatch/offline/fail → reject + degrade to tree-sitter with a clear message. **Index never blocks.**

## Symbol / edge mapping (no plugin-api change)

**Symbol kinds** (onto existing 6, C# precedent): `class`→`class`, `interface`→`interface`,
`enum`→`type`, `record`→`class`, `annotation`→`interface`, `method`/`constructor`→`method`,
`field`→`variable`.

**Edge kinds** (ADR-014 table): `import`→`imports`; `extends`→`extends`; `implements`→`implements`;
`new Foo()`→`calls`+`uses`; static/instance/`Type::method` call→`calls`; lambda w/ target type→`implements`;
`@Annotation`→`uses`; generic arg / field / param / return / `throws` type→`uses`.

**JSON contract:** identical shape to `RoslynBatchResult` (`file`/`projectGraph`/`progress`/`done`
records; `{symbolId, name, kind, startLine, endLine, startOffset?, endOffset?}` symbols;
`{from, to, kind}` edges). Symbol ID format: `<relativeFile>::<name>::<kind>`.

## Error handling (warn-and-continue at adapter boundary)

| Failure | Behaviour |
|---|---|
| No JRE / JRE < 17 | tree-sitter; `ctxo doctor` install hint |
| JAR not downloaded (opt-in not taken) | tree-sitter |
| Download fail / SHA mismatch | reject JAR, tree-sitter, clear message |
| JDT fails for file F | composite re-runs tree-sitter on F only; aggregate via `_meta.hint` |
| Classpath unresolved | empty classpath (intra-file bindings); still better than tree-sitter for same-file overloads |
| JAR process crash/timeout | empty result, log stderr, file marked unindexed |

## Observability

`ctxo doctor --json`: `{tier, backend:"jdt", jdtVersion, javaVersion, jarVerified,
classpathSource, classpathResolved, classpathJars, bindingsResolved, bindingsUnresolved, avgFileMs}`.

## Test strategy

- **TS unit:** `toolchain-detect` version parsing (incl. ≥17 gate, missing JRE); `jar-download` SHA-256 verify (mocked fetch, mismatch path); composite tier selection; JSONL parse; graceful degradation (no JRE / download fail / hash mismatch / JDT per-file failure).
- **Java unit:** `Analyzer` on fixtures (overloads, generics, method refs, lambdas, annotations); `ClasspathResolver` source precedence + multi-module.
- **CI regression:** fixture Maven project — tree-sitter emits 0 `calls`, JDT must emit ≥ 50 (floor check prevents silent degradation). JRE-17 CI leg must resolve a Java 21 source fixture.
- **Framework:** vitest (+ `InMemoryTransport` where MCP-integration relevant). Tests co-located in `__tests__/`.

## Build sequencing (internal order — each step leaves something working)

1. Scaffold `packages/lang-java/` (package.json, tsconfig, index.ts, logger.ts).
2. **tree-sitter syntax tier** (`JavaAdapter`) — standalone, day-one value, full test coverage.
3. **Java analyzer** (`pom.xml` single shade + `Main`/`Analyzer`/`ClasspathResolver`) — JSONL contract + Java unit tests.
4. **TS full-tier wiring** (`toolchain-detect`, `jar-download`, `JdtAdapter`, `JdtProcess` batch) + `JavaCompositeAdapter` tier selection.
5. **Watch / keep-alive** (`JdtKeepAlive` + incremental).
6. **CI**: hermetic JAR build + SHA-256 manifest + GitHub Releases publish; regression floor test.
7. **Integration**: `ctxo doctor` fields, plugin discovery registration, changeset, close issue #69.

## Residual risks to verify during implementation

- **JDT Core artifact coordinate**: pin the exact `org.eclipse.jdt:org.eclipse.jdt.core` (or `ecj`) version that runs on JRE 17 *and* parses Java 21; test the runtime×source-level matrix.
- **Hermetic CI build**: deterministic JAR + auto-generated SHA-256 manifest (no manual hashing).
- **Offline first-run UX**: download-fail path must degrade silently-but-messaged; never block the index.
- **Annotation processors skipped** (Lombok/MapStruct/Dagger): generated sources absent until the consumer builds once — document in README.
