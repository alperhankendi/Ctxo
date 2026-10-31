package io.ctxo.jdt;

import org.eclipse.jdt.core.dom.*;

import java.math.BigInteger;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fact evidence of one compilation unit ({@code --facts=}, issue #156, Fact contract FC-3 to FC-5).
 *
 * <p>The analyzer reports syntax; the plugin's shared finisher decides which evidence becomes a
 * fact (trivial literals, numeric constants, text, order and the 500-fact cap). Here only the
 * normalization patterns and the retry/timeout name rule are applied, to keep the output small.
 *
 * <ul>
 *   <li>{@code comparison}: {@code ==}, {@code !=}, {@code <}, {@code <=}, {@code >}, {@code >=}
 *       with exactly one literal operand, inside the condition of {@code if}, {@code while},
 *       {@code do}, {@code for} and {@code ?:}, through {@code &&}, {@code ||}, {@code !} and
 *       parentheses; switch statement and expression case labels as {@code <subject> case <label>}.
 *   <li>{@code call}: a method invocation whose simple name matches a pattern ({@link #matchesPattern}).
 *   <li>{@code binding}: a field or local declarator, a plain assignment or an annotation member
 *       whose name has a retry or timeout fragment ({@link #hasRetryTimeoutFragment}).
 *   <li>{@code duration}: {@code Duration.of{Millis,Seconds,Minutes,Hours,Days,Nanos}(n)} and
 *       {@code Duration.of(n, ChronoUnit.X)}, written with a {@code Duration} or
 *       {@code java.time.Duration} receiver (by name, so the syntax tier can agree), named after
 *       the declarator, assignment or annotation member it is bound to.
 * </ul>
 *
 * <p>Java wraps int arithmetic, the shared rules evaluate it exactly: a binding value or duration
 * amount in which some int-typed operation leaves the int range (24 * 60 * 60 * 1000 * 365) is
 * not a constant, so it gives no evidence, also beside a floating operand. A hex, octal or binary
 * int literal above INT_MAX ({@code 0xFFFFFFFF}, a valid int with the value -1, which the shared
 * rules would read as 4294967295) counts as leaving the range, so a comparison or case label with
 * one gives no evidence either. Types come from the JDT bindings,
 * else from the literals (an integer literal without {@code L} is an int).
 *
 * <p>{@code symbolId} is the owner as {@code EmitVisitor} names it: the innermost method or
 * constructor ({@code <file>::<name>::method}), else the field declarator
 * ({@code <file>::<name>::variable}), else the type. {@code text}, {@code literal},
 * {@code qualifier} and {@code value} are source slices.
 */
final class FactEvidence {
  /** At most this many evidence records per file (a generated file must not dominate the batch output). */
  static final int MAX_EVIDENCE_PER_FILE = 2000;

  /** Name fragments of retry and timeout bindings (the shared {@code RETRY_TIMEOUT_FRAGMENTS}). */
  static final List<String> RETRY_TIMEOUT_FRAGMENTS =
      List.of("retry", "retries", "attempt", "timeout", "delay", "backoff", "ttl", "expir");

  // ASCII classes only: [0-9] rather than \d, and no Unicode case tests.
  private static final Pattern NAME_TOKEN = Pattern.compile("[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|[0-9]+");

  private static final Set<InfixExpression.Operator> COMPARISONS = Set.of(
      InfixExpression.Operator.EQUALS, InfixExpression.Operator.NOT_EQUALS,
      InfixExpression.Operator.LESS, InfixExpression.Operator.LESS_EQUALS,
      InfixExpression.Operator.GREATER, InfixExpression.Operator.GREATER_EQUALS);

  private static final Map<String, String> DURATION_METHODS = Map.of(
      "ofNanos", "ns", "ofMillis", "ms", "ofSeconds", "s", "ofMinutes", "min", "ofHours", "h", "ofDays", "d");

  private static final Map<String, String> CHRONO_UNITS = Map.of(
      "NANOS", "ns", "MICROS", "us", "MILLIS", "ms", "SECONDS", "s", "MINUTES", "min", "HOURS", "h", "DAYS", "d");

  private static final BigInteger INT_MIN = BigInteger.valueOf(Integer.MIN_VALUE);
  private static final BigInteger INT_MAX = BigInteger.valueOf(Integer.MAX_VALUE);

  private FactEvidence() {}

  /**
   * FC-5: the name split into ASCII tokens (camelCase, PascalCase, digit runs; every other
   * character separates), lower-cased with {@code Locale.ROOT}; true when the tokens joined from
   * the start of some token begin with a fragment.
   */
  static boolean hasRetryTimeoutFragment(String name) {
    List<String> tokens = new ArrayList<>();
    Matcher m = NAME_TOKEN.matcher(name);
    while (m.find()) tokens.add(m.group().toLowerCase(Locale.ROOT));
    for (int i = 0; i < tokens.size(); i++) {
      String rest = String.join("", tokens.subList(i, tokens.size()));
      for (String fragment : RETRY_TIMEOUT_FRAGMENTS) if (rest.startsWith(fragment)) return true;
    }
    return false;
  }

  /**
   * FC-4: {@code Name} matches exactly, {@code Name*} by prefix (case-sensitive), {@code q.Name[*]}
   * only when the call is written {@code q.Name(...)}; {@code qualifier} is the receiver's source,
   * null for a call without one.
   */
  static boolean matchesPattern(String method, String qualifier, List<String> patterns) {
    for (String pattern : patterns) {
      int dot = pattern.indexOf('.');
      String patternQualifier = dot >= 0 ? pattern.substring(0, dot) : null;
      String name = dot >= 0 ? pattern.substring(dot + 1) : pattern;
      if (patternQualifier != null && !patternQualifier.equals(qualifier)) continue;
      boolean match = name.endsWith("*") ? method.startsWith(name.substring(0, name.length() - 1)) : method.equals(name);
      if (match) return true;
    }
    return false;
  }

  /**
   * Adds the evidence of {@code cu} to {@code out}. {@code source} is the text JDT parsed (offsets
   * index into it); {@code file} the relative path used in symbol IDs.
   */
  static void collect(CompilationUnit cu, String source, String file, Dtos.FactOptions options, List<Dtos.Evidence> out) {
    cu.accept(new Collector(cu, source, file, options, out));
  }

  private static final class Collector extends ASTVisitor {
    private final CompilationUnit cu;
    private final String source;
    private final String file;
    private final List<String> patterns;
    private final List<Dtos.Evidence> out;
    private final Deque<String> owners = new ArrayDeque<>();

    Collector(CompilationUnit cu, String source, String file, Dtos.FactOptions options, List<Dtos.Evidence> out) {
      this.cu = cu; this.source = source; this.file = file; this.patterns = options.normalizationMethods; this.out = out;
    }

    // ── Owners, as EmitVisitor names them ──

    private String id(String name, String kind) { return file + "::" + name + "::" + kind; }
    private void enter(String id) { owners.push(id); }
    private void leave() { owners.pop(); }

    @Override public boolean visit(TypeDeclaration node) {
      enter(id(node.getName().getIdentifier(), node.isInterface() ? "interface" : "class"));
      return true;
    }
    @Override public void endVisit(TypeDeclaration node) { leave(); }
    @Override public boolean visit(EnumDeclaration node) { enter(id(node.getName().getIdentifier(), "type")); return true; }
    @Override public void endVisit(EnumDeclaration node) { leave(); }
    @Override public boolean visit(RecordDeclaration node) { enter(id(node.getName().getIdentifier(), "class")); return true; }
    @Override public void endVisit(RecordDeclaration node) { leave(); }
    @Override public boolean visit(AnnotationTypeDeclaration node) {
      enter(id(node.getName().getIdentifier(), "interface"));
      return true;
    }
    @Override public void endVisit(AnnotationTypeDeclaration node) { leave(); }
    @Override public boolean visit(MethodDeclaration node) { enter(id(node.getName().getIdentifier(), "method")); return true; }
    @Override public void endVisit(MethodDeclaration node) { leave(); }

    /** The field's own annotations belong to its first declarator, as EmitVisitor gives each declarator the declaration's annotations. */
    @Override public boolean visit(FieldDeclaration node) {
      VariableDeclarationFragment first = (VariableDeclarationFragment) node.fragments().get(0);
      enter(id(first.getName().getIdentifier(), "variable"));
      return true;
    }
    @Override public void endVisit(FieldDeclaration node) { leave(); }

    @Override public boolean visit(VariableDeclarationFragment node) {
      boolean field = node.getParent() instanceof FieldDeclaration;
      if (field) enter(id(node.getName().getIdentifier(), "variable"));
      Expression init = node.getInitializer();
      if (init != null) bound(node, node.getName().getIdentifier(), init);
      return true;
    }
    @Override public void endVisit(VariableDeclarationFragment node) {
      if (node.getParent() instanceof FieldDeclaration) leave();
    }

    // ── Conditions ──

    @Override public boolean visit(IfStatement node) { condition(node.getExpression()); return true; }
    @Override public boolean visit(WhileStatement node) { condition(node.getExpression()); return true; }
    @Override public boolean visit(DoStatement node) { condition(node.getExpression()); return true; }
    @Override public boolean visit(ForStatement node) { condition(node.getExpression()); return true; }
    @Override public boolean visit(ConditionalExpression node) { condition(node.getExpression()); return true; }

    private void condition(Expression e) {
      if (e == null) return;
      if (e instanceof ParenthesizedExpression) {
        condition(((ParenthesizedExpression) e).getExpression());
      } else if (e instanceof PrefixExpression && ((PrefixExpression) e).getOperator() == PrefixExpression.Operator.NOT) {
        condition(((PrefixExpression) e).getOperand());
      } else if (e instanceof InfixExpression) {
        InfixExpression infix = (InfixExpression) e;
        InfixExpression.Operator op = infix.getOperator();
        if (op == InfixExpression.Operator.CONDITIONAL_AND || op == InfixExpression.Operator.CONDITIONAL_OR) {
          condition(infix.getLeftOperand());
          condition(infix.getRightOperand());
          for (Object extended : infix.extendedOperands()) condition((Expression) extended);
        } else if (COMPARISONS.contains(op) && infix.extendedOperands().isEmpty()) {
          String left = literalKind(infix.getLeftOperand());
          String right = literalKind(infix.getRightOperand());
          if ((left == null) == (right == null)) return;
          Expression literal = left != null ? infix.getLeftOperand() : infix.getRightOperand();
          // 0xFFFFFFFF is -1 in Java, the shared rules would read 4294967295: not a constant, no fact.
          if (overflowsInt(literal)) return;
          Dtos.Evidence ev = evidence("comparison", infix);
          if (ev == null) return;
          ev.text = src(infix);
          ev.operator = op.toString();
          ev.literal = src(literal);
          ev.literalKind = left != null ? left : right;
        }
      }
    }

    @Override public boolean visit(SwitchStatement node) { caseLabels(node.getExpression(), node.statements()); return true; }
    @Override public boolean visit(SwitchExpression node) { caseLabels(node.getExpression(), node.statements()); return true; }

    private void caseLabels(Expression subject, List<?> statements) {
      String subjectText = src(subject);
      for (Object statement : statements) {
        if (!(statement instanceof SwitchCase)) continue;
        SwitchCase label = (SwitchCase) statement;
        for (Object o : label.expressions()) {
          Expression value = (Expression) o;
          String kind = literalKind(value);
          if (kind == null || overflowsInt(value)) continue;
          Dtos.Evidence ev = evidence("comparison", label);
          if (ev == null) return;
          ev.text = subjectText + " case " + src(value);
          ev.operator = "case";
          ev.literal = src(value);
          ev.literalKind = kind;
        }
      }
    }

    /** number (a NumberLiteral, optionally under a unary minus), string (also text blocks), char, boolean, null; else null. */
    private static String literalKind(Expression e) {
      if (e instanceof NumberLiteral) return "number";
      if (e instanceof PrefixExpression) {
        PrefixExpression prefix = (PrefixExpression) e;
        return prefix.getOperator() == PrefixExpression.Operator.MINUS && prefix.getOperand() instanceof NumberLiteral ? "number" : null;
      }
      if (e instanceof StringLiteral || e instanceof TextBlock) return "string";
      if (e instanceof CharacterLiteral) return "char";
      if (e instanceof BooleanLiteral) return "boolean";
      if (e instanceof NullLiteral) return "null";
      return null;
    }

    // ── Calls and durations ──

    @Override public boolean visit(MethodInvocation node) {
      String method = node.getName().getIdentifier();
      Expression receiver = node.getExpression();
      String qualifier = receiver == null ? null : src(receiver);
      if (matchesPattern(method, qualifier, patterns)) {
        Dtos.Evidence ev = evidence("call", node);
        if (ev != null) {
          ev.text = src(node);
          ev.method = method;
          ev.qualifier = qualifier;
          destination(node, ev);
        }
      }
      if (isDuration(node) && !boundDuration(node)) duration(node, null);
      return true;
    }

    /**
     * FC-4b: up to the statement and never out of a lambda, the nearest call ({@code new T} for a
     * construction) that takes the value as an argument, with its receiver type and the type
     * declaring its method when the bindings resolve, and whether on the way the value is an operand
     * of a {@code +} chain with a string whose value holds ASCII whitespace. The syntax tier reads the
     * same places.
     */
    private void destination(MethodInvocation call, Dtos.Evidence ev) {
      boolean inProse = false;
      ASTNode node = call;
      for (ASTNode parent = node.getParent(); parent != null; node = parent, parent = parent.getParent()) {
        if (parent instanceof Statement || parent instanceof BodyDeclaration || parent instanceof LambdaExpression
            || parent instanceof AnonymousClassDeclaration || parent instanceof CompilationUnit) break;
        if (parent instanceof MethodInvocation && node.getLocationInParent() == MethodInvocation.ARGUMENTS_PROPERTY) {
          MethodInvocation outer = (MethodInvocation) parent;
          String name = outer.getName().getIdentifier();
          ev.consumer = collapse(outer.getExpression() == null ? name : src(outer.getExpression()) + "." + name);
          ev.consumerTypes = consumerTypes(outer);
          break;
        } else if (parent instanceof ClassInstanceCreation && node.getLocationInParent() == ClassInstanceCreation.ARGUMENTS_PROPERTY) {
          ev.consumer = "new " + collapse(src(((ClassInstanceCreation) parent).getType()));
          break;
        } else if (parent instanceof InfixExpression && ((InfixExpression) parent).getOperator() == InfixExpression.Operator.PLUS) {
          List<Expression> operands = new ArrayList<>();
          concatOperands((Expression) parent, operands);
          for (Expression operand : operands) if (isProse(operand)) inProse = true;
        }
      }
      if (inProse) ev.inProse = Boolean.TRUE;
    }

    /** The consumer's receiver type and the class declaring its method (erasures, qualified), or null. */
    private static List<String> consumerTypes(MethodInvocation call) {
      List<String> types = new ArrayList<>();
      Expression receiver = call.getExpression();
      if (receiver != null) addType(types, receiver.resolveTypeBinding());
      IMethodBinding method = call.resolveMethodBinding();
      if (method != null) addType(types, method.getDeclaringClass());
      return types.isEmpty() ? null : types;
    }

    private static void addType(List<String> types, ITypeBinding type) {
      if (type == null || type.isRecovered()) return;
      String name = type.getErasure().getQualifiedName();
      if (!name.isEmpty() && !types.contains(name)) types.add(name);
    }

    private static String collapse(String text) {
      return text.replaceAll("\\s+", " ").trim();
    }

    /** The operands of a {@code +} chain, through nested {@code +} (not through parentheses). */
    private static void concatOperands(Expression e, List<Expression> out) {
      if (e instanceof InfixExpression && ((InfixExpression) e).getOperator() == InfixExpression.Operator.PLUS) {
        InfixExpression infix = (InfixExpression) e;
        concatOperands(infix.getLeftOperand(), out);
        concatOperands(infix.getRightOperand(), out);
        for (Object extended : infix.extendedOperands()) concatOperands((Expression) extended, out);
      } else {
        out.add(e);
      }
    }

    /** A string literal or text block whose value holds ASCII whitespace (space, tab, LF, CR, FF, VT). */
    private static boolean isProse(Expression e) {
      String value = null;
      try {
        if (e instanceof StringLiteral) value = ((StringLiteral) e).getLiteralValue();
        else if (e instanceof TextBlock) value = ((TextBlock) e).getLiteralValue();
      } catch (IllegalArgumentException invalid) {
        return false;
      }
      if (value == null) return false;
      for (int i = 0; i < value.length(); i++) if (" \t\n\r\f\u000B".indexOf(value.charAt(i)) >= 0) return true;
      return false;
    }

    /** {@code Duration.ofX(n)} or {@code Duration.of(n, ChronoUnit.X)} with a known unit, by name. */
    private boolean isDuration(Expression e) {
      if (!(e instanceof MethodInvocation)) return false;
      return durationUnit((MethodInvocation) e) != null;
    }

    private String durationUnit(MethodInvocation call) {
      Expression receiver = call.getExpression();
      if (receiver == null) return null;
      String qualifier = src(receiver);
      if (!qualifier.equals("Duration") && !qualifier.equals("java.time.Duration")) return null;
      String method = call.getName().getIdentifier();
      List<?> args = call.arguments();
      if (args.size() == 1) return DURATION_METHODS.get(method);
      if (args.size() != 2 || !method.equals("of") || !(args.get(1) instanceof QualifiedName)) return null;
      QualifiedName unit = (QualifiedName) args.get(1);
      String owner = unit.getQualifier().getFullyQualifiedName();
      if (!owner.equals("ChronoUnit") && !owner.equals("java.time.temporal.ChronoUnit")) return null;
      return CHRONO_UNITS.get(unit.getName().getIdentifier());
    }

    /** True when the call is the whole value of a declarator, plain assignment or annotation member (reported there with the name). */
    private static boolean boundDuration(MethodInvocation call) {
      ASTNode parent = call.getParent();
      if (parent instanceof VariableDeclarationFragment) return ((VariableDeclarationFragment) parent).getInitializer() == call;
      if (parent instanceof Assignment) {
        Assignment assignment = (Assignment) parent;
        return assignment.getRightHandSide() == call && assignment.getOperator() == Assignment.Operator.ASSIGN
            && assignedName(assignment.getLeftHandSide()) != null;
      }
      if (parent instanceof MemberValuePair) return ((MemberValuePair) parent).getValue() == call;
      return false;
    }

    private void duration(MethodInvocation call, String name) {
      Expression amount = (Expression) call.arguments().get(0);
      if (overflowsInt(amount)) return;
      Dtos.Evidence ev = evidence("duration", call);
      if (ev == null) return;
      ev.name = name;
      ev.constructor = src(call.getExpression()) + "." + call.getName().getIdentifier();
      ev.unit = durationUnit(call);
      ev.amount = src(amount);
    }

    // ── Bindings ──

    @Override public boolean visit(Assignment node) {
      if (node.getOperator() != Assignment.Operator.ASSIGN) return true;
      String name = assignedName(node.getLeftHandSide());
      if (name != null) bound(node, name, node.getRightHandSide());
      return true;
    }

    @Override public boolean visit(MemberValuePair node) {
      bound(node, node.getName().getIdentifier(), node.getValue());
      return true;
    }

    /** The assigned name: a simple name, or the last segment of a field access or qualified name; else null. */
    private static String assignedName(Expression left) {
      if (left instanceof SimpleName) return ((SimpleName) left).getIdentifier();
      if (left instanceof QualifiedName) return ((QualifiedName) left).getName().getIdentifier();
      if (left instanceof FieldAccess) return ((FieldAccess) left).getName().getIdentifier();
      if (left instanceof SuperFieldAccess) return ((SuperFieldAccess) left).getName().getIdentifier();
      return null;
    }

    /** A named duration whatever the name; otherwise a binding when the name has a retry or timeout fragment. */
    private void bound(ASTNode node, String name, Expression value) {
      if (isDuration(value)) {
        duration((MethodInvocation) value, name);
        return;
      }
      if (!hasRetryTimeoutFragment(name) || overflowsInt(value)) return;
      Dtos.Evidence ev = evidence("binding", node);
      if (ev == null) return;
      ev.name = name;
      ev.value = src(value);
    }

    // ── Helpers ──

    /** A new record owned by the current owner, or null when the file's cap is reached. */
    private Dtos.Evidence evidence(String kind, ASTNode node) {
      if (out.size() >= MAX_EVIDENCE_PER_FILE) return null;
      Dtos.Evidence ev = new Dtos.Evidence(kind, owners.peek(), Math.max(0, cu.getLineNumber(node.getStartPosition()) - 1));
      out.add(ev);
      return ev;
    }

    private String src(ASTNode node) {
      return source.substring(node.getStartPosition(), node.getStartPosition() + node.getLength());
    }
  }

  // ── Int overflow (Java wraps, the shared rules do not) ──

  private static final class Overflow extends RuntimeException {
    private static final long serialVersionUID = 1L;
    Overflow() { super(null, null, false, false); }
  }

  /** An exact integer and whether its Java type is long (else int). */
  private static final class Exact {
    final BigInteger value;
    final boolean isLong;
    Exact(BigInteger value, boolean isLong) { this.value = value; this.isLong = isLong; }
  }

  /**
   * True when {@code e} is integer literal arithmetic ({@code + - * /}, parentheses, unary signs)
   * in which some int-typed step leaves the int range. Anything else (names, floating literals,
   * casts) is false: the shared rules decide about it.
   */
  static boolean overflowsInt(Expression e) {
    try {
      exact(e);
      return false;
    } catch (Overflow o) {
      return true;
    }
  }

  /** The exact value, or null when {@code e} is not integer literal arithmetic; throws {@link Overflow}. */
  private static Exact exact(Expression e) {
    Exact result = exactUnchecked(e);
    if (result != null) {
      ITypeBinding type = e.resolveTypeBinding();
      boolean isInt = type != null ? "int".equals(type.getName()) : !result.isLong;
      checkInt(result.value, isInt);
    }
    return result;
  }

  private static Exact exactUnchecked(Expression e) {
    if (e instanceof NumberLiteral) return integerLiteral(((NumberLiteral) e).getToken(), false);
    if (e instanceof ParenthesizedExpression) return exact(((ParenthesizedExpression) e).getExpression());
    if (e instanceof PrefixExpression) {
      PrefixExpression prefix = (PrefixExpression) e;
      PrefixExpression.Operator op = prefix.getOperator();
      if (op != PrefixExpression.Operator.MINUS && op != PrefixExpression.Operator.PLUS) return null;
      // -2147483648 is an int: the literal under the minus is not checked on its own.
      Exact operand = prefix.getOperand() instanceof NumberLiteral
          ? integerLiteral(((NumberLiteral) prefix.getOperand()).getToken(), op == PrefixExpression.Operator.MINUS)
          : exact(prefix.getOperand());
      if (operand == null) return null;
      return op == PrefixExpression.Operator.MINUS && !(prefix.getOperand() instanceof NumberLiteral)
          ? new Exact(operand.value.negate(), operand.isLong) : operand;
    }
    if (e instanceof InfixExpression) {
      InfixExpression infix = (InfixExpression) e;
      InfixExpression.Operator op = infix.getOperator();
      if (op != InfixExpression.Operator.PLUS && op != InfixExpression.Operator.MINUS
          && op != InfixExpression.Operator.TIMES && op != InfixExpression.Operator.DIVIDE) return null;
      // Every operand is evaluated (and checked) first, so an int sub-expression beside a floating
      // operand still counts (1.5 * 2 * (100000 * 100000)). Then the chain is folded left to right
      // as Java evaluates it: the int steps before the first floating operand wrap in Java and are
      // checked (100000 * 100000 * 1.5); from that operand on, Java computes in double, and the
      // result is not an exact integer (null).
      List<Exact> values = new ArrayList<>();
      values.add(exact(infix.getLeftOperand()));
      values.add(exact(infix.getRightOperand()));
      for (Object o : infix.extendedOperands()) values.add(exact((Expression) o));
      Exact acc = values.get(0);
      if (acc == null) return null;
      for (int i = 1; i < values.size(); i++) {
        Exact next = values.get(i);
        if (next == null) return null;
        boolean isLong = acc.isLong || next.isLong;
        BigInteger value;
        if (op == InfixExpression.Operator.PLUS) value = acc.value.add(next.value);
        else if (op == InfixExpression.Operator.MINUS) value = acc.value.subtract(next.value);
        else if (op == InfixExpression.Operator.TIMES) value = acc.value.multiply(next.value);
        else if (next.value.signum() == 0) return null;
        else value = acc.value.divide(next.value); // truncates toward zero, as Java does
        // Each step of a left-associative chain has its own type (1000 * 1000 * 1000 * 1000L).
        checkInt(value, !isLong);
        acc = new Exact(value, isLong);
      }
      return acc;
    }
    return null;
  }

  private static void checkInt(BigInteger value, boolean isInt) {
    if (isInt && (value.compareTo(INT_MIN) < 0 || value.compareTo(INT_MAX) > 0)) throw new Overflow();
  }

  /** An integer literal's exact value (negated when {@code negate}); null for floating-point literals. */
  private static Exact integerLiteral(String token, boolean negate) {
    String text = token.replace("_", "").toLowerCase(Locale.ROOT);
    boolean isLong = text.endsWith("l");
    if (isLong) text = text.substring(0, text.length() - 1);
    BigInteger value;
    try {
      if (text.startsWith("0x")) {
        if (text.contains("p") || text.contains(".")) return null;
        value = new BigInteger(text.substring(2), 16);
      } else if (text.startsWith("0b")) {
        value = new BigInteger(text.substring(2), 2);
      } else if (text.contains(".") || text.contains("e") || text.endsWith("f") || text.endsWith("d")) {
        return null;
      } else if (text.length() > 1 && text.startsWith("0")) {
        value = new BigInteger(text.substring(1), 8);
      } else {
        value = new BigInteger(text, 10);
      }
    } catch (NumberFormatException e) {
      return null;
    }
    return new Exact(negate ? value.negate() : value, isLong);
  }
}
