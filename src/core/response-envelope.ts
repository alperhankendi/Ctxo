/**
 * Response envelope — adds _meta field and truncates large payloads.
 *
 * Applied between payload construction and masking in every MCP handler.
 * Threshold default: 8192 bytes (~8KB). Configurable via CTXO_RESPONSE_LIMIT env.
 */

const DEFAULT_THRESHOLD = 8192;

export interface ResponseMeta {
  totalItems: number;
  returnedItems: number;
  truncated: boolean;
  totalBytes: number;
  hint?: string;
}

/**
 * Known array field names in tool responses that can be truncated.
 * Maps field name → drill-in hint for the LLM.
 */
const TRUNCATABLE_FIELDS: Record<string, string> = {
  impactedSymbols: 'Use search_symbols to find specific impacted symbols, or get_blast_radius with a confidence filter.',
  importers: 'Use find_importers with edgeKinds filter or maxDepth to narrow results.',
  deadSymbols: 'Use search_symbols with kind filter to find specific dead symbols.',
  unusedExports: 'Use find_importers to check specific symbols.',
  results: 'Use search_symbols or get_ranked_context with a narrower query.',
  rankings: 'Use get_symbol_importance with kind or filePattern filter to narrow results.',
  context: 'Use get_context_for_task with a smaller tokenBudget.',
  hierarchies: 'Use get_class_hierarchy with a specific symbolId.',
  scaffolding: 'Review the scaffolding markers directly in the listed files.',
  deadFiles: 'Use find_dead_code with includeTests to adjust scope.',
  files: 'Use get_changed_symbols with a narrower since ref or smaller maxFiles.',
};

function getThreshold(): number {
  const env = process.env['CTXO_RESPONSE_LIMIT'];
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return DEFAULT_THRESHOLD;
}

/**
 * Find the largest array field in a payload object that is in our truncatable list.
 */
function findTruncatableArray(data: Record<string, unknown>): { key: string; arr: unknown[] } | null {
  let best: { key: string; arr: unknown[] } | null = null;
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && key in TRUNCATABLE_FIELDS) {
      if (!best || value.length > best.arr.length) {
        best = { key, arr: value };
      }
    }
  }
  return best;
}

/**
 * Wrap a payload object with _meta and truncate if needed.
 *
 * @param data - The raw response object (before JSON.stringify)
 * @returns The data object with _meta added (and arrays truncated if over threshold)
 */
export function wrapResponse(data: Record<string, unknown>): Record<string, unknown> {
  const threshold = getThreshold();
  const fullJson = JSON.stringify(data);
  const totalBytes = Buffer.byteLength(fullJson, 'utf-8');

  const truncatable = findTruncatableArray(data);
  const totalItems = truncatable ? truncatable.arr.length : 0;

  // Under threshold — return with _meta, no truncation
  if (totalBytes <= threshold) {
    return {
      ...data,
      _meta: {
        totalItems,
        returnedItems: totalItems,
        truncated: false,
        totalBytes,
      } satisfies ResponseMeta,
    };
  }

  // Over threshold — truncate the largest array
  if (!truncatable || truncatable.arr.length <= 1) {
    // No array to truncate, just add _meta
    return {
      ...data,
      _meta: {
        totalItems,
        returnedItems: totalItems,
        truncated: false,
        totalBytes,
      } satisfies ResponseMeta,
    };
  }

  // Binary search for the number of items that fit within threshold
  let lo = 1;
  let hi = truncatable.arr.length;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const trial = {
      ...data,
      [truncatable.key]: truncatable.arr.slice(0, mid),
      _meta: {
        totalItems,
        returnedItems: mid,
        truncated: true,
        totalBytes,
        hint: TRUNCATABLE_FIELDS[truncatable.key],
      },
    };
    const size = Buffer.byteLength(JSON.stringify(trial), 'utf-8');
    if (size <= threshold) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const hint = TRUNCATABLE_FIELDS[truncatable.key];

  return {
    ...data,
    [truncatable.key]: truncatable.arr.slice(0, lo),
    _meta: {
      totalItems,
      returnedItems: lo,
      truncated: true,
      totalBytes,
      hint,
    } satisfies ResponseMeta,
  };
}
