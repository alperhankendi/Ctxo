package io.ctxo.jdt;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class FactEvidenceTest {
  private static final Path LENDING = Paths.get("src/test/resources/lending").toAbsolutePath();
  private static final Path GOLDEN = Paths.get("src/test/resources/lending-facts-off.golden.jsonl").toAbsolutePath();
  private static final Path GOLDEN_SQL = Paths.get("src/test/resources/lending-facts-off-sql.golden.jsonl").toAbsolutePath();
  private static final String FACTS = "src/main/java/lending/facts/";
  private static final String RULES = FACTS + "LoanRules.java";
  private static JsonObject vectors;
  private static List<String> defaultPatterns;
  private static List<Dtos.FileResult> lending;

  @BeforeAll
  static void analyzeLending() throws IOException {
    vectors = JsonParser.parseString(Files.readString(vectorsFile(), StandardCharsets.UTF_8)).getAsJsonObject();
    defaultPatterns = strings(vectors.getAsJsonObject("defaults").getAsJsonArray("normalizationMethods"));
    lending = new Analyzer(LENDING.toString(), new String[0], false, new Dtos.FactOptions(defaultPatterns))
        .analyze(Main.discoverJavaFiles(LENDING.toString()));
  }

  /** packages/plugin-api/conformance/fact-vectors.json, found by walking up from user.dir. */
  private static Path vectorsFile() {
    for (Path dir = Paths.get(System.getProperty("user.dir")).toAbsolutePath(); dir != null; dir = dir.getParent()) {
      Path candidate = dir.resolve("packages/plugin-api/conformance/fact-vectors.json");
      if (Files.isRegularFile(candidate)) return candidate;
    }
    throw new AssertionError("fact-vectors.json not found above " + System.getProperty("user.dir"));
  }

  private static List<String> strings(JsonArray array) {
    List<String> out = new ArrayList<>();
    for (JsonElement e : array) out.add(e.getAsString());
    return out;
  }

  private static Dtos.FileResult file(List<Dtos.FileResult> results, String file) {
    return results.stream().filter(fr -> fr.file.equals(file)).findFirst()
        .orElseThrow(() -> new AssertionError("no file result " + file));
  }

  /** {@code <kind> <owner> <line> <fields>} per record of one file, the owner without the file prefix. */
  private static List<String> evidence(List<Dtos.FileResult> results, String file, String kind) {
    List<Dtos.Evidence> all = file(results, file).factEvidence;
    if (all == null) return List.of();
    return all.stream().filter(e -> e.kind.equals(kind)).map(e -> describe(file, e)).collect(Collectors.toList());
  }

  private static String describe(String file, Dtos.Evidence e) {
    String owner = e.symbolId == null ? "-" : e.symbolId.substring(file.length() + 2);
    StringBuilder out = new StringBuilder(e.kind).append(' ').append(owner).append(' ').append(e.line);
    for (String part : new String[] { e.text, e.operator, e.literal, e.literalKind, e.method, e.qualifier,
        e.name, e.value, e.constructor, e.unit, e.amount, e.verb, e.route }) {
      out.append(" | ").append(part);
    }
    return out.toString();
  }

  /** The 0-based line of the only line of a file that contains {@code needle}. */
  private static int lineOf(Path root, String file, String needle) throws IOException {
    List<String> lines = Files.readAllLines(root.resolve(file), StandardCharsets.UTF_8);
    int found = -1;
    for (int i = 0; i < lines.size(); i++) {
      if (!lines.get(i).contains(needle)) continue;
      assertEquals(-1, found, "more than one line holds " + needle);
      found = i;
    }
    assertNotEquals(-1, found, "no line holds " + needle);
    return found;
  }

  private static void write(Path root, String rel, String source) throws IOException {
    Path p = root.resolve(rel);
    Files.createDirectories(p.getParent());
    Files.write(p, source.getBytes(StandardCharsets.UTF_8));
  }

  private static List<Dtos.FileResult> analyzeWithFacts(Path root) {
    return new Analyzer(root.toString(), new String[0], false, new Dtos.FactOptions(defaultPatterns))
        .analyze(Main.discoverJavaFiles(root.toString()));
  }

  @Test
  void comparisonsInConditionsAndCaseLabelsAreReported() throws IOException {
    assertEquals(List.of(
        "comparison canBorrow::method " + lineOf(LENDING, RULES, "member == null")
            + " | member == null | == | null | null | null | null | null | null | null | null | null | null | null",
        "comparison canBorrow::method " + lineOf(LENDING, RULES, "openLoans >= 5")
            + " | openLoans >= 5 | >= | 5 | number | null | null | null | null | null | null | null | null | null",
        "comparison fee::method " + lineOf(LENDING, RULES, "case \"gold\"")
            + " | tier case \"gold\" | case | \"gold\" | string | null | null | null | null | null | null | null | null | null",
        "comparison fee::method " + lineOf(LENDING, RULES, "case \"\"")
            + " | tier case \"\" | case | \"\" | string | null | null | null | null | null | null | null | null | null",
        "comparison label::method " + lineOf(LENDING, RULES, "days > 14")
            + " | days > 14 | > | 14 | number | null | null | null | null | null | null | null | null | null"),
        evidence(lending, RULES, "comparison"));
  }

  @Test
  void conditionShapesLiteralKindsAndSwitchExpressions(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Shapes.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "class Shapes {",
        "  int a(int x, char c, boolean b, String s) {",
        "    while (!(x < -2) || c == 'y') x++;",
        "    do { x--; } while (b != true);",
        "    for (int i = 0; i != 3; i++) x += i;",
        "    if (x == 1 == b) return 0;",
        "    if (f(x > 9)) return 0;",
        "    if (x == x) return 0;",
        "    if (s.equals(\"q\")) return 0;",
        "    return switch (s) { case \"a\", \"b\" -> 1; default -> 2; };",
        "  }",
        "  boolean f(boolean v) { return v; }",
        "}", ""));
    List<String> found = evidence(analyzeWithFacts(tmp), rel, "comparison").stream()
        .map(s -> s.replaceAll(" \\| null", "")).collect(Collectors.toList());
    assertEquals(List.of(
        "comparison a::method 3 | x < -2 | < | -2 | number",
        "comparison a::method 3 | c == 'y' | == | 'y' | char",
        "comparison a::method 4 | b != true | != | true | boolean",
        "comparison a::method 5 | i != 3 | != | 3 | number",
        "comparison a::method 10 | s case \"a\" | case | \"a\" | string",
        "comparison a::method 10 | s case \"b\" | case | \"b\" | string"), found);
  }

  @Test
  void normalizationCallsMatchTheConfiguredPatterns(@TempDir Path tmp) throws IOException {
    // Walk order: the outer call is visited first (the finisher sorts).
    assertEquals(List.of(
        "call key::method " + lineOf(LENDING, RULES, "email.trim()")
            + " | email.trim().toLowerCase() | null | null | null | toLowerCase | email.trim() | null | null | null | null | null | null | null",
        "call key::method " + lineOf(LENDING, RULES, "email.trim()")
            + " | email.trim() | null | null | null | trim | email | null | null | null | null | null | null | null",
        "call same::method " + lineOf(LENDING, RULES, "equalsIgnoreCase")
            + " | a.equalsIgnoreCase(b) | null | null | null | equalsIgnoreCase | a | null | null | null | null | null | null | null"),
        evidence(lending, RULES, "call"));

    // Custom patterns replace the defaults; a qualified pattern needs the qualifier as written.
    List<Dtos.FileResult> custom = new Analyzer(LENDING.toString(), new String[0], false,
        new Dtos.FactOptions(List.of("trim", "a.equals*"))).analyze(Main.discoverJavaFiles(LENDING.toString()));
    assertEquals(List.of("trim email", "equalsIgnoreCase a"),
        file(custom, RULES).factEvidence.stream().filter(e -> e.kind.equals("call"))
            .map(e -> e.method + " " + e.qualifier).collect(Collectors.toList()));

    // A call without a receiver has no qualifier.
    write(tmp, "src/main/java/lending/Bare.java",
        "package lending;\nclass Bare {\n  String trim(String s) { return s; }\n  String x() { return trim(\"a\"); }\n}\n");
    Dtos.Evidence bare = file(analyzeWithFacts(tmp), "src/main/java/lending/Bare.java").factEvidence.get(0);
    assertEquals("trim(\"a\")", bare.text);
    assertNull(bare.qualifier);
  }

  @Test
  void normalizationCallsReportWhereTheirValueGoes(@TempDir Path tmp) throws IOException {
    write(tmp, "src/main/java/org/slf4j/Logger.java",
        "package org.slf4j;\npublic interface Logger { void info(String m); void warn(String m, Object a); }\n");
    write(tmp, "src/main/java/lending/Members.java", String.join("\n",
        "package lending;",
        "import java.util.*;",
        "class Members {",
        "  String save(String email, String name, Repo repo, List<String> items) {",
        "    log.warn(\"unknown {}\", email.toLowerCase());",
        "    repo.put(email.toUpperCase(), name.trim());",
        "    log.info(\"saved \" + repo.upsert(name.toLowerCase()));",
        "    String caption = \"Member: \" + name.trim() + \"!\";",
        "    if (email.trim().isEmpty()) throw new IllegalArgumentException(email.toUpperCase());",
        "    log.info(String.join(\",\", items.stream().map(i -> i.trim()).toList()));",
        "    return caption;",
        "  }",
        "  static final org.slf4j.Logger log = null;",
        "  interface Repo { void put(String k, String v); String upsert(String v); }",
        "}",
        ""));
    List<String> calls = file(analyzeWithFacts(tmp), "src/main/java/lending/Members.java").factEvidence.stream()
        .filter(e -> e.kind.equals("call"))
        .map(e -> e.line + " " + e.text + " | " + e.consumer + " " + e.consumerTypes + " " + e.inProse)
        .collect(Collectors.toList());
    assertEquals(List.of(
        "4 email.toLowerCase() | log.warn [org.slf4j.Logger] null",
        "5 email.toUpperCase() | repo.put [lending.Members.Repo] null",
        "5 name.trim() | repo.put [lending.Members.Repo] null",
        "6 name.toLowerCase() | repo.upsert [lending.Members.Repo] null",
        "7 name.trim() | null null true",
        "8 email.trim() | null null null",
        "8 email.toUpperCase() | new IllegalArgumentException null null",
        "9 i.trim() | null null null"), calls);
  }

  @Test
  void bindingsOnlyForFragmentNames(@TempDir Path tmp) throws IOException {
    for (JsonElement e : vectors.getAsJsonArray("hasRetryTimeoutFragment")) {
      JsonObject vector = e.getAsJsonObject();
      String name = vector.get("input").getAsString();
      assertEquals(vector.get("expected").getAsBoolean(), FactEvidence.hasRetryTimeoutFragment(name), name);
    }

    assertEquals(List.of(
        "binding MAX_RETRIES::variable " + lineOf(LENDING, RULES, "MAX_RETRIES")
            + " | null | null | null | null | null | null | MAX_RETRIES | 3 | null | null | null | null | null"),
        evidence(lending, RULES, "binding"));

    String rel = "src/main/java/lending/Bindings.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "@interface Policy { int retries(); int count(); }",
        "class Bindings {",
        "  int a = 1, retryCount = 4;",
        "  long settlementDays = 2;",
        "  @Policy(retries = 2, count = 9)",
        "  void m(Bindings other) {",
        "    int delayMs = 30 * 1000;",
        "    other.timeoutMs = 5;",
        "    timeoutMs = 6;",
        "    this.timeoutMs += 7;",
        "  }",
        "  int timeoutMs;",
        "}", ""));
    List<String> found = evidence(analyzeWithFacts(tmp), rel, "binding").stream()
        .map(s -> s.replaceAll(" \\| null", "")).collect(Collectors.toList());
    assertEquals(List.of(
        "binding retryCount::variable 3 | retryCount | 4",
        "binding m::method 5 | retries | 2",
        "binding m::method 7 | delayMs | 30 * 1000",
        "binding m::method 8 | timeoutMs | 5",
        "binding m::method 9 | timeoutMs | 6"), found);
  }

  @Test
  void matchesPatternFollowsTheVectors() {
    for (String category : new String[] { "matchesNormalizationPattern", "matchesNormalizationPatternCustom" }) {
      for (JsonElement e : vectors.getAsJsonArray(category)) {
        JsonObject vector = e.getAsJsonObject();
        JsonObject input = vector.getAsJsonObject("input");
        String method = input.get("method").getAsString();
        String qualifier = input.has("qualifier") ? input.get("qualifier").getAsString() : null;
        List<String> patterns = input.has("patterns") ? strings(input.getAsJsonArray("patterns")) : defaultPatterns;
        assertEquals(vector.get("expected").getAsBoolean(), FactEvidence.matchesPattern(method, qualifier, patterns),
            category + " " + input);
      }
    }
  }

  @Test
  void durationsReportUnitAndAmount(@TempDir Path tmp) throws IOException {
    assertEquals(List.of(
        "duration HOLD_TIMEOUT::variable " + lineOf(LENDING, RULES, "HOLD_TIMEOUT")
            + " | null | null | null | null | null | null | HOLD_TIMEOUT | null | java.time.Duration.ofMinutes | min | 90 | null | null"),
        evidence(lending, RULES, "duration"));

    String rel = "src/main/java/lending/Waits.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "import java.time.Duration;",
        "import java.time.temporal.ChronoUnit;",
        "class Waits {",
        "  Duration grace = Duration.ofDays(2);",
        "  void m() {",
        "    sleep(Duration.of(5, ChronoUnit.SECONDS));",
        "    sleep(Duration.of(7, java.time.temporal.ChronoUnit.MICROS));",
        "    sleep(Duration.ofMillis(250), Duration.ofNanos(3), Duration.ofHours(1));",
        "    sleep(Duration.ofSeconds(1, 5));",
        "    sleep(Duration.of(1, ChronoUnit.WEEKS));",
        "  }",
        "  void sleep(Duration... d) {}",
        "}", ""));
    List<String> found = evidence(analyzeWithFacts(tmp), rel, "duration").stream()
        .map(s -> s.replaceAll(" \\| null", "")).collect(Collectors.toList());
    assertEquals(List.of(
        "duration grace::variable 4 | grace | Duration.ofDays | d | 2",
        "duration m::method 6 | Duration.of | s | 5",
        "duration m::method 7 | Duration.of | us | 7",
        "duration m::method 8 | Duration.ofMillis | ms | 250",
        "duration m::method 8 | Duration.ofNanos | ns | 3",
        "duration m::method 8 | Duration.ofHours | h | 1"), found);
  }

  @Test
  void intOverflowIsNotAConstant(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Overflow.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "import java.time.Duration;",
        "class Overflow {",
        "  static final long HOLD_TIMEOUT_MS = 24 * 60 * 60 * 1000 * 365;",
        "  static final long RETRY_WINDOW_MS = 24L * 60 * 60 * 1000 * 365;",
        "  static final int RETRY_LIMIT = 100000 * 100000 / 100000;",
        "  static final long RETRY_MIXED = 1000 * 1000 * 1000 * 1000L;",
        "  static final long RETRY_WRAP = 1000 * 1000 * 1000 * 10 * 1L;",
        "  static final int RETRY_MIN = -2147483648;",
        "  static final int RETRY_MAX = 2147483647;",
        "  static final Duration EXPIRY = Duration.ofMillis(24 * 60 * 60 * 1000 * 365);",
        "  static final Duration EXPIRY_LONG = Duration.ofMillis(24L * 60 * 60 * 1000 * 365);",
        "}", ""));
    List<String> found = file(analyzeWithFacts(tmp), rel).factEvidence.stream()
        .map(e -> e.name + " = " + (e.value != null ? e.value : e.amount)).collect(Collectors.toList());
    assertEquals(List.of(
        "RETRY_WINDOW_MS = 24L * 60 * 60 * 1000 * 365",
        "RETRY_MIXED = 1000 * 1000 * 1000 * 1000L",
        "RETRY_MIN = -2147483648",
        "RETRY_MAX = 2147483647",
        "EXPIRY_LONG = 24L * 60 * 60 * 1000 * 365"), found);
  }

  @Test
  void anIntStepBesideAFloatingOperandIsStillChecked(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Mixed.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "class Mixed {",
        "  static final double RETRY_FACTOR = 1.5 * 2 * (100000 * 100000);",
        "  static final double RETRY_SCALE = 1.5 * 2 * (1000 * 1000);",
        "  static final double DELAY_SCALE = (100000 * 100000) * 1.5;",
        "}", ""));
    List<String> found = file(analyzeWithFacts(tmp), rel).factEvidence.stream()
        .map(e -> e.name).collect(Collectors.toList());
    assertEquals(List.of("RETRY_SCALE"), found);
    assertTrue(FactEvidence.overflowsInt(expression("1.5 * 2 * (100000 * 100000)")));
  }

  /** {@code languageSpecific.java.overflowsInt}: expressions the JDT evidence step treats as not constants (no bindings: types from the literals). */
  @Test
  void overflowsIntFollowsTheJavaVectors() {
    JsonArray cases = vectors.getAsJsonObject("languageSpecific").getAsJsonObject("java").getAsJsonArray("overflowsInt");
    assertTrue(cases.size() > 0);
    for (JsonElement e : cases) {
      JsonObject vector = e.getAsJsonObject();
      String input = vector.get("input").getAsString();
      assertEquals(vector.get("expected").getAsBoolean(), FactEvidence.overflowsInt(expression(input)), input);
    }
  }

  /** {@code languageSpecific.java.comparisonGivesEvidence}: an int-overflowing number literal (0xFFFFFFFF is -1 in Java) gives no comparison. */
  @Test
  void comparisonsFollowTheJavaVectors(@TempDir Path tmp) throws IOException {
    JsonArray cases = vectors.getAsJsonObject("languageSpecific").getAsJsonObject("java").getAsJsonArray("comparisonGivesEvidence");
    assertTrue(cases.size() > 0);
    StringBuilder source = new StringBuilder("package lending;\nclass Cmp {\n");
    for (int i = 0; i < cases.size(); i++) {
      String input = cases.get(i).getAsJsonObject().get("input").getAsString();
      source.append("  boolean m").append(i).append("(int x) { if (").append(input).append(") return true; return false; }\n");
    }
    source.append("}\n");
    write(tmp, "src/main/java/lending/Cmp.java", source.toString());
    List<Dtos.Evidence> found = file(analyzeWithFacts(tmp), "src/main/java/lending/Cmp.java").factEvidence;
    for (int i = 0; i < cases.size(); i++) {
      JsonObject vector = cases.get(i).getAsJsonObject();
      String owner = "src/main/java/lending/Cmp.java::m" + i + "::method";
      boolean has = found != null && found.stream().anyMatch(e -> e.kind.equals("comparison") && owner.equals(e.symbolId));
      assertEquals(vector.get("expected").getAsBoolean(), has, vector.get("input").getAsString());
    }
  }

  @Test
  void anIntOverflowingCaseLabelGivesNoEvidence(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Labels.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "class Labels {",
        "  int m(int x) {",
        "    switch (x) { case 0xFFFFFFFF: return 1; case 0x7FFFFFFF: return 2; case 5: return 3; default: return 0; }",
        "  }",
        "  int n(long y) {",
        "    return switch ((int) y) { case 037777777777 -> 1; case -2147483648 -> 2; default -> 0; };",
        "  }",
        "}", ""));
    List<String> labels = file(analyzeWithFacts(tmp), rel).factEvidence.stream()
        .map(e -> e.text).collect(Collectors.toList());
    assertEquals(List.of("x case 0x7FFFFFFF", "x case 5", "(int) y case -2147483648"), labels);
  }

  private static org.eclipse.jdt.core.dom.Expression expression(String source) {
    org.eclipse.jdt.core.dom.ASTParser parser = org.eclipse.jdt.core.dom.ASTParser.newParser(org.eclipse.jdt.core.dom.AST.getJLSLatest());
    parser.setKind(org.eclipse.jdt.core.dom.ASTParser.K_EXPRESSION);
    // As the Analyzer sets them: JDT 3.33's default source level rejects binary literals and underscores.
    Map<String, String> options = org.eclipse.jdt.core.JavaCore.getOptions();
    org.eclipse.jdt.core.JavaCore.setComplianceOptions(org.eclipse.jdt.core.JavaCore.VERSION_17, options);
    parser.setCompilerOptions(options);
    parser.setSource(source.toCharArray());
    org.eclipse.jdt.core.dom.ASTNode node = parser.createAST(null);
    assertTrue(node instanceof org.eclipse.jdt.core.dom.Expression, source + " parses as an expression");
    return (org.eclipse.jdt.core.dom.Expression) node;
  }

  @Test
  void aCollectorFailureDropsThatFilesEvidenceOnly(@TempDir Path tmp) throws IOException {
    write(tmp, "src/main/java/lending/Broken.java",
        "package lending;\nclass Broken {\n  static final int MAX_RETRIES = 3;\n  int m(int x) { if (x > 5) return 1; return 0; }\n}\n");
    write(tmp, "src/main/java/lending/Fine.java",
        "package lending;\nclass Fine {\n  static final int MAX_RETRIES = 4;\n}\n");
    Analyzer.FactCollector original = Analyzer.factCollector;
    java.io.PrintStream stderr = System.err;
    ByteArrayOutputStream errors = new ByteArrayOutputStream();
    try {
      // A collector that records one record, then fails on a node of Broken.java mid-walk.
      Analyzer.factCollector = (cu, source, rel, options, out) -> {
        original.collect(cu, source, rel, options, out);
        if (rel.endsWith("Broken.java")) throw new IllegalStateException("unexpected node");
      };
      System.setErr(new PrintStream(errors, true));
      List<Dtos.FileResult> results = analyzeWithFacts(tmp);
      Dtos.FileResult broken = file(results, "src/main/java/lending/Broken.java");
      assertNull(broken.factEvidence);
      assertTrue(broken.symbols.stream().anyMatch(s -> s.name.equals("m")), "symbols are kept");
      assertFalse(broken.edges.isEmpty() && broken.symbols.isEmpty());
      assertEquals(1, file(results, "src/main/java/lending/Fine.java").factEvidence.size());
    } finally {
      Analyzer.factCollector = original;
      System.setErr(stderr);
    }
    String log = errors.toString();
    assertEquals(1, log.lines().count(), log);
    assertTrue(log.contains("src/main/java/lending/Broken.java") && log.contains("IllegalStateException"), log);
  }

  @Test
  void doneAndReadyLinesCarryTheFactsMarkerOnlyWithTheOption() throws IOException {
    Analyzer on = new Analyzer(LENDING.toString(), new String[0], false, new Dtos.FactOptions(defaultPatterns));
    Analyzer off = new Analyzer(LENDING.toString(), new String[0], true);

    JsonObject doneOn = lastLine(batch(on));
    assertEquals("done", doneOn.get("type").getAsString());
    assertTrue(doneOn.get("facts").getAsBoolean());
    JsonObject doneOff = lastLine(batch(off));
    assertEquals("done", doneOff.get("type").getAsString());
    assertFalse(doneOff.has("facts"), doneOff.toString());
    assertEquals(List.of("type", "totalFiles", "elapsed", "sql"), new ArrayList<>(doneOff.keySet()));

    JsonObject readyOn = firstLine(keepAlive(on));
    assertEquals("ready", readyOn.get("type").getAsString());
    assertTrue(readyOn.get("facts").getAsBoolean());
    JsonObject readyOff = firstLine(keepAlive(off));
    assertEquals(List.of("type", "projectCount", "fileCount"), new ArrayList<>(readyOff.keySet()));
  }

  private static String batch(Analyzer analyzer) {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    Main.runBatch(LENDING.toString(), analyzer, new PrintStream(bytes, true));
    return bytes.toString();
  }

  private static String keepAlive(Analyzer analyzer) throws IOException {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    Main.runKeepAlive(LENDING.toString(), analyzer, new java.io.ByteArrayInputStream(new byte[0]),
        new PrintStream(bytes, true, "UTF-8"));
    return bytes.toString("UTF-8");
  }

  private static JsonObject firstLine(String output) {
    return JsonParser.parseString(output.split("\\r?\\n")[0]).getAsJsonObject();
  }

  private static JsonObject lastLine(String output) {
    String[] lines = output.trim().split("\\r?\\n");
    return JsonParser.parseString(lines[lines.length - 1]).getAsJsonObject();
  }

  @Test
  void textBlocksAreStringLiteralsWithTheirSourceText(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Blocks.java";
    write(tmp, rel, String.join("\r\n",
        "package lending;",
        "class Blocks {",
        "  boolean m(String s) {",
        "    if (s == \"\"\"",
        "        gold",
        "        \"\"\") return true;",
        "    return s.trim() == null;",
        "  }",
        "}", ""));
    List<Dtos.Evidence> found = file(analyzeWithFacts(tmp), rel).factEvidence;
    assertEquals(2, found.size(), String.valueOf(found.size()));
    assertEquals("string", found.get(0).literalKind);
    assertEquals("\"\"\"\r\n        gold\r\n        \"\"\"", found.get(0).literal);
    assertEquals(3, found.get(0).line);
    assertEquals("s.trim()", found.get(1).text);
    assertEquals(6, found.get(1).line);
  }

  @Test
  void aByteOrderMarkDoesNotShiftTheText(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Bom.java";
    write(tmp, rel, "\uFEFFpackage lending;\nclass Bom {\n  boolean m(int days) { return days > 14; }\n"
        + "  int n(int days) { if (days > 21) return 1; return 0; }\n}\n");
    List<Dtos.Evidence> found = file(analyzeWithFacts(tmp), rel).factEvidence;
    assertEquals(1, found.size());
    assertEquals("days > 21", found.get(0).text);
    assertEquals(3, found.get(0).line);
  }

  @Test
  void ownersFollowTheEmitVisitorIds(@TempDir Path tmp) throws IOException {
    String rel = "src/main/java/lending/Owners.java";
    write(tmp, rel, String.join("\n",
        "package lending;",
        "class Owners {",
        "  static { int retries = 2; }",
        "  Owners() { int timeout = 3; }",
        "  Runnable r = () -> { int delay = 4; };",
        "  enum Tier { GOLD; static final int TTL = 5; }",
        "  Object o = new Object() { int backoff() { int attempts = 6; return attempts; } };",
        "}", ""));
    List<String> found = file(analyzeWithFacts(tmp), rel).factEvidence.stream()
        .map(e -> e.name + " " + e.symbolId.substring(rel.length() + 2)).collect(Collectors.toList());
    assertEquals(List.of("retries Owners::class", "timeout Owners::method", "delay r::variable", "TTL TTL::variable",
        "attempts backoff::method"), found);
  }

  @Test
  void codeInStringsGivesNothing() {
    Dtos.FileResult rules = file(lending, RULES);
    assertTrue(rules.factEvidence.stream().noneMatch(e -> e.symbolId.endsWith("::note::method")),
        String.valueOf(rules.factEvidence.size()));
  }

  @Test
  void evidenceIsCappedPerFile(@TempDir Path tmp) throws IOException {
    StringBuilder body = new StringBuilder("package lending;\nclass Many {\n  int m(int x) {\n");
    for (int i = 0; i < FactEvidence.MAX_EVIDENCE_PER_FILE + 5; i++) body.append("    if (x == ").append(i + 2).append(") return 1;\n");
    body.append("    return 0;\n  }\n}\n");
    write(tmp, "src/main/java/lending/Many.java", body.toString());
    assertEquals(FactEvidence.MAX_EVIDENCE_PER_FILE,
        file(analyzeWithFacts(tmp), "src/main/java/lending/Many.java").factEvidence.size());
  }

  @Test
  void withoutTheOptionThereIsNoEvidence() {
    List<Dtos.FileResult> off = new Analyzer(LENDING.toString(), new String[0], true)
        .analyze(Main.discoverJavaFiles(LENDING.toString()));
    assertTrue(off.stream().allMatch(fr -> fr.factEvidence == null));
    List<Dtos.FileResult> nullOptions = new Analyzer(LENDING.toString(), new String[0], false, null)
        .analyze(Main.discoverJavaFiles(LENDING.toString()));
    assertTrue(nullOptions.stream().allMatch(fr -> fr.factEvidence == null));
    // A file without evidence has no key either.
    assertNull(file(lending, "src/main/java/lending/facts/HoldResource.java").factEvidence);
  }

  @Test
  void factOptionsDecodeBase64JsonAndRejectBadInput() {
    String json = "{\"normalizationMethods\":[\"trim\",\"strings.ToLower\"]}";
    String encoded = Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    assertEquals(List.of("trim", "strings.ToLower"), Dtos.FactOptions.decode(encoded).normalizationMethods);
    assertNull(Dtos.FactOptions.decode("not base64 !!"));
    assertNull(Dtos.FactOptions.decode(Base64.getEncoder().encodeToString("[1]".getBytes(StandardCharsets.UTF_8))));
    assertNull(Dtos.FactOptions.decode(Base64.getEncoder().encodeToString("{}".getBytes(StandardCharsets.UTF_8))));
    assertNull(Dtos.FactOptions.decode(Base64.getEncoder()
        .encodeToString("{\"normalizationMethods\":[1]}".getBytes(StandardCharsets.UTF_8))));
    assertNull(Dtos.FactOptions.decode(null));
  }

  @Test
  void mainReadsFactsBeforeThePositionalArguments() {
    String encoded = Base64.getEncoder()
        .encodeToString("{\"normalizationMethods\":[\"trim\"]}".getBytes(StandardCharsets.UTF_8));
    Main.Args args = Main.parseArgs(new String[] { "/root", "--keep-alive", "--sql-call-sites", "--facts=" + encoded });
    assertEquals(List.of("/root"), args.positional);
    assertTrue(args.keepAlive);
    assertTrue(args.sqlCallSites);
    assertEquals(List.of("trim"), args.facts.normalizationMethods);
    Main.Args first = Main.parseArgs(new String[] { "--facts=" + encoded, "/root" });
    assertEquals(List.of("/root"), first.positional);
    assertNotNull(first.facts);
    Main.Args bad = Main.parseArgs(new String[] { "/root", "--facts=%%" });
    assertEquals(List.of("/root"), bad.positional);
    assertNull(bad.facts);
    assertNull(Main.parseArgs(new String[] { "/root" }).facts);
  }

  /**
   * Facts off, the batch output is byte-identical to the tip of the line before facts existed, with
   * and without {@code --sql-call-sites}. With facts on, every line without its factEvidence member
   * is the same too.
   *
   * <p>The goldens ({@code lending-facts-off.golden.jsonl}, {@code lending-facts-off-sql.golden.jsonl})
   * are the {@code "type":"file"} lines of the analyzer built at {@code a364d6e2}, the commit before
   * fact evidence, sorted by {@code file}. To regenerate them (only for a deliberate output change):
   * export that commit's {@code packages/lang-java-analyzer/java} ({@code git archive a364d6e2 ...}),
   * run {@code mvn -q -Pjava17 -DskipTests package} there, copy the current {@code lending} fixture
   * with every {@code .java} file converted to LF line endings (offsets depend on them, and git may
   * check the fixture out with CRLF), run {@code java -jar ctxo-jdt-analyzer-17.jar <copy>} (and again
   * with {@code --sql-call-sites}), keep the {@code "type":"file"} lines, sort them by their
   * {@code file} member and write them with LF line endings. The -11 and -17 JARs give the same lines.
   */
  @Test
  void factsOffOutputIsByteIdenticalToTheGolden(@TempDir Path tmp) throws IOException {
    Path copy = lfCopy(tmp);
    assertGolden(GOLDEN, copy, false);
  }

  @Test
  void factsOffOutputWithSqlCallSitesIsByteIdenticalToTheGolden(@TempDir Path tmp) throws IOException {
    Path copy = lfCopy(tmp);
    assertGolden(GOLDEN_SQL, copy, true);
  }

  private static void assertGolden(Path goldenFile, Path copy, boolean sqlCallSites) throws IOException {
    List<String> golden = new ArrayList<>();
    for (String line : Files.readString(goldenFile, StandardCharsets.UTF_8).split("\\r?\\n")) {
      if (!line.isBlank()) golden.add(line);
    }
    assertEquals(sqlCallSites, golden.stream().anyMatch(l -> l.contains("\"sqlCallSites\"")));

    assertEquals(golden, fileLines(copy.toString(), new Analyzer(copy.toString(), new String[0], sqlCallSites)));

    List<String> on = fileLines(copy.toString(),
        new Analyzer(copy.toString(), new String[0], sqlCallSites, new Dtos.FactOptions(defaultPatterns)));
    assertTrue(on.stream().anyMatch(l -> l.contains("\"factEvidence\"")));
    List<String> stripped = on.stream().map(l -> {
      JsonObject o = JsonParser.parseString(l).getAsJsonObject();
      o.remove("factEvidence");
      return Main.json(o);
    }).collect(Collectors.toList());
    assertEquals(golden, stripped);
  }

  /** The lending fixture copied with LF line endings. */
  private static Path lfCopy(Path tmp) throws IOException {
    Path copy = tmp.resolve("lending");
    try (Stream<Path> walk = Files.walk(LENDING)) {
      for (Path p : (Iterable<Path>) walk::iterator) {
        Path target = copy.resolve(LENDING.relativize(p).toString());
        if (Files.isDirectory(p)) { Files.createDirectories(target); continue; }
        String text = Files.readString(p, StandardCharsets.UTF_8).replace("\r\n", "\n");
        Files.write(target, text.getBytes(StandardCharsets.UTF_8));
      }
    }
    return copy;
  }

  /** The {@code file} lines of a batch run, sorted by file (the walk order depends on the file system). */
  private static List<String> fileLines(String root, Analyzer analyzer) {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    Main.runBatch(root, analyzer, new PrintStream(bytes, true));
    List<String> lines = new ArrayList<>();
    for (String line : bytes.toString().split("\\r?\\n")) {
      if (line.startsWith("{\"type\":\"file\"")) lines.add(line);
    }
    lines.sort(Comparator.comparing(l -> JsonParser.parseString(l).getAsJsonObject().get("file").getAsString()));
    return lines;
  }
}
