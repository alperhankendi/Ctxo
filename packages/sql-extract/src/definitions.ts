import { AccessSink, batchRanges, compareCodepoint, readMultipartName, scanAccesses } from './accesses.js';
import {
  NOT_COLUMN_WORDS,
  NOT_DML_AFTER,
  RESERVED_WORDS,
  STATEMENT_START_WORDS,
  isForeignKeyAction,
  keywordOf,
} from './keywords.js';
import { canonicalFromParts, foldAsciiLower } from './names.js';
import { tokenizeSql } from './tokenizer.js';
import type { SqlDefinition, SqlFileExtraction, SqlObjectKind, SqlToken } from './types.js';

const KIND_WORDS: ReadonlyMap<string, SqlObjectKind> = new Map([
  ['TABLE', 'table'],
  ['VIEW', 'view'],
  ['PROC', 'procedure'],
  ['PROCEDURE', 'procedure'],
  ['FUNCTION', 'function'],
]);

/** Words that end an ALTER TABLE ... ADD list at paren depth 0 (INSERT, UPDATE and DELETE unless they are FK actions). */
const ALTER_ADD_END_WORDS: ReadonlySet<string> = new Set([
  ...STATEMENT_START_WORDS,
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'EXEC', 'EXECUTE', 'TRUNCATE', 'FETCH',
]);

interface DefinitionStart {
  readonly index: number;
  readonly kind: SqlObjectKind;
  readonly name: string;
  readonly declaredName: string;
  readonly nameEnd: number;
}

interface Draft {
  readonly kind: SqlObjectKind;
  readonly name: string;
  readonly declaredName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly columns: Set<string>;
  readonly accesses: AccessSink;
}

function keywordAt(tokens: readonly SqlToken[], i: number, end: number): string {
  return i < end ? keywordOf(tokens[i]) : '';
}

/** `CREATE [OR ALTER] TABLE | VIEW | PROC | PROCEDURE | FUNCTION name` or `ALTER VIEW | PROC | PROCEDURE | FUNCTION name`. */
function definitionStart(tokens: readonly SqlToken[], i: number, end: number): DefinitionStart | undefined {
  const verb = keywordOf(tokens[i]);
  let j = i + 1;
  if (verb === 'CREATE' && keywordAt(tokens, j, end) === 'OR' && keywordAt(tokens, j + 1, end) === 'ALTER') j += 2;
  const kind = KIND_WORDS.get(keywordAt(tokens, j, end));
  if (kind === undefined || (kind === 'table' && verb === 'ALTER')) return undefined;
  const name = readMultipartName(tokens, j + 1, end);
  if (name === undefined) return undefined;
  const canonical = canonicalFromParts(name.parts);
  if (canonical === undefined) return undefined; // temp tables, 3- and 4-part names, system schemas
  return { index: i, kind, name: canonical, declaredName: name.parts.join('.'), nameEnd: name.next };
}

function columnName(token: SqlToken): string | undefined {
  if (token.kind === 'quoted') return token.value.length > 0 ? foldAsciiLower(token.value) : undefined;
  if (token.kind !== 'word') return undefined;
  const w = keywordOf(token);
  if (RESERVED_WORDS.has(w) || NOT_COLUMN_WORDS.has(w)) return undefined;
  return foldAsciiLower(token.value);
}

/** Column names of the CREATE TABLE element list opened at `open`. */
function tableColumns(tokens: readonly SqlToken[], open: number, end: number): string[] {
  const columns: string[] = [];
  let depth = 0;
  let atElement = false;
  for (let j = open; j < end; j++) {
    const t = tokens[j]!;
    if (t.kind === 'punct') {
      if (t.value === '(') {
        depth++;
        if (depth === 1) {
          atElement = true;
          continue;
        }
      } else if (t.value === ')') {
        depth--;
        if (depth <= 0) break;
      } else if (t.value === ',' && depth === 1) {
        atElement = true;
        continue;
      } else if (t.value === ';') {
        break;
      }
    }
    if (atElement) {
      atElement = false;
      const column = columnName(t);
      if (column !== undefined) columns.push(column);
    }
  }
  return columns;
}

/** `ALTER TABLE name [WITH CHECK | NOCHECK] ADD element, ...` at `i` (the ALTER token). */
function alterTableAdd(
  tokens: readonly SqlToken[],
  i: number,
  end: number,
): { table: string; columns: string[]; next: number } | undefined {
  const name = readMultipartName(tokens, i + 2, end);
  if (name === undefined) return undefined;
  const table = canonicalFromParts(name.parts);
  if (table === undefined) return undefined;
  let j = name.next;
  if (keywordAt(tokens, j, end) === 'WITH' && ['CHECK', 'NOCHECK'].includes(keywordAt(tokens, j + 1, end))) j += 2;
  if (keywordAt(tokens, j, end) !== 'ADD') return undefined;
  const columns: string[] = [];
  let depth = 0;
  let atElement = true;
  for (j++; j < end; j++) {
    const t = tokens[j]!;
    if (t.kind === 'punct') {
      if (t.value === '(') depth++;
      else if (t.value === ')') {
        if (depth === 0) break;
        depth--;
      } else if (t.value === ';') break;
      else if (t.value === ',' && depth === 0) {
        atElement = true;
        continue;
      }
    } else if (depth === 0 && t.kind === 'word') {
      const w = keywordOf(t);
      const before = keywordOf(tokens[j - 1]);
      if (ALTER_ADD_END_WORDS.has(w) && !NOT_DML_AFTER.has(before) && !isForeignKeyAction(before, w, keywordAt(tokens, j + 1, end))) {
        break;
      }
    }
    if (atElement) {
      atElement = false;
      const column = columnName(t);
      if (column !== undefined) columns.push(column);
    }
  }
  return { table, columns, next: j };
}

function newlines(text: string): number {
  let count = 0;
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) count++;
  return count;
}

/**
 * Tables, views, procedures and functions a SQL file defines, in source order. A view, procedure
 * or function body runs to the end of its batch or to the next view, procedure or function
 * definition at paren depth 0 (a missing GO). CREATE TABLE and ALTER TABLE inside a body are body
 * text: no definition, no columns. Accesses come from bodies only.
 */
export function extractSqlDefinitions(source: string): SqlFileExtraction {
  const tokens = tokenizeSql(source);
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  const added = new Map<string, string[]>();

  for (const [from, to] of batchRanges(tokens)) {
    const starts: DefinitionStart[] = [];
    let depth = 0;
    let inBody = false; // after a view, procedure or function start, to the end of the batch
    for (let i = from; i < to; i++) {
      const t = tokens[i]!;
      if (t.kind === 'punct') {
        if (t.value === '(') depth++;
        else if (t.value === ')') depth = Math.max(0, depth - 1);
        else if (t.value === ';') depth = 0;
        continue;
      }
      if (depth !== 0) continue;
      const w = keywordOf(t);
      if (w !== 'CREATE' && w !== 'ALTER') continue;
      const start = definitionStart(tokens, i, to);
      if (start !== undefined && !(inBody && start.kind === 'table')) {
        starts.push(start);
        if (start.kind !== 'table') inBody = true;
        i = start.nameEnd - 1;
      } else if (!inBody && w === 'ALTER' && keywordAt(tokens, i + 1, to) === 'TABLE') {
        const add = alterTableAdd(tokens, i, to);
        if (add !== undefined) {
          added.set(add.table, [...(added.get(add.table) ?? []), ...add.columns]);
          i = add.next - 1;
        }
      }
    }

    starts.forEach((start, k) => {
      const last = (k + 1 < starts.length ? starts[k + 1]!.index : to) - 1;
      const first = tokens[start.index]!;
      const lastToken = tokens[last]!;
      const columns = new Set<string>();
      const accesses = new AccessSink();
      if (start.kind === 'table') {
        if (start.nameEnd <= last && tokens[start.nameEnd]!.kind === 'punct' && tokens[start.nameEnd]!.value === '(') {
          for (const c of tableColumns(tokens, start.nameEnd, last + 1)) columns.add(c);
        }
      } else {
        scanAccesses(tokens, start.nameEnd, last + 1, accesses);
      }
      const key = `${start.kind}\u0000${start.name}`;
      const existing = byKey.get(key);
      if (existing !== undefined) {
        for (const c of columns) existing.columns.add(c);
        existing.accesses.addAll(accesses);
        return;
      }
      const draft: Draft = {
        kind: start.kind,
        name: start.name,
        declaredName: start.declaredName,
        startLine: first.line,
        endLine: lastToken.line + newlines(lastToken.text),
        startOffset: first.start,
        endOffset: lastToken.end,
        columns,
        accesses,
      };
      byKey.set(key, draft);
      drafts.push(draft);
    });
  }

  const definitions: SqlDefinition[] = drafts.map((d) => {
    if (d.kind === 'table') for (const c of added.get(d.name) ?? []) d.columns.add(c);
    return {
      kind: d.kind,
      name: d.name,
      declaredName: d.declaredName,
      startLine: d.startLine,
      endLine: d.endLine,
      startOffset: d.startOffset,
      endOffset: d.endOffset,
      columns: d.kind === 'table' ? [...d.columns].sort(compareCodepoint) : [],
      accesses: d.kind === 'table' ? [] : d.accesses.toArray(),
    };
  });
  return { definitions };
}
