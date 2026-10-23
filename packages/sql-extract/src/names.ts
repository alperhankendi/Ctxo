import { RESERVED_WORDS, keywordOf } from './keywords.js';
import { tokenizeSql } from './tokenizer.js';

export const SQL_DIALECT = 'tsql' as const;
export const DEFAULT_SQL_SCHEMA = 'dbo' as const;

const SKIPPED_SCHEMAS = new Set(['sys', 'information_schema']);

/** Folds ASCII A-Z to lowercase and keeps every other character (no locale or Unicode folding). */
export function foldAsciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * Canonical `schema.name` from already-unquoted name parts. One part gets the `dbo` schema,
 * two parts are `schema.name`. Three or more parts, empty parts, parts containing `::` or `.`
 * (a delimited `[Loans.Archive]` would otherwise read as more parts), temp tables, table variables and
 * the sys and information_schema schemas give undefined.
 */
export function canonicalFromParts(parts: readonly string[]): string | undefined {
  if (parts.length < 1 || parts.length > 2) return undefined;
  for (const part of parts) {
    if (part.length === 0 || part.includes('::') || part.includes('.')) return undefined;
  }
  const name = parts[parts.length - 1]!;
  if (name.startsWith('#') || name.startsWith('@')) return undefined;
  const schema = parts.length === 2 ? parts[0]! : DEFAULT_SQL_SCHEMA;
  if (SKIPPED_SCHEMAS.has(foldAsciiLower(schema))) return undefined;
  return `${foldAsciiLower(schema)}.${foldAsciiLower(name)}`;
}

/**
 * Tokenizes a multipart name text such as `[dbo].[Loans]`, then canonicalizes it. An unquoted
 * reserved word is not a name part, as in a T-SQL parser: `SELECT` and `dbo.Table` give undefined.
 */
export function canonicalSqlName(text: string): string | undefined {
  const tokens = tokenizeSql(text);
  if (tokens.length === 0 || tokens.length % 2 === 0) return undefined;
  const parts: string[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k]!;
    if (k % 2 === 0) {
      if (tok.kind !== 'word' && tok.kind !== 'quoted') return undefined;
      if (tok.kind === 'word' && RESERVED_WORDS.has(keywordOf(tok))) return undefined;
      parts.push(tok.value);
    } else if (tok.kind !== 'punct' || tok.value !== '.') {
      return undefined;
    }
  }
  return canonicalFromParts(parts);
}
