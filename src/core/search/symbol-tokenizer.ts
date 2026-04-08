/**
 * Symbol Tokenizer — splits symbol names into searchable tokens.
 *
 * Handles camelCase, PascalCase, snake_case, kebab-case, and digit boundaries.
 * Used to populate FTS5 `tokenized_name` columns and to tokenize search queries.
 */

const STOP_WORDS = new Set([
  'get', 'set', 'is', 'has', 'can', 'do', 'the', 'a', 'an', 'of', 'to', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'not', 'no', 'or',
]);

export interface TokenizerOptions {
  /** Include stop-word tokens in output (default: false) */
  includeStopWords?: boolean;
  /** Include the full original name as an additional token (default: true) */
  includeOriginal?: boolean;
  /** Include file path segments as tokens (default: false) */
  includeFilePath?: boolean;
}

const DEFAULT_OPTIONS: Required<TokenizerOptions> = {
  includeStopWords: false,
  includeOriginal: true,
  includeFilePath: false,
};

export class SymbolTokenizer {
  private readonly options: Required<TokenizerOptions>;

  constructor(options?: TokenizerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Tokenize a symbol name into searchable tokens.
   *
   * Examples:
   *   "getCoChangeMetrics"    → ["get", "co", "change", "metrics"]  (or without stop words: ["co", "change", "metrics"])
   *   "SqliteStorageAdapter"  → ["sqlite", "storage", "adapter"]
   *   "i_storage_port"        → ["i", "storage", "port"]
   *   "BM25Scorer"            → ["bm", "25", "scorer"]
   *   "DB_PASSWORD"           → ["db", "password"]
   */
  tokenize(symbolName: string, filePath?: string): string[] {
    const splitTokens = SymbolTokenizer.splitName(symbolName);
    const lowered = splitTokens.map((t) => t.toLowerCase());

    const tokens: string[] = this.options.includeStopWords
      ? lowered
      : lowered.filter((t) => !STOP_WORDS.has(t));

    // Preserve original name as a token for exact matching
    if (this.options.includeOriginal) {
      const original = symbolName.toLowerCase();
      if (!tokens.includes(original)) {
        tokens.unshift(original);
      }
    }

    // Include file path segments
    if (this.options.includeFilePath && filePath) {
      const pathTokens = SymbolTokenizer.tokenizeFilePath(filePath);
      for (const pt of pathTokens) {
        if (!tokens.includes(pt)) {
          tokens.push(pt);
        }
      }
    }

    return tokens;
  }

  /**
   * Tokenize a search query. Queries use stop words and don't include originals.
   */
  tokenizeQuery(query: string): string[] {
    const words = query.trim().split(/\s+/);
    const tokens: string[] = [];
    for (const word of words) {
      const split = SymbolTokenizer.splitName(word);
      for (const t of split) {
        const lowered = t.toLowerCase();
        if (lowered.length > 0 && !tokens.includes(lowered)) {
          tokens.push(lowered);
        }
      }
    }
    return tokens;
  }

  /**
   * Split a name into constituent words based on naming convention boundaries.
   *
   * Rules:
   *  1. Split on underscores and hyphens (snake_case, kebab-case)
   *  2. Split on camelCase/PascalCase boundaries (uppercase after lowercase)
   *  3. Split acronym boundaries (e.g., "HTMLParser" → ["HTML", "Parser"])
   *  4. Split on digit ↔ letter boundaries
   */
  static splitName(name: string): string[] {
    if (!name || name.length === 0) return [];

    // Step 1: Split on underscores, hyphens, dots, slashes
    const segments = name.split(/[_\-./\\]+/).filter((s) => s.length > 0);

    const tokens: string[] = [];
    for (const segment of segments) {
      tokens.push(...SymbolTokenizer.splitCamelCase(segment));
    }

    return tokens.filter((t) => t.length > 0);
  }

  /**
   * Split a single segment on camelCase/PascalCase/digit boundaries.
   */
  private static splitCamelCase(segment: string): string[] {
    const tokens: string[] = [];
    let current = '';

    for (let i = 0; i < segment.length; i++) {
      const ch = segment[i];
      const prev = i > 0 ? segment[i - 1] : '';
      const next = i < segment.length - 1 ? segment[i + 1] : '';

      // Boundary: letter → digit or digit → letter
      if (current.length > 0) {
        const prevIsDigit = isDigit(prev);
        const currIsDigit = isDigit(ch);
        if (prevIsDigit !== currIsDigit) {
          tokens.push(current);
          current = ch;
          continue;
        }
      }

      // Boundary: lowercase → uppercase (camelCase boundary)
      if (current.length > 0 && isLower(prev) && isUpper(ch)) {
        tokens.push(current);
        current = ch;
        continue;
      }

      // Acronym boundary: multiple uppercase followed by lowercase
      // "HTMLParser": H-T-M-L-P-a → when we hit 'a', current="HTMLP"
      // We should split to "HTML" + "Pa..."
      if (current.length > 1 && isUpper(ch) === false && isUpper(prev) && !isDigit(ch)) {
        // prev is uppercase, current char is lowercase → split before prev
        const lastChar = current[current.length - 1];
        if (isUpper(lastChar)) {
          tokens.push(current.slice(0, -1));
          current = lastChar + ch;
          continue;
        }
      }

      current += ch;
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Extract searchable tokens from a file path.
   * "src/core/search/symbol-tokenizer.ts" → ["src", "core", "search", "symbol", "tokenizer", "ts"]
   */
  static tokenizeFilePath(filePath: string): string[] {
    // Remove extension, split on separators
    const withoutExt = filePath.replace(/\.[^.]+$/, '');
    const segments = withoutExt.split(/[/\\]+/);
    const tokens: string[] = [];
    for (const seg of segments) {
      const parts = seg.split(/[_\-.]+/).filter((s) => s.length > 0);
      for (const p of parts) {
        const lowered = p.toLowerCase();
        if (lowered.length > 0 && !tokens.includes(lowered)) {
          tokens.push(lowered);
        }
      }
    }
    return tokens;
  }

  /** Check if a token is a stop word */
  static isStopWord(token: string): boolean {
    return STOP_WORDS.has(token.toLowerCase());
  }
}

function isUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

function isLower(ch: string): boolean {
  return ch >= 'a' && ch <= 'z';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
