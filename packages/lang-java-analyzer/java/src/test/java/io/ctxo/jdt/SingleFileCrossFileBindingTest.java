package io.ctxo.jdt;

import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Documents JDT's binding resolution behaviour for single-file vs full-project parsing.
 *
 * Finding: JDT resolves type-level bindings (extends, implements, uses) via the sourcepath
 * alone, but method bindings (IMethodBinding → "calls" edges) require the callee's
 * CompilationUnit to be included in the ASTParser.createASTs() file list.
 *
 * This is why keep-alive must analyze all project files per watch tick to preserve
 * "calls" accuracy (Case B — documented in Main.runKeepAlive).
 */
class SingleFileCrossFileBindingTest {
  private Path fixtureDir() { return Paths.get("src/test/resources/fixture").toAbsolutePath(); }

  /**
   * Single-file parse: sourcepath resolves "extends Bar" but NOT "calls Bar.helper".
   * This confirms that keep-alive cannot simply analyze the changed file alone.
   */
  @Test
  void singleFileParsing_typeBindingResolvesButMethodBindingDoesNot() throws Exception {
    Path root = fixtureDir();
    // Analyze ONLY Foo.java — Bar.java is NOT in the file list,
    // but IS on the sourcepath (root = fixture dir).
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Foo.java").toString()));

    assertEquals(1, results.size(), "Should return exactly one FileResult for Foo.java");
    Dtos.FileResult foo = results.get(0);

    // Type-level binding: "extends Bar" resolves via sourcepath alone — good
    boolean hasExtendsBar = foo.edges.stream()
        .anyMatch(e -> e.kind.equals("extends") && e.to.contains("Bar"));
    assertTrue(hasExtendsBar,
        "extends-Bar edge must resolve via sourcepath even when Bar.java is not in createASTs list");

    // Method-level binding: "calls Bar.helper" does NOT resolve without Bar.java in createASTs
    boolean hasCallsToHelper = foo.edges.stream()
        .anyMatch(e -> e.kind.equals("calls") && e.to.contains("helper"));
    assertFalse(hasCallsToHelper,
        "calls-to-helper must NOT resolve when Bar.java is absent from createASTs " +
        "(documents the JDT limitation that forces full-project parse in keep-alive)");
  }

  /**
   * Full-project parse: both type AND method bindings resolve when all files are in createASTs.
   * This is the mode keep-alive uses.
   */
  @Test
  void fullProjectParsing_resolvesBothTypeAndMethodBindings() throws Exception {
    Path root = fixtureDir();
    List<Dtos.FileResult> results = new Analyzer(root.toString(), new String[0])
        .analyze(List.of(root.resolve("Foo.java").toString(), root.resolve("Bar.java").toString()));

    Dtos.FileResult foo = results.stream().filter(r -> r.file.endsWith("Foo.java")).findFirst().orElseThrow();

    assertTrue(foo.edges.stream().anyMatch(e -> e.kind.equals("extends") && e.to.contains("Bar")),
        "extends-Bar must resolve in full-project parse");
    assertTrue(foo.edges.stream().anyMatch(e -> e.kind.equals("calls") && e.to.contains("helper")),
        "calls-to-helper must resolve in full-project parse");
  }
}
