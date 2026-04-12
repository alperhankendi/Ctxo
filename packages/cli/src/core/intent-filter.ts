/**
 * Intent-based result filtering for MCP tool responses.
 *
 * When an `intent` string is provided, filters array results to only include
 * entries whose text fields (symbolId, file, name, kind, edgeKind, reason)
 * match at least one keyword from the intent.
 *
 * Keywords are extracted by splitting the intent on whitespace and lowercasing.
 * A match is found when any keyword appears as a substring of any text field.
 */

/**
 * Extract lowercase keywords from an intent string.
 * Filters out very short words (< 2 chars) to avoid noise.
 */
function extractKeywords(intent: string): string[] {
  return intent
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

/**
 * Check if any keyword matches any of the given text values (case-insensitive substring).
 */
function matchesAny(keywords: string[], values: string[]): boolean {
  const lower = values.map(v => v.toLowerCase());
  return keywords.some(kw => lower.some(v => v.includes(kw)));
}

/**
 * Collect all string values from a record for matching.
 * Extracts from known fields: symbolId, file, name, kind, edgeKind, edgeKinds, reason, confidence.
 */
function collectMatchableStrings(entry: Record<string, unknown>): string[] {
  const strings: string[] = [];
  for (const key of ['symbolId', 'file', 'name', 'kind', 'edgeKind', 'reason', 'confidence']) {
    const v = entry[key];
    if (typeof v === 'string') strings.push(v);
  }
  const edgeKinds = entry['edgeKinds'];
  if (Array.isArray(edgeKinds)) {
    for (const ek of edgeKinds) {
      if (typeof ek === 'string') strings.push(ek);
    }
  }
  return strings;
}

/**
 * Filter an array of result entries by intent keywords.
 * Returns only entries where at least one keyword matches a text field.
 *
 * @param items - Array of result objects
 * @param intent - User intent string (e.g., "test coverage", "adapter", "security")
 * @returns Filtered array (empty if no matches)
 */
export function filterByIntent<T extends Record<string, unknown>>(
  items: T[],
  intent: string | undefined,
): T[] {
  if (!intent || intent.trim().length === 0) return items;

  const keywords = extractKeywords(intent);
  if (keywords.length === 0) return items;

  return items.filter(item => {
    const strings = collectMatchableStrings(item);
    return matchesAny(keywords, strings);
  });
}
