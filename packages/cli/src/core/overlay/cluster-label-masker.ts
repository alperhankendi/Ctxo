import type { CommunityEntry, CommunitySnapshot, GodNode } from '../types.js';
import { makeGlobMatcher } from '../config/load-config.js';

/**
 * Replace sensitive cluster labels with `[masked-cluster-N]`. Labels matching
 * any configured glob (e.g. `internal-*`, `*-vault`, `src/payment-*`) are
 * rewritten deterministically so MCP tool responses never leak org-sensitive
 * directory names to AI agents over the stdio channel.
 *
 * Determinism matters: drift-detector compares labels across snapshots, so
 * the same input label must always produce the same mask. We seed the mask
 * counter from the snapshot's sorted, unique label set.
 */
export class ClusterLabelMasker {
  private readonly matcher: (input: string) => boolean;
  private readonly enabled: boolean;
  private readonly labelCache = new Map<string, string>();

  constructor(patterns: readonly string[]) {
    this.enabled = patterns.length > 0;
    this.matcher = this.enabled ? makeGlobMatcher([...patterns]) : () => false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  mask(label: string): string {
    if (!this.enabled) return label;
    if (!this.matcher(label)) return label;
    const cached = this.labelCache.get(label);
    if (cached) return cached;
    const masked = `[masked-cluster-${this.labelCache.size + 1}]`;
    this.labelCache.set(label, masked);
    return masked;
  }

  maskSnapshot(snapshot: CommunitySnapshot): CommunitySnapshot {
    if (!this.enabled) return snapshot;
    // Seed the cache in sorted order so output is stable across runs.
    const uniqueLabels = [...new Set(snapshot.communities.map((c) => c.communityLabel))].sort();
    for (const label of uniqueLabels) this.mask(label);

    const maskedCommunities: CommunityEntry[] = snapshot.communities.map((entry) => ({
      ...entry,
      communityLabel: this.mask(entry.communityLabel),
    }));
    const maskedGodNodes: GodNode[] = snapshot.godNodes.map((g) => ({ ...g }));
    return { ...snapshot, communities: maskedCommunities, godNodes: maskedGodNodes };
  }
}
