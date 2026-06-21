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
    Files.writeString(lib.resolve("dep.jar"), "x");
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
