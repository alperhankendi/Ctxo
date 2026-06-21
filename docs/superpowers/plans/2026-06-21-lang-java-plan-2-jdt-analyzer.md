# lang-java Plan 2 — JDT Analyzer (Java side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the standalone `ctxo-jdt-analyzer` uber-JAR (Eclipse JDT Core) that reads a Java project, resolves bindings, and emits symbols + semantic edges (`calls`/`uses`/`extends`/`implements`/`imports`) as JSONL on stdout — in both one-shot batch mode and a keep-alive (watch) mode. This is the full-tier engine; the TypeScript side that spawns and parses it is Plan 3.

**Architecture:** A small Maven project under `packages/lang-java/tools/ctxo-jdt-analyzer/`. `Main.java` owns the stdio protocol (batch + keep-alive). `Analyzer.java` runs `ASTParser.createASTs(...)` with `resolveBindings(true)` and an `ASTVisitor` that emits a `FileResult` per compilation unit. `ClasspathResolver.java` resolves dependency JARs (so bindings resolve). JSON via Gson. Built into an uber-JAR with `maven-shade-plugin`, **compiled with `release 17`** so the artifact runs on JRE 17+ (we build/test on the installed JDK 21).

**Tech Stack:** Java 17 (source/target via `release`), built on JDK 21 + Maven 3.9. Eclipse JDT Core (DOM/AST batch API), Gson, JUnit 5 (surefire). Output JSON contract mirrors `RoslynBatchResult` (see `packages/lang-csharp/src/roslyn/roslyn-process.ts`).

**Plan set:** Plan 2 of 5. Spec: [docs/superpowers/specs/2026-06-21-lang-java-full-tier-design.md](../specs/2026-06-21-lang-java-full-tier-design.md). Decisions: [ADR-014](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).

---

## ⚙️ Environment preamble (EVERY Maven/java command needs this)

The JDK + Maven are installed but **not on the running shells' PATH**. Prefix EVERY command that runs `mvn` or `java` with:

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
```

(PowerShell equivalent: `$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'; $env:Path="$env:JAVA_HOME\bin;C:\Users\ahank\tools\apache-maven-3.9.16\bin;$env:Path"`.)

Verify once at the start: `mvn -version` should print Maven 3.9.16 / Java 21.

> **Build on JDK 21, target release 17.** `maven.compiler.release=17` makes the artifact run on JRE 17+ (our single-tier decision). Do NOT bump to 21 — that would break the JRE-17 floor.

---

## JSON output contract (must match the TS side in Plan 3 / RoslynBatchResult)

One JSON object per line on **stdout**. Record types:

```jsonc
{"type":"file","file":"src/main/java/com/example/Foo.java","symbols":[...],"edges":[...],"complexity":[]}
{"type":"progress","message":"..."}
{"type":"projectGraph","projects":[{"name":"...","path":"..."}],"edges":[]}
{"type":"done","totalFiles":12,"elapsed":"3.4s"}
{"type":"ready","projectCount":1,"fileCount":12}   // keep-alive startup only
```

- `symbols[]`: `{symbolId, name, kind, startLine, endLine, startOffset?, endOffset?}` — `kind` ∈ `function|class|interface|method|variable|type`. Symbol ID = `<relativeFile>::<name>::<kind>`. Lines are **0-based** (match tree-sitter / ctxo index convention — JDT line numbers are 1-based, so subtract 1).
- `edges[]`: `{from, to, kind}` — `kind` ∈ `imports|calls|extends|implements|uses`.
- `complexity[]`: **always empty** — tree-sitter owns complexity (mirrors lang-go analyzer).
- **Errors go to stderr**, never stdout (stdout is the JSONL channel).
- Kind mapping: class→`class`, interface→`interface`, enum→`type`, record→`class`, annotation→`interface`, method/constructor→`method`, field→`variable`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/lang-java/tools/ctxo-jdt-analyzer/pom.xml` | Maven build: JDT Core + Gson + JUnit; shade uber-JAR; release 17. |
| `.../src/main/java/io/ctxo/jdt/Main.java` | Entry point + stdio protocol (batch + keep-alive). |
| `.../src/main/java/io/ctxo/jdt/Analyzer.java` | `ASTParser.createASTs` + `ASTVisitor` → `FileResult`. |
| `.../src/main/java/io/ctxo/jdt/ClasspathResolver.java` | Resolve dependency JARs (override → IDE → local-repo → empty). |
| `.../src/main/java/io/ctxo/jdt/Dtos.java` | Plain data classes: `FileResult`, `Sym`, `Edge` (Gson-serialized). |
| `.../src/test/java/io/ctxo/jdt/AnalyzerTest.java` | JUnit: analyze fixture sources, assert symbols/edges. |
| `.../src/test/resources/fixture/...` | Small Java fixture sources for tests. |
| `.../.gitignore` | Ignore `target/`. |

> The built `target/*.jar` is NOT committed (Plan 5 publishes it from CI). Only sources are committed. `packages/lang-java/package.json` `files` array already excludes `tools/` from the npm tarball (added in Plan 1); leave it.

---

## Task 1: Maven project skeleton + JDT API spike

**Files:**
- Create: `packages/lang-java/tools/ctxo-jdt-analyzer/pom.xml`
- Create: `packages/lang-java/tools/ctxo-jdt-analyzer/.gitignore`
- Temporary spike: `packages/lang-java/tools/ctxo-jdt-analyzer/src/main/java/io/ctxo/jdt/Spike.java`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
target/
*.class
```

- [ ] **Step 2: Create `pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>io.ctxo</groupId>
  <artifactId>ctxo-jdt-analyzer</artifactId>
  <version>0.8.0</version>
  <packaging>jar</packaging>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <!-- Pin after the spike confirms the version runs on JRE 17 and parses Java 21. -->
    <jdt.core.version>3.39.0</jdt.core.version>
    <gson.version>2.11.0</gson.version>
    <junit.version>5.10.2</junit.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.eclipse.jdt</groupId>
      <artifactId>org.eclipse.jdt.core</artifactId>
      <version>${jdt.core.version}</version>
    </dependency>
    <dependency>
      <groupId>com.google.code.gson</groupId>
      <artifactId>gson</artifactId>
      <version>${gson.version}</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>${junit.version}</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <finalName>ctxo-jdt-analyzer</finalName>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-shade-plugin</artifactId>
        <version>3.5.3</version>
        <executions>
          <execution>
            <phase>package</phase>
            <goals><goal>shade</goal></goals>
            <configuration>
              <transformers>
                <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                  <mainClass>io.ctxo.jdt.Main</mainClass>
                </transformer>
              </transformers>
              <filters>
                <filter>
                  <artifact>*:*</artifact>
                  <excludes>
                    <exclude>META-INF/*.SF</exclude>
                    <exclude>META-INF/*.DSA</exclude>
                    <exclude>META-INF/*.RSA</exclude>
                  </excludes>
                </filter>
              </filters>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

- [ ] **Step 3: Write the JDT API spike** `src/main/java/io/ctxo/jdt/Spike.java`

This confirms (a) the JDT artifact resolves and runs on the JVM, (b) the batch `ASTParser.createASTs` API + binding resolution work, (c) method-call bindings resolve. It prints what it finds so Tasks 3-5 use the correct API.

```java
package io.ctxo.jdt;

import org.eclipse.jdt.core.dom.*;
import java.util.*;

public class Spike {
  public static void main(String[] args) {
    String source =
        "package com.example;\n" +
        "import java.util.List;\n" +
        "public class Foo extends Bar implements Baz {\n" +
        "  private int count;\n" +
        "  public int add(int a, int b) { return Math.max(a, b); }\n" +
        "}\n";

    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setKind(ASTParser.K_COMPILATION_UNIT);
    parser.setResolveBindings(true);
    parser.setBindingsRecovery(true);
    parser.setStatementsRecovery(true);
    Map<String, String> options = JavaCore.getOptions();
    JavaCore.setComplianceOptions(JavaCore.VERSION_17, options);
    parser.setCompilerOptions(options);
    parser.setUnitName("Foo.java");
    // No classpath here — intra-file bindings only (this is the "empty classpath" mode).
    parser.setEnvironment(new String[0], new String[0], new String[0], true);
    parser.setSource(source.toCharArray());

    CompilationUnit cu = (CompilationUnit) parser.createAST(null);
    System.out.println("CompilationUnit problems: " + cu.getProblems().length);

    cu.accept(new ASTVisitor() {
      @Override public boolean visit(TypeDeclaration node) {
        System.out.println("type=" + node.getName().getIdentifier()
            + " isInterface=" + node.isInterface()
            + " line=" + cu.getLineNumber(node.getStartPosition()));
        ITypeBinding tb = node.resolveBinding();
        System.out.println("  binding=" + (tb != null ? tb.getQualifiedName() : "UNRESOLVED"));
        Type sc = node.getSuperclassType();
        System.out.println("  superclass=" + (sc != null ? sc.toString() : "none"));
        System.out.println("  superInterfaces=" + node.superInterfaceTypes());
        return true;
      }
      @Override public boolean visit(MethodInvocation node) {
        IMethodBinding mb = node.resolveMethodBinding();
        System.out.println("call=" + node.getName().getIdentifier()
            + " resolved=" + (mb != null)
            + (mb != null ? " decl=" + mb.getDeclaringClass().getQualifiedName() : ""));
        return true;
      }
    });
  }
}
```

- [ ] **Step 4: Build + run the spike** (with the env preamble)

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"
export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
cd packages/lang-java/tools/ctxo-jdt-analyzer
mvn -q -DskipTests compile
mvn -q exec:java -Dexec.mainClass=io.ctxo.jdt.Spike 2>/dev/null \
  || java -cp "target/classes:$(cat cp.txt 2>/dev/null)" io.ctxo.jdt.Spike
```

If `exec:java` isn't available, build the classpath file first:
```bash
mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt
java -cp "target/classes;$(cat cp.txt)" io.ctxo.jdt.Spike   # note ';' separator on Windows
```

Expected output: `Foo` type with a resolved binding, `superclass=Bar`, `MethodInvocation` for `Math.max` (may be UNRESOLVED without JRE on classpath — `includeRunningVMBootclasspath=true` should resolve `Math.max` against the running JDK).

- [ ] **Step 5: RECORD spike findings** that Tasks 3-5 depend on, then verify the JDT version actually ran:
  - Confirm `mvn compile` resolved `org.eclipse.jdt:org.eclipse.jdt.core:3.39.0` and it runs on JDK 21. **If 3.39.0 fails to resolve or load, find the latest 3.3x on Maven Central that documents "BREE: JavaSE-17" and update `<jdt.core.version>` — record the chosen version.** (We build on JDK 21 but the artifact must run on JRE 17.)
  - Confirm: `AST.getJLSLatest()`, `parser.createASTs(...)` vs `createAST`, `setEnvironment(classpath, sourcepath, encodings, includeVMBootclasspath)`, `TypeDeclaration.getSuperclassType()`, `superInterfaceTypes()`, `MethodInvocation.resolveMethodBinding()`, `IMethodBinding.getDeclaringClass().getQualifiedName()`, `cu.getLineNumber(pos)` (1-based). Note any signature that differs.
  - `EnumDeclaration`, `RecordDeclaration`, `AnnotationTypeDeclaration`, `FieldDeclaration` exist in `org.eclipse.jdt.core.dom`.

- [ ] **Step 6: Delete the spike** `rm src/main/java/io/ctxo/jdt/Spike.java cp.txt` (don't commit it).

- [ ] **Step 7: Commit the project skeleton**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/pom.xml packages/lang-java/tools/ctxo-jdt-analyzer/.gitignore
git commit -m "feat(lang-java): scaffold ctxo-jdt-analyzer maven project"
```

---

## Task 2: JSON DTOs

**Files:**
- Create: `.../src/main/java/io/ctxo/jdt/Dtos.java`

- [ ] **Step 1: Create `Dtos.java`** (Gson serializes field names as-is → camelCase already)

```java
package io.ctxo.jdt;

import java.util.ArrayList;
import java.util.List;

/** Plain data carriers serialized to JSONL by Gson. Field names ARE the JSON keys. */
public final class Dtos {
  private Dtos() {}

  public static final class Sym {
    public String symbolId;
    public String name;
    public String kind;
    public int startLine;
    public int endLine;
    public Integer startOffset; // nullable
    public Integer endOffset;

    public Sym(String symbolId, String name, String kind, int startLine, int endLine, int startOffset, int endOffset) {
      this.symbolId = symbolId; this.name = name; this.kind = kind;
      this.startLine = startLine; this.endLine = endLine;
      this.startOffset = startOffset; this.endOffset = endOffset;
    }
  }

  public static final class Edge {
    public String from;
    public String to;
    public String kind;
    public Edge(String from, String to, String kind) { this.from = from; this.to = to; this.kind = kind; }
  }

  public static final class FileResult {
    public String type = "file";
    public String file;
    public List<Sym> symbols = new ArrayList<>();
    public List<Edge> edges = new ArrayList<>();
    public List<Object> complexity = new ArrayList<>(); // always empty; tree-sitter owns complexity
    public FileResult(String file) { this.file = file; }
  }
}
```

- [ ] **Step 2: Compile** `mvn -q -DskipTests compile` (with env preamble). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/src/main/java/io/ctxo/jdt/Dtos.java
git commit -m "feat(lang-java): jdt-analyzer JSON DTOs"
```

---

## Task 3: Analyzer — symbols + edges (the core)

**Files:**
- Create: `.../src/main/java/io/ctxo/jdt/Analyzer.java`
- Create: `.../src/test/java/io/ctxo/jdt/AnalyzerTest.java`
- Create: `.../src/test/resources/fixture/Foo.java`, `.../Bar.java`

> Analyzer takes a list of absolute source file paths + a classpath + the project root (for relative IDs), runs one batch `createASTs`, and returns `List<FileResult>`. Lines converted to 0-based.

- [ ] **Step 1: Write the failing test** `src/test/java/io/ctxo/jdt/AnalyzerTest.java`

```java
package io.ctxo.jdt;

import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AnalyzerTest {

  private Path fixtureDir() {
    return Paths.get("src/test/resources/fixture").toAbsolutePath();
  }

  @Test
  void emitsSymbolsWithMappedKinds() throws Exception {
    Path root = fixtureDir();
    List<String> files = List.of(root.resolve("Foo.java").toString(), root.resolve("Bar.java").toString());
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0]).analyze(files);

    Dtos.FileResult foo = results.stream().filter(r -> r.file.endsWith("Foo.java")).findFirst().orElseThrow();
    Map<String, String> kindByName = new HashMap<>();
    for (Dtos.Sym s : foo.symbols) kindByName.put(s.name, s.kind);

    assertEquals("class", kindByName.get("Foo"));
    assertEquals("method", kindByName.get("add"));
    assertEquals("variable", kindByName.get("count"));
    assertTrue(foo.symbols.stream().anyMatch(s -> s.kind.equals("class") && s.name.equals("Foo")));
    // symbolId format + 0-based lines
    Dtos.Sym fooSym = foo.symbols.stream().filter(s -> s.name.equals("Foo")).findFirst().orElseThrow();
    assertTrue(fooSym.symbolId.endsWith("Foo.java::Foo::class"));
    assertTrue(fooSym.startLine >= 0);
  }

  @Test
  void emitsResolvedCallAndExtendsEdges() throws Exception {
    Path root = fixtureDir();
    List<String> files = List.of(root.resolve("Foo.java").toString(), root.resolve("Bar.java").toString());
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0]).analyze(files);
    Dtos.FileResult foo = results.stream().filter(r -> r.file.endsWith("Foo.java")).findFirst().orElseThrow();

    long calls = foo.edges.stream().filter(e -> e.kind.equals("calls")).count();
    long extendsE = foo.edges.stream().filter(e -> e.kind.equals("extends")).count();
    assertTrue(calls >= 1, "expected resolved call edge to Bar.helper()");
    assertEquals(1, extendsE, "Foo extends Bar");
    assertTrue(foo.edges.stream().anyMatch(e -> e.kind.equals("calls") && e.to.contains("helper")));
  }

  @Test
  void complexityAlwaysEmpty() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Foo.java").toString()));
    assertTrue(results.get(0).complexity.isEmpty());
  }
}
```

- [ ] **Step 2: Create fixtures.** `src/test/resources/fixture/Bar.java`:

```java
package fixture;

public class Bar {
  public int helper(int x) { return x * 2; }
}
```

`src/test/resources/fixture/Foo.java`:

```java
package fixture;

public class Foo extends Bar {
  private int count;
  public int add(int a, int b) {
    return helper(a) + b;   // resolved call to Bar.helper
  }
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"; export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
cd packages/lang-java/tools/ctxo-jdt-analyzer && mvn -q test
```
Expected: FAIL — `Analyzer` class does not exist.

- [ ] **Step 4: Implement `Analyzer.java`**

> Written against the JDT DOM batch API confirmed by the Task 1 spike. If the spike showed a different signature, adapt. The tests assert behaviour (kinds, ≥1 resolved call, 1 extends); make them pass against the real API.

```java
package io.ctxo.jdt;

import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.dom.*;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/** Runs JDT batch analysis over a set of source files and emits FileResults. */
public final class Analyzer {
  private final String rootDir;
  private final String[] classpath;

  public Analyzer(String rootDir, String[] classpath) {
    this.rootDir = rootDir;
    this.classpath = classpath;
  }

  public List<Dtos.FileResult> analyze(List<String> sourceFiles) {
    Map<String, Dtos.FileResult> byPath = new LinkedHashMap<>();

    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setKind(ASTParser.K_COMPILATION_UNIT);
    parser.setResolveBindings(true);
    parser.setBindingsRecovery(true);
    parser.setStatementsRecovery(true);
    Map<String, String> options = JavaCore.getOptions();
    JavaCore.setComplianceOptions(JavaCore.VERSION_17, options);
    parser.setCompilerOptions(options);
    parser.setEnvironment(classpath, new String[] { rootDir }, null, true);

    String[] files = sourceFiles.toArray(new String[0]);
    String[] encodings = null;

    FileASTRequestor requestor = new FileASTRequestor() {
      @Override public void acceptAST(String sourceFilePath, CompilationUnit cu) {
        String rel = relativize(sourceFilePath);
        Dtos.FileResult fr = new Dtos.FileResult(rel);
        cu.accept(new EmitVisitor(cu, rel, fr));
        byPath.put(rel, fr);
      }
    };

    parser.createASTs(files, encodings, new String[0], requestor, null);
    return new ArrayList<>(byPath.values());
  }

  private String relativize(String absSourcePath) {
    try {
      Path root = Paths.get(rootDir).toAbsolutePath().normalize();
      Path p = Paths.get(absSourcePath).toAbsolutePath().normalize();
      return root.relativize(p).toString().replace('\\', '/');
    } catch (Exception e) {
      return absSourcePath.replace('\\', '/');
    }
  }

  /** Visits one CompilationUnit, appending symbols + edges to the FileResult. */
  private final class EmitVisitor extends ASTVisitor {
    private final CompilationUnit cu;
    private final String file;
    private final Dtos.FileResult out;
    private String enclosingTypeId; // symbol id of the nearest enclosing type, for edge `from`

    EmitVisitor(CompilationUnit cu, String file, Dtos.FileResult out) {
      this.cu = cu; this.file = file; this.out = out;
    }

    private int line0(int pos) { return Math.max(0, cu.getLineNumber(pos) - 1); }
    private String symId(String name, String kind) { return file + "::" + name + "::" + kind; }

    private void addType(String name, String kind, ASTNode node) {
      out.symbols.add(new Dtos.Sym(symId(name, kind), name, kind,
          line0(node.getStartPosition()), line0(node.getStartPosition() + node.getLength()),
          node.getStartPosition(), node.getStartPosition() + node.getLength()));
    }

    // ── type declarations ──
    @Override public boolean visit(TypeDeclaration node) {
      String name = node.getName().getIdentifier();
      String kind = node.isInterface() ? "interface" : "class";
      addType(name, kind, node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, kind);
      // edges: extends / implements / imports handled in dedicated visits using enclosingTypeId
      emitInheritance(node, kind);
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false; // we manually recursed into body so we control enclosing context
    }

    private void emitInheritance(TypeDeclaration node, String kind) {
      Type sc = node.getSuperclassType();
      if (sc != null) out.edges.add(new Dtos.Edge(enclosingTypeId, typeId(sc, "class"), "extends"));
      for (Object o : node.superInterfaceTypes()) {
        Type t = (Type) o;
        String ek = kind.equals("interface") ? "extends" : "implements";
        out.edges.add(new Dtos.Edge(enclosingTypeId, typeId(t, "interface"), ek));
      }
    }

    @Override public boolean visit(EnumDeclaration node) {
      String name = node.getName().getIdentifier();
      addType(name, "type", node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, "type");
      for (Object o : node.superInterfaceTypes()) {
        out.edges.add(new Dtos.Edge(enclosingTypeId, typeId((Type) o, "interface"), "implements"));
      }
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false;
    }

    @Override public boolean visit(RecordDeclaration node) {
      String name = node.getName().getIdentifier();
      addType(name, "class", node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, "class");
      for (Object o : node.superInterfaceTypes()) {
        out.edges.add(new Dtos.Edge(enclosingTypeId, typeId((Type) o, "interface"), "implements"));
      }
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false;
    }

    @Override public boolean visit(AnnotationTypeDeclaration node) {
      addType(node.getName().getIdentifier(), "interface", node);
      return true;
    }

    // ── members ──
    @Override public boolean visit(MethodDeclaration node) {
      String name = node.getName().getIdentifier(); // constructors: name == type name
      out.symbols.add(new Dtos.Sym(symId(name, "method"), name, "method",
          line0(node.getStartPosition()), line0(node.getStartPosition() + node.getLength()),
          node.getStartPosition(), node.getStartPosition() + node.getLength()));
      return true; // descend into the body to capture calls/uses
    }

    @Override public boolean visit(FieldDeclaration node) {
      for (Object o : node.fragments()) {
        VariableDeclarationFragment f = (VariableDeclarationFragment) o;
        String name = f.getName().getIdentifier();
        out.symbols.add(new Dtos.Sym(symId(name, "variable"), name, "variable",
            line0(node.getStartPosition()), line0(node.getStartPosition() + node.getLength()),
            node.getStartPosition(), node.getStartPosition() + node.getLength()));
      }
      return true;
    }

    // ── edges: imports ──
    @Override public boolean visit(ImportDeclaration node) {
      // anchored on the first type; if no type yet, skip (rare for real files)
      if (enclosingTypeId == null) return false;
      String fq = node.getName().getFullyQualifiedName();
      String last = fq.contains(".") ? fq.substring(fq.lastIndexOf('.') + 1) : fq;
      out.edges.add(new Dtos.Edge(enclosingTypeId, fq + "::" + last + "::class", "imports"));
      return false;
    }

    // ── edges: calls ──
    @Override public boolean visit(MethodInvocation node) {
      if (enclosingTypeId == null) return true;
      IMethodBinding mb = node.resolveMethodBinding();
      if (mb != null && mb.getDeclaringClass() != null) {
        String decl = mb.getDeclaringClass().getQualifiedName();
        String m = mb.getName();
        out.edges.add(new Dtos.Edge(enclosingTypeId, decl + "::" + m + "::method", "calls"));
      }
      return true;
    }

    @Override public boolean visit(ClassInstanceCreation node) {
      if (enclosingTypeId == null) return true;
      IMethodBinding ctor = node.resolveConstructorBinding();
      if (ctor != null && ctor.getDeclaringClass() != null) {
        String decl = ctor.getDeclaringClass().getQualifiedName();
        out.edges.add(new Dtos.Edge(enclosingTypeId, decl + "::" + ctor.getDeclaringClass().getName() + "::method", "calls"));
        out.edges.add(new Dtos.Edge(enclosingTypeId, decl + "::" + decl.substring(decl.lastIndexOf('.') + 1) + "::class", "uses"));
      }
      return true;
    }

    // helper: resolve a Type node to a target symbol id (simple-name based, like the tree-sitter tier)
    private String typeId(Type t, String fallbackKind) {
      ITypeBinding b = t.resolveBinding();
      if (b != null) {
        String qn = b.getQualifiedName();
        String last = qn.contains(".") ? qn.substring(qn.lastIndexOf('.') + 1) : qn;
        return last + "::" + fallbackKind;
      }
      String s = t.toString();
      String last = s.contains(".") ? s.substring(s.lastIndexOf('.') + 1) : s;
      // strip generics
      int lt = last.indexOf('<'); if (lt >= 0) last = last.substring(0, lt);
      return last + "::" + fallbackKind;
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"; export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
cd packages/lang-java/tools/ctxo-jdt-analyzer && mvn -q test
```
Expected: PASS (3 tests). If a `calls` edge is missing, the fixture call must resolve — confirm `setEnvironment` sourcepath includes the fixture dir so `Bar.helper` resolves cross-file. Adjust per the spike's confirmed API. Do NOT weaken the assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/src/main/java/io/ctxo/jdt/Analyzer.java packages/lang-java/tools/ctxo-jdt-analyzer/src/test
git commit -m "feat(lang-java): jdt analyzer symbols + resolved call/extends/uses edges"
```

---

## Task 4: `uses` edges for declared types (fields, params, returns, generics)

**Files:**
- Modify: `.../Analyzer.java`
- Modify: `.../AnalyzerTest.java`

- [ ] **Step 1: Add the failing test** (append to `AnalyzerTest`)

```java
  @Test
  void emitsUsesEdgeForFieldAndParameterTypes() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Uses.java").toString(), root.resolve("Bar.java").toString()));
    Dtos.FileResult uses = results.stream().filter(r -> r.file.endsWith("Uses.java")).findFirst().orElseThrow();
    assertTrue(uses.edges.stream().anyMatch(e -> e.kind.equals("uses") && e.to.contains("Bar")),
        "field of type Bar should produce a uses edge");
  }
```

Create `src/test/resources/fixture/Uses.java`:

```java
package fixture;

public class Uses {
  private Bar bar;
  public Bar make(Bar input) { return input; }
}
```

- [ ] **Step 2: Run → fail** (`mvn -q test`, env preamble). Expected: the `uses` assertion fails.

- [ ] **Step 3: Implement `uses` for declared types.** Add visits to `EmitVisitor`:

```java
    @Override public boolean visit(SingleVariableDeclaration node) { // params
      addUses(node.getType());
      return true;
    }

    // field types are on FieldDeclaration.getType()
    // (extend the existing visit(FieldDeclaration) to also call addUses(node.getType()))

    private void addUses(Type t) {
      if (enclosingTypeId == null || t == null) return;
      collectTypeUses(t);
    }

    private void collectTypeUses(Type t) {
      if (t.isParameterizedType()) {
        ParameterizedType pt = (ParameterizedType) t;
        collectTypeUses(pt.getType());
        for (Object a : pt.typeArguments()) collectTypeUses((Type) a);
      } else if (t.isArrayType()) {
        collectTypeUses(((ArrayType) t).getElementType());
      } else if (t.isSimpleType() || t.isQualifiedType() || t.isNameQualifiedType()) {
        if (!isPrimitiveOrJavaLang(t)) out.edges.add(new Dtos.Edge(enclosingTypeId, typeId(t, "class"), "uses"));
      }
    }

    private boolean isPrimitiveOrJavaLang(Type t) {
      ITypeBinding b = t.resolveBinding();
      if (b == null) return false;
      if (b.isPrimitive()) return true;
      String pkg = b.getPackage() == null ? "" : b.getPackage().getName();
      return pkg.equals("java.lang");
    }
```

And in the existing `visit(FieldDeclaration)`, add `addUses(node.getType());` before returning. Also add return-type uses in `visit(MethodDeclaration)`: `if (node.getReturnType2() != null) addUses(node.getReturnType2());`.

- [ ] **Step 4: Run → pass** (`mvn -q test`, env preamble). Expected: 4 tests pass. Tune `isPrimitiveOrJavaLang` if `Bar` is filtered (it must NOT be — it's in `fixture`, not `java.lang`).

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/src
git commit -m "feat(lang-java): jdt analyzer uses edges (field/param/return/generic types)"
```

---

## Task 5: ClasspathResolver (override → IDE → local-repo → empty)

**Files:**
- Create: `.../src/main/java/io/ctxo/jdt/ClasspathResolver.java`
- Create: `.../src/test/java/io/ctxo/jdt/ClasspathResolverTest.java`
- Create test resources under `.../src/test/resources/cp/...`

> Source order (stop at first non-empty): (1) explicit override array (passed from the TS side, which reads `.ctxo/config.yaml` — Java does NOT parse YAML); (2) IDE metadata: Eclipse `.classpath` `<classpathentry kind="lib" path="...">` and `.idea/libraries/*.xml` `<root url="jar://.../x.jar!/">`; (3) local-repo scan: parse `pom.xml` `<dependency>` coordinates (javax.xml DOM — no new dep) and resolve to `~/.m2/repository/<g>/<a>/<v>/<a>-<v>.jar`, and parse `build.gradle` `implementation "g:a:v"` via regex resolving under `~/.gradle/caches/modules-2/files-2.1`; (4) empty. **No `mvn`/`gradle` spawn** unless `allowBuildTools` is true (deferred — leave a guarded stub that just logs and falls through).

- [ ] **Step 1: Write failing tests** `ClasspathResolverTest.java`

```java
package io.ctxo.jdt;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ClasspathResolverTest {

  @Test
  void overrideWins(@TempDir Path dir) {
    String[] override = { "/libs/a.jar", "/libs/b.jar" };
    String[] cp = new ClasspathResolver(dir.toString(), override, false).resolve();
    assertArrayEquals(override, cp);
  }

  @Test
  void readsEclipseClasspathLibEntries(@TempDir Path dir) throws Exception {
    Path lib = dir.resolve("lib"); Files.createDirectories(lib);
    Path jar = lib.resolve("dep.jar"); Files.writeString(jar, "x");
    Files.writeString(dir.resolve(".classpath"),
        "<classpath><classpathentry kind=\"lib\" path=\"lib/dep.jar\"/></classpath>");
    String[] cp = new ClasspathResolver(dir.toString(), new String[0], false).resolve();
    assertTrue(Arrays.stream(cp).anyMatch(p -> p.replace('\\','/').endsWith("lib/dep.jar")));
  }

  @Test
  void emptyWhenNothingResolvable(@TempDir Path dir) {
    String[] cp = new ClasspathResolver(dir.toString(), new String[0], false).resolve();
    assertEquals(0, cp.length);
  }
}
```

- [ ] **Step 2: Run → fail** (`mvn -q test`).

- [ ] **Step 3: Implement `ClasspathResolver.java`**

```java
package io.ctxo.jdt;

import org.w3c.dom.*;
import javax.xml.parsers.*;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

/** Resolves dependency JARs so JDT bindings resolve. No build-tool execution by default. */
public final class ClasspathResolver {
  private final String rootDir;
  private final String[] override;
  private final boolean allowBuildTools;

  public ClasspathResolver(String rootDir, String[] override, boolean allowBuildTools) {
    this.rootDir = rootDir;
    this.override = override == null ? new String[0] : override;
    this.allowBuildTools = allowBuildTools;
  }

  public String[] resolve() {
    if (override.length > 0) return override;                 // (1) override
    List<String> ide = fromIdeMetadata();                    // (2) IDE
    if (!ide.isEmpty()) return ide.toArray(new String[0]);
    List<String> local = fromLocalRepo();                    // (3) local-repo scan
    if (!local.isEmpty()) return local.toArray(new String[0]);
    return new String[0];                                    // (4) empty
  }

  private List<String> fromIdeMetadata() {
    List<String> out = new ArrayList<>();
    Path dotClasspath = Paths.get(rootDir, ".classpath");
    if (Files.exists(dotClasspath)) {
      try {
        Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(dotClasspath.toFile());
        NodeList entries = doc.getElementsByTagName("classpathentry");
        for (int i = 0; i < entries.getLength(); i++) {
          Element e = (Element) entries.item(i);
          if ("lib".equals(e.getAttribute("kind"))) {
            Path p = Paths.get(rootDir).resolve(e.getAttribute("path"));
            if (Files.exists(p)) out.add(p.toString());
          }
        }
      } catch (Exception ignored) {}
    }
    // .idea/libraries/*.xml jar:// roots
    Path ideaLibs = Paths.get(rootDir, ".idea", "libraries");
    if (Files.isDirectory(ideaLibs)) {
      try (var stream = Files.newDirectoryStream(ideaLibs, "*.xml")) {
        Pattern jarUrl = Pattern.compile("jar://([^!]+)!/");
        for (Path xml : stream) {
          String content = Files.readString(xml);
          Matcher m = jarUrl.matcher(content);
          while (m.find()) {
            String path = m.group(1).replace("$PROJECT_DIR$", rootDir);
            if (Files.exists(Paths.get(path))) out.add(path);
          }
        }
      } catch (Exception ignored) {}
    }
    return out;
  }

  private List<String> fromLocalRepo() {
    List<String> out = new ArrayList<>();
    String home = System.getProperty("user.home");
    Path m2 = Paths.get(home, ".m2", "repository");
    // Maven: parse pom.xml dependencies
    Path pom = Paths.get(rootDir, "pom.xml");
    if (Files.exists(pom) && Files.isDirectory(m2)) {
      try {
        Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(pom.toFile());
        NodeList deps = doc.getElementsByTagName("dependency");
        for (int i = 0; i < deps.getLength(); i++) {
          Element d = (Element) deps.item(i);
          String g = text(d, "groupId"), a = text(d, "artifactId"), v = text(d, "version");
          if (g == null || a == null || v == null) continue;
          Path jar = m2.resolve(Paths.get(g.replace('.', '/'), a, v, a + "-" + v + ".jar"));
          if (Files.exists(jar)) out.add(jar.toString());
        }
      } catch (Exception ignored) {}
    }
    // Gradle: regex implementation "g:a:v"
    Path gradle = Paths.get(rootDir, "build.gradle");
    Path gradleCache = Paths.get(home, ".gradle", "caches", "modules-2", "files-2.1");
    if (Files.exists(gradle) && Files.isDirectory(gradleCache)) {
      try {
        String content = Files.readString(gradle);
        Matcher m = Pattern.compile("[\"']([\\w.\\-]+):([\\w.\\-]+):([\\w.\\-]+)[\"']").matcher(content);
        while (m.find()) {
          Path artDir = gradleCache.resolve(Paths.get(m.group(1), m.group(2), m.group(3)));
          if (Files.isDirectory(artDir)) findJarUnder(artDir, out);
        }
      } catch (Exception ignored) {}
    }
    return out;
  }

  private void findJarUnder(Path dir, List<String> out) {
    try (var s = Files.walk(dir, 3)) {
      s.filter(p -> p.toString().endsWith(".jar")).forEach(p -> out.add(p.toString()));
    } catch (Exception ignored) {}
  }

  private static String text(Element parent, String tag) {
    NodeList n = parent.getElementsByTagName(tag);
    return n.getLength() > 0 ? n.item(0).getTextContent().trim() : null;
  }
}
```

- [ ] **Step 4: Run → pass** (`mvn -q test`, env preamble). Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/src/main/java/io/ctxo/jdt/ClasspathResolver.java packages/lang-java/tools/ctxo-jdt-analyzer/src/test/java/io/ctxo/jdt/ClasspathResolverTest.java
git commit -m "feat(lang-java): jdt classpath resolver (override/IDE/local-repo)"
```

---

## Task 6: Main — stdio protocol (batch + keep-alive) + uber-JAR

**Files:**
- Create: `.../src/main/java/io/ctxo/jdt/Main.java`

> CLI: `java -jar ctxo-jdt-analyzer.jar <projectRoot> [--keep-alive] [--classpath <p1;p2;...>] [--allow-build-tools]`. Batch: discover `.java` files under root (excluding `target/`, `build/`, `.git/`, `node_modules/`), resolve classpath, analyze, print one `file` line each, then `done`. Keep-alive: print `ready`, then read JSON `{ "file": "rel/path" }` lines from stdin, re-analyze that one file (with the cached classpath), print its `file` result. Errors → stderr.

- [ ] **Step 1: Implement `Main.java`**

```java
package io.ctxo.jdt;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

public final class Main {
  private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
  private static final PrintStream OUT = System.out;

  public static void main(String[] args) {
    List<String> positional = new ArrayList<>();
    boolean keepAlive = false, allowBuildTools = false;
    String[] cpOverride = new String[0];
    for (int i = 0; i < args.length; i++) {
      switch (args[i]) {
        case "--keep-alive": keepAlive = true; break;
        case "--allow-build-tools": allowBuildTools = true; break;
        case "--classpath": if (i + 1 < args.length) cpOverride = splitPath(args[++i]); break;
        default: positional.add(args[i]);
      }
    }
    if (positional.isEmpty()) { err("Usage: java -jar ctxo-jdt-analyzer.jar <projectRoot> [--keep-alive] [--classpath p1;p2] [--allow-build-tools]"); System.exit(1); return; }

    String root = Paths.get(positional.get(0)).toAbsolutePath().normalize().toString();
    String[] classpath = new ClasspathResolver(root, cpOverride, allowBuildTools).resolve();
    Analyzer analyzer = new Analyzer(root, classpath);

    if (keepAlive) runKeepAlive(root, analyzer);
    else runBatch(root, analyzer);
  }

  private static void runBatch(String root, Analyzer analyzer) {
    long start = System.nanoTime();
    List<String> files = discoverJavaFiles(root);
    progress("Analyzing " + files.size() + " files");
    List<Dtos.FileResult> results = analyzer.analyze(files);
    for (Dtos.FileResult fr : results) OUT.println(GSON.toJson(fr));
    JsonObject done = new JsonObject();
    done.addProperty("type", "done");
    done.addProperty("totalFiles", results.size());
    done.addProperty("elapsed", String.format("%.1fs", (System.nanoTime() - start) / 1e9));
    OUT.println(GSON.toJson(done));
  }

  private static void runKeepAlive(String root, Analyzer analyzer) {
    JsonObject ready = new JsonObject();
    ready.addProperty("type", "ready");
    ready.addProperty("projectCount", 1);
    ready.addProperty("fileCount", discoverJavaFiles(root).size());
    OUT.println(GSON.toJson(ready));
    try (BufferedReader in = new BufferedReader(new InputStreamReader(System.in))) {
      String line;
      while ((line = in.readLine()) != null) {
        if (line.isBlank()) continue;
        try {
          JsonObject req = JsonParser.parseString(line).getAsJsonObject();
          String rel = req.get("file").getAsString();
          String abs = Paths.get(root).resolve(rel).toString();
          List<Dtos.FileResult> r = analyzer.analyze(List.of(abs));
          if (!r.isEmpty()) OUT.println(GSON.toJson(r.get(0)));
          else OUT.println(GSON.toJson(new Dtos.FileResult(rel.replace('\\', '/'))));
        } catch (Exception e) { err("keep-alive error: " + e.getMessage()); }
      }
    } catch (IOException e) { err("stdin closed: " + e.getMessage()); }
  }

  private static List<String> discoverJavaFiles(String root) {
    Set<String> skip = Set.of("target", "build", ".git", "node_modules", ".gradle", "bin", "out");
    try (var s = Files.walk(Paths.get(root))) {
      return s.filter(p -> p.toString().endsWith(".java"))
              .filter(p -> {
                for (Path part : Paths.get(root).relativize(p)) if (skip.contains(part.toString())) return false;
                return true;
              })
              .map(Path::toString)
              .collect(Collectors.toList());
    } catch (IOException e) { err("discover failed: " + e.getMessage()); return List.of(); }
  }

  private static String[] splitPath(String v) {
    return Arrays.stream(v.split("[;" + File.pathSeparator + "]")).filter(s -> !s.isBlank()).toArray(String[]::new);
  }
  private static void progress(String msg) {
    JsonObject o = new JsonObject(); o.addProperty("type", "progress"); o.addProperty("message", msg);
    OUT.println(GSON.toJson(o));
  }
  private static void err(String msg) { System.err.println("[ctxo-jdt-analyzer] " + msg); }
}
```

- [ ] **Step 2: Build the uber-JAR + smoke test**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"; export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
cd packages/lang-java/tools/ctxo-jdt-analyzer
mvn -q -DskipTests package
java -jar target/ctxo-jdt-analyzer.jar src/test/resources/fixture
```
Expected: prints `progress`, then one `{"type":"file",...}` line per fixture file (with `calls`/`extends`/`uses` edges visible for Foo.java), then `{"type":"done",...}`. Confirm a `calls` edge to `helper` appears.

- [ ] **Step 3: Keep-alive smoke test**

```bash
printf '{"file":"Foo.java"}\n' | java -jar target/ctxo-jdt-analyzer.jar src/test/resources/fixture --keep-alive
```
Expected: a `{"type":"ready",...}` line, then a `{"type":"file","file":"Foo.java",...}` line.

- [ ] **Step 4: Commit**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/src/main/java/io/ctxo/jdt/Main.java
git commit -m "feat(lang-java): jdt analyzer stdio protocol (batch + keep-alive) + uber-jar"
```

---

## Task 7: Full build + JSON-contract regression gate

**Files:**
- Create: `.../src/test/java/io/ctxo/jdt/ContractIT.java`

- [ ] **Step 1: Add a contract test** asserting the JSON shape the TS side (Plan 3) will parse:

```java
package io.ctxo.jdt;

import com.google.gson.Gson;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ContractIT {
  @Test
  void fileResultSerializesToExpectedShape() throws Exception {
    Path root = Paths.get("src/test/resources/fixture").toAbsolutePath();
    List<Dtos.FileResult> r = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Foo.java").toString(), root.resolve("Bar.java").toString()));
    String json = new Gson().toJson(r.get(0));
    assertTrue(json.contains("\"type\":\"file\""));
    assertTrue(json.contains("\"symbols\""));
    assertTrue(json.contains("\"edges\""));
    assertTrue(json.contains("\"complexity\":[]"));
    // floor check: JDT must resolve real call edges that tree-sitter cannot
    long calls = r.stream().flatMap(x -> x.edges.stream()).filter(e -> e.kind.equals("calls")).count();
    assertTrue(calls >= 1, "JDT must emit resolved call edges");
  }
}
```

- [ ] **Step 2: Run the full suite + package**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"; export PATH="$JAVA_HOME/bin:/c/Users/ahank/tools/apache-maven-3.9.16/bin:$PATH"
cd packages/lang-java/tools/ctxo-jdt-analyzer && mvn -q clean package
```
Expected: all tests pass; `target/ctxo-jdt-analyzer.jar` produced.

- [ ] **Step 3: Commit**

```bash
git add packages/lang-java/tools/ctxo-jdt-analyzer/src/test/java/io/ctxo/jdt/ContractIT.java
git commit -m "test(lang-java): jdt analyzer JSON contract + resolved-calls floor"
```

---

## Self-Review (Plan 2 scope)

**Spec coverage:** uber-JAR via JDT ✓ (Tasks 1,6); `ASTParser.createASTs` + `resolveBindings` ✓ (Task 3); symbols with kind mapping ✓ (Task 3); resolved `calls`/`extends`/`implements`/`imports` ✓ (Task 3); `uses` for declared types/generics ✓ (Task 4); complexity always empty ✓ (Tasks 2,3); classpath 5-source (override/IDE/local-repo/empty; build-tool spawn deferred behind flag) ✓ (Task 5); stdio batch + keep-alive ✓ (Task 6); JSON contract = RoslynBatchResult shape ✓ (Tasks 2,7); 0-based lines ✓ (Task 3). Multi-module reactor detection is NOT in this plan (single-root discovery) — flag for Plan 3/follow-up if needed.

**Placeholder scan:** the `allowBuildTools` path is an intentional deferred stub (flag parsed, no spawn) per ADR security rule — documented, not a TODO. The Task 1 spike + Task 3 "adapt to confirmed API" notes are the same de-risking pattern as Plan 1's tree-sitter spike, not placeholders.

**Type/contract consistency:** `Dtos.FileResult`/`Sym`/`Edge` field names = the camelCase JSON keys the TS `RoslynFileResult`/`RoslynSymbol`/`RoslynEdge` interfaces expect. Symbol-ID format and kind set match Plan 1's tree-sitter tier exactly (so the two tiers produce mergeable graphs). `--classpath` separator handling tolerates both `;` and the OS path separator.

**Risk gate:** the JDT DOM API specifics (Task 3/4 code) are the one place to verify against the real library — the Task 1 spike confirms them before implementation, and the behaviour-asserting tests (resolved calls ≥ 1, extends == 1, uses contains Bar) are the source of truth. The implementer must make tests pass against the real API, not weaken them.
