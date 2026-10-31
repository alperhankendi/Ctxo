// Domain copy of packages/lang-csharp/src/facts/fact-rules.ts (PR 4 Part 2, issue #156), used by the text-scan
// fallback. It differs from the master only in this header and in importing types from @ctxo/cli/internal;
// packages/cli/tests/e2e/facts-shared-copies.test.ts checks that it does not drift.
import type { LiteralKind, StringLiteralDecoder, TrivialLiteral } from './fact-types.js';

/** Name fragments of `retry-timeout` bindings, matched on identifier-token boundaries (FC-5). */
export const RETRY_TIMEOUT_FRAGMENTS: readonly string[] = ['retry', 'retries', 'attempt', 'timeout', 'delay', 'backoff', 'ttl', 'expir'];

/** Longest fact text, in Unicode code points (FC-2). */
export const MAX_FACT_TEXT = 200;

/** Most facts kept per file (FC-10). */
export const MAX_FACTS_PER_FILE = 500;

/** At most 200 code points (never inside a surrogate pair), trimmed at the end after a cut; shorter values are unchanged. */
export function capFactValue(value: string): string {
  const points = Array.from(value);
  return points.length <= MAX_FACT_TEXT ? value : points.slice(0, MAX_FACT_TEXT).join('').trimEnd();
}

/** FC-2: whitespace runs become one space, trimmed, cut at 200 code points (never inside a surrogate pair). */
export function normalizeFactText(text: string): string {
  return capFactValue(text.replace(/\s+/g, ' ').trim());
}

// ── FC-7 canonical numbers ──────────────────────────────────────

/** A number token; `integer` is the literal's type (no `.`, no exponent, no floating suffix), not its value. */
type Token = { readonly kind: 'number'; readonly value: number; readonly integer: boolean } | { readonly kind: 'op'; readonly op: string };

/** An evaluated operand: its double and whether its type is integer (every literal in it is an integer literal). */
interface Operand { readonly value: number; readonly integer: boolean }

const NUMBER_LITERAL = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:[uU][lL]|[lL][uU]|[lLuUmMdDfFn])?/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_$.]/;

const LEADING_ZERO_INTEGER = /^0\d+(?:[uU][lL]|[lL][uU]|[lLuUn])?$/;

/** Hex, binary and octal literals are integers; a decimal one is when it has no `.`, no exponent and no `m`, `d` or `f` suffix. */
function isIntegerLiteral(text: string): boolean {
  if (/^0[xXbBoO]/.test(text)) return true;
  return !/[.eE]/.test(text) && !/[mMdDfF]$/.test(text);
}

function readNumber(text: string): number {
  // parseInt stops at the first non-digit, so a suffix after hex, binary or octal digits is ignored
  // (and a hex digit d or f is never taken for a suffix).
  const prefix = text.slice(0, 2).toLowerCase();
  if (prefix === '0x') return parseInt(text.slice(2), 16);
  if (prefix === '0b') return parseInt(text.slice(2), 2);
  if (prefix === '0o') return parseInt(text.slice(2), 8);
  return Number(text.replace(/(?:[uU][lL]|[lL][uU]|[lLuUmMdDfFn])$/, ''));
}

function tokenize(expression: string): Token[] | undefined {
  const source = expression.replace(/_/g, '');
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if ('+-*/()'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      i++;
    } else {
      const match = NUMBER_LITERAL.exec(source.slice(i));
      if (!match) return undefined;
      const end = i + match[0].length;
      if (end < source.length && IDENTIFIER_CHAR.test(source[end]!)) return undefined;
      // A leading-zero integer (017) is octal in Java and Go and decimal in C#: not a constant.
      if (LEADING_ZERO_INTEGER.test(match[0])) return undefined;
      tokens.push({ kind: 'number', value: readNumber(match[0]), integer: isIntegerLiteral(match[0]) });
      i = end;
    }
  }
  return tokens;
}

class Parser {
  private position = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number | undefined {
    const operand = this.expression();
    return operand !== undefined && this.position === this.tokens.length ? operand.value : undefined;
  }

  private peekOp(): string | undefined {
    const token = this.tokens[this.position];
    return token?.kind === 'op' ? token.op : undefined;
  }

  private expression(): Operand | undefined {
    let left = this.term();
    while (left !== undefined && (this.peekOp() === '+' || this.peekOp() === '-')) {
      const op = this.peekOp();
      this.position++;
      const right = this.term();
      if (right === undefined) return undefined;
      left = { value: op === '+' ? left.value + right.value : left.value - right.value, integer: left.integer && right.integer };
    }
    return left;
  }

  private term(): Operand | undefined {
    let left = this.unary();
    while (left !== undefined && (this.peekOp() === '*' || this.peekOp() === '/')) {
      const op = this.peekOp();
      this.position++;
      const right = this.unary();
      if (right === undefined) return undefined;
      const integer = left.integer && right.integer;
      if (op === '*') {
        left = { value: left.value * right.value, integer };
        continue;
      }
      if (right.value === 0) return undefined;
      // Integer division truncates in C#, Java and Go but not in TypeScript: a remainder is not a constant.
      if (integer && left.value % right.value !== 0) return undefined;
      left = { value: left.value / right.value, integer };
    }
    return left;
  }

  private unary(): Operand | undefined {
    const op = this.peekOp();
    if (op === '-' || op === '+') {
      this.position++;
      const operand = this.unary();
      return operand === undefined ? undefined : op === '-' ? { value: -operand.value, integer: operand.integer } : operand;
    }
    return this.primary();
  }

  private primary(): Operand | undefined {
    const token = this.tokens[this.position];
    if (!token) return undefined;
    if (token.kind === 'number') {
      this.position++;
      return { value: token.value, integer: token.integer };
    }
    if (token.op !== '(') return undefined;
    this.position++;
    const operand = this.expression();
    if (operand === undefined || this.peekOp() !== ')') return undefined;
    this.position++;
    return operand;
  }
}

const MAX_EXACT_INTEGER = 2 ** 53;

/**
 * FC-7 evaluation, shared by `canonicalNumber` and the FC-6 number check: the IEEE double of a
 * constant expression, or `undefined` when it is not a constant. Not constants: names, strings,
 * division by zero, a leading-zero integer literal other than `0` (`017`), a division of two
 * integer operands with a non-zero remainder (`7 / 2`; `7.0 / 2` is a float division), non-finite
 * results, results with |v| >= 2^53, and non-zero results that round to 0 at 6 decimals.
 */
function evaluate(expression: string): number | undefined {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return undefined;
  const value = new Parser(tokens).parse();
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) >= MAX_EXACT_INTEGER) return undefined;
  if (value !== 0 && Number(value.toFixed(6)) === 0) return undefined;
  return value;
}

/**
 * An integer prints as plain digits; anything else is the exact binary double rounded to 6
 * decimals as JS `toFixed(6)` does (0.0000015 gives 0.000002, 0.0000005 gives 0; an exact tie such
 * as 0.0078125 rounds half away from zero), trailing zeros removed; `-0` prints `0`. Java copies
 * round with `new BigDecimal(double).setScale(6, RoundingMode.HALF_UP)`; Go copies must not rely on
 * `strconv.FormatFloat` for exact ties, which it rounds to even.
 */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value === 0 ? '0' : String(value);
  const fixed = value.toFixed(6).replace(/\.?0+$/, '');
  return fixed === '-0' ? '0' : fixed;
}

/**
 * FC-7: the canonical text of a numeric constant (`_` and type suffixes removed; decimal, exponent,
 * hex, binary and octal forms; `+ - * /`, parentheses and unary minus in IEEE doubles), or
 * `undefined` when the expression is not a constant (see `evaluate` and `formatNumber`).
 */
export function canonicalNumber(expression: string): string | undefined {
  const value = evaluate(expression);
  return value === undefined ? undefined : formatNumber(value);
}

// ── FC-6 trivial literals ───────────────────────────────────────

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "'": "'", '\\': '\\', n: '\n', t: '\t', r: '\r' };
const PLAIN_STRING = /^"((?:[^"\\]|\\[\s\S])*)"$/;
const PLAIN_CHAR = /^'((?:[^'\\]|\\[\s\S])*)'$/;

/**
 * The body of a plain quoted literal with the common escapes decoded (a backslash before `"`, `'`,
 * a backslash, `n`, `t` or `r`); undefined when it holds any other escape.
 */
export function decodeCommonEscapes(body: string): string | undefined {
  let valid = true;
  const decoded = body.replace(/\\([\s\S])/g, (_, ch: string) => {
    const escaped = ESCAPES[ch];
    if (escaped === undefined) valid = false;
    return escaped ?? '';
  });
  return valid ? decoded : undefined;
}

/**
 * Decoded content of a string or char literal; undefined when it is not a constant. The shared
 * rules decode only a plain `"..."` string (a `'...'` char for kind `char`) with the common
 * escapes; every other form goes to the language's string literal decoder, and without one it is
 * not a string constant.
 */
function stringContent(literal: string, kind: 'string' | 'char', decode: StringLiteralDecoder | undefined): string | undefined {
  const text = literal.trim();
  const plain = (kind === 'char' ? PLAIN_CHAR : PLAIN_STRING).exec(text);
  if (plain) return decodeCommonEscapes(plain[1]!);
  return decode ? decode(text) : undefined;
}

/**
 * FC-6: true when the literal equals an entry of the trivial list of the same type: numbers when
 * the evaluated double (FC-7) equals the list's number exactly, strings and chars by decoded
 * content, `null`/`nil`/`None` with `null`, booleans case-insensitively. Each language supplies its
 * own `decodeStringLiteral` for every string form other than a plain quoted literal; without it
 * such a literal is never trivial.
 */
export function isTrivialLiteral(
  literal: string,
  kind: LiteralKind,
  trivial: readonly TrivialLiteral[],
  decodeStringLiteral?: StringLiteralDecoder,
): boolean {
  switch (kind) {
    case 'number': {
      const value = evaluate(literal);
      return value !== undefined && trivial.some(t => typeof t === 'number' && t === value);
    }
    case 'string':
    case 'char': {
      const content = stringContent(literal, kind, decodeStringLiteral);
      return content !== undefined && trivial.some(t => typeof t === 'string' && t === content);
    }
    case 'null':
      return (literal === 'null' || literal === 'nil' || literal === 'None') && trivial.includes(null);
    case 'boolean': {
      const lower = literal.toLowerCase();
      if (lower !== 'true' && lower !== 'false') return false;
      return trivial.includes(lower === 'true');
    }
    default:
      return false;
  }
}

// ── FC-4 normalization ──────────────────────────────────────────

/**
 * FC-4: `Name` matches exactly, `Name*` by prefix (case-sensitive), and `q.Name[*]` only when the
 * call is written `q.Name(...)` (`qualifier` is the receiver's source).
 */
export function matchesNormalizationPattern(method: string, qualifier: string | undefined, patterns: readonly string[]): boolean {
  return patterns.some(pattern => {
    const dot = pattern.indexOf('.');
    const patternQualifier = dot >= 0 ? pattern.slice(0, dot) : undefined;
    const name = dot >= 0 ? pattern.slice(dot + 1) : pattern;
    if (patternQualifier !== undefined && patternQualifier !== qualifier) return false;
    return name.endsWith('*') ? method.startsWith(name.slice(0, -1)) : method === name;
  });
}

// ── FC-4b normalization that is not a business rule ─────────────

const NAME_TOKEN = /[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|\d+/g;

/** Lower-cased ASCII name tokens (camelCase, PascalCase, digit runs), as FC-5 splits names. */
function nameTokens(name: string): string[] {
  return (name.match(NAME_TOKEN) ?? []).map(t => t.toLowerCase());
}

/**
 * Logger types, as the full tiers report them in `consumerTypes` (qualified, type arguments dropped;
 * Go: the package path, or `<package path>.<type>`; TypeScript: `<package>.<type>` for a type
 * declared in a package or an ambient `declare module`, else the type's name).
 */
const LOGGER_TYPES: ReadonlySet<string> = new Set([
  'Microsoft.Extensions.Logging.ILogger', 'Microsoft.Extensions.Logging.Logger', 'Microsoft.Extensions.Logging.LoggerExtensions',
  'Serilog.ILogger', 'Serilog.Log', 'NLog.Logger', 'NLog.ILogger', 'log4net.ILog',
  'System.Diagnostics.Debug', 'System.Diagnostics.Trace',
  'java.util.logging.Logger', 'org.slf4j.Logger', 'org.apache.logging.log4j.Logger', 'org.apache.log4j.Logger',
  'org.apache.commons.logging.Log',
  'log', 'log.Logger', 'log/slog', 'log/slog.Logger', 'github.com/sirupsen/logrus', 'github.com/sirupsen/logrus.Logger',
  'github.com/sirupsen/logrus.Entry', 'go.uber.org/zap.Logger', 'go.uber.org/zap.SugaredLogger',
  'github.com/rs/zerolog.Logger', 'github.com/rs/zerolog.Event',
  'Console', 'pino.Logger', 'pino.BaseLogger', 'winston.Logger', '@nestjs/common.Logger', '@nestjs/common.LoggerService',
  '@nestjs/common.ConsoleLogger', 'bunyan.Logger', 'log4js.Logger', 'tslog.Logger',
]);

/** Logging methods of those types (and of a receiver named like a logger). */
const LOG_METHODS: ReadonlySet<string> = new Set([
  'Log', 'LogInformation', 'LogWarning', 'LogError', 'LogDebug', 'LogTrace', 'LogCritical',
  'Information', 'Warning', 'Error', 'Debug', 'Verbose', 'Fatal', 'Info', 'Warn', 'Trace', 'Write',
  'InfoFormat', 'WarnFormat', 'ErrorFormat', 'DebugFormat', 'FatalFormat',
  'log', 'info', 'warn', 'warning', 'error', 'debug', 'trace', 'fatal', 'severe', 'fine', 'finer', 'finest',
  'Print', 'Printf', 'Println', 'Fatalf', 'Fatalln', 'Panic', 'Panicf', 'Panicln',
  'Infof', 'Warnf', 'Errorf', 'Debugf', 'Tracef', 'Infow', 'Warnw', 'Errorw', 'Debugw', 'Fatalw',
  'InfoContext', 'WarnContext', 'ErrorContext', 'DebugContext',
  'WriteLine', 'TraceInformation', 'TraceWarning', 'TraceError', 'Msg', 'Msgf', 'verbose', 'silly',
]);

/** Methods a bare `Log` receiver name does not make a sink: a class named `Log` may be a business ledger. */
const BARE_LOG_EXCLUDED: ReadonlySet<string> = new Set(['Write', 'WriteLine', 'Print', 'Printf', 'Println', 'Msg', 'Msgf']);

/** Receivers named like a logger: the syntax tiers (and unresolved receivers) know a logger only by its name. */
const LOGGER_NAMES: ReadonlySet<string> = new Set(['log', 'Log', 'logger', '_logger', 'Logger', 'LOG', 'LOGGER', 'slog', 'console']);

/** Display and formatting APIs by type: text built for people goes through them. */
const DISPLAY_TYPES: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ['System.Text.StringBuilder', new Set(['Append', 'AppendLine', 'AppendFormat', 'Insert'])],
  ['java.lang.StringBuilder', new Set(['append', 'insert'])],
  ['java.lang.StringBuffer', new Set(['append', 'insert'])],
  ['strings.Builder', new Set(['WriteString'])],
  ['System.String', new Set(['Format'])],
  ['java.lang.String', new Set(['format'])],
  ['fmt', new Set(['Sprintf', 'Sprint', 'Sprintln', 'Printf', 'Print', 'Println', 'Fprintf', 'Fprint', 'Fprintln'])],
  ['System.Console', new Set(['Write', 'WriteLine'])],
]);

/** The same APIs by name, for the syntax tiers: a static receiver as written. */
const DISPLAY_RECEIVERS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ['string', new Set(['Format'])],
  ['String', new Set(['Format', 'format'])],
  ['fmt', DISPLAY_TYPES.get('fmt')!],
  ['Console', new Set(['Write', 'WriteLine'])],
]);

/** Builder variables by name, for the syntax tiers: `sb.Append(...)`, `html.AppendLine(...)`. */
const BUILDER_NAMES: ReadonlySet<string> = new Set(['sb', 'builder', 'html', 'buffer', 'buf']);
const BUILDER_METHODS: ReadonlySet<string> = new Set(['Append', 'AppendLine', 'AppendFormat', 'append', 'WriteString']);

/** Repeatedly drops innermost `<...>` groups (type arguments). */
function withoutTypeArguments(text: string): string {
  let out = text;
  for (let previous = ''; previous !== out;) {
    previous = out;
    out = out.replace(/<[^<>]*>/g, '');
  }
  return out;
}

/** A callee as its method, the name before it, or the constructed type of `new T`; type arguments and whitespace dropped. */
function calleeParts(callee: string): { readonly method: string; readonly receiver: string | undefined; readonly construction: string | undefined } {
  const compact = withoutTypeArguments(callee.trim());
  if (/^new\s/.test(compact)) return { method: '', receiver: undefined, construction: compact.slice(4).replace(/\s+/g, '') };
  const segments = compact.replace(/\s+/g, '').split(/[?!]?\./).filter(s => s.length > 0);
  return { method: segments[segments.length - 1] ?? '', receiver: segments[segments.length - 2], construction: undefined };
}

/** A type name as the rules compare it: no `global::`, no type arguments, no Go pointer star. */
function typeKey(type: string): string {
  return withoutTypeArguments(type.trim().replace(/^global::/, '').replace(/^\*+/, ''));
}

/** The simple name of T ends with an `Exception` or `Error` token (`ArgumentException`, `Error`, `TypeError`). */
function isErrorType(type: string): boolean {
  const tokens = nameTokens(type.split('.').pop() ?? '');
  const last = tokens[tokens.length - 1];
  return last === 'exception' || last === 'error';
}

/**
 * FC-4b: true when `callee`, the nearest call that receives a normalization's value, writes text
 * for a log or a crash rather than using a value:
 * - (a) a logging method (`LogInformation`, `Warning`, `info`, `Printf` and the rest of
 *   `LOG_METHODS`) on a known logger type, when the full tier reports the types
 *   (`consumerTypes`: Microsoft.Extensions.Logging, Serilog, NLog, log4net,
 *   `System.Diagnostics.Debug`/`Trace`, java.util.logging, SLF4J, log4j, commons-logging, Go `log`,
 *   `log/slog`, logrus, zap, zerolog, and in TypeScript `Console`, pino, winston, NestJS
 *   `Logger`/`LoggerService`, bunyan, log4js, tslog);
 * - (b) otherwise, with no types or with types that are no known logger, in every tier, the same
 *   method on a receiver named like a logger (`log`, `Log`, `logger`, `_logger`, `Logger`, `LOG`,
 *   `LOGGER`, `slog`, `console`; a bare `Log` not for `Write` or `Print`), so the tiers agree;
 * - (c) an exception or error construction (`new ...Exception`, `new Error`), `errors.New` or
 *   `fmt.Errorf`, by name in every tier.
 * `auth.LogIn`, `tracker.TraceParcel`, `PrintLabel` or `writer.WriteLine` are no sinks.
 */
export function isMessageSink(callee: string, consumerTypes?: readonly string[]): boolean {
  const { method, receiver, construction } = calleeParts(callee);
  if (construction !== undefined) return isErrorType(construction);
  if ((receiver === 'errors' && method === 'New') || (receiver === 'fmt' && method === 'Errorf')) return true;
  if (!LOG_METHODS.has(method)) return false;
  if (consumerTypes !== undefined && consumerTypes.some(type => LOGGER_TYPES.has(typeKey(type)))) return true;
  if (receiver === undefined || !LOGGER_NAMES.has(receiver)) return false;
  return !(receiver === 'Log' && BARE_LOG_EXCLUDED.has(method));
}

/**
 * FC-4b: true when `callee` is a display or formatting API (`StringBuilder.Append*`,
 * `string.Format`, `String.format`, `fmt.Sprintf` and friends, `strings.Builder.WriteString`,
 * `Console.Write*`): by type when the full tier reports `consumerTypes`, else by the static
 * receiver as written, or a builder method on a receiver named `sb`, `builder`, `html`, `buffer`
 * or `buf`. A normalization in prose (`inProse`) that goes to one of them is display text.
 */
export function isDisplayCall(callee: string, consumerTypes?: readonly string[]): boolean {
  const { method, receiver, construction } = calleeParts(callee);
  if (construction !== undefined || receiver === undefined) return false;
  if (consumerTypes !== undefined && consumerTypes.length > 0) {
    return consumerTypes.some(type => DISPLAY_TYPES.get(typeKey(type))?.has(method) === true);
  }
  return DISPLAY_RECEIVERS.get(receiver)?.has(method) === true || (BUILDER_NAMES.has(receiver) && BUILDER_METHODS.has(method));
}

/** Receivers whose calls work on a path or a single character, not on a business value. */
const TECHNICAL_QUALIFIERS: ReadonlySet<string> = new Set([
  'Path', 'System.IO.Path', 'Paths', 'FilenameUtils', 'filepath', 'char', 'Char', 'System.Char', 'Character', 'unicode',
]);

/** Hex and base64 encoders and file-extension readers: their output is a format, not a business value. */
const ENCODED_OR_EXTENSION =
  /(?:\b(?:ToHexString|ToHexStringLower|ToBase64String|EncodeToString|encodeToString|encodeHexString|formatHex|printHexBinary|GetExtension|getExtension|extname)|\b(?:filepath|path)\.Ext|\bBitConverter\.ToString)\s*\(|\.(?:digest|toString)\(\s*['"`](?:hex|base64|base64url)['"`]\s*\)/;

/** Path separator constants a trim may name. */
const SEPARATOR_NAMES: ReadonlySet<string> = new Set([
  'Path.DirectorySeparatorChar', 'Path.AltDirectorySeparatorChar', 'System.IO.Path.DirectorySeparatorChar',
  'System.IO.Path.AltDirectorySeparatorChar', 'File.separator', 'File.separatorChar', 'os.PathSeparator',
  'filepath.Separator', 'string(os.PathSeparator)', 'string(filepath.Separator)', 'path.sep',
]);

const QUOTED = /^(['"`])((?:[^\\]|\\[\s\S])*)\1$/;

/** A path separator argument: a quoted literal of only `/` and `\`, or a separator constant. */
function isSeparatorArgument(argument: string): boolean {
  const text = argument.replace(/\s+/g, '');
  if (SEPARATOR_NAMES.has(text)) return true;
  const quoted = QUOTED.exec(text);
  if (!quoted) return false;
  const body = quoted[2]!.replace(/\\\\/g, '\\');
  return body.length > 0 && /^[/\\]+$/.test(body);
}

/** The top-level arguments of the call that ends the text, or undefined when the text does not end with one. */
function lastCallArguments(text: string): string[] | undefined {
  return lastCall(text)?.args;
}

/** The call that ends the text: the source before its argument list and its top-level arguments. */
function lastCall(text: string): { readonly callee: string; readonly args: string[] } | undefined {
  const source = text.trimEnd();
  if (!source.endsWith(')')) return undefined;
  const opens: number[] = [];
  let open: number | undefined;
  let quote: string | undefined;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quote !== undefined) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      opens.push(i);
    } else if (ch === ')') {
      const start = opens.pop();
      if (i === source.length - 1) open = start;
    }
  }
  if (open === undefined) return undefined;
  const body = source.slice(open + 1, -1);
  const args: string[] = [];
  let depth = 0;
  let from = 0;
  quote = undefined;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote !== undefined) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(body.slice(from, i).trim());
      from = i + 1;
    }
  }
  const last = body.slice(from).trim();
  if (last.length > 0 || args.length > 0) args.push(last);
  return { callee: source.slice(0, open), args };
}

/**
 * FC-4b: true when a normalization call works on a format rather than a business value: a call
 * on a path or character type (`Path.TrimEndingDirectorySeparator`, `char.ToUpperInvariant`,
 * `Character.toUpperCase`, `unicode.ToLower`), the case of hex or base64 output or of a file
 * extension (`Convert.ToHexString(h).ToLowerInvariant()`, `hex.EncodeToString`, `digest('hex')`,
 * `Path.GetExtension(f).ToLower()`, `filepath.Ext`), or a trim of path separators only
 * (`p.TrimEnd('/')`, `strings.TrimSuffix(p, "/")`, `TrimStart(Path.DirectorySeparatorChar)`).
 */
export function isTechnicalNormalization(method: string, qualifier: string | undefined, text: string): boolean {
  if (qualifier !== undefined && TECHNICAL_QUALIFIERS.has(qualifier.replace(/\s+/g, ''))) return true;
  if (ENCODED_OR_EXTENSION.test(text)) return true;
  if (!/^trim/i.test(method)) return false;
  const args = lastCallArguments(text);
  if (!args || args.length === 0) return false;
  if (args.every(isSeparatorArgument)) return true;
  // A package-level trim (`strings.TrimRight(p, "/")`): the subject first, then only separators.
  return args.length > 1 && !QUOTED.test(args[0]!.replace(/\s+/g, '')) && args.slice(1).every(isSeparatorArgument);
}

/**
 * FC-4b: true when the normalization `inner` feeds the normalization call `outer` (named
 * `outerMethod`) directly, as its receiver (`x.Trim()` in `x.Trim().ToLower()`, also `?.`) or as
 * its only argument (`strings.TrimSpace(s)` in `strings.ToLower(strings.TrimSpace(s))`). Both
 * texts are compared without whitespace. A chain is one normalization: only the outermost call is
 * a fact.
 */
export function feedsNormalization(inner: string, outer: string, outerMethod: string): boolean {
  const a = inner.replace(/\s+/g, '');
  return a.length > 0 && normalizationInputs(outer, outerMethod).includes(a);
}

/** Normalization methods that compare their receiver with their argument: the argument is not their input. */
const COMPARISON_METHODS: ReadonlySet<string> = new Set([
  'equalsIgnoreCase', 'EqualFold', 'Equals', 'equals', 'Compare', 'CompareTo', 'compareTo', 'compareToIgnoreCase',
]);

/**
 * FC-4b: the inputs of the normalization call `text` (named `method`), without whitespace: its
 * receiver (`x.Trim()` of `x.Trim().ToLower()`, also after `?.`) and its only argument
 * (`strings.TrimSpace(s)` of `strings.ToLower(strings.TrimSpace(s))`). The argument of a
 * comparison method (`a.equalsIgnoreCase(b.trim())`, `strings.EqualFold`) is another value, not an
 * input. Empty when the text does not end with a call to `method` (a text cut at 200 code points,
 * for example).
 */
export function normalizationInputs(text: string, method: string): string[] {
  const call = lastCall(text.replace(/\s+/g, ''));
  if (!call) return [];
  const inputs: string[] = [];
  for (const access of [`?.${method}`, `.${method}`]) {
    if (call.callee.endsWith(access)) {
      inputs.push(call.callee.slice(0, -access.length));
      break;
    }
  }
  if (call.args.length === 1 && !COMPARISON_METHODS.has(method) && (call.callee === method || call.callee.endsWith(`.${method}`))) inputs.push(call.args[0]!);
  return inputs.filter(input => input.length > 0);
}

// ── FC-5 retry and timeout names ────────────────────────────────

/**
 * FC-5: the name is split into lower-cased ASCII tokens (camelCase, PascalCase, digit runs): only
 * A-Z, a-z and 0-9 form tokens, every other character (`_`, `-`, non-ASCII letters) separates them,
 * with no Unicode case tests and no locale-dependent lowercasing (`ñretry` matches). A fragment
 * matches when the tokens joined from the start of some token begin with it. A deliberate
 * narrowing of spec 12.1's "a name containing": `settlementDays` never matches `ttl`.
 */
export function hasRetryTimeoutFragment(name: string): boolean {
  const tokens = (name.match(NAME_TOKEN) ?? []).map(t => t.toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    const rest = tokens.slice(i).join('');
    if (RETRY_TIMEOUT_FRAGMENTS.some(fragment => rest.startsWith(fragment))) return true;
  }
  return false;
}

// ── FC-8 routes ─────────────────────────────────────────────────

/** FC-8: empty parts dropped, each part's outer `/` trimmed, joined with `/`, repeats collapsed, `/` prefixed. */
export function joinRoute(...parts: readonly (string | undefined)[]): string {
  const segments = parts
    .map(part => (part ?? '').replace(/^\/+|\/+$/g, ''))
    .filter(part => part.length > 0);
  return `/${segments.join('/')}`.replace(/\/{2,}/g, '/');
}
