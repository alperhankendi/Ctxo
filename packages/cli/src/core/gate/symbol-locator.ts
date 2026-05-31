import type { FileIndex } from '../types.js';

/** 1-based line where `snippet` begins in `source`, or null if not found. */
export function lineOfSnippet(source: string, snippet: string): number | null {
  const idx = source.indexOf(snippet);
  if (idx === -1) return null;
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

/** symbolId of the innermost symbol whose [startLine,endLine] contains `line`. */
export function locateSymbolAtLine(fileIndex: FileIndex, line: number): string | null {
  let best: { id: string; span: number } | null = null;
  for (const s of fileIndex.symbols) {
    if (line >= s.startLine && line <= s.endLine) {
      const span = s.endLine - s.startLine;
      if (best === null || span < best.span) best = { id: s.symbolId, span };
    }
  }
  return best?.id ?? null;
}
