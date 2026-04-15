import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { ArchitecturalOverlay } from '../../core/overlay/architectural-overlay.js';
import { wrapResponse } from '../../core/response-envelope.js';
import type { CommunitySnapshot, GodNode } from '../../core/types.js';
import type { StalenessCheck } from './get-logic-slice.js';

const OVERLAY_MODES = ['regex', 'communities', 'both'] as const;

const InputSchema = z.object({
  layer: z.string().optional(),
  mode: z.enum(OVERLAY_MODES).optional(),
});

export interface CommunityOverlayCluster {
  id: number;
  label: string;
  memberCount: number;
  members: string[];
  godNodes: string[];
}

export interface CommunityOverlay {
  clusters: CommunityOverlayCluster[];
  modularity: number;
  edgeQuality: CommunitySnapshot['edgeQuality'];
  crossClusterEdges: number;
  computedAt: string;
  commitSha: string;
}

export function buildCommunityOverlay(
  snapshot: CommunitySnapshot,
  options: { memberPreviewLimit?: number } = {},
): CommunityOverlay {
  const previewLimit = options.memberPreviewLimit ?? 15;
  const byCluster = new Map<number, string[]>();
  for (const entry of snapshot.communities) {
    const list = byCluster.get(entry.communityId) ?? [];
    list.push(entry.symbolId);
    byCluster.set(entry.communityId, list);
  }
  const labelFor = new Map<number, string>();
  for (const entry of snapshot.communities) {
    if (!labelFor.has(entry.communityId)) {
      labelFor.set(entry.communityId, entry.communityLabel);
    }
  }
  const godNodesByCommunity = new Map<number, Set<string>>();
  for (const god of snapshot.godNodes as readonly GodNode[]) {
    for (const communityId of god.bridgedCommunities) {
      const set = godNodesByCommunity.get(communityId) ?? new Set<string>();
      set.add(god.symbolId);
      godNodesByCommunity.set(communityId, set);
    }
  }

  const clusters: CommunityOverlayCluster[] = [];
  for (const [id, members] of byCluster) {
    members.sort();
    clusters.push({
      id,
      label: labelFor.get(id) ?? `community-${id}`,
      memberCount: members.length,
      members: members.slice(0, previewLimit),
      godNodes: [...(godNodesByCommunity.get(id) ?? [])].sort(),
    });
  }
  clusters.sort((a, b) => b.memberCount - a.memberCount || a.id - b.id);

  return {
    clusters,
    modularity: snapshot.modularity,
    edgeQuality: snapshot.edgeQuality,
    crossClusterEdges: snapshot.crossClusterEdges,
    computedAt: snapshot.computedAt,
    commitSha: snapshot.commitSha,
  };
}

export function handleGetArchitecturalOverlay(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
) {
  const overlay = new ArchitecturalOverlay();

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const files = storage.listIndexedFiles();
      const result = overlay.classify(files);
      const mode = parsed.data.mode ?? 'both';

      const buildContent = (payloadStr: string) => {
        const content: Array<{ type: 'text'; text: string }> = [];
        if (staleness) {
          const warning = staleness.check(files);
          if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
        }
        content.push({ type: 'text', text: payloadStr });
        return content;
      };

      // Filter by layer if specified (regex-mode semantics always apply here)
      if (parsed.data.layer) {
        const filtered = result.layers[parsed.data.layer];
        const payload = masking.mask(
          JSON.stringify(wrapResponse({ layer: parsed.data.layer, files: filtered ?? [] })),
        );
        return { content: buildContent(payload) };
      }

      const snapshot = mode === 'regex' ? undefined : storage.readCommunities();
      const community = snapshot ? buildCommunityOverlay(snapshot) : undefined;

      const body: Record<string, unknown> = {};
      if (mode !== 'communities') body.layers = result.layers;
      if (community) body.communities = community;
      if (mode === 'communities' && !community) {
        body.hint = 'No community snapshot available. Run `ctxo index` to generate one.';
      }

      const payload = masking.mask(JSON.stringify(wrapResponse(body)));
      return { content: buildContent(payload) };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };
}
