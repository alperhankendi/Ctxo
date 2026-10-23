import {
  ALIAS_END_WORDS,
  FROM_LIST_END_WORDS,
  NOT_DML_AFTER,
  RESERVED_WORDS,
  STATEMENT_START_WORDS,
  TABLE_HINTS,
  isForeignKeyAction,
  keywordOf,
} from './keywords.js';
import { canonicalFromParts, canonicalSqlName, foldAsciiLower } from './names.js';
import { tokenizeSql } from './tokenizer.js';
import type { SqlAccess, SqlAccessKind, SqlTextKind, SqlToken } from './types.js';

/** Orders by UTF-16 code unit, like the CLI's compareCodepoint and C#'s StringComparer.Ordinal. */
export function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Collects accesses; `toArray` gives them unique and sorted by kind, then name. */
export class AccessSink {
  private readonly keys = new Set<string>();

  add(kind: SqlAccessKind, name: string): void {
    this.keys.add(`${kind}\u0000${name}`);
  }

  addAll(other: AccessSink): void {
    for (const key of other.keys) this.keys.add(key);
  }

  toArray(): SqlAccess[] {
    return [...this.keys].sort(compareCodepoint).map((key) => {
      const cut = key.indexOf('\u0000');
      return { kind: key.slice(0, cut) as SqlAccessKind, name: key.slice(cut + 1) };
    });
  }
}

/** [from, to) token ranges of the batches between GO separators. */
export function batchRanges(tokens: readonly SqlToken[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.kind !== 'batch') continue;
    if (i > from) ranges.push([from, i]);
    from = i + 1;
  }
  if (tokens.length > from) ranges.push([from, tokens.length]);
  return ranges;
}

function isPunct(token: SqlToken | undefined, value: string): boolean {
  return token !== undefined && token.kind === 'punct' && token.value === value;
}

/**
 * Reads a dot-separated name starting at `i` (stopping before `end`). The first part must be a
 * quoted identifier or an unreserved word; `a..b` gives an empty middle part.
 */
export function readMultipartName(
  tokens: readonly SqlToken[],
  i: number,
  end: number,
): { parts: string[]; next: number } | undefined {
  const first = i < end ? tokens[i] : undefined;
  if (first === undefined) return undefined;
  if (first.kind !== 'quoted' && (first.kind !== 'word' || RESERVED_WORDS.has(keywordOf(first)))) return undefined;
  const parts = [first.value];
  let j = i + 1;
  while (j < end && isPunct(tokens[j], '.')) {
    const part = j + 1 < end ? tokens[j + 1] : undefined;
    if (part !== undefined && (part.kind === 'word' || part.kind === 'quoted')) {
      parts.push(part.value);
      j += 2;
    } else {
      parts.push('');
      j += 1;
    }
  }
  return { parts, next: j };
}

/** One statement's alias map and its one-part UPDATE or DELETE targets, resolved when it ends. */
interface Statement {
  readonly merge: boolean;
  readonly pending: string[];
  readonly aliases: Map<string, string | undefined>;
}

/** A parenthesis level (the root frame is the statement level of the scanned range). */
interface Frame {
  /** FROM opens a table clause here: the root, a subquery that starts with SELECT, a derived table. */
  readonly queryLike: boolean;
  /** Inside a FROM clause, where a comma starts another table source. */
  fromActive: boolean;
  /** A parenthesized join: its aliases belong to the enclosing statement. */
  forwardAliases: boolean;
  stmt: Statement | undefined;
  /** Runs at the closing parenthesis with the index after it; returns where scanning resumes. */
  onClose: ((next: number) => number) | undefined;
}

function newStatement(merge: boolean): Statement {
  return { merge, pending: [], aliases: new Map() };
}

/** Applies the SQL extraction rules to tokens [start, end) of one batch or one definition body. */
class AccessScanner {
  private readonly frames: Frame[] = [];
  private readonly ctes = new Set<string>();

  constructor(
    private readonly tokens: readonly SqlToken[],
    private readonly start: number,
    private readonly end: number,
    private readonly sink: AccessSink,
  ) {
    this.frames.push(this.frame(true));
  }

  run(): void {
    let i = this.start;
    while (i < this.end) {
      const next = this.step(i);
      i = next > i ? next : i + 1;
    }
    this.endStatement();
  }

  private frame(queryLike: boolean): Frame {
    return { queryLike, fromActive: false, forwardAliases: false, stmt: undefined, onClose: undefined };
  }

  private tok(i: number): SqlToken | undefined {
    return i >= this.start && i < this.end ? this.tokens[i] : undefined;
  }

  private kw(i: number): string {
    return keywordOf(this.tok(i));
  }

  private isPunctAt(i: number, value: string): boolean {
    return isPunct(this.tok(i), value);
  }

  private top(): Frame {
    return this.frames[this.frames.length - 1]!;
  }

  private step(i: number): number {
    const t = this.tokens[i]!;
    if (t.kind === 'punct') return this.punct(i, t.value);
    if (t.kind !== 'word') return i + 1;
    const w = keywordOf(t);
    switch (w) {
      case 'FROM':
        return this.fromClause(i);
      case 'JOIN':
      case 'APPLY':
        return this.tableSource(i + 1);
      case 'USING':
        return this.top().stmt?.merge === true ? this.tableSource(i + 1) : i + 1;
      case 'INSERT':
      case 'UPDATE':
      case 'DELETE':
        return this.isDml(i, w) ? this.dml(i, w) : i + 1;
      case 'MERGE':
        return this.kw(i + 1) === 'JOIN' || this.kw(i + 1) === 'UNION' ? i + 1 : this.dml(i, w);
      case 'TRUNCATE':
        this.beginStatement(undefined);
        return this.kw(i + 1) === 'TABLE' ? this.target(i + 2, undefined, false) : i + 1;
      case 'INTO':
        // SELECT ... INTO and OUTPUT ... INTO (INSERT INTO and MERGE INTO are consumed by dml).
        return this.target(i + 1, undefined, false);
      case 'EXEC':
      case 'EXECUTE':
        return this.procedureCall(i);
      case 'WITH':
        return this.withClause(i);
      case 'FETCH':
        return this.fetch(i);
    }
    if (STATEMENT_START_WORDS.has(w)) this.beginStatement(undefined);
    else if (FROM_LIST_END_WORDS.has(w)) this.top().fromActive = false;
    return i + 1;
  }

  private punct(i: number, value: string): number {
    switch (value) {
      case '(':
        this.openFrame(i, false);
        return i + 1;
      case ')':
        return this.closeFrame(i);
      case ';':
        this.endStatement();
        return i + 1;
      case ',':
        return this.top().fromActive ? this.tableSource(i + 1) : i + 1;
      default:
        return i + 1;
    }
  }

  private openFrame(i: number, tableSource: boolean): Frame {
    const frame = this.frame(tableSource || this.kw(i + 1) === 'SELECT');
    this.frames.push(frame);
    return frame;
  }

  private closeFrame(i: number): number {
    if (this.frames.length === 1) return i + 1; // an unbalanced ')'
    const frame = this.frames.pop()!;
    this.closeStatement(frame);
    return frame.onClose !== undefined ? frame.onClose(i + 1) : i + 1;
  }

  /** A `;` or the end of the range: every open statement ends, and so does the CTE scope. */
  private endStatement(): void {
    while (this.frames.length > 1) this.closeStatement(this.frames.pop()!);
    const root = this.top();
    this.closeStatement(root);
    root.fromActive = false;
    this.ctes.clear();
  }

  private beginStatement(stmt: Statement | undefined): void {
    const frame = this.top();
    this.closeStatement(frame);
    frame.fromActive = false;
    frame.stmt = stmt;
  }

  private closeStatement(frame: Frame): void {
    const stmt = frame.stmt;
    if (stmt === undefined) return;
    frame.stmt = undefined;
    for (const raw of stmt.pending) {
      const key = foldAsciiLower(raw);
      const name = stmt.aliases.has(key) ? stmt.aliases.get(key) : canonicalFromParts([raw]);
      if (name !== undefined) this.sink.add('writes', name);
    }
  }

  private resolve(parts: readonly string[]): string | undefined {
    if (parts.length === 1 && this.ctes.has(foldAsciiLower(parts[0]!))) return undefined;
    return canonicalFromParts(parts);
  }

  private isNameStart(i: number): boolean {
    const t = this.tok(i);
    return t !== undefined && (t.kind === 'quoted' || (t.kind === 'word' && !RESERVED_WORDS.has(keywordOf(t))));
  }

  private fromClause(i: number): number {
    const frame = this.top();
    if (!frame.queryLike) return i + 1; // FROM inside TRIM(...) and other non-query parentheses
    frame.fromActive = true;
    return this.tableSource(i + 1);
  }

  /** A table source after FROM, JOIN, APPLY, USING or a FROM-list comma. */
  private tableSource(start: number): number {
    let i = start;
    // ( table [alias] JOIN ... ) and (( ... ) JOIN ... ): parenthesized joins, nested to any depth.
    // A loop, not recursion, so a deep nest cannot overflow the stack.
    while (this.isPunctAt(i, '(') && (this.isNameStart(i + 1) || this.isPunctAt(i + 1, '('))) {
      const frame = this.openFrame(i, true);
      frame.forwardAliases = true;
      frame.fromActive = true;
      i++;
    }
    const t = this.tok(i);
    if (t === undefined) return i;
    if (isPunct(t, '(')) {
      this.openFrame(i, true).onClose = (next) => this.alias(next, undefined); // a derived table
      return i + 1;
    }
    if (t.kind === 'variable') return this.alias(i + 1, undefined); // a table variable
    const name = readMultipartName(this.tokens, i, this.end);
    if (name === undefined) return i;
    const table = this.resolve(name.parts);
    const next = name.next;
    if (this.isPunctAt(next, '(')) {
      const hints = TABLE_HINTS.has(this.kw(next + 1)); // legacy hints: dbo.Members (NOLOCK)
      if (hints && table !== undefined) this.sink.add('reads', table);
      // A table-valued function gives no read. Either way the parenthesis is scanned like other text.
      this.openFrame(next, false).onClose = (after) => this.alias(after, hints ? table : undefined);
      return next + 1;
    }
    if (table !== undefined) this.sink.add('reads', table);
    return this.alias(next, table);
  }

  /** An optional `[AS] alias` at `j`, mapped to `table` in the enclosing statement. */
  private alias(j: number, table: string | undefined): number {
    const t = this.tok(j);
    if (t === undefined) return j;
    let alias: SqlToken | undefined;
    let next = j;
    if (keywordOf(t) === 'AS') {
      const a = this.tok(j + 1);
      next = j + 1;
      if (a !== undefined && (a.kind === 'word' || a.kind === 'quoted' || a.kind === 'string')) {
        alias = a;
        next = j + 2;
      }
    } else if (t.kind === 'quoted' || (t.kind === 'word' && !ALIAS_END_WORDS.has(keywordOf(t)))) {
      alias = t;
      next = j + 1;
    }
    if (alias !== undefined) {
      let k = this.frames.length - 1;
      while (k > 0 && this.frames[k]!.forwardAliases) k--;
      const frame = this.frames[k]!;
      frame.stmt ??= newStatement(false);
      frame.stmt.aliases.set(foldAsciiLower(alias.value), table);
    }
    return next;
  }

  private isDml(i: number, w: string): boolean {
    const before = this.kw(i - 1);
    if (NOT_DML_AFTER.has(before) || isForeignKeyAction(before, w, this.kw(i + 1))) return false;
    if (this.isPunctAt(i + 1, '(')) return false;
    return !(w === 'UPDATE' && this.kw(i + 1) === 'STATISTICS');
  }

  /** INSERT, UPDATE, DELETE and MERGE: optional TOP (n), INTO or FROM, then the target. */
  private dml(i: number, w: string): number {
    const stmt = newStatement(w === 'MERGE');
    this.beginStatement(stmt);
    const afterTop = (at: number): number => {
      let j = at;
      if (this.kw(j) === 'PERCENT') j++;
      if ((w === 'INSERT' || w === 'MERGE') && this.kw(j) === 'INTO') j++;
      else if (w === 'DELETE' && this.kw(j) === 'FROM') j++;
      return this.target(j, w === 'UPDATE' || w === 'DELETE' ? stmt : undefined, w === 'MERGE');
    };
    const j = i + 1;
    if (this.kw(j) !== 'TOP') return afterTop(j);
    if (this.isPunctAt(j + 1, '(')) {
      // TOP (expression): scanned like other text, then the target follows the parenthesis.
      this.openFrame(j + 1, false).onClose = afterTop;
      return j + 2;
    }
    return afterTop(j + 2);
  }

  /**
   * A write target at `j`. With `stmt`, a one-part name waits for the statement's FROM aliases
   * (UPDATE alias ... FROM table alias).
   */
  private target(j: number, stmt: Statement | undefined, withAlias: boolean): number {
    const t = this.tok(j);
    if (t === undefined) return j;
    if (t.kind === 'variable') return withAlias ? this.alias(j + 1, undefined) : j + 1;
    const name = readMultipartName(this.tokens, j, this.end);
    if (name === undefined) return j;
    let table: string | undefined;
    if (stmt !== undefined && name.parts.length === 1) {
      if (!this.ctes.has(foldAsciiLower(name.parts[0]!))) stmt.pending.push(name.parts[0]!);
    } else {
      table = this.resolve(name.parts);
      if (table !== undefined) this.sink.add('writes', table);
    }
    return withAlias ? this.alias(name.next, table) : name.next;
  }

  /** EXEC [@var =] name; EXEC (...), EXEC @var and EXECUTE AS are skipped. */
  private procedureCall(i: number): number {
    this.beginStatement(undefined);
    let j = i + 1;
    if (this.kw(j) === 'AS') return j + 1;
    if (this.tok(j)?.kind === 'variable') {
      if (!this.isPunctAt(j + 1, '=')) return j + 1;
      j += 2;
    }
    const name = readMultipartName(this.tokens, j, this.end);
    if (name === undefined) return j;
    const proc = canonicalFromParts(name.parts);
    if (proc !== undefined) this.sink.add('executes', proc);
    return name.next;
  }

  /** WITH name [(columns)] AS ( starts a CTE list; any other WITH (hints, options) is skipped. */
  private withClause(i: number): number {
    const head = this.cteHead(i + 1);
    if (head === undefined) return i + 1;
    this.beginStatement(undefined);
    return this.enterCte(head);
  }

  /** `name [(column, ...)] AS (` at `j`; the column list holds names and commas only. */
  private cteHead(j: number): { name: string; open: number } | undefined {
    if (!this.isNameStart(j)) return undefined;
    let k = j + 1;
    if (this.isPunctAt(k, '(')) {
      k++;
      while (this.isNameStart(k) || this.isPunctAt(k, ',')) k++;
      if (!this.isPunctAt(k, ')')) return undefined;
      k++;
    }
    if (this.kw(k) !== 'AS' || !this.isPunctAt(k + 1, '(')) return undefined;
    return { name: this.tokens[j]!.value, open: k + 1 };
  }

  private enterCte(head: { name: string; open: number }): number {
    this.ctes.add(foldAsciiLower(head.name));
    this.openFrame(head.open, false).onClose = (next) => {
      if (!this.isPunctAt(next, ',')) return next;
      const more = this.cteHead(next + 1);
      return more === undefined ? next : this.enterCte(more);
    };
    return head.open + 1;
  }

  /** FETCH [NEXT | PRIOR | FIRST | LAST | ABSOLUTE n | RELATIVE n] [FROM] cursor: no read. */
  private fetch(i: number): number {
    this.beginStatement(undefined);
    let j = i + 1;
    const w = this.kw(j);
    if (w === 'NEXT' || w === 'PRIOR' || w === 'FIRST' || w === 'LAST') j++;
    else if (w === 'ABSOLUTE' || w === 'RELATIVE') j += 2;
    return this.kw(j) === 'FROM' ? j + 1 : j;
  }
}

/** Adds the accesses of tokens [from, to) to `sink`. */
export function scanAccesses(tokens: readonly SqlToken[], from: number, to: number, sink: AccessSink): void {
  new AccessScanner(tokens, from, to, sink).run();
}

/**
 * Reads, writes and executes in SQL text, unique and sorted by kind, then name.
 * `statement` (default): SQL as code sends it, every batch. `procedureName`: one executes
 * access for a valid procedure name, [] otherwise.
 */
export function extractSqlAccesses(text: string, kind: SqlTextKind = 'statement'): SqlAccess[] {
  if (kind === 'procedureName') {
    const name = canonicalSqlName(text);
    return name === undefined ? [] : [{ kind: 'executes', name }];
  }
  const tokens = tokenizeSql(text);
  const sink = new AccessSink();
  for (const [from, to] of batchRanges(tokens)) scanAccesses(tokens, from, to, sink);
  return sink.toArray();
}
