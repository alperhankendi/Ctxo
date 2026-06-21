package io.ctxo.jdt;

import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.dom.*;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/** Runs JDT batch analysis over a set of source files and emits FileResults. */
public final class Analyzer {
  private final String rootDir;
  private final String[] classpath;

  public Analyzer(String rootDir, String[] classpath) {
    this.rootDir = rootDir;
    this.classpath = classpath;
  }

  public List<Dtos.FileResult> analyze(List<String> sourceFiles) {
    Map<String, Dtos.FileResult> byPath = new LinkedHashMap<>();
    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setKind(ASTParser.K_COMPILATION_UNIT);
    parser.setResolveBindings(true);
    parser.setBindingsRecovery(true);
    parser.setStatementsRecovery(true);
    Map<String, String> options = JavaCore.getOptions();
    JavaCore.setComplianceOptions(JavaCore.VERSION_17, options);
    parser.setCompilerOptions(options);
    parser.setEnvironment(classpath, new String[] { rootDir }, null, true);

    String[] files = sourceFiles.toArray(new String[0]);
    FileASTRequestor requestor = new FileASTRequestor() {
      @Override public void acceptAST(String sourceFilePath, CompilationUnit cu) {
        String rel = relativize(sourceFilePath);
        Dtos.FileResult fr = new Dtos.FileResult(rel);
        cu.accept(new EmitVisitor(cu, rel, fr));
        // imports: anchor on the first top-level type symbol (JDT visits imports before types,
        // so this must run after the visitor has populated symbols).
        String anchor = null;
        for (Dtos.Sym s : fr.symbols) {
          if (s.kind.equals("class") || s.kind.equals("interface") || s.kind.equals("type")) { anchor = s.symbolId; break; }
        }
        if (anchor != null) {
          for (Object o : cu.imports()) {
            org.eclipse.jdt.core.dom.ImportDeclaration imp = (org.eclipse.jdt.core.dom.ImportDeclaration) o;
            String fq = imp.getName().getFullyQualifiedName();
            String last = fq.contains(".") ? fq.substring(fq.lastIndexOf('.') + 1) : fq;
            fr.edges.add(new Dtos.Edge(anchor, fq + "::" + last + "::class", "imports"));
          }
        }
        byPath.put(rel, fr);
      }
    };
    parser.createASTs(files, null, new String[0], requestor, null);
    return new ArrayList<>(byPath.values());
  }

  private String relativize(String absSourcePath) {
    try {
      Path root = Paths.get(rootDir).toAbsolutePath().normalize();
      Path p = Paths.get(absSourcePath).toAbsolutePath().normalize();
      return root.relativize(p).toString().replace('\\', '/');
    } catch (Exception e) { return absSourcePath.replace('\\', '/'); }
  }

  private final class EmitVisitor extends ASTVisitor {
    private final CompilationUnit cu;
    private final String file;
    private final Dtos.FileResult out;
    private String enclosingTypeId;

    EmitVisitor(CompilationUnit cu, String file, Dtos.FileResult out) { this.cu = cu; this.file = file; this.out = out; }

    private int line0(int pos) { return Math.max(0, cu.getLineNumber(pos) - 1); }
    private String symId(String name, String kind) { return file + "::" + name + "::" + kind; }
    private void addType(String name, String kind, ASTNode node) {
      out.symbols.add(new Dtos.Sym(symId(name, kind), name, kind,
          line0(node.getStartPosition()), line0(node.getStartPosition() + node.getLength()),
          node.getStartPosition(), node.getStartPosition() + node.getLength()));
    }

    @Override public boolean visit(TypeDeclaration node) {
      String name = node.getName().getIdentifier();
      String kind = node.isInterface() ? "interface" : "class";
      addType(name, kind, node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, kind);
      Type sc = node.getSuperclassType();
      if (sc != null) out.edges.add(new Dtos.Edge(enclosingTypeId, typeId(sc, "class"), "extends"));
      for (Object o : node.superInterfaceTypes()) {
        String ek = kind.equals("interface") ? "extends" : "implements";
        out.edges.add(new Dtos.Edge(enclosingTypeId, typeId((Type) o, "interface"), ek));
      }
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false;
    }

    @Override public boolean visit(EnumDeclaration node) {
      String name = node.getName().getIdentifier();
      addType(name, "type", node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, "type");
      for (Object o : node.superInterfaceTypes())
        out.edges.add(new Dtos.Edge(enclosingTypeId, typeId((Type) o, "interface"), "implements"));
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false;
    }

    @Override public boolean visit(RecordDeclaration node) {
      String name = node.getName().getIdentifier();
      addType(name, "class", node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, "class");
      for (Object o : node.superInterfaceTypes())
        out.edges.add(new Dtos.Edge(enclosingTypeId, typeId((Type) o, "interface"), "implements"));
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false;
    }

    @Override public boolean visit(AnnotationTypeDeclaration node) {
      String name = node.getName().getIdentifier();
      addType(name, "interface", node);
      String prev = enclosingTypeId; enclosingTypeId = symId(name, "interface");
      node.bodyDeclarations().forEach(b -> ((ASTNode) b).accept(this));
      enclosingTypeId = prev;
      return false;
    }

    @Override public boolean visit(MethodDeclaration node) {
      String name = node.getName().getIdentifier();
      out.symbols.add(new Dtos.Sym(symId(name, "method"), name, "method",
          line0(node.getStartPosition()), line0(node.getStartPosition() + node.getLength()),
          node.getStartPosition(), node.getStartPosition() + node.getLength()));
      if (node.getReturnType2() != null) addUses(node.getReturnType2());
      return true;
    }

    @Override public boolean visit(FieldDeclaration node) {
      for (Object o : node.fragments()) {
        VariableDeclarationFragment f = (VariableDeclarationFragment) o;
        String name = f.getName().getIdentifier();
        out.symbols.add(new Dtos.Sym(symId(name, "variable"), name, "variable",
            line0(node.getStartPosition()), line0(node.getStartPosition() + node.getLength()),
            node.getStartPosition(), node.getStartPosition() + node.getLength()));
      }
      addUses(node.getType());
      return true;
    }

    @Override public boolean visit(SingleVariableDeclaration node) {
      addUses(node.getType());
      return true;
    }

    private void addUses(Type t) {
      if (enclosingTypeId == null || t == null) return;
      collectTypeUses(t);
    }

    private void collectTypeUses(Type t) {
      if (t == null) return;
      if (t.isParameterizedType()) {
        ParameterizedType pt = (ParameterizedType) t;
        collectTypeUses(pt.getType());
        for (Object a : pt.typeArguments()) collectTypeUses((Type) a);
      } else if (t.isArrayType()) {
        collectTypeUses(((ArrayType) t).getElementType());
      } else if (t.isWildcardType()) {
        Type bound = ((WildcardType) t).getBound();
        if (bound != null) collectTypeUses(bound);
      } else if (t.isSimpleType() || t.isQualifiedType() || t.isNameQualifiedType()) {
        if (!isPrimitiveOrJavaLang(t)) out.edges.add(new Dtos.Edge(enclosingTypeId, typeId(t, "class"), "uses"));
      }
    }

    private boolean isPrimitiveOrJavaLang(Type t) {
      ITypeBinding b = t.resolveBinding();
      if (b == null) return false;
      if (b.isPrimitive()) return true;
      String pkg = b.getPackage() == null ? "" : b.getPackage().getName();
      return pkg.equals("java.lang");
    }

    @Override public boolean visit(MethodInvocation node) {
      if (enclosingTypeId == null) return true;
      IMethodBinding mb = node.resolveMethodBinding();
      if (mb != null && mb.getDeclaringClass() != null) {
        String decl = mb.getDeclaringClass().getQualifiedName();
        out.edges.add(new Dtos.Edge(enclosingTypeId, decl + "::" + mb.getName() + "::method", "calls"));
      }
      return true;
    }

    @Override public boolean visit(ClassInstanceCreation node) {
      if (enclosingTypeId == null) return true;
      IMethodBinding ctor = node.resolveConstructorBinding();
      if (ctor != null && ctor.getDeclaringClass() != null) {
        String decl = ctor.getDeclaringClass().getQualifiedName();
        String simple = decl.contains(".") ? decl.substring(decl.lastIndexOf('.') + 1) : decl;
        out.edges.add(new Dtos.Edge(enclosingTypeId, decl + "::" + simple + "::method", "calls"));
        out.edges.add(new Dtos.Edge(enclosingTypeId, simple + "::class", "uses"));
      }
      return true;
    }

    private String typeId(Type t, String fallbackKind) {
      ITypeBinding b = t.resolveBinding();
      if (b != null) {
        String qn = b.getQualifiedName();
        int lt = qn.indexOf('<'); if (lt >= 0) qn = qn.substring(0, lt);
        String last = qn.contains(".") ? qn.substring(qn.lastIndexOf('.') + 1) : qn;
        return last + "::" + fallbackKind;
      }
      String s = t.toString();
      int lt2 = s.indexOf('<'); if (lt2 >= 0) s = s.substring(0, lt2);
      String last = s.contains(".") ? s.substring(s.lastIndexOf('.') + 1) : s;
      return last + "::" + fallbackKind;
    }
  }
}
