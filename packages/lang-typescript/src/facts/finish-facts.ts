// Shared fact finisher (PR 4, issue #156, Fact contract FC-1 to FC-10). Copied unchanged into every
// official language plugin; only import paths may differ.
import type { CodeFact, FactKind, SymbolNode } from '@ctxo/plugin-api';
import { FACT_KIND_ORDER } from './fact-types.js';
import type { FactEvidence, FactOptions, StringLiteralDecoder } from './fact-types.js';
import {
  MAX_FACTS_PER_FILE,
  canonicalNumber,
  capFactValue,
  hasRetryTimeoutFragment,
  isDisplayCall,
  isMessageSink,
  isTechnicalNormalization,
  isTrivialLiteral,
  joinRoute,
  matchesNormalizationPattern,
  normalizationInputs,
  normalizeFactText,
} from './fact-rules.js';

/** FC-9: `<file>::<basename without its last extension>::variable`, the owner of code outside every declaration. */
export function moduleSymbolId(file: string): string {
  const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return `${file}::${dot > 0 ? base.slice(0, dot) : base}::variable`;
}

interface DraftFact {
  readonly kind: FactKind;
  readonly symbolId?: string;
  readonly line: number;
  readonly text: string;
  readonly detail: Readonly<Record<string, string>>;
  /**
   * FC-4b: a normalization whose value goes into a message or display text. It is no fact, but it
   * still folds the normalizations that feed it, so `fmt.Errorf("%s", strings.ToLower(strings.TrimSpace(s)))`
   * gives no fact for the inner call either.
   */
  readonly silent?: boolean;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An unbound duration is named by the constructor's last two `.` segments; `setTimeout` is always `setTimeout`. */
function durationName(name: string | undefined, constructor: string): string {
  const segments = constructor.split('.');
  if (segments[segments.length - 1] === 'setTimeout') return 'setTimeout';
  return name ?? segments.slice(-2).join('.');
}

/** The analyzer's `consumerTypes` when it is a list of strings; anything else counts as no types. */
function consumerTypesOf(evidence: Extract<FactEvidence, { kind: 'call' }>): readonly string[] | undefined {
  const types: unknown = evidence.consumerTypes;
  return Array.isArray(types) && types.every(type => typeof type === 'string') ? types as string[] : undefined;
}

/**
 * FC-4b: the nearest call that receives the value (`consumer`) is a message sink, or a display or
 * formatting API that receives it inside prose (`inProse`). Evidence fields of the wrong type
 * (a malformed analyzer record) count as absent.
 */
function isMessageOrDisplay(evidence: Extract<FactEvidence, { kind: 'call' }>): boolean {
  const consumer: unknown = evidence.consumer;
  if (typeof consumer !== 'string') return false;
  const types = consumerTypesOf(evidence);
  return isMessageSink(consumer, types) || (evidence.inProse === true && isDisplayCall(consumer, types));
}

function draft(evidence: FactEvidence, options: FactOptions, decodeStringLiteral: StringLiteralDecoder | undefined): DraftFact | undefined {
  const base = { ...(evidence.symbolId !== undefined ? { symbolId: evidence.symbolId } : {}), line: evidence.line };
  switch (evidence.kind) {
    case 'comparison':
      if (isTrivialLiteral(evidence.literal, evidence.literalKind, options.trivialLiterals, decodeStringLiteral)) return undefined;
      // CRLF and CR become LF before the cap, so the committed index does not depend on a checkout's line endings.
      return { ...base, kind: 'literal-comparison', text: evidence.text, detail: { operator: evidence.operator, literal: capFactValue(evidence.literal.replace(/\r\n?/g, '\n')) } };
    case 'call':
      if (!matchesNormalizationPattern(evidence.method, evidence.qualifier, options.normalizationMethods)) return undefined;
      // FC-4b: a log or crash message, display text, or a format rather than a business value.
      if (isTechnicalNormalization(evidence.method, evidence.qualifier, evidence.text)) return undefined;
      return {
        ...base,
        kind: 'normalization',
        text: evidence.text,
        detail: { method: evidence.method },
        ...(isMessageOrDisplay(evidence) ? { silent: true } : {}),
      };
    case 'binding': {
      if (!hasRetryTimeoutFragment(evidence.name)) return undefined;
      const value = canonicalNumber(evidence.value);
      if (value === undefined) return undefined;
      return { ...base, kind: 'retry-timeout', text: `${evidence.name} = ${value}`, detail: { name: evidence.name, value } };
    }
    case 'duration': {
      const amount = canonicalNumber(evidence.amount);
      if (amount === undefined) return undefined;
      const name = durationName(evidence.name, evidence.constructor);
      const value = `${amount}${evidence.unit}`;
      return { ...base, kind: 'retry-timeout', text: `${name} = ${value}`, detail: { name, value } };
    }
    case 'route': {
      const verb = evidence.verb.toUpperCase();
      const route = joinRoute(evidence.route);
      return { ...base, kind: 'endpoint', text: `${verb} ${route}`, detail: { verb, route } };
    }
    default:
      return undefined;
  }
}

/**
 * FC-4b: a normalization that feeds another normalization fact of the same symbol (the receiver or
 * only argument of the outer call, starting on a line the outer call spans) is dropped, so a chain
 * is one fact, the outermost; a chain split over lines (`strings.ToLower(\n strings.TrimSpace(s))`)
 * folds too.
 */
function outermostNormalizations(drafts: readonly DraftFact[]): DraftFact[] {
  // Keyed by symbol and input text, so a long chain costs one pass, not a pair test per two calls.
  const key = (symbolId: string | undefined, input: string): string => `${symbolId ?? ''}\n${input}`;
  const fed = new Map<string, Array<readonly [number, number]>>();
  for (const fact of drafts) {
    if (fact.kind !== 'normalization') continue;
    const span = [fact.line, fact.line + (fact.text.match(/\r\n|\r|\n/g)?.length ?? 0)] as const;
    for (const input of normalizationInputs(fact.text, fact.detail['method'] ?? '')) {
      const k = key(fact.symbolId, input);
      const spans = fed.get(k);
      if (spans) spans.push(span);
      else fed.set(k, [span]);
    }
  }
  if (fed.size === 0) return [...drafts];
  return drafts.filter(fact => {
    if (fact.kind !== 'normalization') return true;
    const spans = fed.get(key(fact.symbolId, fact.text.replace(/\s+/g, '')));
    return !spans?.some(([from, to]) => fact.line >= from && fact.line <= to);
  });
}

interface Candidate {
  readonly symbol: SymbolNode;
  readonly index: number;
}

/** True when `a` is the better owner of a line both hold: the later start, then the smaller span, then index order. */
function inner(a: Candidate, b: Candidate): boolean {
  if (a.symbol.startLine !== b.symbol.startLine) return a.symbol.startLine > b.symbol.startLine;
  const spanA = a.symbol.endLine - a.symbol.startLine;
  const spanB = b.symbol.endLine - b.symbol.startLine;
  return spanA !== spanB ? spanA < spanB : a.index < b.index;
}

/**
 * The innermost symbol holding each line (the later start, then the smaller span, then index order); lines outside
 * every symbol are absent. One sweep over the sorted lines: O((lines + symbols) log symbols).
 */
export function innermostSymbolIds(lines: Iterable<number>, symbols: readonly SymbolNode[]): Map<number, string> {
  const out = new Map<number, string>();
  if (symbols.length === 0) return out;
  const ownerOf = innermostSymbolCursor(symbols);
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const owner = ownerOf(line);
    if (owner !== undefined) out.set(line, owner);
  }
  return out;
}

/**
 * The innermost symbol holding a line, for lines asked in nondecreasing order (undefined outside every symbol). A
 * heap holds the symbols started so far; its top is dropped while it ends before the line, since later lines cannot
 * be inside it either. Each symbol is pushed and popped once: O(symbols log symbols) over all calls.
 */
export function innermostSymbolCursor(symbols: readonly SymbolNode[]): (line: number) => string | undefined {
  const order = symbols.map((symbol, index) => ({ symbol, index })).sort((a, b) => a.symbol.startLine - b.symbol.startLine || a.index - b.index);
  const heap: Candidate[] = [];
  const swap = (i: number, j: number): void => {
    const t = heap[i]!;
    heap[i] = heap[j]!;
    heap[j] = t;
  };
  const push = (c: Candidate): void => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!inner(heap[i]!, heap[parent]!)) break;
      swap(i, parent);
      i = parent;
    }
  };
  const pop = (): void => {
    const last = heap.pop()!;
    if (heap.length === 0) return;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < heap.length && inner(heap[left]!, heap[best]!)) best = left;
      if (right < heap.length && inner(heap[right]!, heap[best]!)) best = right;
      if (best === i) return;
      swap(i, best);
      i = best;
    }
  };
  let next = 0;
  return (line) => {
    while (next < order.length && order[next]!.symbol.startLine <= line) push(order[next++]!);
    while (heap.length > 0 && heap[0]!.symbol.endLine < line) pop();
    return heap.length > 0 ? heap[0]!.symbol.symbolId : undefined;
  };
}

/**
 * Turns collector evidence into the file's facts: the trivial-literal list, normalization patterns
 * and the calls that are not business normalization (FC-4b), retry/timeout names and numbers,
 * routes (FC-3 to FC-8), FC-2 text, FC-9 attribution, then FC-10
 * order (line, kind, text, detail, symbol), duplicates dropped and at most 500 facts.
 * `decodeStringLiteral` is the language's string literal decoder for the trivial-literal check;
 * without it only a plain quoted literal can be trivial.
 */
export function finishFacts(
  file: string,
  evidence: readonly FactEvidence[],
  symbols: readonly SymbolNode[],
  options: FactOptions,
  decodeStringLiteral?: StringLiteralDecoder,
): CodeFact[] {
  const moduleId = moduleSymbolId(file);
  const found: DraftFact[] = [];
  for (const item of evidence) {
    const fact = draft(item, options, decodeStringLiteral);
    if (fact) found.push(fact);
  }
  const drafts = outermostNormalizations(found).filter(fact => fact.silent !== true);
  const owners = innermostSymbolIds(drafts.filter(fact => fact.symbolId === undefined).map(fact => fact.line), symbols);
  const keyed: { readonly fact: CodeFact; readonly detailKey: string }[] = [];
  for (const fact of drafts) {
    const finished: CodeFact = {
      kind: fact.kind,
      symbolId: fact.symbolId ?? owners.get(fact.line) ?? moduleId,
      line: fact.line,
      text: normalizeFactText(fact.text),
      detail: fact.detail,
    };
    keyed.push({ fact: finished, detailKey: JSON.stringify(fact.detail) });
  }

  keyed.sort((a, b) =>
    a.fact.line - b.fact.line
    || FACT_KIND_ORDER.indexOf(a.fact.kind) - FACT_KIND_ORDER.indexOf(b.fact.kind)
    || compare(a.fact.text, b.fact.text)
    || compare(a.detailKey, b.detailKey)
    || compare(a.fact.symbolId, b.fact.symbolId));

  const facts: CodeFact[] = [];
  let previous: (typeof keyed)[number] | undefined;
  for (const entry of keyed) {
    if (
      previous
      && previous.fact.line === entry.fact.line
      && previous.fact.kind === entry.fact.kind
      && previous.fact.text === entry.fact.text
      && previous.detailKey === entry.detailKey
      && previous.fact.symbolId === entry.fact.symbolId
    ) {
      continue;
    }
    facts.push(entry.fact);
    previous = entry;
    if (facts.length === MAX_FACTS_PER_FILE) break;
  }
  return facts;
}
