const MIN_PREFIX_SEGMENTS = 1;
const PATH_SEPARATOR = '/';

export function labelCommunities(
  membersByCommunity: ReadonlyMap<number, readonly string[]>,
  pagerank: ReadonlyMap<string, number>,
): Map<number, string> {
  const labels = new Map<number, string>();
  const used = new Set<string>();

  for (const [communityId, members] of membersByCommunity) {
    const label = pickLabel(members, pagerank, used);
    labels.set(communityId, label);
    used.add(label);
  }

  return labels;
}

function pickLabel(
  members: readonly string[],
  pagerank: ReadonlyMap<string, number>,
  used: ReadonlySet<string>,
): string {
  const files = members.map(extractFilePath).filter((file): file is string => Boolean(file));
  const prefixLabel = longestCommonPathPrefix(files);

  if (prefixLabel && !used.has(prefixLabel)) {
    return prefixLabel;
  }

  const topSymbol = pickTopByPagerank(members, pagerank);
  if (topSymbol) {
    const name = extractSymbolName(topSymbol);
    if (name) {
      const candidate = `${name} area`;
      if (!used.has(candidate)) return candidate;
    }
  }

  if (prefixLabel) {
    return disambiguate(prefixLabel, used);
  }

  return disambiguate('cluster', used);
}

function extractFilePath(symbolId: string): string | undefined {
  const parts = symbolId.split('::');
  return parts.length === 3 ? parts[0] : undefined;
}

function extractSymbolName(symbolId: string): string | undefined {
  const parts = symbolId.split('::');
  return parts.length === 3 ? parts[1] : undefined;
}

function longestCommonPathPrefix(files: readonly string[]): string | undefined {
  if (files.length === 0) return undefined;
  const normalized = files.map((file) => file.replace(/\\/g, PATH_SEPARATOR));
  const segments = normalized.map((file) => file.split(PATH_SEPARATOR));
  const first = segments[0]!;

  let matchLength = first.length;
  for (let i = 1; i < segments.length; i++) {
    const current = segments[i]!;
    matchLength = Math.min(matchLength, current.length);
    for (let j = 0; j < matchLength; j++) {
      if (current[j] !== first[j]) {
        matchLength = j;
        break;
      }
    }
    if (matchLength === 0) break;
  }

  // Drop the filename if the common prefix includes it.
  const fullMatch = matchLength === first.length && files.length === 1;
  const keep = fullMatch ? matchLength - 1 : matchLength;
  if (keep < MIN_PREFIX_SEGMENTS) return undefined;

  const prefix = first.slice(0, keep).join(PATH_SEPARATOR);
  return prefix.length > 0 ? prefix : undefined;
}

function pickTopByPagerank(
  members: readonly string[],
  pagerank: ReadonlyMap<string, number>,
): string | undefined {
  let best: string | undefined;
  let bestScore = -1;
  for (const symbolId of members) {
    const score = pagerank.get(symbolId) ?? 0;
    if (score > bestScore || (score === bestScore && best !== undefined && symbolId < best)) {
      bestScore = score;
      best = symbolId;
    }
  }
  return best ?? members[0];
}

function disambiguate(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base} (${suffix})`)) suffix++;
  return `${base} (${suffix})`;
}
