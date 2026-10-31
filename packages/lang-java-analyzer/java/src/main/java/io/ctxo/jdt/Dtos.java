package io.ctxo.jdt;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Plain data carriers serialized to JSONL by Gson. Field names ARE the JSON keys. */
public final class Dtos {
  private Dtos() {}

  public static final class Sym {
    public String symbolId;
    public String name;
    public String kind;
    public int startLine;
    public int endLine;
    public Integer startOffset;
    public Integer endOffset;
    /** Annotations in source order; null when there are none, so Gson omits the key. */
    public List<Ann> annotations;
    public Sym(String symbolId, String name, String kind, int startLine, int endLine, int startOffset, int endOffset) {
      this.symbolId = symbolId; this.name = name; this.kind = kind;
      this.startLine = startLine; this.endLine = endLine;
      this.startOffset = startOffset; this.endOffset = endOffset;
    }
  }

  /**
   * One Java annotation (protocol v2 {@code SymbolAnnotation}): the simple name, the {@code value}
   * member in {@code args}, the other members in {@code named} (a LinkedHashMap in source order).
   * {@code args} and {@code named} are null when empty, so Gson omits them.
   */
  public static final class Ann {
    public String name;
    public List<String> args;
    public Map<String, String> named;
    public Ann(String name, List<String> args, Map<String, String> named) {
      this.name = name; this.args = args; this.named = named;
    }
  }

  public static final class Edge {
    public String from;
    public String to;
    public String kind;
    public Edge(String from, String to, String kind) { this.from = from; this.to = to; this.kind = kind; }
  }

  /**
   * Raw SQL text at a known call site or on a known annotation ({@code --sql-call-sites}). The
   * plugin turns it into data edges with {@code @ctxo/sql-extract}. {@code line} is 0-based and
   * points at the text; {@code kind} is {@code statement}, or {@code procedureName} when the text
   * is a JDBC call escape ({@code text} is then the procedure name).
   */
  public static final class SqlSite {
    public String symbolId;
    public int line;
    public String text;
    public String kind;
    public SqlSite(String symbolId, int line, String text, String kind) {
      this.symbolId = symbolId; this.line = line; this.text = text; this.kind = kind;
    }
  }

  /** SQL texts found at known call sites in one analysis run, as the batch {@code done} line reports them. */
  public static final class SqlStats {
    /** Texts that are compile-time constants (each has a {@link SqlSite}). */
    public int constant;
    /** Texts that are not (built at runtime, a parameter, a non-final field). */
    public int nonConstant;
  }

  /**
   * One fact evidence record ({@code --facts=}, issue #156): {@code comparison}, {@code call},
   * {@code binding} or {@code duration}. The plugin's shared finisher turns evidence into facts;
   * the analyzer applies only the normalization patterns and the retry/timeout name rule. Members
   * that do not apply to the kind stay null, so Gson omits them. {@code line} is 0-based.
   */
  public static final class Evidence {
    public String kind;
    public String symbolId;
    public int line;
    public String text, operator, literal, literalKind, method, qualifier, name, value, constructor, unit, amount, verb, route;
    /** FC-4b, {@code call} only: the callee of the nearest call that takes the call's value as an argument; null when none. */
    public String consumer;
    /** FC-4b, {@code call} only: the consumer's receiver type and declaring class, qualified erasures; null when unresolved. */
    public List<String> consumerTypes;
    /** FC-4b, {@code call} only: true when the value is an operand of a {@code +} chain with prose; null otherwise. */
    public Boolean inProse;
    public Evidence(String kind, String symbolId, int line) { this.kind = kind; this.symbolId = symbolId; this.line = line; }
  }

  /** The {@code --facts=} value: standard base64 of the UTF-8 JSON {@code {"normalizationMethods":[...]}}. */
  public static final class FactOptions {
    public final List<String> normalizationMethods;
    public FactOptions(List<String> normalizationMethods) { this.normalizationMethods = List.copyOf(normalizationMethods); }

    /** The options, or null when the value is not base64 of such a JSON object (every entry a string). */
    static FactOptions decode(String base64) {
      if (base64 == null) return null;
      try {
        String json = new String(java.util.Base64.getDecoder().decode(base64), java.nio.charset.StandardCharsets.UTF_8);
        com.google.gson.JsonElement root = com.google.gson.JsonParser.parseString(json);
        if (!root.isJsonObject()) return null;
        com.google.gson.JsonElement methods = root.getAsJsonObject().get("normalizationMethods");
        if (methods == null || !methods.isJsonArray()) return null;
        List<String> out = new ArrayList<>();
        for (com.google.gson.JsonElement m : methods.getAsJsonArray()) {
          if (!m.isJsonPrimitive() || !m.getAsJsonPrimitive().isString()) return null;
          out.add(m.getAsString());
        }
        return new FactOptions(out);
      } catch (RuntimeException e) {
        return null;
      }
    }
  }

  public static final class FileResult {
    public String type = "file";
    public String file;
    public List<Sym> symbols = new ArrayList<>();
    public List<Edge> edges = new ArrayList<>();
    public List<Object> complexity = new ArrayList<>();
    /**
     * Sorted by line, then text; null when the file has none or without {@code --sql-call-sites},
     * so Gson omits the key.
     */
    public List<SqlSite> sqlCallSites;
    /** In walk order, at most {@link FactEvidence#MAX_EVIDENCE_PER_FILE}; null when the file has none or without {@code --facts=}. */
    public List<Evidence> factEvidence;
    public FileResult(String file) { this.file = file; }
  }
}
