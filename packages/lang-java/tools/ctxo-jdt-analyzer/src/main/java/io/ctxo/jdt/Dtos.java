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
    public Integer startOffset;
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
    public List<Object> complexity = new ArrayList<>();
    public FileResult(String file) { this.file = file; }
  }
}
