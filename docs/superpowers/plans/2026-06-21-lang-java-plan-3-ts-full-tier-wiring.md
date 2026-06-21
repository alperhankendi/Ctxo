# lang-java Plan 3 — TypeScript Full-Tier Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the TypeScript side of `@ctxo/lang-java` to the JDT analyzer JAR (built in Plan 2): detect the Java runtime, resolve the analyzer JAR (env override or verified cache), spawn it in batch mode, parse its JSONL into `SymbolNode`/`GraphEdge`, and have `JavaCompositeAdapter` select the full tier at `initialize()` when available — falling back to tree-sitter otherwise.

**Architecture:** Mirror `packages/lang-go/src/analyzer/*`. `toolchain-detect.ts` probes `java -version`. `jar-download.ts` resolves/verifies the JAR (SHA-256). `jdt-process.ts` spawns `java -jar` and parses JSONL (never throws — empty result on failure). `JdtAnalyzerAdapter` runs the batch once and serves per-file from an in-memory cache (the `GoAnalyzerAdapter` pattern). `JavaCompositeAdapter.initialize()` activates the analyzer when ready; complexity is ALWAYS tree-sitter.

**Tech Stack:** TypeScript (ESM, strict), Node 20 (`spawn`, global `fetch`, `node:crypto`), vitest. Integration tests run against the REAL JAR at `packages/lang-java/tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar` via env, and skip when Java is unavailable.

**Plan set:** Plan 3 of 5. Spec: [docs/superpowers/specs/2026-06-21-lang-java-full-tier-design.md](../specs/2026-06-21-lang-java-full-tier-design.md). Decisions: [ADR-014](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md). Builds on Plan 1 (tree-sitter tier + composite seam) and Plan 2 (the analyzer JAR).

---

## ⚙️ Environment preamble (for integration tests that spawn `java`)

The JDK is installed but not on the shells' PATH. Integration tests resolve `java` via `JAVA_HOME`. When running vitest manually so integration tests execute, set:

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java/tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar"
```

Integration tests **skip** (not fail) when `JAVA_HOME`/`java` or the JAR is absent, so the suite stays green on machines without Java. Unit tests never need Java.

---

## Design contracts (locked from Plan 1/2)

- The analyzer JSONL `file` record: `{type:"file", file, symbols[], edges[], complexity[]}` (`complexity` always empty). Symbols: `{symbolId, name, kind, startLine, endLine, startOffset?, endOffset?}` (0-based lines). Edges: `{from, to, kind}`.
- **Edge `to` targets are a MIX**: 3-part for resolved calls/imports (`pkg.Type::method::method`, `fq::last::class`) and 2-part for type refs (`Bar::class`). So validate `from` as a full 3-part symbol ID, but DO NOT require `to` to be 3-part (it is name-resolved downstream — same as Plan 1's tree-sitter tier).
- JAR resolution order: `CTXO_JDT_ANALYZER_JAR` env (dev/CI/test escape hatch) → verified cache `~/.ctxo/cache/lang-java/<version>/ctxo-jdt-analyzer.jar` → null. **No silent download**: the network download is an explicit, separately-invoked function (opt-in), not triggered by `resolve`.
- `java` executable resolution: `CTXO_JAVA_HOME` → `JAVA_HOME` → `java` on PATH.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/lang-java/src/analyzer/toolchain-detect.ts` | `parseJavaVersion` (pure) + `detectJavaRuntime()` → `{available, major?, version?, javaBin}`. Gate ≥ 17. |
| `packages/lang-java/src/analyzer/jar-download.ts` | `verifySha256` (pure), `resolveAnalyzerJar` (env→cache→null), `downloadAnalyzerJar` (opt-in fetch + verify + cache). |
| `packages/lang-java/src/analyzer/jdt-process.ts` | `JdtFileResult`/`JdtBatchResult` types + `runBatchIndex(javaBin, jarPath, root, opts)` (spawn + JSONL parse; never throws). |
| `packages/lang-java/src/analyzer/jdt-adapter.ts` | `JdtAnalyzerAdapter`: initialize/ensureBatch/extractSymbols/extractEdges/extractComplexity/isReady/dispose. |
| `packages/lang-java/src/composite-adapter.ts` | MODIFY: activate `JdtAnalyzerAdapter` in `initialize()` when ready; `getTier()` reflects runtime; complexity always tree-sitter. |
| `packages/lang-java/src/index.ts` | MODIFY: `tier: 'full'` (full tier now exists; degrades at runtime like lang-go). |
| `packages/lang-java/src/analyzer/__tests__/*.test.ts` | Unit tests (pure fns) + integration tests (real JAR, skipped without Java). |

---

## Task 1: toolchain-detect

**Files:**
- Create: `packages/lang-java/src/analyzer/toolchain-detect.ts`
- Create: `packages/lang-java/src/analyzer/__tests__/toolchain-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseJavaVersion } from '../toolchain-detect.js';

describe('parseJavaVersion', () => {
  it('parses modern openjdk version output', () => {
    const out = 'openjdk version "21.0.11" 2026-04-21 LTS\nOpenJDK Runtime Environment ...';
    expect(parseJavaVersion(out)).toEqual({ major: 21, version: '21.0.11' });
  });
  it('parses legacy 1.8 output', () => {
    const out = 'java version "1.8.0_392"\nJava(TM) SE Runtime ...';
    expect(parseJavaVersion(out)).toEqual({ major: 8, version: '1.8.0_392' });
  });
  it('parses Java 17', () => {
    expect(parseJavaVersion('openjdk version "17.0.10" 2026-01-16')).toEqual({ major: 17, version: '17.0.10' });
  });
  it('returns null on unparseable output', () => {
    expect(parseJavaVersion('not java')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @ctxo/lang-java test -- toolchain-detect` → FAIL (no module).

- [ ] **Step 3: Implement `toolchain-detect.ts`**

```typescript
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');
const MIN_MAJOR = 17;

export interface JavaToolchainInfo {
  available: boolean;     // true iff major >= MIN_MAJOR
  major?: number;
  version?: string;
  javaBin: string;        // resolved executable to spawn
}

/** Pure parser: extract {major, version} from `java -version` (stderr) text. */
export function parseJavaVersion(output: string): { major: number; version: string } | null {
  const m = output.match(/version "([^"]+)"/);
  if (!m) return null;
  const version = m[1]!;
  // "1.8.0_392" → major 8; "21.0.11" → major 21
  const parts = version.split('.');
  let major: number;
  if (parts[0] === '1' && parts.length > 1) major = parseInt(parts[1]!, 10);
  else major = parseInt(parts[0]!, 10);
  if (Number.isNaN(major)) return null;
  return { major, version };
}

/** Resolve the java executable: CTXO_JAVA_HOME → JAVA_HOME → 'java' on PATH. */
export function resolveJavaBin(): string {
  const home = process.env.CTXO_JAVA_HOME || process.env.JAVA_HOME;
  if (home) {
    const bin = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (existsSync(bin)) return bin;
  }
  return 'java';
}

/** Probe the Java runtime. `available` gates full tier on JRE >= 17. */
export function detectJavaRuntime(): JavaToolchainInfo {
  const javaBin = resolveJavaBin();
  try {
    // `java -version` prints to stderr.
    const out = execFileSync(javaBin, ['-version'], { encoding: 'utf-8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = parseJavaVersion(out);
    return finalize(javaBin, parsed);
  } catch (err) {
    // execFileSync throws on non-zero exit; version text may be on stderr of the error.
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const text = stderr ? stderr.toString() : '';
    const parsed = parseJavaVersion(text);
    if (parsed) return finalize(javaBin, parsed);
    log.info(`Java runtime not detected via ${javaBin}`);
    return { available: false, javaBin };
  }
}

function finalize(javaBin: string, parsed: { major: number; version: string } | null): JavaToolchainInfo {
  if (!parsed) return { available: false, javaBin };
  const available = parsed.major >= MIN_MAJOR;
  if (!available) log.info(`Java ${parsed.version} found but >= ${MIN_MAJOR} required for full tier`);
  return { available, major: parsed.major, version: parsed.version, javaBin };
}
```

- [ ] **Step 4: Run → pass.** Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/src/analyzer/toolchain-detect.ts packages/lang-java/src/analyzer/__tests__/toolchain-detect.test.ts
git commit -m "feat(lang-java): java toolchain detection (parse version, gate >=17)"
```

---

## Task 2: jar-download (resolve + SHA-256 verify)

**Files:**
- Create: `packages/lang-java/src/analyzer/jar-download.ts`
- Create: `packages/lang-java/src/analyzer/__tests__/jar-download.test.ts`

> `resolveAnalyzerJar` is pure-ish (filesystem only, no network). `downloadAnalyzerJar` does the opt-in network fetch + verify. `EXPECTED_SHA256` is a placeholder constant updated by Plan 5's release pipeline; until then, the env override (`CTXO_JDT_ANALYZER_JAR`) is the path used in dev/CI/test.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifySha256, resolveAnalyzerJar } from '../jar-download.js';

describe('verifySha256', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctxo-jar-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns true when the file hash matches', () => {
    const f = join(dir, 'a.jar'); writeFileSync(f, 'hello');
    const sha = createHash('sha256').update('hello').digest('hex');
    expect(verifySha256(f, sha)).toBe(true);
  });
  it('returns false on mismatch', () => {
    const f = join(dir, 'a.jar'); writeFileSync(f, 'hello');
    expect(verifySha256(f, 'deadbeef')).toBe(false);
  });
  it('returns false when file is missing', () => {
    expect(verifySha256(join(dir, 'nope.jar'), 'x')).toBe(false);
  });
});

describe('resolveAnalyzerJar', () => {
  let dir: string;
  const ENV = 'CTXO_JDT_ANALYZER_JAR';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctxo-jar-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env[ENV]; });

  it('uses the env override when set and the file exists', () => {
    const f = join(dir, 'override.jar'); writeFileSync(f, 'x');
    process.env[ENV] = f;
    expect(resolveAnalyzerJar('0.8.0')).toBe(f);
  });
  it('ignores the env override when the file does not exist', () => {
    process.env[ENV] = join(dir, 'missing.jar');
    // no cache either → null
    expect(resolveAnalyzerJar('0.8.0', { cacheRoot: dir })).toBeNull();
  });
  it('uses a cached jar when present (no SHA pinned → accept)', () => {
    const cacheDir = join(dir, '0.8.0'); mkdirSync(cacheDir, { recursive: true });
    const jar = join(cacheDir, 'ctxo-jdt-analyzer.jar'); writeFileSync(jar, 'x');
    expect(resolveAnalyzerJar('0.8.0', { cacheRoot: dir, expectedSha: null })).toBe(jar);
  });
  it('rejects a cached jar when SHA does not match', () => {
    const cacheDir = join(dir, '0.8.0'); mkdirSync(cacheDir, { recursive: true });
    const jar = join(cacheDir, 'ctxo-jdt-analyzer.jar'); writeFileSync(jar, 'x');
    expect(resolveAnalyzerJar('0.8.0', { cacheRoot: dir, expectedSha: 'deadbeef' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `jar-download.ts`**

```typescript
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');

const JAR_NAME = 'ctxo-jdt-analyzer.jar';
const ENV_OVERRIDE = 'CTXO_JDT_ANALYZER_JAR';
/** Pinned by Plan 5's release pipeline. null = accept any cached jar (pre-release dev). */
export const EXPECTED_SHA256: string | null = null;
/** GitHub Releases asset URL template (used by the opt-in download). */
const RELEASE_URL = (version: string) =>
  `https://github.com/alperhankendi/Ctxo/releases/download/lang-java-v${version}/${JAR_NAME}`;

export interface ResolveOpts {
  cacheRoot?: string;            // default ~/.ctxo/cache/lang-java
  expectedSha?: string | null;   // default EXPECTED_SHA256
}

export function verifySha256(filePath: string, expected: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    return hash.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

function defaultCacheRoot(): string {
  return join(homedir(), '.ctxo', 'cache', 'lang-java');
}

/**
 * Resolve a usable analyzer JAR WITHOUT network access:
 *   1. CTXO_JDT_ANALYZER_JAR env override (if the file exists)
 *   2. cached jar at <cacheRoot>/<version>/ctxo-jdt-analyzer.jar (SHA-verified when a hash is pinned)
 *   3. null
 */
export function resolveAnalyzerJar(version: string, opts: ResolveOpts = {}): string | null {
  const override = process.env[ENV_OVERRIDE];
  if (override && existsSync(override)) {
    log.info(`Using analyzer jar from ${ENV_OVERRIDE}: ${override}`);
    return override;
  }
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();
  const expected = opts.expectedSha === undefined ? EXPECTED_SHA256 : opts.expectedSha;
  const cached = join(cacheRoot, version, JAR_NAME);
  if (existsSync(cached)) {
    if (expected && !verifySha256(cached, expected)) {
      log.warn(`Cached analyzer jar failed SHA-256 verification: ${cached}`);
      return null;
    }
    return cached;
  }
  return null;
}

/**
 * Opt-in download from GitHub Releases → verify SHA-256 → cache. Returns the
 * cached path, or null on any failure (caller degrades to tree-sitter).
 * NEVER called automatically — only by an explicit install/opt-in flow.
 */
export async function downloadAnalyzerJar(version: string, opts: ResolveOpts = {}): Promise<string | null> {
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();
  const expected = opts.expectedSha === undefined ? EXPECTED_SHA256 : opts.expectedSha;
  const destDir = join(cacheRoot, version);
  const dest = join(destDir, JAR_NAME);
  try {
    const res = await fetch(RELEASE_URL(version));
    if (!res.ok) { log.warn(`Analyzer download failed: HTTP ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, buf);
    if (expected && !verifySha256(dest, expected)) {
      log.warn('Downloaded analyzer jar failed SHA-256 verification');
      return null;
    }
    log.info(`Downloaded analyzer jar to ${dest}`);
    return dest;
  } catch (err) {
    log.warn(`Analyzer download error: ${(err as Error).message}`);
    return null;
  }
}
```

- [ ] **Step 4: Run → pass.** Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/src/analyzer/jar-download.ts packages/lang-java/src/analyzer/__tests__/jar-download.test.ts
git commit -m "feat(lang-java): analyzer jar resolution + SHA-256 verify (env/cache, opt-in download)"
```

---

## Task 3: jdt-process (spawn + JSONL parse)

**Files:**
- Create: `packages/lang-java/src/analyzer/jdt-process.ts`
- Create: `packages/lang-java/src/analyzer/__tests__/jdt-process.integration.test.ts`

- [ ] **Step 1: Implement `jdt-process.ts`** (mirrors lang-go `analyzer-process.ts`)

```typescript
import { spawn } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');

export interface JdtSymbol {
  symbolId: string; name: string; kind: string;
  startLine: number; endLine: number; startOffset?: number; endOffset?: number;
}
export interface JdtEdge { from: string; to: string; kind: string; }
export interface JdtFileResult {
  type: 'file'; file: string; symbols: JdtSymbol[]; edges: JdtEdge[]; complexity: unknown[];
}
export interface JdtBatchResult {
  files: JdtFileResult[]; totalFiles: number; elapsed: string;
}

export interface RunOpts { classpathOverride?: string[]; allowBuildTools?: boolean; timeoutMs?: number; }

/**
 * Spawn `java -jar <jar> <root> [--classpath ...] [--allow-build-tools]` in batch
 * mode and parse the JSONL stream. Never throws — empty result on any failure so
 * the composite can fall back to tree-sitter.
 */
export async function runBatchIndex(
  javaBin: string,
  jarPath: string,
  projectRoot: string,
  opts: RunOpts = {},
): Promise<JdtBatchResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  return new Promise((resolve) => {
    const empty: JdtBatchResult = { files: [], totalFiles: 0, elapsed: '' };
    const args = ['-jar', jarPath, projectRoot];
    if (opts.classpathOverride?.length) args.push('--classpath', opts.classpathOverride.join(';'));
    if (opts.allowBuildTools) args.push('--allow-build-tools');

    const proc = spawn(javaBin, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    const files: JdtFileResult[] = [];
    let totalFiles = 0, elapsed = '', stderr = '', buffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          switch (obj.type) {
            case 'file': files.push(obj as JdtFileResult); break;
            case 'progress': log.info(String(obj.message ?? '')); break;
            case 'done': totalFiles = Number(obj.totalFiles ?? 0); elapsed = String(obj.elapsed ?? ''); break;
            // 'projectGraph' reserved for future multi-module use; ignored here.
          }
        } catch {
          log.error(`Failed to parse JSONL line: ${line.slice(0, 120)}`);
        }
      }
    });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { log.error(`ctxo-jdt-analyzer exited ${code}: ${stderr.trim().slice(0, 500)}`); resolve(empty); return; }
      resolve({ files, totalFiles, elapsed });
    });
    proc.on('error', (err) => { log.error(`ctxo-jdt-analyzer spawn error: ${err.message}`); resolve(empty); });
  });
}
```

- [ ] **Step 2: Integration test** `jdt-process.integration.test.ts` (runs the REAL jar; skips without Java)

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../toolchain-detect.js';
import { runBatchIndex } from '../jdt-process.js';

const jar = process.env.CTXO_JDT_ANALYZER_JAR
  ?? resolve(__dirname, '../../../tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar');
const fixture = resolve(__dirname, '../../../tools/ctxo-jdt-analyzer/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('runBatchIndex (real jar)', () => {
  it('emits file results with resolved call edges', async () => {
    const result = await runBatchIndex(java.javaBin, jar, fixture, { timeoutMs: 120_000 });
    expect(result.files.length).toBeGreaterThan(0);
    const foo = result.files.find((f) => f.file.endsWith('Foo.java'));
    expect(foo).toBeDefined();
    expect(foo!.edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    expect(foo!.edges.some((e) => e.kind === 'extends')).toBe(true);
  }, 130_000);
});
```

> If `canRun` is false (no Java / no jar), this suite is skipped — keeps CI green. To run it locally, set `JAVA_HOME` + `CTXO_JDT_ANALYZER_JAR` (see preamble) after `mvn package` in Plan 2.

- [ ] **Step 3: Run.** With env preamble + built jar: integration test PASSES. Without: it SKIPS (still green).

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java/tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar"
pnpm --filter @ctxo/lang-java test -- jdt-process
```

- [ ] **Step 4: Commit**

```bash
git add packages/lang-java/src/analyzer/jdt-process.ts packages/lang-java/src/analyzer/__tests__/jdt-process.integration.test.ts
git commit -m "feat(lang-java): jdt analyzer process (spawn batch + JSONL parse)"
```

---

## Task 4: JdtAnalyzerAdapter (batch-once, serve per file)

**Files:**
- Create: `packages/lang-java/src/analyzer/jdt-adapter.ts`
- Create: `packages/lang-java/src/analyzer/__tests__/jdt-adapter.integration.test.ts`

> Mirrors `GoAnalyzerAdapter`. The analyzer emits project-relative file paths already (the JAR relativizes against the root we pass), so NO path rewriting is needed. Validate `from`/symbolId as full 3-part IDs; keep edges whose `from` is valid and `to` is non-empty (targets may be 2-part name refs, resolved downstream).

- [ ] **Step 1: Implement `jdt-adapter.ts`**

```typescript
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { createLogger } from '../logger.js';
import { detectJavaRuntime } from './toolchain-detect.js';
import { resolveAnalyzerJar } from './jar-download.js';
import { runBatchIndex, type JdtFileResult } from './jdt-process.js';

const log = createLogger('ctxo:lang-java');
const FULL_SYMBOL_ID = /^.+::.+::.+$/; // file::name::kind

/** Plugin version — keep in sync with package.json / index.ts. */
const ANALYZER_VERSION = '0.8.0';

export class JdtAnalyzerAdapter implements ILanguageAdapter {
  readonly extensions = ['.java'] as const;
  readonly tier = 'full' as const;

  private root: string | null = null;
  private javaBin = 'java';
  private jarPath: string | null = null;
  private cache = new Map<string, JdtFileResult>();
  private batchPromise: Promise<void> | null = null;
  private initialized = false;

  isSupported(filePath: string): boolean { return filePath.toLowerCase().endsWith('.java'); }
  isReady(): boolean { return this.initialized && this.jarPath !== null && this.root !== null; }

  async initialize(rootDir: string): Promise<void> {
    const java = detectJavaRuntime();
    if (!java.available) {
      log.info(`Java full tier unavailable: JRE ${java.version ?? 'not found'} (>= 17 required)`);
      return;
    }
    const jar = resolveAnalyzerJar(ANALYZER_VERSION);
    if (!jar) {
      log.info('Java full tier unavailable: analyzer jar not present (run opt-in install for full tier)');
      return;
    }
    this.root = rootDir;
    this.javaBin = java.javaBin;
    this.jarPath = jar;
    this.initialized = true;
    log.info(`Java analyzer ready: JRE ${java.version}, jar ${jar}`);
  }

  async extractSymbols(filePath: string, _source: string): Promise<SymbolNode[]> {
    if (!this.isReady()) return [];
    await this.ensureBatch();
    const file = this.cache.get(this.norm(filePath));
    if (!file) return [];
    return file.symbols
      .filter((s) => FULL_SYMBOL_ID.test(s.symbolId))
      .map((s) => ({
        symbolId: s.symbolId, name: s.name, kind: s.kind as SymbolKind,
        startLine: s.startLine, endLine: s.endLine,
        ...(s.startOffset != null ? { startOffset: s.startOffset } : {}),
        ...(s.endOffset != null ? { endOffset: s.endOffset } : {}),
      }));
  }

  async extractEdges(filePath: string, _source: string): Promise<GraphEdge[]> {
    if (!this.isReady()) return [];
    await this.ensureBatch();
    const file = this.cache.get(this.norm(filePath));
    if (!file) return [];
    return file.edges
      .filter((e) => FULL_SYMBOL_ID.test(e.from) && e.to.length > 0)
      .map((e) => ({ from: e.from, to: e.to, kind: e.kind as GraphEdge['kind'] }));
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    return []; // tree-sitter owns complexity
  }

  async dispose(): Promise<void> {
    this.cache.clear(); this.batchPromise = null; this.initialized = false;
  }

  private norm(filePath: string): string { return filePath.replace(/\\/g, '/'); }

  private ensureBatch(): Promise<void> {
    if (this.batchPromise) return this.batchPromise;
    this.batchPromise = this.runBatch();
    return this.batchPromise;
  }

  private async runBatch(): Promise<void> {
    if (!this.jarPath || !this.root) return;
    const result = await runBatchIndex(this.javaBin, this.jarPath, this.root);
    this.cache.clear();
    for (const file of result.files) this.cache.set(this.norm(file.file), file);
    log.info(`Java analyzer batch: ${result.files.length} files in ${result.elapsed}`);
  }
}
```

- [ ] **Step 2: Integration test** `jdt-adapter.integration.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../toolchain-detect.js';
import { JdtAnalyzerAdapter } from '../jdt-adapter.js';

const jar = process.env.CTXO_JDT_ANALYZER_JAR
  ?? resolve(__dirname, '../../../tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar');
const fixture = resolve(__dirname, '../../../tools/ctxo-jdt-analyzer/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('JdtAnalyzerAdapter (real jar)', () => {
  it('initializes ready and serves symbols + resolved edges per file', async () => {
    process.env.CTXO_JDT_ANALYZER_JAR = jar; // ensure resolution
    const a = new JdtAnalyzerAdapter();
    await a.initialize(fixture);
    expect(a.isReady()).toBe(true);

    const symbols = await a.extractSymbols('Foo.java', '');
    expect(symbols.find((s) => s.name === 'Foo')?.kind).toBe('class');

    const edges = await a.extractEdges('Foo.java', '');
    expect(edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    expect(await a.extractComplexity('Foo.java', '')).toEqual([]);
    await a.dispose();
  }, 130_000);
});
```

- [ ] **Step 3: Run** (with env preamble): integration test PASSES; without Java it SKIPS.

- [ ] **Step 4: Commit**

```bash
git add packages/lang-java/src/analyzer/jdt-adapter.ts packages/lang-java/src/analyzer/__tests__/jdt-adapter.integration.test.ts
git commit -m "feat(lang-java): JdtAnalyzerAdapter (batch-once, per-file cache)"
```

---

## Task 5: Wire the composite to full tier + declare full tier

**Files:**
- Modify: `packages/lang-java/src/composite-adapter.ts`
- Modify: `packages/lang-java/src/index.ts`
- Modify: `packages/lang-java/src/__tests__/composite-adapter.test.ts`

- [ ] **Step 1: Update the composite test** to cover both tiers. Replace the file with:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JavaCompositeAdapter } from '../composite-adapter.js';
import { detectJavaRuntime } from '../analyzer/toolchain-detect.js';

describe('JavaCompositeAdapter (syntax fallback)', () => {
  it('falls back to syntax tier when full tier is unavailable', async () => {
    // Force no jar → analyzer not ready → syntax tier.
    const prev = process.env.CTXO_JDT_ANALYZER_JAR;
    process.env.CTXO_JDT_ANALYZER_JAR = resolve('definitely-missing-' + Date.now() + '.jar');
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize('/tmp/project');
    expect(adapter.getTier()).toBe('syntax');
    const symbols = await adapter.extractSymbols('A.java', 'class A { void m() {} }');
    expect(symbols.find((s) => s.name === 'A')?.kind).toBe('class');
    const complexity = await adapter.extractComplexity('A.java', 'class A { void m() { if (true) {} } }');
    expect(complexity.find((c) => c.symbolId === 'A.java::m::method')).toBeDefined();
    if (prev === undefined) delete process.env.CTXO_JDT_ANALYZER_JAR; else process.env.CTXO_JDT_ANALYZER_JAR = prev;
  });

  it('reports .java support', () => {
    const adapter = new JavaCompositeAdapter();
    expect(adapter.isSupported('Foo.java')).toBe(true);
    expect(adapter.isSupported('Foo.go')).toBe(false);
  });
});

const jar = process.env.CTXO_JDT_ANALYZER_JAR
  ?? resolve(__dirname, '../../tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar');
const fixture = resolve(__dirname, '../../tools/ctxo-jdt-analyzer/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('JavaCompositeAdapter (full tier, real jar)', () => {
  it('selects full tier and serves resolved call edges; complexity still tree-sitter', async () => {
    process.env.CTXO_JDT_ANALYZER_JAR = jar;
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize(fixture);
    expect(adapter.getTier()).toBe('full');
    const edges = await adapter.extractEdges('Foo.java', '');
    expect(edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    // complexity comes from tree-sitter even in full tier (read real fixture source)
    const src = 'package fixture;\npublic class Foo extends Bar {\n  public int add(int a, int b){ if(a>0){return a;} return helper(a)+b; }\n}\n';
    const complexity = await adapter.extractComplexity('Foo.java', src);
    expect(complexity.find((c) => c.symbolId === 'Foo.java::add::method')).toBeDefined();
    await adapter.dispose();
  }, 130_000);
});
```

- [ ] **Step 2: Run → fail** (composite still syntax-only). Expected: the full-tier test fails (getTier 'syntax').

- [ ] **Step 3: Update `composite-adapter.ts`** to wire the analyzer:

```typescript
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';
import { JavaAdapter } from './java-adapter.js';
import { JdtAnalyzerAdapter } from './analyzer/jdt-adapter.js';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-java');

/**
 * Picks between the full-tier JDT analyzer and the syntax-tier tree-sitter
 * adapter at initialize() time. Symbols/edges come from whichever is active;
 * complexity is ALWAYS tree-sitter (JDT emits none).
 */
export class JavaCompositeAdapter implements ILanguageAdapter {
  private treeSitter: JavaAdapter;
  private analyzer: JdtAnalyzerAdapter | null = null;

  constructor() { this.treeSitter = new JavaAdapter(); }

  async initialize(rootDir: string): Promise<void> {
    try {
      const analyzer = new JdtAnalyzerAdapter();
      await analyzer.initialize(rootDir);
      if (analyzer.isReady()) {
        this.analyzer = analyzer;
        log.info('Java plugin: JDT full-tier active');
        return;
      }
      await analyzer.dispose();
    } catch (err) {
      log.warn(`Java analyzer unavailable: ${(err as Error).message}`);
    }
    log.info('Java plugin: tree-sitter syntax-tier active (install full tier for resolved call/use edges)');
  }

  async dispose(): Promise<void> {
    if (this.analyzer) await this.analyzer.dispose();
  }

  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    return (this.analyzer ?? this.treeSitter).extractSymbols(filePath, source);
  }

  extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    return (this.analyzer ?? this.treeSitter).extractEdges(filePath, source);
  }

  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    return this.treeSitter.extractComplexity(filePath, source); // always tree-sitter
  }

  isSupported(filePath: string): boolean { return filePath.toLowerCase().endsWith('.java'); }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.treeSitter.setSymbolRegistry?.(registry);
  }

  getAnalyzerDelegate(): JdtAnalyzerAdapter | null { return this.analyzer; }

  getTier(): 'full' | 'syntax' | 'unavailable' {
    if (this.analyzer) return 'full';
    if (this.treeSitter) return 'syntax';
    return 'unavailable';
  }
}
```

- [ ] **Step 4: Update `index.ts`** — flip the declared tier back to `'full'` (full tier now exists; degrades at runtime like lang-go). Change the `tier:` field:

```typescript
  tier: 'full',
```

- [ ] **Step 5: Run → pass.** Unit fallback test passes always; full-tier test passes with env preamble (or skips without Java). Run full package + typecheck + build:

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java/tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar"
pnpm --filter @ctxo/lang-java test && pnpm --filter @ctxo/lang-java typecheck && pnpm --filter @ctxo/lang-java build
```
Expected: all tests pass (full-tier integration runs since env is set); typecheck + build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/lang-java/src/composite-adapter.ts packages/lang-java/src/index.ts packages/lang-java/src/__tests__/composite-adapter.test.ts
git commit -m "feat(lang-java): wire composite to JDT full tier; declare full tier"
```

---

## Task 6: Workspace verification

- [ ] **Step 1: Full build + typecheck + tests** (env preamble set so integration runs):

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java/tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar"
pnpm --filter @ctxo/lang-java build && pnpm --filter @ctxo/lang-java typecheck && pnpm --filter @ctxo/lang-java test
```
Expected: build emits dist; typecheck clean; ALL tests pass (unit + integration).

- [ ] **Step 2: Confirm syntax-tier still works WITHOUT Java** (unset env):

```bash
unset JAVA_HOME CTXO_JDT_ANALYZER_JAR CTXO_JAVA_HOME
pnpm --filter @ctxo/lang-java test 2>&1 | tail -6
```
Expected: all tests pass; integration suites SKIP (not fail). This proves graceful degradation.

- [ ] **Step 3: Final commit (if anything changed)**

```bash
git add -A packages/lang-java
git commit -m "chore(lang-java): plan 3 workspace verification" || echo "nothing to commit"
```

---

## Self-Review (Plan 3 scope)

**Spec coverage:** toolchain detect (≥17 gate) ✓ (T1); jar resolve env→cache→null + SHA-256 + opt-in download (no silent) ✓ (T2); spawn batch + JSONL parse, never-throw ✓ (T3); JdtAnalyzerAdapter batch-once/per-file cache, complexity empty ✓ (T4); composite full-tier selection + always-tree-sitter complexity + tier='full' declaration ✓ (T5); graceful degradation without Java ✓ (T6). Keep-alive/watch is Plan 4; CI publish + real download + `ctxo doctor` + plugin discovery is Plan 5 — explicitly out of scope.

**Placeholder scan:** `EXPECTED_SHA256 = null` is intentional pre-release (Plan 5 pins it); documented, not a TODO. `downloadAnalyzerJar` is a complete, opt-in function (not auto-called) — its real end-to-end exercise waits on Plan 5's published asset; SHA-verify + cache logic IS unit-tested now.

**Type consistency:** `JdtFileResult`/`JdtSymbol`/`JdtEdge` field names match the analyzer's JSON (Plan 2 `Dtos`) and the TS `SymbolNode`/`GraphEdge` shapes. `detectJavaRuntime().javaBin` feeds `runBatchIndex(javaBin, ...)`. `ANALYZER_VERSION` ('0.8.0') matches the Plan 2 pom `<version>` and the jar cache path. The composite's `getAnalyzerDelegate()` mirrors lang-go for future cli optimizations.

**Risk note:** integration tests depend on the Plan 2 jar existing at `tools/ctxo-jdt-analyzer/target/`. They SKIP cleanly when absent, so the suite is green on Java-less machines/CI; to exercise the full tier, build the jar (Plan 2 `mvn package`) and set the env preamble.
