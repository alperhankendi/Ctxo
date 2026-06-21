# lang-java Plan 4 — Watch / Keep-Alive (generalized capability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give `ctxo watch` fast incremental re-index for Java (single changed file in <~200ms via a long-lived JDT keep-alive process), by generalizing the watch keep-alive wiring into an optional plugin capability — removing the per-language hardcoding — then implementing that capability for Java.

**Architecture (research-backed: VS Code/LSP optional-capability + Beck "make the change easy, then make the easy change"):** Define an optional `IIncrementalReindex` capability in `@ctxo/plugin-api` (generalization of the existing `RoslynLike` shape). Refactor C# behind it FIRST (behavior-preserving, tests green). Generalize `watch-command.ts` to feature-detect the capability per plugin and dispatch by extension via a `Map` (no `.cs`/`.java` branches). THEN add the capability for Java: a `JdtKeepAlive` process wrapper + the Java composite exposing `getIncrementalReindex()` whose `reindexFile` combines JDT symbols/edges with tree-sitter complexity (preserving the "complexity always tree-sitter" invariant in watch too).

**Tech Stack:** TypeScript (ESM, strict), Node 20 child_process; Java keep-alive (`Main.java --keep-alive` already exists from Plan 2). vitest. Decisions: [ADR-014](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md); design research in the session brainstorm.

**Plan set:** Plan 4 of 5 (final). Builds on Plans 1-3 + 5. Sequencing is deliberate: T1-T3 generalize with C# staying green; T4-T6 add Java.

---

## ⚙️ Environment preamble (Java integration tests only — T5/T6)
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java-analyzer/jar/ctxo-jdt-analyzer.jar"
```
TS-only tasks (T1-T4) need no Java.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/plugin-api/src/incremental-reindex.ts` | NEW: optional `IIncrementalReindex` + `ReindexResult` capability types |
| `packages/plugin-api/src/index.ts` | MODIFY: export the new types |
| `packages/lang-csharp/src/composite-adapter.ts` | MODIFY: add `getIncrementalReindex()` returning the Roslyn delegate (keep `getRoslynDelegate` for index pre-warm) |
| `packages/cli/src/cli/watch-command.ts` | MODIFY: generalize — `Map<ext, IIncrementalReindex>`, feature-detect, drop `.cs` hardcode + local `RoslynLike` |
| `packages/lang-java/src/analyzer/jdt-process.ts` | MODIFY: add `JdtKeepAlive` class (mirror `RoslynKeepAlive`) |
| `packages/lang-java/src/analyzer/jdt-adapter.ts` | MODIFY: `startKeepAlive()` + `reindexFile()` (symbols/edges via keep-alive) |
| `packages/lang-java/src/composite-adapter.ts` | MODIFY: implement/expose `getIncrementalReindex()` combining JDT symbols/edges + tree-sitter complexity |

---

## Task 1: `IIncrementalReindex` capability in plugin-api

**Files:** Create `packages/plugin-api/src/incremental-reindex.ts`; modify `packages/plugin-api/src/index.ts`.

- [ ] **Step 1: Create the capability types**
```typescript
// packages/plugin-api/src/incremental-reindex.ts
import type { SymbolNode, GraphEdge, ComplexityMetrics } from './types.js';

/** Result of re-analyzing a single file via a keep-alive analyzer. */
export interface ReindexResult {
  symbols: SymbolNode[];
  edges: GraphEdge[];
  complexity: ComplexityMetrics[];
}

/**
 * Optional capability a composite adapter MAY expose for fast watch-mode
 * incremental re-index via a long-lived analyzer process. Plugins that don't
 * implement it degrade to per-file extract*() (handled by the host). Modeled
 * on the LSP/VS Code "optional capability" pattern — feature-detected, never
 * required by the core ILanguageAdapter contract.
 */
export interface IIncrementalReindex {
  /** True when the keep-alive backend is available and ready. */
  isReady(): boolean;
  /** Start the long-lived process. Returns false if it could not start. */
  startKeepAlive(): Promise<boolean>;
  /** Re-analyze one project-relative file; null when the file could not be analyzed. */
  reindexFile(relativePath: string): Promise<ReindexResult | null>;
  /** Shut down the keep-alive process. */
  dispose(): Promise<void>;
}

/** A composite adapter that can supply an incremental-reindex capability. */
export interface IncrementalReindexCapable {
  getIncrementalReindex(): IIncrementalReindex | null;
}
```

- [ ] **Step 2: Export from `packages/plugin-api/src/index.ts`** — add (matching the file's existing `export type { ... }` style):
```typescript
export type { IIncrementalReindex, ReindexResult, IncrementalReindexCapable } from './incremental-reindex.js';
```

- [ ] **Step 3: Build + typecheck** `pnpm --filter @ctxo/plugin-api build && pnpm --filter @ctxo/plugin-api typecheck` → clean.

- [ ] **Step 4: Commit**
```bash
git add packages/plugin-api/src/incremental-reindex.ts packages/plugin-api/src/index.ts
git commit -m "feat(plugin-api): optional IIncrementalReindex capability for watch keep-alive"
```

---

## Task 2: C# composite exposes the capability (preparatory refactor, behavior unchanged)

**Files:** Modify `packages/lang-csharp/src/composite-adapter.ts`.

> `RoslynAdapter` already implements `isReady`/`startKeepAlive`/`reindexFile`/`dispose` (the exact `IIncrementalReindex` shape). We just expose it via the generic method. Keep `getRoslynDelegate()` (index-command still uses it for batch pre-warm — out of scope here).

- [ ] **Step 1: Add the import + method.** Import the type:
```typescript
import type { IIncrementalReindex } from '@ctxo/plugin-api';
```
Add to `CSharpCompositeAdapter` (next to `getRoslynDelegate`):
```typescript
  /** Optional watch keep-alive capability (generic). Null in syntax tier. */
  getIncrementalReindex(): IIncrementalReindex | null {
    return this.roslyn;
  }
```
(`RoslynAdapter` structurally satisfies `IIncrementalReindex`. If TS complains that `reindexFile`'s return type isn't assignable — RoslynAdapter currently returns an inline `{symbols,edges,complexity}` shape — adjust RoslynAdapter's `reindexFile` return type annotation to `Promise<ReindexResult | null>` importing `ReindexResult` from `@ctxo/plugin-api`, OR keep structural compatibility if the shapes already match. Verify by typecheck; prefer annotating RoslynAdapter to return `ReindexResult` for clarity.)

- [ ] **Step 2: Typecheck + test** `pnpm --filter @ctxo/lang-csharp typecheck && pnpm --filter @ctxo/lang-csharp test` → green (no behavior change).

- [ ] **Step 3: Commit**
```bash
git add packages/lang-csharp/src/composite-adapter.ts packages/lang-csharp/src/roslyn/roslyn-adapter.ts
git commit -m "refactor(lang-csharp): expose Roslyn keep-alive via generic getIncrementalReindex()"
```

---

## Task 3: Generalize `watch-command.ts` (drop per-language hardcoding; C# stays green)

**Files:** Modify `packages/cli/src/cli/watch-command.ts`.

- [ ] **Step 1: Replace the local `RoslynLike`/`CSharpCompositeLike` interfaces** (lines 21-34) with the plugin-api import:
```typescript
import type { IIncrementalReindex, IncrementalReindexCapable } from '@ctxo/plugin-api';
```
Delete the local `RoslynLike` and `CSharpCompositeLike` interface declarations.

- [ ] **Step 2: Replace the single `roslynAdapter` with an extension→capability map.** Change `let roslynAdapter: RoslynLike | null = null;` (line 51) to:
```typescript
    const keepAliveByExt = new Map<string, IIncrementalReindex>();
    const activeKeepAlives = new Set<IIncrementalReindex>();
```

- [ ] **Step 3: Replace the C#-specific detection block** (lines 64-75) with generic feature detection:
```typescript
      // Optional: if the plugin exposes an incremental-reindex capability, start
      // keep-alive for fast watch re-index (LSP-style optional capability).
      const capable = adapter as unknown as Partial<IncrementalReindexCapable>;
      if (typeof capable.getIncrementalReindex === 'function') {
        const cap = capable.getIncrementalReindex();
        if (cap?.isReady() && (await cap.startKeepAlive())) {
          for (const ext of plugin.extensions) keepAliveByExt.set(ext.toLowerCase(), cap);
          activeKeepAlives.add(cap);
          console.error(`[ctxo] ${plugin.id} watch: keep-alive active (full tier, fast incremental re-index)`);
        }
      }
```

- [ ] **Step 4: Replace the `.cs`-gated reindex block** (lines 105-143) with a generic capability lookup:
```typescript
        // If a keep-alive capability covers this file's extension, use incremental re-index.
        const cap = keepAliveByExt.get(extname(filePath).toLowerCase());
        if (cap?.isReady()) {
          const result = await cap.reindexFile(relativePath);
          if (result) {
            const commits = await gitAdapter.getCommitHistory(relativePath);
            const intent: CommitIntent[] = commits.map((c) => ({
              hash: c.hash, message: c.message, date: c.date, kind: 'commit' as const,
            }));
            const antiPatterns: AntiPattern[] = revertDetector.detect(commits);
            const source = readFileSync(filePath, 'utf-8');
            const fileIndex: FileIndex = {
              file: relativePath,
              lastModified: Math.floor(Date.now() / 1000),
              contentHash: hasher.hash(source),
              symbols: result.symbols.map(s => ({
                symbolId: s.symbolId, name: s.name,
                kind: s.kind as FileIndex['symbols'][0]['kind'],
                startLine: s.startLine, endLine: s.endLine,
              })),
              edges: result.edges
                .filter(e => !e.to.startsWith('ns:'))
                .map(e => ({ from: e.from, to: e.to, kind: e.kind as FileIndex['edges'][0]['kind'] })),
              complexity: result.complexity.map(c => ({ symbolId: c.symbolId, cyclomatic: c.cyclomatic })),
              intent, antiPatterns,
            };
            writer.write(fileIndex);
            storage.writeSymbolFile(fileIndex);
            console.error(`[ctxo] Re-indexed (keep-alive): ${relativePath}`);
            return;
          }
        }
```
(The generic `extract*()` fallback below it stays unchanged.)

- [ ] **Step 5: Update cleanup** (line 242) to dispose all active keep-alives:
```typescript
      const shutdowns = Promise.all([...activeKeepAlives].map((c) => c.dispose()));
      shutdowns.then(() => {
        watcher.stop().then(() => {
```
(Replace the single `roslynAdapter ? roslynAdapter.dispose() : Promise.resolve()` logic.)

- [ ] **Step 6: Typecheck + test** `pnpm --filter @ctxo/cli typecheck && pnpm --filter @ctxo/cli test -- watch-command` → green. Then full `pnpm --filter @ctxo/cli test 2>&1 | tail -12` (ignore ONLY the known pre-existing `privacy-zero-leakage.test.ts` EPERM file failure). Confirm the existing C# watch-command test still passes (proves the refactor preserved behavior).

- [ ] **Step 7: Commit**
```bash
git add packages/cli/src/cli/watch-command.ts
git commit -m "refactor(cli): generic watch keep-alive capability (drop per-language hardcoding)"
```

---

## Task 4: `JdtKeepAlive` process wrapper

**Files:** Modify `packages/lang-java/src/analyzer/jdt-process.ts`.

> Mirror `RoslynKeepAlive` (packages/lang-csharp/src/roslyn/roslyn-process.ts): spawn `java -jar <jar> <root> --keep-alive`, await the `ready` line, send `{ "file": rel }` on stdin, resolve the pending request when the matching `{type:"file",file,...}` line returns; per-request timeout; idle shutdown; JSONL line buffering (LF). The Java `Main.java --keep-alive` already implements the protocol.

- [ ] **Step 1: Add `JdtKeepAlive`** to `jdt-process.ts`:
```typescript
import { spawn, type ChildProcess } from 'node:child_process';
// (createLogger already imported at top of file)

/** Keep-alive JDT analyzer for watch mode: stays alive, re-analyzes one file per request. */
export class JdtKeepAlive {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string, (r: JdtFileResult | null) => void>();
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly javaBin: string,
    private readonly jarPath: string,
    private readonly projectRoot: string,
    private readonly idleMs = 300_000,
  ) {}

  async start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.proc = spawn(this.javaBin, ['-jar', this.jarPath, this.projectRoot, '--keep-alive'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc.stdout!.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        let nl: number;
        while ((nl = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'ready') { resolve(true); }
            else if (obj.type === 'file') {
              const norm = String(obj.file).replace(/\\/g, '/');
              const cb = this.pending.get(norm);
              if (cb) { this.pending.delete(norm); cb(obj as JdtFileResult); }
            }
          } catch {
            log.error(`JdtKeepAlive parse error: ${line.slice(0, 120)}`);
          }
        }
      });
      this.proc.stderr!.on('data', (c: Buffer) => log.error(`jdt keep-alive: ${c.toString().trim()}`));
      this.proc.on('close', () => { this.proc = null; for (const cb of this.pending.values()) cb(null); this.pending.clear(); });
      this.proc.on('error', (err) => { log.error(`JdtKeepAlive spawn error: ${err.message}`); resolve(false); });
      this.resetIdle();
    });
  }

  isAlive(): boolean { return this.proc !== null && !this.proc.killed; }

  async analyzeFile(relativePath: string): Promise<JdtFileResult | null> {
    if (!this.proc || !this.proc.stdin!.writable) return null;
    const norm = relativePath.replace(/\\/g, '/');
    this.resetIdle();
    return new Promise((resolve) => {
      this.pending.set(norm, resolve);
      this.proc!.stdin!.write(JSON.stringify({ file: norm }) + '\n');
      setTimeout(() => {
        if (this.pending.has(norm)) { this.pending.delete(norm); log.error(`JdtKeepAlive timeout for ${norm}`); resolve(null); }
      }, 30_000);
    });
  }

  async shutdown(): Promise<void> {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.proc) { this.proc.stdin!.end(); this.proc.kill(); this.proc = null; }
  }

  private resetIdle(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => { log.info('JdtKeepAlive idle shutdown'); void this.shutdown(); }, this.idleMs);
  }
}
```

- [ ] **Step 2: Typecheck** `pnpm --filter @ctxo/lang-java typecheck` → clean.

- [ ] **Step 3: Commit**
```bash
git add packages/lang-java/src/analyzer/jdt-process.ts
git commit -m "feat(lang-java): JdtKeepAlive process wrapper for watch incremental re-index"
```

---

## Task 5: Java composite exposes `getIncrementalReindex()` (JDT symbols/edges + tree-sitter complexity)

**Files:** Modify `packages/lang-java/src/analyzer/jdt-adapter.ts` and `packages/lang-java/src/composite-adapter.ts`.

> The capability's `reindexFile` must return COMPLETE data including complexity. JDT does not emit complexity (tree-sitter owns it), so the Java composite combines: symbols/edges from the JDT keep-alive, complexity from `this.treeSitter`. This preserves the "complexity always tree-sitter" invariant in watch too.

- [ ] **Step 1: Add keep-alive lifecycle to `JdtAnalyzerAdapter`** (jdt-adapter.ts). Add a field + methods:
```typescript
import { runBatchIndex, JdtKeepAlive, type JdtFileResult } from './jdt-process.js';
// ...
  private keepAlive: JdtKeepAlive | null = null;

  async startKeepAlive(): Promise<boolean> {
    if (!this.isReady() || !this.jarPath || !this.root) return false;
    this.keepAlive = new JdtKeepAlive(this.javaBin, this.jarPath, this.root);
    const ok = await this.keepAlive.start();
    if (!ok) this.keepAlive = null;
    return ok;
  }

  /** Re-analyze one file via keep-alive → JDT symbols + edges (complexity left to caller). */
  async reindexFileRaw(relativePath: string): Promise<JdtFileResult | null> {
    if (!this.keepAlive?.isAlive()) return null;
    return this.keepAlive.analyzeFile(relativePath);
  }
```
Extend `dispose()` to also shut down keep-alive:
```typescript
  async dispose(): Promise<void> {
    if (this.keepAlive) { await this.keepAlive.shutdown(); this.keepAlive = null; }
    this.cache.clear(); this.batchPromise = null; this.initialized = false;
  }
```

- [ ] **Step 2: Implement the capability on the composite** (composite-adapter.ts). Add the import + an `IIncrementalReindex` impl. Since the composite holds both `analyzer` and `treeSitter`, expose `getIncrementalReindex()` returning an object that combines them:
```typescript
import type { /* existing */ IIncrementalReindex, ReindexResult } from '@ctxo/plugin-api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// ...
  private rootDir = '';

  // in initialize(rootDir): store it
  //   this.rootDir = rootDir;  (add at the top of initialize)

  getIncrementalReindex(): IIncrementalReindex | null {
    if (!this.analyzer) return null;
    const analyzer = this.analyzer;
    const treeSitter = this.treeSitter;
    const rootDir = this.rootDir;
    return {
      isReady: () => analyzer.isReady(),
      startKeepAlive: () => analyzer.startKeepAlive(),
      dispose: () => analyzer.dispose(),
      async reindexFile(relativePath: string): Promise<ReindexResult | null> {
        const raw = await analyzer.reindexFileRaw(relativePath);
        if (!raw) return null;
        // complexity always from tree-sitter (JDT emits none)
        let complexity: ReindexResult['complexity'] = [];
        try {
          const source = readFileSync(join(rootDir, relativePath), 'utf-8');
          complexity = await treeSitter.extractComplexity(relativePath, source);
        } catch { /* file unreadable mid-edit → empty complexity */ }
        return {
          symbols: raw.symbols
            .filter((s) => /^.+::.+::.+$/.test(s.symbolId))
            .map((s) => ({ symbolId: s.symbolId, name: s.name, kind: s.kind as ReindexResult['symbols'][0]['kind'],
              startLine: s.startLine, endLine: s.endLine,
              ...(s.startOffset != null ? { startOffset: s.startOffset } : {}),
              ...(s.endOffset != null ? { endOffset: s.endOffset } : {}) })),
          edges: raw.edges
            .filter((e) => /^.+::.+::.+$/.test(e.from) && e.to.length > 0)
            .map((e) => ({ from: e.from, to: e.to, kind: e.kind as ReindexResult['edges'][0]['kind'] })),
          complexity,
        };
      },
    };
  }
```
(Mirror the symbol/edge mapping + filters used in `jdt-adapter.ts` extractSymbols/extractEdges so watch output matches batch output.)

- [ ] **Step 3: Typecheck** `pnpm --filter @ctxo/lang-java typecheck` → clean.

- [ ] **Step 4: Integration test** `packages/lang-java/src/analyzer/__tests__/jdt-keepalive.integration.test.ts` (gated on Java + jar):
```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../toolchain-detect.js';
import { JavaCompositeAdapter } from '../../composite-adapter.js';

const jar = process.env.CTXO_JDT_ANALYZER_JAR
  ?? resolve(import.meta.dirname, '../../../../lang-java-analyzer/jar/ctxo-jdt-analyzer.jar');
const fixture = resolve(import.meta.dirname, '../../../../lang-java-analyzer/java/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('Java watch keep-alive (real jar)', () => {
  it('reindexFile returns resolved edges + tree-sitter complexity for one file', async () => {
    process.env.CTXO_JDT_ANALYZER_JAR = jar;
    const composite = new JavaCompositeAdapter();
    await composite.initialize(fixture);
    const cap = composite.getIncrementalReindex();
    expect(cap).not.toBeNull();
    expect(cap!.isReady()).toBe(true);
    expect(await cap!.startKeepAlive()).toBe(true);
    const result = await cap!.reindexFile('Foo.java');
    expect(result).not.toBeNull();
    expect(result!.edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    // complexity comes from tree-sitter
    expect(Array.isArray(result!.complexity)).toBe(true);
    await cap!.dispose();
  }, 130_000);
});
```

- [ ] **Step 5: Run** (env preamble): integration test RUNS + passes; `pnpm --filter @ctxo/lang-java test` green (other integration may skip without env).

- [ ] **Step 6: Commit**
```bash
git add packages/lang-java/src/analyzer/jdt-adapter.ts packages/lang-java/src/composite-adapter.ts packages/lang-java/src/analyzer/__tests__/jdt-keepalive.integration.test.ts
git commit -m "feat(lang-java): expose getIncrementalReindex (JDT keep-alive + tree-sitter complexity)"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Full workspace typecheck** `pnpm -r typecheck` → all clean.
- [ ] **Step 2: Targeted suites** (env preamble for Java):
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java-analyzer/jar/ctxo-jdt-analyzer.jar"
pnpm --filter @ctxo/plugin-api test
pnpm --filter @ctxo/lang-csharp test
pnpm --filter @ctxo/lang-java test
pnpm --filter @ctxo/cli test 2>&1 | tail -12
```
Expected: all green except the known pre-existing `privacy-zero-leakage.test.ts` EPERM file failure. The C# watch test passing proves the generalization preserved C# behavior; the Java keep-alive integration proves the new capability works.
- [ ] **Step 3: Final commit (if any stray changes)**
```bash
git add -A packages/lang-java packages/cli packages/lang-csharp packages/plugin-api
git commit -m "chore(lang-java): plan 4 watch keep-alive verification" || echo "nothing to commit"
```

---

## Self-Review (Plan 4 scope)

**Spec/research coverage:** optional capability interface in plugin-api ✓ (T1); generalize-first (C# behind interface, behavior preserved) ✓ (T2); watch-command generic feature-detection, per-language hardcoding removed ✓ (T3 — also resolves the review's altitude finding); JdtKeepAlive lifecycle (JSONL buffer, request correlation by file, per-request timeout, idle shutdown) ✓ (T4); Java capability combining JDT symbols/edges + tree-sitter complexity (invariant preserved) ✓ (T5); end-to-end ✓ (T6). Sequencing follows Beck/Fowler (make-it-easy then easy-change).

**Placeholder scan:** T2 notes a verify-and-annotate step for RoslynAdapter's `reindexFile` return type (structural vs explicit) — that's a typecheck-driven adjustment with the concrete target type named (`ReindexResult`), not a vague TODO. No "implement later".

**Type consistency:** `IIncrementalReindex` (isReady/startKeepAlive/reindexFile/dispose) is used identically in plugin-api, lang-csharp (returns roslyn), watch-command (consumes), lang-java (composite returns combiner). `ReindexResult{symbols,edges,complexity}` matches the `FileIndex` mapping in watch-command. `JdtKeepAlive.analyzeFile` returns `JdtFileResult` (existing type from jdt-process). The symbol/edge filters in T5 match `jdt-adapter.ts` (`FULL_SYMBOL_ID` on symbolId + `from`; `to` non-empty) so watch output equals batch output.

**Risk note:** T2-T3 must keep the existing C# `watch-command` test green (the behavior-preservation gate). The Java keep-alive request correlation is keyed on the normalized relative path the analyzer echoes back in its `file` field — confirm `Main.java --keep-alive` echoes the same relative path form (Plan 2 relativizes against root); if it echoes a different form, normalize both sides in `JdtKeepAlive` (already `replace(/\\/g,'/')`).
