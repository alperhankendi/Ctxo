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
    long calls = r.stream().flatMap(x -> x.edges.stream()).filter(e -> e.kind.equals("calls")).count();
    assertTrue(calls >= 1, "JDT must emit resolved call edges");
  }
}
