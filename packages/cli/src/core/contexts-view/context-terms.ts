import { compareCodepoint } from '../compare-codepoint.js';
import { isDataResourceKind } from '../data-coupling/data-kinds.js';
import { SymbolTokenizer } from '../search/symbol-tokenizer.js';
import type { SymbolNode } from '../types.js';

export interface ContextTerm {
  readonly term: string;
  readonly files: number;
}

export interface TermOccurrence {
  readonly candidate: number;
  readonly file: string;
  readonly symbolId: string;
  readonly members: readonly string[];
}

export interface TermCollision {
  readonly name: string;
  readonly minJaccard: number;
  readonly occurrences: readonly TermOccurrence[];
}

export interface TermSource {
  readonly id: number;
  readonly files: readonly string[];
}

const DEFAULT_TERM_LIMIT = 10;
const COLLISION_JACCARD_THRESHOLD = 0.5;

function isTypeSymbol(symbol: SymbolNode): boolean {
  return symbol.kind === 'class' || symbol.kind === 'interface' || symbol.kind === 'type';
}

/** C# names are namespace-qualified and SQL names schema-qualified, so the short name is the last `.` segment. */
function shortName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(dot + 1);
}

/**
 * The comparison form of a type, table or member name in collisions: ASCII A-Z lowercased (no locale or
 * Unicode folding, as lang-sql folds column names) and `_` removed, so `LoanItems` meets `loan_items`.
 */
export function normalizeTermName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)).replace(/_/g, '');
}

/** The `columns` annotation of a table symbol (lang-sql), sorted and unique; [] without one. */
function columnNames(symbol: SymbolNode): string[] {
  const columns = new Set<string>();
  for (const annotation of symbol.annotations ?? []) {
    if (annotation.name !== 'columns') continue;
    for (const column of annotation.args ?? []) if (column.length > 0) columns.add(column);
  }
  return [...columns].sort(compareCodepoint);
}

/** Names of the symbols one level below `typeName` in the same file (`<typeName>.<member>`). */
function memberNames(typeName: string, symbols: readonly SymbolNode[]): string[] {
  const prefix = `${typeName}.`;
  const members = new Set<string>();
  for (const symbol of symbols) {
    if (!symbol.name.startsWith(prefix)) continue;
    const rest = symbol.name.slice(prefix.length);
    if (rest.includes('.')) continue;
    // The C# tree-sitter fallback suffixes methods with their arity, `Borrow(2)`; overloads collapse.
    const member = rest.replace(/\(\d+\)$/, '');
    if (member.length > 0) members.add(member);
  }
  return [...members].sort(compareCodepoint);
}

/** Enum members: `variable` symbols named `<type>.<member>` directly under a `type` symbol. */
function enumMemberNames(typeName: string, symbols: readonly SymbolNode[]): string[] {
  const prefix = `${typeName}.`;
  const members: string[] = [];
  for (const symbol of symbols) {
    if (symbol.kind !== 'variable' || !symbol.name.startsWith(prefix)) continue;
    const rest = symbol.name.slice(prefix.length);
    if (rest.length > 0 && !rest.includes('.')) members.push(rest);
  }
  return members;
}

/**
 * Top type-name terms of a candidate (spec 7.3, Designer call 8): type names, enum members, and the short
 * names and columns of tables and views, tokenized with SymbolTokenizer, minus stop words, technical words
 * and tokens shorter than 2 characters or all digits, ranked by number of files, ties by code point order.
 */
export function harvestTopTerms(
  files: readonly string[],
  symbolsByFile: ReadonlyMap<string, readonly SymbolNode[]>,
  technicalTerms: readonly string[],
  limit: number = DEFAULT_TERM_LIMIT,
): ContextTerm[] {
  const technical = new Set(technicalTerms.map((term) => term.toLowerCase()));
  const fileCounts = new Map<string, number>();

  for (const file of new Set(files)) {
    const symbols = symbolsByFile.get(file) ?? [];
    const names: string[] = [];
    for (const symbol of symbols) {
      if (isDataResourceKind(symbol.kind)) {
        names.push(shortName(symbol.name), ...columnNames(symbol));
        continue;
      }
      if (!isTypeSymbol(symbol)) continue;
      names.push(shortName(symbol.name));
      if (symbol.kind === 'type') names.push(...enumMemberNames(symbol.name, symbols));
    }

    const terms = new Set<string>();
    for (const name of names) {
      for (const raw of SymbolTokenizer.splitName(name)) {
        const token = raw.toLowerCase();
        if (token.length < 2 || /^\d+$/.test(token)) continue;
        if (SymbolTokenizer.isStopWord(token) || technical.has(token)) continue;
        terms.add(token);
      }
    }
    for (const term of terms) fileCounts.set(term, (fileCounts.get(term) ?? 0) + 1);
  }

  return [...fileCounts.entries()]
    .map(([term, count]) => ({ term, files: count }))
    .sort((a, b) => b.files - a.files || compareCodepoint(a.term, b.term))
    .slice(0, limit);
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  let intersection = 0;
  for (const item of new Set(b)) if (left.has(item)) intersection++;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

/**
 * Type and table names that appear in two or more candidates with member sets whose Jaccard similarity is
 * below 0.5 for at least one pair of occurrences in different candidates. A table's members are its
 * columns; views take no part. Names and members compare in `normalizeTermName` form (ASCII case and `_`
 * ignored): the collision is named by that form, and the occurrences keep the original member spellings.
 * `similarity` is Jaccard over the normalized members; a test can pass its own to count the comparisons.
 */
export function findTermCollisions(
  candidates: readonly TermSource[],
  symbolsByFile: ReadonlyMap<string, readonly SymbolNode[]>,
  similarity: (a: readonly string[], b: readonly string[]) => number = jaccard,
): TermCollision[] {
  const byName = new Map<string, Array<{ readonly occurrence: TermOccurrence; readonly normalized: string[] }>>();

  for (const candidate of candidates) {
    for (const file of new Set(candidate.files)) {
      const symbols = symbolsByFile.get(file) ?? [];
      for (const symbol of symbols) {
        const isTable = symbol.kind === 'table';
        if (!isTable && !isTypeSymbol(symbol)) continue;
        const key = normalizeTermName(shortName(symbol.name));
        // Arity stripping (in memberNames) applies to class members only; columns are taken as they are.
        const members = isTable ? columnNames(symbol) : memberNames(symbol.name, symbols);
        const entry = {
          occurrence: { candidate: candidate.id, file, symbolId: symbol.symbolId, members },
          normalized: members.map(normalizeTermName),
        };
        const list = byName.get(key);
        if (list) list.push(entry);
        else byName.set(key, [entry]);
      }
    }
  }

  const collisions: TermCollision[] = [];
  for (const [name, entries] of byName) {
    let min = Infinity;
    // Jaccard is never below 0, so once a pair reaches it no later pair can lower the minimum.
    for (let i = 0; i < entries.length && min > 0; i++) {
      for (let j = i + 1; j < entries.length && min > 0; j++) {
        const a = entries[i]!;
        const b = entries[j]!;
        if (a.occurrence.candidate === b.occurrence.candidate) continue;
        min = Math.min(min, similarity(a.normalized, b.normalized));
      }
    }
    if (min === Infinity || min >= COLLISION_JACCARD_THRESHOLD) continue;
    collisions.push({
      name,
      minJaccard: Math.round(min * 1000) / 1000,
      occurrences: entries
        .map((entry) => entry.occurrence)
        .sort((a, b) => a.candidate - b.candidate || compareCodepoint(a.symbolId, b.symbolId)),
    });
  }

  return collisions.sort((a, b) => compareCodepoint(a.name, b.name));
}
