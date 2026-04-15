import { z } from 'zod';

/**
 * Zod schema for `.ctxo/config.yaml`.
 *
 * Unknown fields on the root are ignored (forward compatibility) but unknown
 * fields under recognised sections (`stats`, `index`) are rejected so typos
 * surface immediately via `ctxo doctor`.
 */
export const StatsConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict();

export const IndexConfigSchema = z
  .object({
    ignore: z.array(z.string().min(1)).optional(),
    ignoreProjects: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const MaskingConfigSchema = z
  .object({
    /**
     * Glob patterns matched against community cluster labels. Matching labels
     * are replaced with `[masked-cluster-N]` in MCP tool responses so
     * org-sensitive folder names (e.g. `src/payment-vault`, `internal-*`)
     * never surface to AI agents over the stdio channel.
     */
    clusterLabels: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CtxoConfigSchema = z
  .object({
    version: z.union([z.string(), z.number()]).optional(),
    stats: StatsConfigSchema.optional(),
    index: IndexConfigSchema.optional(),
    masking: MaskingConfigSchema.optional(),
  })
  .passthrough();

export type StatsConfig = z.infer<typeof StatsConfigSchema>;
export type IndexConfig = z.infer<typeof IndexConfigSchema>;
export type MaskingConfig = z.infer<typeof MaskingConfigSchema>;
export type CtxoConfig = z.infer<typeof CtxoConfigSchema>;

export const DEFAULT_CONFIG: CtxoConfig = {
  version: '1.0',
  stats: { enabled: true },
  index: { ignore: [], ignoreProjects: [] },
  masking: { clusterLabels: [] },
};
