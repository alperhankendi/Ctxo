# C# Full-Tier Semantic Analysis

Ctxo provides **compiler-accurate semantic analysis** for C# codebases via a standalone .NET console app powered by the Roslyn Compiler API. This is the same compiler engine that Visual Studio and the .NET SDK use internally.

## What You Get

When you run `ctxo index` on a C# project with .NET SDK 8+ installed, Ctxo delivers full semantic analysis powered by the Roslyn Compiler API:

| Capability | Full Tier (Roslyn) |
|---|---|
| Symbol extraction | All access levels, generics, properties, events, delegates |
| Edge resolution | Cross-file, cross-project via SymbolFinder |
| Inheritance | Semantic: `BaseType` vs `Interfaces` (compiler-accurate) |
| Call graph | Incoming (`FindCallersAsync`) + outgoing (IOperation tree) |
| Complexity | Cyclomatic + cognitive via `SyntaxKind` enum |
| Type resolution | Generics, overloads, implicit types, var, nullable |
| Scope | Solution-wide (.sln/.csproj) |

## Requirements

* **.NET SDK 8.0 or later** (8.0, 9.0, 10.0+ all supported)
* If .NET SDK is not installed, Ctxo falls back to tree-sitter syntax tier automatically
* No configuration needed - auto-discovers `.sln` and `.csproj` files

```Shell
# Check your .NET SDK version
dotnet --version

# Index your C# project
npx @ctxo/cli index
```

## How It Works

Ctxo ships a lightweight .NET console app (`tools/ctxo-roslyn/`) inside the npm package. When `ctxo index` detects `.cs` files and .NET SDK is available:

```
ctxo index
  |
  +-- Detect .NET SDK >= 8.0
  +-- Discover .sln (auto-search, up to 3 levels deep)
  +-- Spawn: dotnet run --project tools/ctxo-roslyn -- solution.sln
  |     |
  |     +-- MSBuildWorkspace.OpenSolutionAsync()
  |     +-- Single-pass analysis of ALL .cs files:
  |     |     Symbols: GetDeclaredSymbol (classes, methods, properties, fields, events)
  |     |     Edges: IOperation tree (calls, uses, creates) + BaseType/Interfaces (extends, implements)
  |     |     Complexity: SyntaxKind counting (cyclomatic + cognitive)
  |     +-- JSONL output to stdout (streaming, one line per file)
  |     +-- Exit
  |
  +-- Parse results into ctxo index pipeline
  +-- Git history + anti-pattern detection (same as TypeScript)
  +-- Write .ctxo/index/ JSON files
```

**Index time:** \~3-5 seconds for a typical 150-file C# solution (semantic analysis included).

## Edge Types Extracted

Roslyn provides **5 semantic edge types** that the syntax tier cannot:

### `extends` - Class Inheritance

```C#
public class UserSyncJob : BaseSyncJob { }
```

```JSON
{"from": "src/Jobs/UserSyncJob.cs::UserSyncJob::class",
 "to": "src/Jobs/BaseSyncJob.cs::BaseSyncJob::class",
 "kind": "extends"}
```

Roslyn uses `INamedTypeSymbol.BaseType` - no heuristic needed. The syntax tier used an I-prefix pattern (`IFoo` = interface, everything else = extends) which fails for cases like `class Foo : BaseService`.

### `implements` - Interface Implementation

```C#
public class UserService : IUserRepository { }
```

```JSON
{"from": "src/Services/UserService.cs::UserService::class",
 "to": "src/Interfaces/IUserRepository.cs::IUserRepository::interface",
 "kind": "implements"}
```

Roslyn uses `INamedTypeSymbol.Interfaces` - semantically correct for multiple interface implementation, default interface methods, and covariant/contravariant interfaces.

### `calls` - Method Invocations (Cross-File)

```C#
public override async Task ExecuteAsync() {
    var users = _userService.GetAll();    // cross-file call
    LogStart();                            // base class call
}
```

```JSON
{"from": "src/Jobs/UserSyncJob.cs::UserSyncJob.ExecuteAsync::method",
 "to": "src/Services/UserService.cs::UserService.GetAll::method",
 "kind": "calls"}
```

Extracted via Roslyn's `IOperation` tree (`IInvocationOperation`). Resolves the exact target method including overload resolution, generic inference, and extension method binding.

### `uses` - Property/Field Access (Cross-File)

```C#
var display = user.GetDisplayName();  // uses User.GetDisplayName
var id = user.Id;                     // uses User.Id property
```

```JSON
{"from": "src/Services/UserService.cs::UserService.GetUserDisplay::method",
 "to": "src/Models/User.cs::User.Id::variable",
 "kind": "uses"}
```

Tracks `IPropertyReferenceOperation` and `IFieldReferenceOperation` across file boundaries. Only cross-type references are recorded (same-class field access is filtered).

### `imports` - Type Dependencies

```C#
using CsharpSample.Models;    // resolved to actual types used
using CsharpSample.Interfaces;
```

```JSON
{"from": "src/Services/UserService.cs::UserService::class",
 "to": "src/Models/User.cs::User::class",
 "kind": "imports"}
```

Unlike the syntax tier which only recorded namespace strings, Roslyn resolves `using` directives to the actual types referenced in the file.

## Complexity Metrics

Roslyn provides compiler-accurate complexity via `SyntaxKind` enum:

**Cyclomatic complexity** - counts decision points:

* `IfStatement`, `ForStatement`, `ForEachStatement`, `WhileStatement`, `DoStatement`
* `SwitchStatement`, `SwitchExpression`, `CatchClause`, `ConditionalExpression`
* `LogicalAndExpression`, `LogicalOrExpression`, `CoalesceExpression`

**Cognitive complexity** - adds nesting penalty:

* Each nesting level (if, for, while, switch, catch, lambda) increases the weight
* `ElseClause` counted with nesting penalty
* More representative of actual code comprehension difficulty

```JSON
{"symbolId": "src/Services/UserService.cs::UserService.GetUserDisplay::method",
 "cyclomatic": 3, "cognitive": 2}
```

## MCP Tools Enhanced by Full Tier

All 14 MCP tools automatically benefit from semantic edges:

| Tool                    | Syntax Tier               | Full Tier                                         |
| ----------------------- | ------------------------- | ------------------------------------------------- |
| `get_blast_radius`      | 0 impact (edges missing)  | 35 impact, risk 1.0, 4 depth levels               |
| `find_importers`        | 0 results                 | 34 importers, cross-file transitive               |
| `get_class_hierarchy`   | I-prefix heuristic        | Semantic extends/implements tree                  |
| `get_symbol_importance` | PageRank on partial graph | PageRank on complete dependency graph             |
| `get_logic_slice`       | Incomplete closure        | Full transitive dependency closure                |
| `search_symbols`        | Public symbols only       | All 2382 symbols (all access levels)              |
| `get_context_for_task`  | Limited accuracy          | Semantic edges for fix/extend/refactor/understand |
| `get_pr_impact`         | Partial risk assessment   | Full risk with call graph + co-changes            |

## Real-World Example: CaasBackend

Enterprise C# backend, 166 files, 2 projects:

```
$ npx @ctxo/cli index
[ctxo:roslyn] Roslyn adapter ready: SDK 10.0.201, solution src/CaaSTeamsService.sln
[ctxo:roslyn] Solution loaded: 2 projects, 167 .cs files
[ctxo:roslyn] Roslyn batch index: 167 files in 3.7s
[ctxo] Index complete: 166 files indexed
[ctxo]   C#: 166 files (full tier)
```

**BaseSyncJob refactoring analysis (single tool call):**

```
get_blast_radius("BaseSyncJob")
-> impactScore: 35, riskScore: 1.0 (MAXIMUM)
-> 17 direct subclass dependents:
   ChatSync, ChatEventSync, UserSync, UserRetainedMessageSync,
   TeamSync, ChannelSync, ChannelMessages, ChannelRetainedMessages,
   TeamsAttachmentDownloader, MeetingCollector, MeetingEnable,
   OnlineMeetingCollector, VoiceCallCollector, UserMessageSyncJob,
   HostedImageDownloadJob, AttachmentDownloadJob, TenantSync
-> Transitive impact: 35 symbols across 4 depth levels
-> Orchestration layer: ScheduleManager, JobTracker
-> Entry points: MainLoopAsync, SyncEndpoints, ServiceRunCommand

get_symbol_importance("BaseSyncJob")
-> Logger:            57 inDegree (highest PageRank)
-> ConnectionFactory:  27 inDegree
-> Settings:           23 inDegree
-> SyncTrackerService: 21 inDegree
-> ExecuteAsync:        7 inDegree (template method pattern)
```

**Before Roslyn (syntax tier):** AI assistant needed 10+ Read/Grep tool calls, found 0 dependents via ctxo.
**After Roslyn (full tier):** Single `get_blast_radius` call returns complete picture.

## Watch Mode (Keep-Alive)

For `ctxo watch`, the Roslyn process stays alive and uses incremental recompilation:

```
ctxo watch
  |
  +-- Start Roslyn keep-alive process (load solution once: 3-5s)
  +-- File change detected -> stdin: {"file": "src/UserService.cs"}
  +-- Roslyn: solution.WithDocumentText() -> incremental recompile (<100ms)
  +-- stdout: updated symbols + edges for changed file
  +-- Repeat until Ctrl+C or inactivity timeout (5 min)
```

Roslyn's `Solution` is immutable + snapshot-based. `WithDocumentText()` creates a new solution reusing all unchanged compilations. Only the changed file's semantic model is recomputed.

## Configuration

Optional settings in `.ctxo/config.yaml`:

```YAML
csharp:
  mode: keep-alive      # "keep-alive" (default) | "one-shot"
  timeout: 300           # keep-alive inactivity timeout in seconds
  solution: ./src/My.sln # explicit .sln path (default: auto-discover)
```

Most projects need no configuration - Ctxo auto-discovers the `.sln` file.

## What Roslyn Can and Cannot Resolve

### Fully Resolved (compiler-accurate)

* All type references (generics, nullable, var, tuples, anonymous)
* Cross-file symbol resolution (partial classes, extension methods, global usings)
* Method overload resolution (exact overload the compiler selects)
* Inheritance chains (multiple interfaces, default interface methods, records)
* Async/await patterns, LINQ, lambda/delegate binding
* Operator overloads, implicit/explicit conversions

### Not Resolvable (inherent to static analysis)

* Reflection-based calls (`typeof(X).GetMethod("Y")`)
* `dynamic` keyword operations
* DI container resolution (which implementation is injected at runtime)
* Runtime polymorphism (which virtual override runs at a specific call site)

These limitations are shared by all static analyzers in any language - they are fundamental to the halting problem, not Roslyn-specific.

## Fallback Behavior

If .NET SDK is not installed or the solution fails to load:

1. Ctxo logs: `[ctxo:roslyn] Roslyn adapter unavailable: .NET SDK not found`
2. Falls back to tree-sitter C# adapter (syntax tier)
3. Index summary shows: `C#: N files (syntax tier - .NET SDK 8+ for full analysis)`
4. All 14 MCP tools still work, but with reduced accuracy for C# symbols

No error, no crash - graceful degradation to the best available analysis.

## Comparison with TypeScript Analysis

| Aspect        | TypeScript (ts-morph)              | C# (Roslyn)                |
| ------------- | ---------------------------------- | -------------------------- |
| Parser        | TypeScript Compiler API            | Roslyn Compiler API        |
| Tier          | Full (since V1)                    | Full (since V2 / v0.6.0)   |
| Cross-file    | Via project preloading             | Via MSBuildWorkspace       |
| Call graph    | Syntax-based                       | IOperation tree (semantic) |
| Inheritance   | `getExtends()` / `getImplements()` | `BaseType` / `Interfaces`  |
| Complexity    | SyntaxKind counting                | SyntaxKind counting        |
| Prerequisites | None (ts-morph bundled)            | .NET SDK 8+ (external)     |

Both languages now have full semantic analysis. The main difference is that TypeScript analysis is bundled (no external dependency), while C# requires .NET SDK installed on the machine.
