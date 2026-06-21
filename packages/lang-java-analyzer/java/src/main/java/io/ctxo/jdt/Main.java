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
    if (keepAlive) runKeepAlive(root, analyzer); else runBatch(root, analyzer);
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
          OUT.println(GSON.toJson(!r.isEmpty() ? r.get(0) : new Dtos.FileResult(rel.replace('\\', '/'))));
        } catch (Exception e) { err("keep-alive error: " + e.getMessage()); }
      }
    } catch (IOException e) { err("stdin closed: " + e.getMessage()); }
  }

  private static List<String> discoverJavaFiles(String root) {
    Set<String> skip = Set.of("target", "build", ".git", "node_modules", ".gradle", "bin", "out");
    try (var s = Files.walk(Paths.get(root))) {
      return s.filter(p -> p.toString().endsWith(".java"))
              .filter(p -> { for (Path part : Paths.get(root).relativize(p)) if (skip.contains(part.toString())) return false; return true; })
              .map(Path::toString).collect(Collectors.toList());
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
