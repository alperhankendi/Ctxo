package io.ctxo.jdt;

import org.w3c.dom.*;
import javax.xml.parsers.*;
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
    if (override.length > 0) return override;
    List<String> ide = fromIdeMetadata();
    if (!ide.isEmpty()) return ide.toArray(new String[0]);
    List<String> local = fromLocalRepo();
    if (!local.isEmpty()) return local.toArray(new String[0]);
    return new String[0];
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
    Path ideaLibs = Paths.get(rootDir, ".idea", "libraries");
    if (Files.isDirectory(ideaLibs)) {
      try (var stream = Files.newDirectoryStream(ideaLibs, "*.xml")) {
        Pattern jarUrl = Pattern.compile("jar://([^!]+)!/");
        for (Path xml : stream) {
          Matcher m = jarUrl.matcher(Files.readString(xml));
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
    Path gradle = Paths.get(rootDir, "build.gradle");
    Path gradleCache = Paths.get(home, ".gradle", "caches", "modules-2", "files-2.1");
    if (Files.exists(gradle) && Files.isDirectory(gradleCache)) {
      try {
        Matcher m = Pattern.compile("[\"']([\\w.\\-]+):([\\w.\\-]+):([\\w.\\-]+)[\"']").matcher(Files.readString(gradle));
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
