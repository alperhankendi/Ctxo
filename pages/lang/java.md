# Java Full-Tier Semantic Analysis

Ctxo provides **compiler-accurate semantic analysis** for Java codebases via Eclipse JDT Core, shipped as a separate companion npm package `@ctxo/lang-java-analyzer` (prebuilt ~15 MB JAR; integrity and provenance via npm). This is the same compiler engine that the Eclipse IDE and many Java tooling projects use internally.

## What You Get

When you run `ctxo index` on a Java project with JRE 17+ installed, Ctxo delivers full semantic analysis powered by Eclipse JDT Core:

| Capability | Syntax Tier (tree-sitter) | Full Tier (JDT) |
|---|---|---|
| Symbol extraction | Top-level classes, methods, fields | All access levels, generics, nested types |
| Edge resolution | File-local heuristics | Cross-file, cross-package via JDT BindingKey |
| Inheritance | Pattern-based | Semantic: `ITypeBinding.getSuperclass()` / `getInterfaces()` |
| Call graph | Absent | Incoming + outgoing via ASTVisitor |
| Complexity | Cyclomatic via tree-sitter | Cyclomatic + cognitive |
| Type resolution | Absent | Generics, overloads, var, wildcards |
| Scope | Per-file | Project-wide (Maven / Gradle) |

One JDT build covers **Java 8 through 21** - no multi-JDK setup required.

## Requirements

* **JRE 17+** on PATH (covers Java 8-21 source and class files)
* **`@ctxo/lang-java-analyzer`** companion package (installed by `ctxo install java` when JRE 17+ is detected)
* If JRE or analyzer is absent, Ctxo falls back to tree-sitter syntax tier automatically
* Detection markers: `pom.xml`, `build.gradle`, `build.gradle.kts`

```Shell
# Check your Java version
java -version

# Install Java support (auto-selects tier based on JRE availability)
ctxo install java

# Force full-tier analyzer install
ctxo install java --full-tier

# Skip analyzer, syntax tier only
ctxo install java --syntax-only

# Index your Java project
ctxo index
```

## How It Works

`@ctxo/lang-java-analyzer` ships a prebuilt JAR inside the npm package. When `ctxo index` detects `.java` files and both JRE 17+ and the analyzer are available:

```
ctxo index
  |
  +-- Detect JRE 17+ on PATH
  +-- Discover pom.xml / build.gradle / build.gradle.kts
  +-- Spawn: java -jar lang-java-analyzer.jar <projectRoot>
  |     |
  |     +-- Eclipse JDT Core: parse + bind all .java files
  |     +-- Single-pass analysis:
  |     |     Symbols: ITypeBinding (classes, methods, fields, constructors)
  |     |     Edges: ASTVisitor (calls, uses, extends, implements)
  |     |     Complexity: cyclomatic + cognitive via ASTNode counting
  |     +-- JSONL output to stdout (streaming, one line per file)
  |     +-- Exit
  |
  +-- Parse results into ctxo index pipeline
  +-- Git history + anti-pattern detection (same as TypeScript)
  +-- Write .ctxo/index/ JSON files
```

**Index time:** ~3-6 seconds for a typical 150-file Java project (semantic analysis included).

## Edge Types Extracted

Eclipse JDT provides **5 semantic edge types** that the syntax tier cannot:

### `extends` - Class Inheritance

```java
public class UserSyncJob extends BaseSyncJob { }
```

```json
{"from": "src/main/java/jobs/UserSyncJob.java::UserSyncJob::class",
 "to": "src/main/java/jobs/BaseSyncJob.java::BaseSyncJob::class",
 "kind": "extends"}
```

JDT uses `ITypeBinding.getSuperclass()` - no heuristic needed. Resolved correctly for generic base classes and multi-level hierarchies.

### `implements` - Interface Implementation

```java
public class UserService implements IUserRepository { }
```

```json
{"from": "src/main/java/services/UserService.java::UserService::class",
 "to": "src/main/java/interfaces/IUserRepository.java::IUserRepository::interface",
 "kind": "implements"}
```

JDT uses `ITypeBinding.getInterfaces()` - semantically correct for multiple interface implementation and generic interfaces.

### `calls` - Method Invocations (Cross-File)

```java
public void execute() {
    List<User> users = userService.getAll();  // cross-file call
    super.logStart();                          // base class call
}
```

```json
{"from": "src/main/java/jobs/UserSyncJob.java::UserSyncJob.execute::method",
 "to": "src/main/java/services/UserService.java::UserService.getAll::method",
 "kind": "calls"}
```

Extracted via JDT's `MethodInvocation` ASTNode with full binding resolution, including overloaded and generic method calls.

### `uses` - Field / Property Access (Cross-File)

```java
String display = user.getDisplayName();  // uses User.getDisplayName
long id = user.id;                       // uses User.id field
```

```json
{"from": "src/main/java/services/UserService.java::UserService.getUserDisplay::method",
 "to": "src/main/java/models/User.java::User.id::variable",
 "kind": "uses"}
```

Tracks `FieldAccess` and `QualifiedName` ASTNodes across file boundaries. Only cross-type references are recorded.

### `imports` - Type Dependencies

```java
import com.example.models.User;
import com.example.interfaces.IUserRepository;
```

```json
{"from": "src/main/java/services/UserService.java::UserService::class",
 "to": "src/main/java/models/User.java::User::class",
 "kind": "imports"}
```

Unlike the syntax tier which records only import strings, JDT resolves import declarations to the actual types referenced in the file.

## Complexity Metrics

Eclipse JDT provides compiler-accurate complexity via `ASTNode` type constants:

**Cyclomatic complexity** - counts decision points:

* `IfStatement`, `ForStatement`, `EnhancedForStatement`, `WhileStatement`, `DoStatement`
* `SwitchStatement`, `SwitchExpression`, `CatchClause`, `ConditionalExpression`
* `InfixExpression` with `&&` / `||` operators

**Cognitive complexity** - adds nesting penalty:

* Each nesting level (if, for, while, switch, catch, lambda) increases the weight
* `ElseStatement` counted with nesting penalty
* More representative of actual code comprehension difficulty

```json
{"symbolId": "src/main/java/services/UserService.java::UserService.getUserDisplay::method",
 "cyclomatic": 3, "cognitive": 2}
```

## MCP Tools Enhanced by Full Tier

All 14 MCP tools automatically benefit from semantic edges:

| Tool | Syntax Tier | Full Tier |
|---|---|---|
| `get_blast_radius` | 0 impact (edges missing) | Full impact with confirmed/likely/potential tiers |
| `find_importers` | 0 results | Cross-file transitive importers |
| `get_class_hierarchy` | Absent | Semantic extends/implements tree |
| `get_symbol_importance` | PageRank on partial graph | PageRank on complete dependency graph |
| `get_logic_slice` | Incomplete closure | Full transitive dependency closure |
| `search_symbols` | Public symbols only | All symbols (all access levels) |
| `get_context_for_task` | Limited accuracy | Semantic edges for fix/extend/refactor/understand |
| `get_pr_impact` | Partial risk assessment | Full risk with call graph + co-changes |

## Active Tier Detection

The active tier is shown in:

- `ctxo index` output: `Java: N files (full tier)` or `Java: N files (syntax tier - JRE 17+ + @ctxo/lang-java-analyzer for full analysis)`
- `ctxo doctor`: reports JRE presence and analyzer install status
- MCP `_meta`: `"tier": "full"` or `"tier": "syntax"` per language entry

## Fallback Behavior

If JRE 17+ is not on PATH or the analyzer package is absent:

1. Ctxo logs: `[ctxo:java] JDT analyzer unavailable: JRE 17+ not found` (or `analyzer not installed`)
2. Falls back to tree-sitter Java adapter (syntax tier)
3. Index summary shows: `Java: N files (syntax tier - JRE 17+ + @ctxo/lang-java-analyzer for full analysis)`
4. All 14 MCP tools still work, but with reduced accuracy for Java symbols

No error, no crash - graceful degradation to the best available analysis.

## Comparison with C# Analysis

| Aspect | Java (Eclipse JDT) | C# (Roslyn) |
|---|---|---|
| Parser | Eclipse JDT Core | Roslyn Compiler API |
| Tier | Full (via companion package) | Full (via bundled tools/ctxo-roslyn) |
| Cross-file | Via JDT BindingKey | Via MSBuildWorkspace |
| Call graph | ASTVisitor (MethodInvocation) | IOperation tree (semantic) |
| Inheritance | `getSuperclass()` / `getInterfaces()` | `BaseType` / `Interfaces` |
| Complexity | ASTNode counting | SyntaxKind counting |
| Prerequisites | JRE 17+ + `@ctxo/lang-java-analyzer` | .NET SDK 8+ (external) |
| Build systems | Maven, Gradle | MSBuild (.sln / .csproj) |
| Java versions | Java 8-21 (single JDT build) | N/A |

Both languages have full semantic analysis. Java full tier ships as an opt-in companion npm package; C# full tier is bundled inside `@ctxo/lang-csharp`.
