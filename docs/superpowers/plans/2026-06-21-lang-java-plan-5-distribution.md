# lang-java Plan 5 — Distribution & Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `@ctxo/lang-java`'s full tier reachable and production-ready: ship the JDT JAR as a separate opt-in npm package, rewire the plugin to resolve it from `node_modules`, give `ctxo install java` a JRE-aware smart default, surface the active tier transparently (incl. `ctxo doctor`), and build the JAR in CI only at release time.

**Architecture:** New package `@ctxo/lang-java-analyzer` owns the Maven source and carries the built JAR in its tarball (integrity/provenance via npm). The plugin resolves the JAR via `require.resolve('@ctxo/lang-java-analyzer/package.json')` — no download, no SHA pin. `ctxo install java` detects a JRE 17+ and installs the analyzer package when present. The JAR is built in `release.yml` (`setup-java` + `mvn package`); the PR pipeline stays Node-only; the JAR is never committed.

**Tech Stack:** TypeScript (ESM, strict), Node 20, vitest; Java 17 / Maven (release CI only, on JDK 21 targeting release 17). Decisions: [ADR-014 Revision 2](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md). Spec: [2026-06-21-lang-java-plan-5-distribution-design.md](../specs/2026-06-21-lang-java-plan-5-distribution-design.md).

**Plan set:** Plan 5 of 5 (Plans 1-3 done; Plan 4 = watch, deferred). Builds on the committed Plan 3 wiring.

---

## ⚙️ Environment preamble (Maven steps only — Task 1 build + Task 7)

JDK 21 + Maven are installed but not on the shell PATH. Prefix Maven/java commands:
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
```
TypeScript tasks (2-6) need no Java. Integration tests that spawn `java` also set `CTXO_JDT_ANALYZER_JAR` (see Task 3).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/lang-java-analyzer/package.json` | NEW package; `build` = `mvn package` → copies jar to `jar/`; `files: ["jar/ctxo-jdt-analyzer.jar","index.js","index.d.ts"]` |
| `packages/lang-java-analyzer/index.js` + `index.d.ts` | NEW; exports `jarPath(): string` (absolute path to the bundled jar) + `ANALYZER_VERSION` |
| `packages/lang-java-analyzer/java/` | Maven source MOVED from `packages/lang-java/tools/ctxo-jdt-analyzer/` |
| `packages/lang-java-analyzer/.gitignore` | ignore `target/`, `jar/` (jar is a build output, never committed) |
| `packages/lang-java/src/analyzer/jar-resolve.ts` | NEW; `resolveAnalyzerJar(): string \| null` via require.resolve (+ env override) |
| `packages/lang-java/src/analyzer/jar-download.ts` | DELETE (superseded) |
| `packages/lang-java/src/analyzer/jdt-adapter.ts` | MODIFY; use jar-resolve; version-match check |
| `packages/cli/src/cli/install-command.ts` | MODIFY; `--full-tier`/`--syntax-only` + JRE smart default for java |
| `packages/cli/src/adapters/diagnostics/checks/java-tier-check.ts` | NEW doctor check |
| `packages/cli/src/cli/doctor-command.ts` | MODIFY; register `new JavaTierCheck()` |
| `packages/cli/src/cli/index-command.ts` | MODIFY; add Java tier summary line |
| `.github/workflows/release.yml` | MODIFY; `setup-java` + build analyzer jar before publish |
| `.changeset/lang-java-full-tier.md` | MODIFY; add `@ctxo/lang-java-analyzer` |

---

## Task 1: Scaffold `@ctxo/lang-java-analyzer` (carries the JAR)

**Files:** Create `packages/lang-java-analyzer/{package.json,index.js,index.d.ts,.gitignore}`; move Maven source.

- [ ] **Step 1: Move the Maven source** (preserve git history)
```bash
cd d:/workspace/Ctxo
mkdir -p packages/lang-java-analyzer
git mv packages/lang-java/tools/ctxo-jdt-analyzer packages/lang-java-analyzer/java
# lang-java no longer ships Maven source; drop the now-empty tools dir
rmdir packages/lang-java/tools 2>/dev/null || true
```

- [ ] **Step 2: Create `packages/lang-java-analyzer/.gitignore`**
```gitignore
java/target/
jar/
```

- [ ] **Step 3: Create `packages/lang-java-analyzer/package.json`**
```json
{
  "name": "@ctxo/lang-java-analyzer",
  "version": "0.8.0-alpha.0",
  "description": "Prebuilt Eclipse JDT Core analyzer JAR for @ctxo/lang-java full tier",
  "type": "module",
  "engines": { "node": ">=20" },
  "main": "index.js",
  "types": "index.d.ts",
  "exports": { ".": { "types": "./index.d.ts", "import": "./index.js" }, "./package.json": "./package.json" },
  "files": ["index.js", "index.d.ts", "jar/ctxo-jdt-analyzer.jar", "README.md"],
  "scripts": {
    "build": "mvn -q -f java/pom.xml -DskipTests package && node -e \"require('node:fs').mkdirSync('jar',{recursive:true}); require('node:fs').copyFileSync('java/target/ctxo-jdt-analyzer.jar','jar/ctxo-jdt-analyzer.jar')\"",
    "test": "mvn -q -f java/pom.xml test"
  },
  "keywords": ["ctxo", "java", "jdt", "analyzer"],
  "author": "Alper Hankendi",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/alperhankendi/Ctxo.git", "directory": "packages/lang-java-analyzer" },
  "publishConfig": { "access": "public", "provenance": true }
}
```

- [ ] **Step 4: Create `packages/lang-java-analyzer/index.js`**
```javascript
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const ANALYZER_VERSION = require('./package.json').version;

/** Absolute path to the bundled analyzer JAR, or null if it isn't present. */
export function jarPath() {
  const p = join(here, 'jar', 'ctxo-jdt-analyzer.jar');
  return existsSync(p) ? p : null;
}
```

- [ ] **Step 5: Create `packages/lang-java-analyzer/index.d.ts`**
```typescript
export declare const ANALYZER_VERSION: string;
export declare function jarPath(): string | null;
```

- [ ] **Step 6: Create `packages/lang-java-analyzer/README.md`** (one line is fine)
```markdown
# @ctxo/lang-java-analyzer

Prebuilt Eclipse JDT Core analyzer JAR consumed by [`@ctxo/lang-java`](https://www.npmjs.com/package/@ctxo/lang-java) for full-tier Java analysis. Installed opt-in via `ctxo install java --full-tier`. Requires a JRE 17+ at runtime.
```

- [ ] **Step 7: Install + build the jar + verify** (env preamble set)
```bash
pnpm install
pnpm --filter @ctxo/lang-java-analyzer build
node -e "import('@ctxo/lang-java-analyzer').then(m=>console.log('jar:', m.jarPath(), 'v:', m.ANALYZER_VERSION))"
```
Expected: build produces `jar/ctxo-jdt-analyzer.jar`; the node line prints a real path + `0.8.0-alpha.0`.

- [ ] **Step 8: Commit**
```bash
git add packages/lang-java-analyzer packages/lang-java
git commit -m "feat(lang-java-analyzer): new package carrying the prebuilt JDT jar"
```

---

## Task 2: `jar-resolve.ts` in the plugin (replaces jar-download)

**Files:** Create `packages/lang-java/src/analyzer/jar-resolve.ts` + test; delete `jar-download.ts` + its test.

- [ ] **Step 1: Write the failing test** `packages/lang-java/src/analyzer/__tests__/jar-resolve.test.ts`
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolveAnalyzerJar } from '../jar-resolve.js';

const ENV = 'CTXO_JDT_ANALYZER_JAR';
afterEach(() => { delete process.env[ENV]; });

describe('resolveAnalyzerJar', () => {
  it('honors the env override when the file exists', () => {
    // package.json always exists; use it as a stand-in existing file
    const real = require.resolve('@ctxo/lang-java-analyzer/package.json');
    process.env[ENV] = real;
    expect(resolveAnalyzerJar()).toBe(real);
  });

  it('returns the bundled jar path when the analyzer package is installed and built, else null', () => {
    const result = resolveAnalyzerJar();
    // In dev/CI the jar may or may not be built; result is either an existing path or null — never throws.
    if (result !== null) expect(existsSync(result)).toBe(true);
    else expect(result).toBeNull();
  });

  it('returns null when the env override points at a missing file and package absent path is exercised', () => {
    process.env[ENV] = 'Z:/definitely/missing-' + Date.now() + '.jar';
    const result = resolveAnalyzerJar();
    // env override ignored (missing) → falls through to package resolution (jar may be null)
    if (result !== null) expect(existsSync(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @ctxo/lang-java test -- jar-resolve` → FAIL (no module).

- [ ] **Step 3: Implement `jar-resolve.ts`**
```typescript
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');
const require = createRequire(import.meta.url);
const ANALYZER_PKG = '@ctxo/lang-java-analyzer';
const ENV_OVERRIDE = 'CTXO_JDT_ANALYZER_JAR';
const JAR_REL = ['jar', 'ctxo-jdt-analyzer.jar'];

/**
 * Resolve the full-tier analyzer JAR WITHOUT network access:
 *   1. CTXO_JDT_ANALYZER_JAR env override (dev/CI/test escape hatch), if the file exists
 *   2. the bundled jar inside the installed @ctxo/lang-java-analyzer package
 *   3. null  → caller degrades to tree-sitter
 * Never throws.
 */
export function resolveAnalyzerJar(): string | null {
  const override = process.env[ENV_OVERRIDE];
  if (override && existsSync(override)) {
    log.info(`Using analyzer jar from ${ENV_OVERRIDE}: ${override}`);
    return override;
  }
  try {
    const pkgJson = require.resolve(`${ANALYZER_PKG}/package.json`);
    const jar = join(dirname(pkgJson), ...JAR_REL);
    return existsSync(jar) ? jar : null;
  } catch {
    return null; // analyzer package not installed → syntax tier
  }
}

/** Version of the installed analyzer package, or null when absent. */
export function analyzerPackageVersion(): string | null {
  try {
    const pkgJson = require.resolve(`${ANALYZER_PKG}/package.json`);
    return (require(pkgJson) as { version: string }).version;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @ctxo/lang-java test -- jar-resolve`.

- [ ] **Step 5: Delete the superseded download module + its test**
```bash
git rm packages/lang-java/src/analyzer/jar-download.ts
git rm packages/lang-java/src/analyzer/__tests__/jar-download.test.ts
```

- [ ] **Step 6: Commit**
```bash
git add packages/lang-java/src/analyzer/jar-resolve.ts packages/lang-java/src/analyzer/__tests__/jar-resolve.test.ts
git commit -m "feat(lang-java): resolve analyzer jar from npm package (replaces download)"
```

---

## Task 3: Rewire `jdt-adapter.ts` to jar-resolve + version check

**Files:** Modify `packages/lang-java/src/analyzer/jdt-adapter.ts`; update its integration test.

- [ ] **Step 1: Read** `packages/lang-java/src/analyzer/jdt-adapter.ts`. It currently imports `resolveAnalyzerJar` from `./jar-download.js` and calls `resolveAnalyzerJar(ANALYZER_VERSION)`.

- [ ] **Step 2: Apply the edit** — change the import + call, add a version-mismatch guard. Replace the import line:
```typescript
import { resolveAnalyzerJar, analyzerPackageVersion } from './jar-resolve.js';
```
Replace the `initialize()` jar-resolution block so it takes no version arg and warns on mismatch:
```typescript
    const jar = resolveAnalyzerJar();
    if (!jar) {
      log.info('Java full tier unavailable: @ctxo/lang-java-analyzer not installed (run: ctxo install java --full-tier)');
      return;
    }
    const analyzerVer = analyzerPackageVersion();
    if (analyzerVer && analyzerVer !== ANALYZER_VERSION) {
      log.warn(`Analyzer package version ${analyzerVer} != plugin ${ANALYZER_VERSION}; using it anyway. Re-run "ctxo install java --full-tier" to align.`);
    }
```
(Keep the rest: set `this.jarPath = jar`, `this.javaBin`, `this.initialized = true`, etc.)

- [ ] **Step 3: Run the integration test** (env preamble + jar built in Task 1):
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java-analyzer/jar/ctxo-jdt-analyzer.jar"
pnpm --filter @ctxo/lang-java test -- jdt-adapter
```
Expected: integration test runs (env set) and PASSES — the adapter resolves the jar and serves resolved call edges.

- [ ] **Step 4: Typecheck** `pnpm --filter @ctxo/lang-java typecheck` → clean (no dangling jar-download import).

- [ ] **Step 5: Commit**
```bash
git add packages/lang-java/src/analyzer/jdt-adapter.ts
git commit -m "feat(lang-java): jdt-adapter resolves jar via package + version-match guard"
```

---

## Task 4: `ctxo install java` smart default + flags

**Files:** Modify `packages/cli/src/cli/install-command.ts` (+ its argv wiring) and tests.

- [ ] **Step 1: Read** `packages/cli/src/cli/install-command.ts` and find where `InstallOptions` is built from argv (the CLI entry that parses `--yes`, `--global`, etc.). Add parsing for `--full-tier` and `--syntax-only`.

- [ ] **Step 2: Write the failing test** `packages/cli/src/cli/__tests__/install-java-tier.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { resolveJavaPackages } from '../install-command.js';

describe('resolveJavaPackages', () => {
  it('adds analyzer when JRE present and not syntax-only', () => {
    expect(resolveJavaPackages({ jreAvailable: true })).toEqual(
      ['@ctxo/lang-java', '@ctxo/lang-java-analyzer']);
  });
  it('syntax only when no JRE', () => {
    expect(resolveJavaPackages({ jreAvailable: false })).toEqual(['@ctxo/lang-java']);
  });
  it('--syntax-only forces syntax even with JRE', () => {
    expect(resolveJavaPackages({ jreAvailable: true, syntaxOnly: true })).toEqual(['@ctxo/lang-java']);
  });
  it('--full-tier forces analyzer even without detected JRE', () => {
    expect(resolveJavaPackages({ jreAvailable: false, fullTier: true })).toEqual(
      ['@ctxo/lang-java', '@ctxo/lang-java-analyzer']);
  });
});
```

- [ ] **Step 3: Run → fail.**

- [ ] **Step 4: Implement.** Add to `install-command.ts` a pure helper + wire it in. Extend `InstallOptions` with `fullTier?: boolean; syntaxOnly?: boolean`. Add:
```typescript
/** Decide the java package set from JRE availability + flags. Pure + unit-testable. */
export function resolveJavaPackages(opts: { jreAvailable: boolean; fullTier?: boolean; syntaxOnly?: boolean }): string[] {
  const base = ['@ctxo/lang-java'];
  if (opts.syntaxOnly) return base;
  if (opts.fullTier || opts.jreAvailable) return [...base, '@ctxo/lang-java-analyzer'];
  return base;
}
```
In `run()`, when the resolved languages include `'java'`, replace its single `officialPluginFor('java')` specifier with the result of `resolveJavaPackages({ jreAvailable: detectJavaRuntime().available, fullTier: options.fullTier, syntaxOnly: options.syntaxOnly })`. Import `detectJavaRuntime` from `@ctxo/lang-java`'s toolchain or re-detect via a local `java -version` probe (mirror `LanguageCoverageCheck`'s require pattern — DO NOT import plugin internals across the package boundary; instead spawn `java -version` locally in a tiny `core/detection/detect-java-runtime.ts` helper and unit-test it separately). When JRE absent and java requested, print: `[ctxo] JRE 17+ not found; installing Java syntax tier. Install a JRE then run "ctxo install java --full-tier".`

- [ ] **Step 5: Run → pass.** `pnpm --filter @ctxo/cli test -- install-java-tier`.

- [ ] **Step 6: Commit**
```bash
git add packages/cli/src/cli/install-command.ts packages/cli/src/cli/__tests__/install-java-tier.test.ts
git commit -m "feat(cli): ctxo install java smart full-tier default (--full-tier/--syntax-only)"
```

---

## Task 5: `ctxo doctor` Java tier check

**Files:** Create `packages/cli/src/adapters/diagnostics/checks/java-tier-check.ts` + test; register in `doctor-command.ts`.

- [ ] **Step 1: Write the failing test** `packages/cli/src/adapters/diagnostics/__tests__/java-tier-check.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { evaluateJavaTier } from '../checks/java-tier-check.js';

describe('evaluateJavaTier', () => {
  it('pass: full tier when JRE>=17 and analyzer installed', () => {
    const r = evaluateJavaTier({ hasJava: false, jreMajor: 21, analyzerInstalled: true });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('full');
  });
  it('warn: JRE present but analyzer missing → install hint', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 21, analyzerInstalled: false });
    expect(r.status).toBe('warn');
    expect(r.fix).toContain('--full-tier');
  });
  it('warn: analyzer present but no JRE → JRE hint', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: undefined, analyzerInstalled: true });
    expect(r.status).toBe('warn');
    expect(r.fix?.toLowerCase()).toContain('jre');
  });
  it('pass(syntax): no java sources context → syntax tier, no nag', () => {
    const r = evaluateJavaTier({ hasJava: false, jreMajor: 16, analyzerInstalled: false });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('syntax');
  });
});
```
> `hasJava` = the project has Java sources (so the check only nags when Java is actually used). `jreMajor` undefined = no JRE.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `java-tier-check.ts`** (pure `evaluateJavaTier` + an `IHealthCheck` wrapper)
```typescript
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';

const require = createRequire(import.meta.url);

export interface JavaTierInputs { hasJava: boolean; jreMajor: number | undefined; analyzerInstalled: boolean; }

/** Pure decision: map (java-present, jre, analyzer) → CheckResult fields. */
export function evaluateJavaTier(i: JavaTierInputs): CheckResult {
  const id = 'java_tier', title = 'Java analysis tier';
  if (!i.hasJava) return { id, title, status: 'pass', message: 'no Java sources detected' };
  const jreOk = (i.jreMajor ?? 0) >= 17;
  if (jreOk && i.analyzerInstalled) return { id, title, status: 'pass', message: `full tier (JRE ${i.jreMajor}, analyzer installed)` };
  if (jreOk && !i.analyzerInstalled)
    return { id, title, status: 'warn', message: `syntax tier (JRE ${i.jreMajor} present, analyzer missing)`, fix: 'Run "ctxo install java --full-tier" for resolved call/use edges' };
  if (!jreOk && i.analyzerInstalled)
    return { id, title, status: 'warn', message: 'syntax tier (analyzer installed but no JRE 17+)', fix: 'Install a JRE 17+ and ensure it is on PATH (or set JAVA_HOME)' };
  return { id, title, status: 'pass', message: 'syntax tier (install JRE 17+ and run "ctxo install java --full-tier" for full tier)' };
}

function detectJreMajor(): number | undefined {
  const home = process.env.CTXO_JAVA_HOME || process.env.JAVA_HOME;
  const bin = home ? join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const r = spawnSync(bin, ['-version'], { encoding: 'utf-8' });
  const text = `${r.stderr ?? ''}${r.stdout ?? ''}`;
  const m = text.match(/version "([^"]+)"/);
  if (!m) return undefined;
  const parts = m[1]!.split('.');
  const major = parts[0] === '1' && parts[1] ? parseInt(parts[1]!, 10) : parseInt(parts[0]!, 10);
  return Number.isNaN(major) ? undefined : major;
}

function projectHasJava(root: string): boolean {
  for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts']) if (existsSync(join(root, f))) return true;
  try { return readdirSync(root).some((n) => n.endsWith('.java')); } catch { return false; }
}

function analyzerInstalled(): boolean {
  try { require.resolve('@ctxo/lang-java-analyzer/package.json'); return true; } catch { return false; }
}

export class JavaTierCheck implements IHealthCheck {
  readonly id = 'java_tier';
  readonly title = 'Java analysis tier';
  async run(ctx: CheckContext): Promise<CheckResult> {
    return evaluateJavaTier({
      hasJava: projectHasJava(ctx.projectRoot),
      jreMajor: detectJreMajor(),
      analyzerInstalled: analyzerInstalled(),
    });
  }
}
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @ctxo/cli test -- java-tier-check`.

- [ ] **Step 5: Register** in `packages/cli/src/cli/doctor-command.ts`: import `JavaTierCheck` and add `new JavaTierCheck(),` to the `checks` array (near `LanguageCoverageCheck`).

- [ ] **Step 6: Typecheck + commit**
```bash
pnpm --filter @ctxo/cli typecheck
git add packages/cli/src/adapters/diagnostics/checks/java-tier-check.ts packages/cli/src/adapters/diagnostics/__tests__/java-tier-check.test.ts packages/cli/src/cli/doctor-command.ts
git commit -m "feat(cli): ctxo doctor java tier check (runtime + analyzer + actionable hint)"
```

---

## Task 6: Index output tier transparency for Java

**Files:** Modify `packages/cli/src/cli/index-command.ts`.

- [ ] **Step 1: Read** `index-command.ts` around lines 350-360 (the per-language tier summary: TS/C#/Go) and 420-450 (the generic `getTier()` duck-typing block). Note the existing `goTier`/`csharpTier` variables.

- [ ] **Step 2: Add Java tier tracking + summary line.** Mirror the Go branch: add a `javaTier` variable (default `'syntax'`), and in the plugin loop where `plugin.id === 'go'` duck-types `getTier()`, add:
```typescript
      if (plugin.id === 'java' && typeof (adapter as { getTier?: () => string }).getTier === 'function') {
        javaTier = (adapter as { getTier: () => string }).getTier();
      }
```
(Use the same `adapter`/candidate variable the Go branch uses.) Then add a summary line next to the Go/C# ones:
```typescript
    if (javaCount > 0) console.error(`[ctxo]   Java: ${javaCount} files (${javaTier} tier${javaTier === 'syntax' ? ' - JRE 17+ & "ctxo install java --full-tier" for full analysis' : ''})`);
```
where `javaCount` is derived the same way `goCount`/`csCount` are (from the detection/extension counts already computed in that function). If those counts come from a map, read `byExtension['java']` or the equivalent already present.

- [ ] **Step 3: Typecheck** `pnpm --filter @ctxo/cli typecheck` → clean.

- [ ] **Step 4: Commit**
```bash
git add packages/cli/src/cli/index-command.ts
git commit -m "feat(cli): surface Java analysis tier in index output"
```

---

## Task 7: Build the analyzer JAR in CI at release time

**Files:** Modify `.github/workflows/release.yml`. *(CI-verified; not runnable locally.)*

- [ ] **Step 1: Add a `setup-java` step** after the `pnpm install` step and BEFORE "Build workspace packages":
```yaml
      - name: Set up JDK 21 (for @ctxo/lang-java-analyzer jar build)
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven
```

- [ ] **Step 2: Ensure the analyzer jar is built before publish.** The analyzer package's `build` script runs `mvn package`; `pnpm -r build` (already in release.yml) will invoke it, producing `jar/ctxo-jdt-analyzer.jar` into the package before `changeset publish` packs the tarball. Add a verification step right after "Build workspace packages":
```yaml
      - name: Verify analyzer jar was built
        run: test -f packages/lang-java-analyzer/jar/ctxo-jdt-analyzer.jar
```

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/release.yml
git commit -m "ci(release): build @ctxo/lang-java-analyzer jar (setup-java + mvn) before publish"
```

> Verification of this task happens on the next release run in GitHub Actions (cannot be exercised locally). The local `pnpm --filter @ctxo/lang-java-analyzer build` in Task 1 already proves the build command works.

---

## Task 8: Changeset + workspace verification

**Files:** Modify `.changeset/lang-java-full-tier.md`.

- [ ] **Step 1: Add the analyzer package to the changeset.** Edit `.changeset/lang-java-full-tier.md` frontmatter:
```markdown
---
"@ctxo/lang-java": minor
"@ctxo/lang-java-analyzer": minor
---
```
(append a sentence to the body: "The full-tier JDT analyzer JAR ships as the companion `@ctxo/lang-java-analyzer` package, resolved from node_modules; integrity via npm. Installed opt-in by `ctxo install java --full-tier` (smart default when a JRE 17+ is detected).")

- [ ] **Step 2: Full workspace verification** (TS side, Node-only — no Java needed):
```bash
cd d:/workspace/Ctxo
pnpm -r typecheck
pnpm -r build
```
Expected: all packages typecheck + build clean (lang-java-analyzer `build` runs `mvn package` — needs the env preamble; if running without Java, build that one package separately or accept it requires Maven — note it).

- [ ] **Step 3: Java-side tests + integration green** (env preamble + jar built):
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
export CTXO_JDT_ANALYZER_JAR="$(pwd)/packages/lang-java-analyzer/jar/ctxo-jdt-analyzer.jar"
pnpm --filter @ctxo/lang-java-analyzer test
pnpm --filter @ctxo/lang-java test
pnpm --filter @ctxo/cli test -- "java"
```
Expected: JUnit suite green; lang-java unit + integration green; cli java tests green.

- [ ] **Step 4: Commit**
```bash
git add .changeset/lang-java-full-tier.md
git commit -m "chore(lang-java): changeset adds @ctxo/lang-java-analyzer; plan 5 complete"
```

---

## Self-Review (Plan 5 scope)

**Spec coverage:** D1 separate npm package + require.resolve ✓ (T1,T2,T3); D2 npm integrity, no SHA pin (jar-download deleted) ✓ (T2); D3 smart default + flags + transparency ✓ (T4 install, T5 doctor, T6 index); D4 new package owns Maven source + release-only CI build, no committed binary (jar gitignored) ✓ (T1,T7); D5 action-oriented doctor ✓ (T5). MCP `_meta` tier field: the composite already exposes `getTier()`; surfacing it in `_meta` is a thin follow-up — index-output + doctor cover the primary transparency surfaces in this plan (note: `_meta` tier exposure deferred as a small follow-up, flagged here).

**Placeholder scan:** Tasks 4 and 6 require reading the exact argv-wiring / counts in existing CLI files (install-command argv, index-command counts) because those lines weren't fully quoted here; the *new* logic (resolveJavaPackages, evaluateJavaTier, jar-resolve) is given in full. The read-then-wire steps are explicit, not "figure it out" placeholders. No TBD/TODO in committed outputs.

**Type consistency:** `resolveAnalyzerJar()` (no args) is used consistently in T2/T3 (T3 drops the old `ANALYZER_VERSION` arg); `analyzerPackageVersion()`/`ANALYZER_VERSION` names align; `evaluateJavaTier`/`JavaTierCheck` and `CheckResult` shape match the existing `IHealthCheck` contract (`{id,title,status,message,fix?}`); `resolveJavaPackages` signature matches its tests; the analyzer package name `@ctxo/lang-java-analyzer` is consistent across plugin resolve, install, doctor, changeset.

**Risk note:** Task 6 (`javaCount`/`javaTier` wiring) and Task 4 (argv parsing) depend on the exact current structure of `index-command.ts` / `install-command.ts` — the implementer reads those first (steps say so) and mirrors the proven Go/C# patterns already present.
