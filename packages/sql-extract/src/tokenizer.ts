import type { SqlToken, SqlTokenKind } from './types.js';

const WORD_START = /[\p{L}_#\ud800-\udfff]/u;
const WORD_PART = /[\p{L}\p{N}_$#@\ud800-\udfff]/u;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isBlank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v';
}

/**
 * Tokenizes T-SQL text. Comments and whitespace are dropped. Never throws:
 * unterminated strings, comments and brackets run to the end of the source.
 */
export function tokenizeSql(source: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const n = source.length;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 0;
  let lineStart = i;

  const push = (kind: SqlTokenKind, start: number, end: number, value: string, startLine: number): void => {
    tokens.push({ kind, text: source.slice(start, end), value, start, end, line: startLine });
  };

  /** Advances over [from, to), counting line feeds. */
  const advance = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      if (source.charCodeAt(k) === 10) {
        line++;
        lineStart = k + 1;
      }
    }
  };

  /** Reads a delimited run starting at the opening delimiter; returns end offset and decoded value. */
  const readDelimited = (open: number, closer: string): { end: number; value: string } => {
    let k = open + 1;
    let value = '';
    while (k < n) {
      const ch = source[k]!;
      if (ch === closer) {
        if (source[k + 1] === closer) {
          value += closer;
          k += 2;
          continue;
        }
        return { end: k + 1, value };
      }
      value += ch;
      k++;
    }
    return { end: n, value };
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' ') {
      i++;
      continue;
    }

    if (ch === '-' && source[i + 1] === '-') {
      let k = i + 2;
      while (k < n && source[k] !== '\n') k++;
      i = k;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      let depth = 1;
      let k = i + 2;
      while (k < n && depth > 0) {
        if (source[k] === '/' && source[k + 1] === '*') {
          depth++;
          k += 2;
        } else if (source[k] === '*' && source[k + 1] === '/') {
          depth--;
          k += 2;
        } else {
          k++;
        }
      }
      advance(i, k);
      i = k;
      continue;
    }

    const startLine = line;

    if (ch === "'" || ((ch === 'N' || ch === 'n') && source[i + 1] === "'")) {
      const open = ch === "'" ? i : i + 1;
      const { end, value } = readDelimited(open, "'");
      push('string', i, end, value, startLine);
      advance(i, end);
      i = end;
      continue;
    }

    if (ch === '[' || ch === '"') {
      const { end, value } = readDelimited(i, ch === '[' ? ']' : '"');
      push('quoted', i, end, value, startLine);
      advance(i, end);
      i = end;
      continue;
    }

    if (ch === '@') {
      let k = i + 1;
      if (source[k] === '@') k++;
      while (k < n && WORD_PART.test(source[k]!)) k++;
      push('variable', i, k, source.slice(i, k), startLine);
      i = k;
      continue;
    }

    if (isDigit(ch)) {
      let k = i + 1;
      while (k < n) {
        const c = source[k]!;
        if (WORD_PART.test(c) || (c === '.' && isDigit(source[k + 1]))) k++;
        else break;
      }
      push('number', i, k, source.slice(i, k), startLine);
      i = k;
      continue;
    }

    if (WORD_START.test(ch)) {
      let k = i + 1;
      while (k < n && WORD_PART.test(source[k]!)) k++;
      const text = source.slice(i, k);
      if (text.length === 2 && (text === 'GO' || text === 'go' || text === 'Go' || text === 'gO') && isBatchSeparator(source, i, k, lineStart)) {
        const end = batchEnd(source, k);
        push('batch', i, end, 'GO', startLine);
        i = end;
        continue;
      }
      push('word', i, k, text, startLine);
      i = k;
      continue;
    }

    push('punct', i, i + 1, ch, startLine);
    i++;
  }

  return tokens;
}

/** GO is a batch separator only alone on its line: optional count, optional trailing `--` comment. */
function isBatchSeparator(source: string, start: number, end: number, lineStart: number): boolean {
  for (let k = lineStart; k < start; k++) {
    if (!isBlank(source[k]) && source[k] !== '\r' && source[k] !== '\uFEFF') return false;
  }
  let k = end;
  while (isBlank(source[k])) k++;
  if (isDigit(source[k])) {
    while (isDigit(source[k])) k++;
    while (isBlank(source[k])) k++;
  }
  if (k >= source.length) return true;
  if (source[k] === '\n' || source[k] === '\r') return true;
  return source[k] === '-' && source[k + 1] === '-';
}

/** End offset of the batch token: GO plus an optional count. */
function batchEnd(source: string, afterGo: number): number {
  let k = afterGo;
  while (isBlank(source[k])) k++;
  if (isDigit(source[k])) {
    while (isDigit(source[k])) k++;
    return k;
  }
  return afterGo;
}
