package io.ctxo.jdt;

import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AnalyzerTest {
  private Path fixtureDir() { return Paths.get("src/test/resources/fixture").toAbsolutePath(); }

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
    Dtos.Sym fooSym = foo.symbols.stream().filter(s -> s.name.equals("Foo")).findFirst().orElseThrow();
    assertTrue(fooSym.symbolId.endsWith("Foo.java::Foo::class"));
    assertEquals(2, fooSym.startLine, "Foo class is on 0-based line 2");
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

  @Test
  void emitsUsesEdgeForFieldAndParameterTypes() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Uses.java").toString(), root.resolve("Bar.java").toString()));
    Dtos.FileResult uses = results.stream().filter(r -> r.file.endsWith("Uses.java")).findFirst().orElseThrow();
    assertTrue(uses.edges.stream().anyMatch(e -> e.kind.equals("uses") && e.to.contains("Bar")),
        "field of type Bar should produce a uses edge");
  }

  @Test
  void mapsEnumRecordAnnotationKindsAndConstructor() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Shapes.java").toString(), root.resolve("Bar.java").toString()));
    Dtos.FileResult fr = results.stream().filter(r -> r.file.endsWith("Shapes.java")).findFirst().orElseThrow();
    Map<String, String> kindByName = new HashMap<>();
    for (Dtos.Sym s : fr.symbols) kindByName.put(s.name, s.kind);
    assertEquals("type", kindByName.get("Kind"), "enum -> type");
    assertEquals("class", kindByName.get("Point"), "record -> class");
    assertEquals("interface", kindByName.get("Tag"), "annotation -> interface");
    // constructor: a method symbol named Shapes (same as the class)
    long ctor = fr.symbols.stream().filter(s -> s.name.equals("Shapes") && s.kind.equals("method")).count();
    assertEquals(1, ctor, "constructor -> method");
  }

  @Test
  void emitsImportEdgeWithFullPathTarget() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Shapes.java").toString(), root.resolve("Bar.java").toString()));
    Dtos.FileResult fr = results.stream().filter(r -> r.file.endsWith("Shapes.java")).findFirst().orElseThrow();
    assertTrue(fr.edges.stream().anyMatch(e -> e.kind.equals("imports") && e.to.equals("java.util.List::List::class")),
        "import java.util.List must emit imports edge to java.util.List::List::class");
  }

  @Test
  void usesEdgeForGenericArgumentIsWellFormed() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Shapes.java").toString(), root.resolve("Bar.java").toString()));
    Dtos.FileResult fr = results.stream().filter(r -> r.file.endsWith("Shapes.java")).findFirst().orElseThrow();
    // List<Bar> field: uses edge to Bar must be well-formed (no "Bar>")
    assertTrue(fr.edges.stream().anyMatch(e -> e.kind.equals("uses") && e.to.equals("Bar::class")),
        "generic arg Bar must yield uses edge Bar::class");
    assertTrue(fr.edges.stream().noneMatch(e -> e.to.contains(">")), "no malformed targets with '>'");
  }
}
