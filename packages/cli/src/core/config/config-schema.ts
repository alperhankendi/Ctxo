import { z } from 'zod';
import { parseCoChangeSince } from '../co-change/co-change-window.js';

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
    facts: z.boolean().optional(),
    tests: z.array(z.string().min(1)).optional(),
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

export const WatchConfigSchema = z
  .object({
    /**
     * Minimum number of files that must be re-indexed since the last
     * community snapshot before `ctxo watch` recomputes one. Default: 5.
     * On large monorepos Louvain + PageRank cost ~1 s of blocking CPU;
     * bumping this (e.g. 25) avoids recomputing on every save.
     */
    snapshotMinFileChanges: z.number().int().min(1).optional(),
  })
  .strict();

export const GateConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    sensitivity: z.enum(['strict', 'balanced', 'lenient']).optional(),
    /** Absolute floor: minimum confirmed+likely dependents before the gate can fire. */
    minDependents: z.number().int().min(0).optional(),
    /** Repo-relative significance: symbol must be in the top `percentile`% by PageRank. */
    percentile: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const CoChangeConfigSchema = z
  .object({
    /**
     * Size of the co-change window: the last N non-merge commits from HEAD, or "all".
     * Default: 2000. Independent of `ctxo index --max-history`, which only sets how much
     * per-file commit history is kept.
     */
    maxCommits: z
      .union([z.number().int().min(1), z.literal('all')], { error: 'must be a positive integer or "all"' })
      .optional(),
    /**
     * Narrows the window to a duration counted back from HEAD's committer date (never the wall
     * clock): `30d`, `2w`, `12m` or `1y`. Applies together with `maxCommits`.
     */
    since: z
      .string()
      .refine((value) => parseCoChangeSince(value) !== undefined, {
        error: 'must be a duration such as 30d, 2w, 12m or 1y',
      })
      .optional(),
    /** Commits touching more analysed files than this are skipped as mass changes. Default: 30. */
    maxFilesPerCommit: z.number().int().min(1).optional(),
    /** A file pair becomes an entry only after this many shared commits. Default: 2. */
    minShared: z.number().int().min(1).optional(),
    /** Extra tracked files to analyse that no language plugin indexes, such as SQL scripts (globs). */
    include: z.array(z.string().min(1)).optional(),
    /** Indexed files to leave out of the analysis (globs). */
    exclude: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CommunitiesConfigSchema = z
  .object({
    /** Louvain resolution: higher gives more, smaller communities. Default: 1.0. */
    resolution: z.number().positive().optional(),
    /** Minimum number of communities a symbol must bridge to count as a god node. Default: 3. */
    godNodeMinBridged: z.number().int().min(1).optional(),
    /** Maximum number of god nodes reported. Default: 25. */
    godNodeMaxResults: z.number().int().min(0).optional(),
  })
  .strict();

export const ContextsViewConfigSchema = z
  .object({
    /** Blend of the file-edge signals. Defaults: dependency 1.0, coChange 1.0, data 0 (shared tables are a finding, not a clustering weight). */
    weights: z
      .object({
        dependency: z.number().min(0).optional(),
        coChange: z.number().min(0).optional(),
        data: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    /** Files to leave out of the file graph (globs). */
    exclude: z.array(z.string().min(1)).optional(),
    hubs: z
      .object({
        /** Detect hubs automatically (fan-in and god nodes). Default: true. */
        auto: z.boolean().optional(),
        /** A file is a fan-in hub when it is in the top `topPercent`% by dependents. Default: 1. */
        topPercent: z.number().positive().max(100).optional(),
        /** Minimum distinct dependent files for a fan-in hub. Default: 10. */
        minDependents: z.number().int().min(1).optional(),
        /** Files that lose all their edges (globs). */
        paths: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    /** Louvain resolution for the file graph. Default: 1.0. */
    resolution: z.number().positive().optional(),
    /** Candidates with fewer files fold into a neighbour. Default: 3. */
    minCandidateFiles: z.number().int().min(1).optional(),
    /** Words dropped from candidate terms; replaces the default list. */
    technicalTerms: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CtxoConfigSchema = z
  .object({
    version: z.union([z.string(), z.number()]).optional(),
    stats: StatsConfigSchema.optional(),
    index: IndexConfigSchema.optional(),
    masking: MaskingConfigSchema.optional(),
    watch: WatchConfigSchema.optional(),
    gate: GateConfigSchema.optional(),
    cochange: CoChangeConfigSchema.optional(),
    communities: CommunitiesConfigSchema.optional(),
    contextsView: ContextsViewConfigSchema.optional(),
  })
  .passthrough();

export type StatsConfig = z.infer<typeof StatsConfigSchema>;
export type IndexConfig = z.infer<typeof IndexConfigSchema>;
export type MaskingConfig = z.infer<typeof MaskingConfigSchema>;
export type WatchConfig = z.infer<typeof WatchConfigSchema>;
export type GateConfig = z.infer<typeof GateConfigSchema>;
export type CoChangeConfig = z.infer<typeof CoChangeConfigSchema>;
export type CommunitiesConfig = z.infer<typeof CommunitiesConfigSchema>;
export type ContextsViewConfig = z.infer<typeof ContextsViewConfigSchema>;
export type CtxoConfig = z.infer<typeof CtxoConfigSchema>;

export const DEFAULT_WATCH_SNAPSHOT_MIN_FILE_CHANGES = 5;
export const DEFAULT_COCHANGE_MAX_COMMITS = 2000;
export const DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT = 30;
export const DEFAULT_COCHANGE_MIN_SHARED = 2;
export const DEFAULT_TECHNICAL_TERMS: readonly string[] = [
  'Service',
  'Repository',
  'Controller',
  'Handler',
  'Manager',
  'Dto',
  'Impl',
  'Async',
];

export const DEFAULT_CONFIG: CtxoConfig = {
  version: '1.0',
  stats: { enabled: true },
  index: { ignore: [], ignoreProjects: [] },
  masking: { clusterLabels: [] },
  watch: { snapshotMinFileChanges: DEFAULT_WATCH_SNAPSHOT_MIN_FILE_CHANGES },
  gate: { enabled: true, sensitivity: 'balanced' },
  cochange: {
    maxCommits: DEFAULT_COCHANGE_MAX_COMMITS,
    maxFilesPerCommit: DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT,
    minShared: DEFAULT_COCHANGE_MIN_SHARED,
    include: [],
    exclude: [],
  },
};
