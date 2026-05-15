# @ctxo/lang-java

Ctxo Java language plugin — `syntax` tier, built on `tree-sitter-java`.

## Install

```bash
pnpm add -D @ctxo/lang-java
# or
npm install --save-dev @ctxo/lang-java
```

The Ctxo CLI auto-detects Java projects (`pom.xml`, `build.gradle`, `build.gradle.kts`, `.java` files) and prompts to install this plugin during `ctxo init`.

## Coverage

### Symbols
| Java construct          | Ctxo `SymbolKind` | Name format             |
| ----------------------- | ----------------- | ----------------------- |
| `class`                 | `class`           | `ClassName`             |
| `interface`             | `interface`       | `InterfaceName`         |
| `enum`                  | `class`           | `EnumName`              |
| `record`                | `class`           | `RecordName`            |
| Method                  | `method`          | `EnclosingType.method`  |
| Constructor             | `method`          | `ClassName.ClassName`   |
| Nested type             | (as above)        | `Outer.Inner`           |

### Edges
| Java construct                       | `EdgeKind`    |
| ------------------------------------ | ------------- |
| `import com.foo.Bar;`                | `imports`     |
| `import static com.foo.Bar.X;`       | `imports` (normalized to `com.foo.Bar`) |
| `import com.foo.*;`                  | (skipped — no actionable target) |
| `class A extends B`                  | `extends`     |
| `class A implements I`               | `implements`  |
| `interface A extends B`              | `extends`     |

Edge targets are name-keyed (`TypeName::TypeName::kind`) and resolved against the cross-file symbol registry that the indexer populates in pass 1. When the target type is in the indexed corpus, the resolver binds the edge to the real symbol ID. Otherwise the name-keyed fallback remains, allowing name-based lookups by downstream consumers.

### Cyclomatic complexity
Branch nodes counted: `if`, `for`, `enhanced_for`, `while`, `do`, `switch_label`, `catch_clause`, `ternary_expression`, plus `&&` / `||` short-circuit operators.

## Known limitations

These constructs are NOT yet surfaced — they require new `SymbolKind`/`EdgeKind` values in `@ctxo/plugin-api`:

- Sealed type `permits` clauses
- Enum constants with bodies (and abstract enum methods)
- Instance and static initializer blocks
- Anonymous inner classes
- Lambda bodies (the enclosing method is captured; the lambda itself is not surfaced as a symbol)

Files containing only a `package` declaration plus imports (no top-level type, e.g. `package-info.java`) are skipped — there is no top-level symbol to anchor `imports` edges against. This matches the behavior of `@ctxo/lang-go`.

## Tier

Reports `tier: 'syntax'`. A future `full` tier (built on JDT or `javac`) would add resolved call/use edges and richer type information; tracked as a follow-up.

## License

MIT
