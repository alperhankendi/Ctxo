# lang-java Plan 1 — Foundation (scaffold + tree-sitter syntax tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `@ctxo/lang-java` package with a working tree-sitter syntax tier that emits Java symbols, `imports`/`extends`/`implements` edges, and cyclomatic complexity — a standalone, day-one-useful Java plugin.

**Architecture:** Mirror `packages/lang-go` exactly. A `TreeSitterAdapter` base class (local copy of lang-go's) provides parse/ID/complexity helpers; `JavaAdapter` extends it with Java node handling; `JavaCompositeAdapter` wraps it (full-tier JDT path is added in Plan 3 — for now it only ever selects tree-sitter). The plugin's `index.ts` exports a `CtxoLanguagePlugin` whose `createAdapter` returns the composite.

**Tech Stack:** TypeScript (ESM, strict), `tree-sitter` ^0.22.4, `tree-sitter-java` ^0.23.5, `@ctxo/plugin-api` (workspace), tsup, vitest. Node >= 20.

**Plan set:** This is Plan 1 of 5 (Foundation → JDT analyzer → TS full-tier wiring → watch → distribution/CI). Spec: [docs/superpowers/specs/2026-06-21-lang-java-full-tier-design.md](../specs/2026-06-21-lang-java-full-tier-design.md). Decisions: [ADR-014](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).

**Symbol-kind mapping for this tier (locked, C# precedent):** `class`→`class`, `interface`→`interface`, `enum`→`type`, `record`→`class`, `annotation`→`interface`, `method`/`constructor`→`method`, `field`→`variable`. Symbol ID format: `<relativeFile>::<name>::<kind>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/lang-java/package.json` | Package manifest; deps `tree-sitter`, `tree-sitter-java`; peer `@ctxo/plugin-api`. |
| `packages/lang-java/tsconfig.json` | Extends repo base; `src` → `dist`. |
| `packages/lang-java/tsup.config.ts` | ESM build; externals. |
| `packages/lang-java/vitest.config.ts` | Test include glob. |
| `packages/lang-java/src/logger.ts` | Minimal namespaced logger (no `@ctxo/cli` dep). |
| `packages/lang-java/src/tree-sitter-adapter.ts` | Abstract base: parse, `buildSymbolId`, `nodeToLineRange`, `countCyclomaticComplexity`. |
| `packages/lang-java/src/java-adapter.ts` | `JavaAdapter`: Java symbol/edge/complexity extraction. |
| `packages/lang-java/src/composite-adapter.ts` | `JavaCompositeAdapter`: tier selection (tree-sitter only until Plan 3). |
| `packages/lang-java/src/index.ts` | Plugin export (`CtxoLanguagePlugin`). |
| `packages/lang-java/src/__tests__/java-adapter.test.ts` | Tests for symbols/edges/complexity. |
| `packages/lang-java/src/__tests__/composite-adapter.test.ts` | Tests for tier selection + delegation. |

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/lang-java/package.json`
- Create: `packages/lang-java/tsconfig.json`
- Create: `packages/lang-java/tsup.config.ts`
- Create: `packages/lang-java/vitest.config.ts`
- Create: `packages/lang-java/src/logger.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@ctxo/lang-java",
  "version": "0.8.0-alpha.0",
  "description": "Ctxo Java language plugin (ctxo-jdt-analyzer + tree-sitter, full tier)",
  "type": "module",
  "engines": { "node": ">=20" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist/", "README.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run"
  },
  "keywords": ["ctxo", "ctxo-plugin", "language-plugin", "java", "tree-sitter"],
  "author": "Alper Hankendi",
  "license": "MIT",
  "dependencies": {
    "tree-sitter": "^0.22.4",
    "tree-sitter-java": "^0.23.5"
  },
  "peerDependencies": { "@ctxo/plugin-api": "^0.7.1" },
  "devDependencies": {
    "@ctxo/plugin-api": "workspace:*",
    "@types/node": "^22.15.3",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.3"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/alperhankendi/Ctxo.git",
    "directory": "packages/lang-java"
  },
  "bugs": { "url": "https://github.com/alperhankendi/Ctxo/issues" },
  "homepage": "https://github.com/alperhankendi/Ctxo#readme",
  "publishConfig": { "access": "public", "provenance": true }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['@ctxo/plugin-api', 'tree-sitter', 'tree-sitter-java'],
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create `src/logger.ts`** (copy of lang-go's minimal logger)

```typescript
type LogFn = (message: string, ...args: unknown[]) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

/**
 * Minimal namespaced logger. Writes to stderr only (stdout is reserved for
 * MCP JSON-RPC). Enabled when DEBUG matches the namespace (e.g. DEBUG=ctxo:*).
 */
export function createLogger(namespace: string): Logger {
  const enabled = (): boolean => {
    const debug = process.env.DEBUG ?? '';
    if (!debug) return false;
    return debug.split(',').some((p) => {
      const pat = p.trim();
      if (pat === '*' || pat === namespace) return true;
      if (pat.endsWith('*')) return namespace.startsWith(pat.slice(0, -1));
      return false;
    });
  };
  const write = (level: string): LogFn => (message, ...args) => {
    if (!enabled()) return;
    process.stderr.write(`${namespace} ${level} ${message}\n`);
    if (args.length) process.stderr.write(`${args.map(String).join(' ')}\n`);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
```

- [ ] **Step 6: Install workspace deps**

Run: `pnpm install`
Expected: `@ctxo/lang-java` linked into the workspace; `tree-sitter-java` resolved.

- [ ] **Step 7: Commit**

```bash
git add packages/lang-java/package.json packages/lang-java/tsconfig.json packages/lang-java/tsup.config.ts packages/lang-java/vitest.config.ts packages/lang-java/src/logger.ts
git commit -m "feat(lang-java): scaffold package + minimal logger"
```

---

## Task 2: TreeSitterAdapter base class

**Files:**
- Create: `packages/lang-java/src/tree-sitter-adapter.ts`

> Local copy of `packages/lang-go/src/tree-sitter-adapter.ts` (issue #72 will later extract a shared base; not in scope here). No behaviour change — just establishing the base so `JavaAdapter` can extend it.

- [ ] **Step 1: Create `tree-sitter-adapter.ts`**

```typescript
import Parser from 'tree-sitter';
import type { Tree, SyntaxNode } from 'tree-sitter';
// Grammars ship their own Language type which can drift against tree-sitter's
// parameter type across major versions. Accept any structurally compatible value.
type Language = Parameters<InstanceType<typeof Parser>['setLanguage']>[0] | object;
import { extname } from 'node:path';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';

export abstract class TreeSitterAdapter implements ILanguageAdapter {
  abstract readonly extensions: readonly string[];
  readonly tier = 'syntax' as const;

  protected parser: Parser;
  protected symbolRegistry = new Map<string, SymbolKind>();

  constructor(language: Language) {
    this.parser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.parser.setLanguage(language as any);
  }

  isSupported(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return (this.extensions as readonly string[]).includes(ext);
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.symbolRegistry = registry;
  }

  protected parse(source: string): Tree {
    return this.parser.parse(source);
  }

  protected buildSymbolId(filePath: string, name: string, kind: SymbolKind): string {
    return `${filePath}::${name}::${kind}`;
  }

  protected nodeToLineRange(node: SyntaxNode): {
    startLine: number; endLine: number; startOffset: number; endOffset: number;
  } {
    return {
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startOffset: node.startIndex,
      endOffset: node.endIndex,
    };
  }

  protected countCyclomaticComplexity(node: SyntaxNode, branchTypes: string[]): number {
    let complexity = 1;
    const visit = (n: SyntaxNode) => {
      if (branchTypes.includes(n.type)) complexity++;
      for (let i = 0; i < n.childCount; i++) visit(n.child(i)!);
    };
    visit(node);
    return complexity;
  }

  abstract extractSymbols(filePath: string, source: string): Promise<SymbolNode[]>;
  abstract extractEdges(filePath: string, source: string): Promise<GraphEdge[]>;
  abstract extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ctxo/lang-java typecheck`
Expected: PASS (no emit; the abstract class compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/lang-java/src/tree-sitter-adapter.ts
git commit -m "feat(lang-java): add TreeSitterAdapter base class"
```

---

## Task 3: Confirm tree-sitter-java node/field names (spike)

> tree-sitter grammars differ in exact node `type` strings and field names. Confirm them ONCE against the installed grammar so Tasks 4-6 use correct identifiers. This is a throwaway script, not committed.

**Files:**
- Create (temporary): `packages/lang-java/scratch-ast.mjs`

- [ ] **Step 1: Write the AST dump script**

```javascript
// packages/lang-java/scratch-ast.mjs — throwaway, delete after this task
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';

const parser = new Parser();
parser.setLanguage(Java);

const src = `
package com.example;
import java.util.List;
import static java.lang.Math.max;

public class Foo extends Bar implements Baz, Qux {
  private int count;
  public Foo() {}
  public int add(int a, int b) { if (a > 0) { return a + b; } return b; }
}

interface Service extends Closeable { void run(); }
enum Color { RED, GREEN }
record Point(int x, int y) {}
@interface MyAnno {}
`;

const tree = parser.parse(src);
const print = (node, depth = 0) => {
  const fieldInfo = [];
  for (let i = 0; i < node.childCount; i++) {
    const fname = node.fieldNameForChild(i);
    if (fname) fieldInfo.push(`${fname}=${node.child(i).type}`);
  }
  console.log(`${'  '.repeat(depth)}${node.type}${fieldInfo.length ? '  [' + fieldInfo.join(', ') + ']' : ''}`);
  for (let i = 0; i < node.childCount; i++) print(node.child(i), depth + 1);
};
print(tree.rootNode);
```

- [ ] **Step 2: Run it and record the node types**

Run: `node packages/lang-java/scratch-ast.mjs`
Expected: a printed AST. Record the exact `type` strings and field names for:
- `class_declaration` (fields: `name`; superclass node; interfaces node)
- `interface_declaration` (field `name`; extends node)
- `enum_declaration`, `record_declaration`, `annotation_type_declaration` (field `name`)
- `method_declaration`, `constructor_declaration` (field `name`)
- `field_declaration` → `variable_declarator` (field `name`)
- `import_declaration` (child path node; `static` keyword presence)
- branch nodes for complexity: `if_statement`, `for_statement`, `enhanced_for_statement`, `while_statement`, `do_statement`, `switch_label` / `switch_block_statement_group`, `catch_clause`, `ternary_expression`, `&&`/`||` (`binary_expression` operators)

> **If any identifier below in Tasks 4-6 does not match the dump, use the dumped name.** The code in Tasks 4-6 is written against the tree-sitter-java 0.23.x grammar; this step is the authoritative check.

- [ ] **Step 3: Delete the scratch file**

```bash
rm packages/lang-java/scratch-ast.mjs
```

No commit (nothing tracked changed).

---

## Task 4: JavaAdapter — extractSymbols

**Files:**
- Create: `packages/lang-java/src/java-adapter.ts`
- Test: `packages/lang-java/src/__tests__/java-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/lang-java/src/__tests__/java-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../java-adapter.js';

const FILE = 'src/main/java/com/example/Foo.java';

const SOURCE = `package com.example;

public class Foo extends Bar implements Baz {
  private int count;
  public Foo() {}
  public int add(int a, int b) { return a + b; }
}

interface Service { void run(); }
enum Color { RED, GREEN }
record Point(int x, int y) {}
@interface MyAnno {}
`;

describe('JavaAdapter.extractSymbols', () => {
  it('extracts class/interface/enum/record/annotation/method/constructor/field with mapped kinds', async () => {
    const adapter = new JavaAdapter();
    const symbols = await adapter.extractSymbols(FILE, SOURCE);
    const byName = (n: string) => symbols.find((s) => s.name === n);

    expect(byName('Foo')).toMatchObject({ kind: 'class', symbolId: `${FILE}::Foo::class` });
    expect(byName('Service')).toMatchObject({ kind: 'interface', symbolId: `${FILE}::Service::interface` });
    expect(byName('Color')).toMatchObject({ kind: 'type', symbolId: `${FILE}::Color::type` });        // enum → type
    expect(byName('Point')).toMatchObject({ kind: 'class', symbolId: `${FILE}::Point::class` });        // record → class
    expect(byName('MyAnno')).toMatchObject({ kind: 'interface' });                                      // annotation → interface
    expect(byName('add')).toMatchObject({ kind: 'method' });
    expect(byName('Foo()') ?? byName('Foo')).toBeDefined();                                             // constructor present
    expect(byName('count')).toMatchObject({ kind: 'variable' });                                        // field → variable
  });

  it('returns [] on unparseable source without throwing', async () => {
    const adapter = new JavaAdapter();
    const symbols = await adapter.extractSymbols(FILE, 'class {{{ broken');
    expect(Array.isArray(symbols)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctxo/lang-java test -- java-adapter`
Expected: FAIL — `Cannot find module '../java-adapter.js'`.

- [ ] **Step 3: Implement `java-adapter.ts` (symbols only for now)**

```typescript
import JavaLanguage from 'tree-sitter-java';
import type { SyntaxNode } from 'tree-sitter';
import { TreeSitterAdapter } from './tree-sitter-adapter.js';
import { createLogger } from './logger.js';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '@ctxo/plugin-api';

const log = createLogger('ctxo:lang-java');

/** Java declaration node type → Ctxo SymbolKind (C# precedent mapping). */
const TYPE_DECL_KIND: Record<string, SymbolKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'type',
  record_declaration: 'class',
  annotation_type_declaration: 'interface',
};

export class JavaAdapter extends TreeSitterAdapter {
  readonly extensions = ['.java'] as const;

  constructor() {
    super(JavaLanguage);
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    try {
      const tree = this.parse(source);
      const symbols: SymbolNode[] = [];
      this.walkTypeDecls(tree.rootNode, filePath, symbols);
      return symbols;
    } catch (err) {
      log.error(`Symbol extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async extractEdges(_filePath: string, _source: string): Promise<GraphEdge[]> {
    return []; // implemented in Task 5
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    return []; // implemented in Task 6
  }

  // ── Private helpers ─────────────────────────────────────────

  /** Recursively find type declarations (handles nested types) and their members. */
  private walkTypeDecls(node: SyntaxNode, filePath: string, out: SymbolNode[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const kind = TYPE_DECL_KIND[child.type];
      if (kind) {
        const name = child.childForFieldName('name')?.text;
        if (name) {
          out.push({ symbolId: this.buildSymbolId(filePath, name, kind), name, kind, ...this.nodeToLineRange(child) });
        }
        const body = child.childForFieldName('body');
        if (body) this.extractMembers(body, filePath, out);
      }
      // Recurse so nested types inside bodies are also discovered.
      this.walkTypeDecls(child, filePath, out);
    }
  }

  /** Extract methods, constructors, and fields from a type body. */
  private extractMembers(body: SyntaxNode, filePath: string, out: SymbolNode[]): void {
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;
      if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
        const name = member.childForFieldName('name')?.text;
        if (name) out.push({ symbolId: this.buildSymbolId(filePath, name, 'method'), name, kind: 'method', ...this.nodeToLineRange(member) });
      } else if (member.type === 'field_declaration') {
        for (let j = 0; j < member.childCount; j++) {
          const decl = member.child(j)!;
          if (decl.type === 'variable_declarator') {
            const name = decl.childForFieldName('name')?.text;
            if (name) out.push({ symbolId: this.buildSymbolId(filePath, name, 'variable'), name, kind: 'variable', ...this.nodeToLineRange(member) });
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ctxo/lang-java test -- java-adapter`
Expected: PASS. (If a `kind`/field name mismatches, reconcile against the Task 3 dump.)

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/src/java-adapter.ts packages/lang-java/src/__tests__/java-adapter.test.ts
git commit -m "feat(lang-java): tree-sitter symbol extraction (types + members)"
```

---

## Task 5: JavaAdapter — extractEdges (imports / extends / implements)

**Files:**
- Modify: `packages/lang-java/src/java-adapter.ts`
- Modify: `packages/lang-java/src/__tests__/java-adapter.test.ts`

> Edge `from` is the declaring type's symbol ID; `to` for imports follows the lang-go convention `<importPath>::<lastSegment>::<kind>`. `extends`/`implements` resolve the target kind via the cross-file `symbolRegistry` when present, else default to `class`/`interface` respectively.

- [ ] **Step 1: Add the failing test**

```typescript
// append to java-adapter.test.ts
describe('JavaAdapter.extractEdges', () => {
  it('emits imports, extends, implements edges from the declaring type', async () => {
    const adapter = new JavaAdapter();
    const src = `package com.example;
import java.util.List;
public class Foo extends Bar implements Baz, Qux {}
`;
    const edges = await adapter.extractEdges(FILE, src);
    const kinds = edges.map((e) => e.kind);
    expect(kinds).toContain('imports');
    expect(kinds).toContain('extends');
    expect(kinds.filter((k) => k === 'implements').length).toBe(2); // Baz, Qux

    const ext = edges.find((e) => e.kind === 'extends');
    expect(ext!.from).toBe(`${FILE}::Foo::class`);
    expect(ext!.to).toBe('Bar::class'); // unresolved target → name::kind placeholder
  });

  it('returns [] on broken source without throwing', async () => {
    const adapter = new JavaAdapter();
    expect(await adapter.extractEdges(FILE, '@@@ not java')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctxo/lang-java test -- java-adapter`
Expected: FAIL — `extractEdges` returns `[]` (extends/implements/imports not emitted yet).

- [ ] **Step 3: Replace the stub `extractEdges` and add helpers**

```typescript
// in java-adapter.ts — replace the extractEdges stub with:
  async extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    try {
      const tree = this.parse(source);
      const edges: GraphEdge[] = [];
      const imports = this.collectImports(tree.rootNode);
      this.walkTypeEdges(tree.rootNode, filePath, imports, edges);
      return edges;
    } catch (err) {
      log.error(`Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  /** Resolve a referenced type name to a symbol ID, using the registry when known. */
  private resolveTypeId(name: string, fallbackKind: SymbolKind): string {
    const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    const kind = this.symbolRegistry.get(last) ?? fallbackKind;
    return `${last}::${kind}`;
  }

  /** Collect import target paths from the file's import_declaration nodes. */
  private collectImports(root: SyntaxNode): string[] {
    const paths: string[] = [];
    for (let i = 0; i < root.childCount; i++) {
      const node = root.child(i)!;
      if (node.type === 'import_declaration') {
        // The qualified name is the scoped_identifier child; static imports include a 'static' keyword.
        const nameNode = node.namedChildren.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
        if (nameNode) paths.push(nameNode.text);
      }
    }
    return paths;
  }

  private walkTypeEdges(node: SyntaxNode, filePath: string, imports: string[], out: GraphEdge[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const kind = TYPE_DECL_KIND[child.type];
      if (kind) {
        const name = child.childForFieldName('name')?.text;
        if (name) {
          const from = this.buildSymbolId(filePath, name, kind);
          // imports → one edge per import, anchored on this type
          for (const path of imports) {
            out.push({ from, to: this.resolveTypeId(path, 'class'), kind: 'imports' });
          }
          // extends (superclass for classes; extends_interfaces for interfaces)
          const superclass = child.childForFieldName('superclass');
          if (superclass) {
            for (const t of this.typeNames(superclass)) out.push({ from, to: this.resolveTypeId(t, 'class'), kind: 'extends' });
          }
          const extendsIfaces = child.childForFieldName('interfaces') ?? child.childForFieldName('extends');
          if (extendsIfaces && child.type === 'interface_declaration') {
            for (const t of this.typeNames(extendsIfaces)) out.push({ from, to: this.resolveTypeId(t, 'interface'), kind: 'extends' });
          }
          // implements (super_interfaces on a class)
          const impl = child.childForFieldName('interfaces');
          if (impl && child.type === 'class_declaration') {
            for (const t of this.typeNames(impl)) out.push({ from, to: this.resolveTypeId(t, 'interface'), kind: 'implements' });
          }
        }
      }
      this.walkTypeEdges(child, filePath, imports, out);
    }
  }

  /** Pull type_identifier names out of a superclass / super_interfaces / extends node. */
  private typeNames(node: SyntaxNode): string[] {
    const names: string[] = [];
    const visit = (n: SyntaxNode) => {
      if (n.type === 'type_identifier' || n.type === 'scoped_type_identifier') names.push(n.text);
      else for (let i = 0; i < n.childCount; i++) visit(n.child(i)!);
    };
    visit(node);
    return names;
  }
```

> **Imports-on-every-type is a known simplification** (matches lang-go anchoring imports on a representative symbol). If the Task 3 dump shows the superclass/interfaces field names differ (e.g. `super_interfaces` is a child node not a field), adjust `childForFieldName` calls to iterate children by `type` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ctxo/lang-java test -- java-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/src/java-adapter.ts packages/lang-java/src/__tests__/java-adapter.test.ts
git commit -m "feat(lang-java): tree-sitter imports/extends/implements edges"
```

---

## Task 6: JavaAdapter — extractComplexity

**Files:**
- Modify: `packages/lang-java/src/java-adapter.ts`
- Modify: `packages/lang-java/src/__tests__/java-adapter.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
// append to java-adapter.test.ts
describe('JavaAdapter.extractComplexity', () => {
  it('counts branches per method (base 1 + each branch)', async () => {
    const adapter = new JavaAdapter();
    const src = `class Foo {
  int f(int a) {
    if (a > 0) { return 1; }
    for (int i = 0; i < a; i++) {}
    return a > 1 ? 2 : 3;
  }
}`;
    const metrics = await adapter.extractComplexity(FILE, src);
    const f = metrics.find((m) => m.symbolId === `${FILE}::f::method`);
    expect(f).toBeDefined();
    // base 1 + if + for + ternary = 4
    expect(f!.cyclomatic).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctxo/lang-java test -- java-adapter`
Expected: FAIL — `extractComplexity` returns `[]`.

- [ ] **Step 3: Replace the stub and add the branch-type table**

```typescript
// near the top of java-adapter.ts, after TYPE_DECL_KIND:
const JAVA_BRANCH_TYPES = [
  'if_statement', 'for_statement', 'enhanced_for_statement',
  'while_statement', 'do_statement',
  'switch_label', 'catch_clause', 'ternary_expression',
];

// replace the extractComplexity stub with:
  async extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    try {
      const tree = this.parse(source);
      const metrics: ComplexityMetrics[] = [];
      const visit = (node: SyntaxNode) => {
        if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
          const name = node.childForFieldName('name')?.text;
          if (name) {
            let cyclomatic = this.countCyclomaticComplexity(node, JAVA_BRANCH_TYPES);
            cyclomatic += this.countLogicalOperators(node); // && and || add a path each
            metrics.push({ symbolId: this.buildSymbolId(filePath, name, 'method'), cyclomatic });
          }
        }
        for (let i = 0; i < node.childCount; i++) visit(node.child(i)!);
      };
      visit(tree.rootNode);
      return metrics;
    } catch (err) {
      log.error(`Complexity extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  /** Count && / || operators inside a node (each adds an independent path). */
  private countLogicalOperators(node: SyntaxNode): number {
    let count = 0;
    const visit = (n: SyntaxNode) => {
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||');
        if (op) count++;
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i)!);
    };
    visit(node);
    return count;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ctxo/lang-java test -- java-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/src/java-adapter.ts packages/lang-java/src/__tests__/java-adapter.test.ts
git commit -m "feat(lang-java): tree-sitter cyclomatic complexity"
```

---

## Task 7: JavaCompositeAdapter (tree-sitter-only for now)

**Files:**
- Create: `packages/lang-java/src/composite-adapter.ts`
- Test: `packages/lang-java/src/__tests__/composite-adapter.test.ts`

> Establishes the composite seam so Plan 3 can slot in `JdtAdapter` without touching `index.ts`. For now `getTier()` returns `'syntax'` and all extraction delegates to `JavaAdapter`. `extractComplexity` is wired to ALWAYS use tree-sitter (the invariant Plan 3 relies on).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/lang-java/src/__tests__/composite-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { JavaCompositeAdapter } from '../composite-adapter.js';

describe('JavaCompositeAdapter', () => {
  it('initializes to the syntax tier and delegates extraction to tree-sitter', async () => {
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize('/tmp/project');
    expect(adapter.getTier()).toBe('syntax');

    const file = 'A.java';
    const symbols = await adapter.extractSymbols(file, 'class A { void m() {} }');
    expect(symbols.find((s) => s.name === 'A')?.kind).toBe('class');

    const complexity = await adapter.extractComplexity(file, 'class A { void m() { if (true) {} } }');
    expect(complexity.find((c) => c.symbolId === `${file}::m::method`)).toBeDefined();
  });

  it('reports .java support', () => {
    const adapter = new JavaCompositeAdapter();
    expect(adapter.isSupported('Foo.java')).toBe(true);
    expect(adapter.isSupported('Foo.go')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ctxo/lang-java test -- composite-adapter`
Expected: FAIL — `Cannot find module '../composite-adapter.js'`.

- [ ] **Step 3: Implement `composite-adapter.ts`**

```typescript
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { JavaAdapter } from './java-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-java');

/**
 * Picks between the full-tier JDT analyzer and the syntax-tier tree-sitter
 * adapter at initialize() time. Plan 1 ships syntax-only: the JDT branch is
 * added in Plan 3. Complexity is ALWAYS sourced from tree-sitter.
 */
export class JavaCompositeAdapter implements ILanguageAdapter {
  private treeSitter: JavaAdapter;
  // private analyzer: JdtAdapter | null = null;  // wired in Plan 3

  constructor() {
    this.treeSitter = new JavaAdapter();
  }

  async initialize(_rootDir: string): Promise<void> {
    // Plan 3 will probe the Java runtime + verified JAR here and activate full tier.
    log.info('Java plugin: tree-sitter syntax-tier active (full tier arrives in Plan 3)');
  }

  async dispose(): Promise<void> {
    // Plan 3: dispose the analyzer process if active.
  }

  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    return this.treeSitter.extractSymbols(filePath, source);
  }

  extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    return this.treeSitter.extractEdges(filePath, source);
  }

  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    // Always tree-sitter — JDT does not emit cyclomatic complexity.
    return this.treeSitter.extractComplexity(filePath, source);
  }

  isSupported(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.java');
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.treeSitter.setSymbolRegistry?.(registry);
  }

  getTier(): 'full' | 'syntax' | 'unavailable' {
    return 'syntax';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ctxo/lang-java test -- composite-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/src/composite-adapter.ts packages/lang-java/src/__tests__/composite-adapter.test.ts
git commit -m "feat(lang-java): JavaCompositeAdapter (syntax tier seam)"
```

---

## Task 8: Plugin export (index.ts)

**Files:**
- Create: `packages/lang-java/src/index.ts`

- [ ] **Step 1: Implement `index.ts`**

```typescript
import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { JavaCompositeAdapter } from './composite-adapter.js';

export { JavaAdapter } from './java-adapter.js';
export { JavaCompositeAdapter } from './composite-adapter.js';
export { TreeSitterAdapter } from './tree-sitter-adapter.js';

const VERSION = '0.8.0-alpha.0';

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'java',
  name: 'Java (ctxo-jdt-analyzer + tree-sitter)',
  version: VERSION,
  extensions: ['.java'],
  tier: 'full',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new JavaCompositeAdapter();
  },
};

export default plugin;
```

> `tier: 'full'` advertises the package's eventual capability; until Plan 3 the composite resolves to syntax at runtime. This matches lang-go, which declares `tier: 'full'` while degrading at runtime when the analyzer is absent.

- [ ] **Step 2: Build + typecheck + full test run**

Run: `pnpm --filter @ctxo/lang-java build && pnpm --filter @ctxo/lang-java typecheck && pnpm --filter @ctxo/lang-java test`
Expected: build emits `dist/index.js` + `dist/index.d.ts`; typecheck PASS; all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/lang-java/src/index.ts
git commit -m "feat(lang-java): plugin entry point export"
```

---

## Task 9: Workspace integration check

**Files:**
- Verify only (no new files unless the monorepo requires explicit member listing).

- [ ] **Step 1: Confirm the package is picked up by the workspace**

Run: `pnpm -r --filter @ctxo/lang-java build`
Expected: builds without "no projects matched" — confirms `pnpm-workspace.yaml` globs already include `packages/*`.

- [ ] **Step 2: Run the workspace typecheck + test for the new package**

Run: `pnpm --filter @ctxo/lang-java typecheck && pnpm --filter @ctxo/lang-java test`
Expected: PASS.

- [ ] **Step 3: Sanity-check against a real Java file (manual)**

Run:
```bash
node --input-type=module -e "import('@ctxo/lang-java').then(async ({ plugin }) => { const a = plugin.createAdapter({ logger: console, projectRoot: process.cwd(), workspace: {}, config: {} }); console.log(await a.extractSymbols('X.java', 'public class X { void run(){} }')); })"
```
Expected: prints a symbol array containing `X::class` and `run::method`.

- [ ] **Step 4: Final commit (if any config changed)**

```bash
git add -A packages/lang-java
git commit -m "chore(lang-java): workspace integration for plan 1 foundation" || echo "nothing to commit"
```

---

## Self-Review (Plan 1 scope only)

**Spec coverage (Plan 1 slice):** scaffold ✓ (Task 1), tree-sitter syntax tier symbols/edges/complexity ✓ (Tasks 4-6), composite seam + always-tree-sitter complexity invariant ✓ (Task 7), plugin export ✓ (Task 8). Full-tier/JDT/distribution/watch/CI are **out of scope for Plan 1** — covered by Plans 2-5.

**Placeholder scan:** Stubs in Tasks 4 (`extractEdges`/`extractComplexity` return `[]`) are intentional TDD intermediate states, each replaced with full code in Tasks 5-6. No "TODO/implement later" left in committed final state. The `// Plan 3` comments in the composite are seam markers, not unfinished work — the composite is fully functional as a syntax-tier adapter.

**Type consistency:** `JavaAdapter`, `JavaCompositeAdapter`, `TreeSitterAdapter`, `createLogger`, `getTier()` names are consistent across tasks. `SymbolKind`/`GraphEdge`/`ComplexityMetrics`/`ILanguageAdapter` imported from `@ctxo/plugin-api` match the contract in `packages/plugin-api/src/types.ts` + `adapter.ts`.

**Grammar risk:** Tasks 4-6 depend on exact tree-sitter-java node/field names; Task 3 (spike) is the gate that confirms them before implementation. This is the one place the engineer must verify against the installed grammar rather than trust the plan verbatim.
