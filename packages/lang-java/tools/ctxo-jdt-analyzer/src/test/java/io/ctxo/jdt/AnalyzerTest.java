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

  @Test
  void emitsUsesEdgeForFieldAndParameterTypes() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Uses.java").toString(), root.resolve("Bar.java").toString()));
    Dtos.FileResult uses = results.stream().filter(r -> r.file.endsWith("Uses.java")).findFirst().orElseThrow();
    assertTrue(uses.edges.stream().anyMatch(e -> e.kind.equals("uses") && e.to.contains("Bar")),
        "field of type Bar should produce a uses edge");
  }
}
