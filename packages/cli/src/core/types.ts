import { z } from 'zod';
import { SYMBOL_KINDS, EDGE_KINDS, FACT_KINDS } from '@ctxo/plugin-api';

// ── Symbol Kinds ────────────────────────────────────────────────

export { SYMBOL_KINDS };

export const SymbolKindSchema = z.enum(SYMBOL_KINDS);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

// ── Edge Kinds ──────────────────────────────────────────────────

export { EDGE_KINDS };

export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

// ── Detail Levels ───────────────────────────────────────────────

export const DETAIL_LEVELS = [1, 2, 3, 4] as const;

export const DetailLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type DetailLevel = z.infer<typeof DetailLevelSchema>;

// ── Symbol ID ───────────────────────────────────────────────────

/**
 * Format: "<relativeFile>::<name>::<kind>"
 * Example: "src/foo.ts::myFn::function"
 */
export const SymbolIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const parts = value.split('::');
      if (parts.length !== 3) return false;
      const [file, name, kind] = parts;
      if (!file || !name || !kind) return false;
      return SymbolKindSchema.safeParse(kind).success;
    },
    { message: 'Symbol ID must match format "<file>::<name>::<kind>"' },
  );
export type SymbolId = z.infer<typeof SymbolIdSchema>;

// ── Edge Target ─────────────────────────────────────────────────

/**
 * An edge target: either a full 3-part symbol ID ("<file>::<name>::<kind>")
 * or a 2-part name-reference ("<name>::<kind>") for cross-file / unresolved
 * targets. The graph builder resolves name-references by name at query time.
 */
export const EdgeTargetSchema = z.string().refine(
  (s) => {
    const parts = s.split('::');
    if (parts.length !== 3 && parts.length !== 2) return false;
    if (parts.some((p) => p.length === 0)) return false;
    const kind = parts[parts.length - 1];
    return (SYMBOL_KINDS as readonly string[]).includes(kind as string);
  },
  { message: 'edge target must be <file>::<name>::<kind> or <name>::<kind>' },
);
export type EdgeTarget = z.infer<typeof EdgeTargetSchema>;

// ── Symbol Annotation ───────────────────────────────────────────

/** Host-language attribute or decorator on a symbol (protocol v2). Shape only; plugins enforce caps. */
export const SymbolAnnotationSchema = z.object({
  name: z.string().min(1),
  args: z.array(z.string()).readonly().optional(),
  named: z.record(z.string(), z.string()).readonly().optional(),
});
export type SymbolAnnotation = z.infer<typeof SymbolAnnotationSchema>;

// ── Symbol Node ─────────────────────────────────────────────────

export const SymbolNodeSchema = z
  .object({
    symbolId: SymbolIdSchema,
    name: z.string().min(1),
    kind: SymbolKindSchema,
    startLine: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(),
    annotations: z.array(SymbolAnnotationSchema).readonly().optional(),
  })
  .refine((node) => node.endLine >= node.startLine, {
    message: 'endLine must be >= startLine',
  });
export type SymbolNode = z.infer<typeof SymbolNodeSchema>;

// ── Graph Edge ──────────────────────────────────────────────────

export const GraphEdgeSchema = z.object({
  from: SymbolIdSchema,    // strict 3-part: from is always a local, resolved symbol
  to: EdgeTargetSchema,    // 3-part OR 2-part name-ref for cross-file/unresolved targets
  kind: EdgeKindSchema,
  typeOnly: z.boolean().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ── Commit Intent ───────────────────────────────────────────────

export const CommitIntentSchema = z.object({
  hash: z.string().min(1),
  message: z.string(),
  date: z.string().min(1),
  kind: z.literal('commit'),
});
export type CommitIntent = z.infer<typeof CommitIntentSchema>;

// ── Anti-Pattern ────────────────────────────────────────────────

export const AntiPatternSchema = z.object({
  hash: z.string().min(1),
  message: z.string(),
  date: z.string().min(1),
});
export type AntiPattern = z.infer<typeof AntiPatternSchema>;

// ── Code Fact ───────────────────────────────────────────────────

export const FactKindSchema = z.enum(FACT_KINDS);
export type FactKind = z.infer<typeof FactKindSchema>;

/** A fact extracted from a symbol body (protocol v2). The line is 0-based, like a symbol's start line. */
export const CodeFactSchema = z.object({
  kind: FactKindSchema,
  symbolId: SymbolIdSchema,
  line: z.number().int().nonnegative(),
  text: z.string(),
  detail: z.record(z.string(), z.string()).readonly().optional(),
});
export type CodeFact = z.infer<typeof CodeFactSchema>;

// ── File Index ──────────────────────────────────────────────────

export const ComplexityMetricsSchema = z.object({
  symbolId: z.string().min(1),
  cyclomatic: z.number().nonnegative(),
});

export const FileIndexSchema = z.object({
  file: z.string().min(1),
  lastModified: z.number().nonnegative(),
  contentHash: z.string().optional(),
  symbols: z.array(SymbolNodeSchema),
  edges: z.array(GraphEdgeSchema),
  complexity: z.array(ComplexityMetricsSchema).optional(),
  intent: z.array(CommitIntentSchema),
  antiPatterns: z.array(AntiPatternSchema),
  facts: z.array(CodeFactSchema).readonly().optional(),
});
export type FileIndex = z.infer<typeof FileIndexSchema>;

// ── Logic-Slice Result ──────────────────────────────────────────

export interface LogicSliceResult {
  readonly root: SymbolNode;
  readonly dependencies: readonly SymbolNode[];
  readonly edges: readonly GraphEdge[];
}

// ── Formatted Slice ─────────────────────────────────────────────

export interface TruncationInfo {
  readonly truncated: true;
  readonly reason: 'token_budget_exceeded';
}

export interface FormattedSlice {
  readonly root: SymbolNode;
  readonly dependencies: readonly SymbolNode[];
  readonly edges: readonly GraphEdge[];
  readonly level: DetailLevel;
  readonly levelDescription?: string;
  readonly truncation?: TruncationInfo;
}

// ── Complexity & Churn ──────────────────────────────────────────

export interface ComplexityMetrics {
  readonly symbolId: string;
  readonly cyclomatic: number;
}

export interface ChurnData {
  readonly filePath: string;
  readonly commitCount: number;
}

export const SCORE_BANDS = ['low', 'medium', 'high'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export interface ChangeIntelligenceScore {
  readonly symbolId: string;
  readonly complexity: number;
  readonly churn: number;
  readonly composite: number;
  readonly band: ScoreBand;
}

// ── Why-Context Result ──────────────────────────────────────────

export interface WhyContextResult {
  readonly commitHistory: readonly CommitIntent[];
  readonly antiPatternWarnings: readonly AntiPattern[];
  readonly changeIntelligence?: ChangeIntelligenceScore;
}

// ── Co-Change Analysis ─────────────────────────────────────────

export interface CoChangeEntry {
  readonly file1: string;
  readonly file2: string;
  readonly sharedCommits: number;
  readonly frequency: number;
}

/** The window a co-change matrix was built from and the filters that shaped it. */
export interface CoChangeWindowMeta {
  /** Configured commit limit: the last N non-merge commits from HEAD, or 'all'. */
  readonly maxCommits: number | 'all';
  /** Configured duration limit such as "12m", anchored to HEAD's committer date. */
  readonly since?: string;
  /** Short SHA of HEAD when the matrix was built. */
  readonly head: string;
  /** Commits inside the window. */
  readonly commitsScanned: number;
  /** Window commits that fed the counts. */
  readonly commitsUsed: number;
  /** Window commits skipped for touching more than `maxFilesPerCommit` included files. */
  readonly massSkipped: number;
  readonly maxFilesPerCommit: number;
  readonly minShared: number;
}

export interface CoChangeMatrix {
  readonly version: 1;
  readonly timestamp: number;
  /** Absent in matrices written before the window was recorded. */
  readonly window?: CoChangeWindowMeta;
  readonly entries: readonly CoChangeEntry[];
}

const CoChangeEntrySchema = z.object({
  file1: z.string().min(1),
  file2: z.string().min(1),
  sharedCommits: z.number().int().min(1),
  frequency: z.number().min(0).max(1),
});

const CoChangeWindowMetaSchema = z.object({
  maxCommits: z.union([z.number().int().min(1), z.literal('all')]),
  since: z.string().optional(),
  head: z.string().min(1),
  commitsScanned: z.number().int().min(0),
  commitsUsed: z.number().int().min(0),
  massSkipped: z.number().int().min(0),
  maxFilesPerCommit: z.number().int().min(1),
  minShared: z.number().int().min(1),
});

/**
 * Validates `co-changes.json`. `entries` is required and `window` optional, so files written before
 * the window was recorded still load. Unknown keys are dropped rather than rejected, so a file from
 * a newer Ctxo stays readable.
 */
export const CoChangeMatrixSchema: z.ZodType<CoChangeMatrix> = z.object({
  version: z.literal(1),
  timestamp: z.number(),
  window: CoChangeWindowMetaSchema.optional(),
  entries: z.array(CoChangeEntrySchema),
});

// ── Commit Record (from git adapter) ────────────────────────────

export interface CommitRecord {
  readonly hash: string;
  readonly message: string;
  readonly date: string;
  readonly author: string;
}

// ── Change Log (from git adapter) ───────────────────────────────

/** git name-status letters Ctxo keeps; A added, M modified, D deleted, R renamed, C copied, T type changed. */
export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface FileChange {
  readonly status: FileChangeStatus;
  /** Path after the change: repo-relative, forward slashes. */
  readonly path: string;
  /** Path before the change; set only for renames (R) and copies (C). */
  readonly oldPath?: string;
}

/** One non-merge commit and the files it changed. */
export interface CommitChangeSet {
  /** Full commit SHA (git %H). */
  readonly hash: string;
  /** Subject line (git %s). */
  readonly message: string;
  /** Author date, strict ISO 8601 (git %aI). */
  readonly date: string;
  /** Author name (git %an). */
  readonly author: string;
  /** Committer date in unix seconds (git %ct). */
  readonly committedAt: number;
  readonly changes: readonly FileChange[];
}

export interface ChangeLog {
  /** Short SHA of HEAD (git %h), which may itself be a merge commit. */
  readonly head: string;
  /** Committer date of HEAD in unix seconds (git %ct). */
  readonly headCommittedAt: number;
  /** Non-merge commits reachable from HEAD, newest first. */
  readonly commits: readonly CommitChangeSet[];
}

// ── Blame Line (from git adapter) ───────────────────────────────

export interface BlameLine {
  readonly hash: string;
  readonly lineNumber: number;
  readonly author: string;
  readonly date: string;
}

// ── Search Types ───────────────────────────────────────────────

export interface SearchResult {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  /** BM25 relevance score (higher = more relevant) */
  relevanceScore: number;
  /** PageRank importance score (0-1) */
  importanceScore: number;
  /** Final combined score after all boosts */
  combinedScore: number;
}

export interface SearchMetrics {
  porterHits: number;
  trigramHits: number;
  phase2Activated: boolean;
  fuzzyApplied: boolean;
  latencyMs: number;
}

export interface FuzzyCorrection {
  originalQuery: string;
  correctedQuery: string;
  corrections: Array<{
    original: string;
    corrected: string;
    distance: number;
  }>;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  metrics: SearchMetrics;
  fuzzyCorrection?: FuzzyCorrection;
}

// ── Community Detection ────────────────────────────────────────

export interface CommunityEntry {
  readonly symbolId: string;
  readonly communityId: number;
  readonly communityLabel: string;
}

export interface GodNode {
  readonly symbolId: string;
  readonly bridgedCommunities: readonly number[];
  readonly centralityScore: number;
}

export const EDGE_QUALITY = ['full', 'syntax-only', 'mixed'] as const;
export type EdgeQuality = (typeof EDGE_QUALITY)[number];

export interface CommunitySnapshot {
  readonly version: 1;
  readonly computedAt: string;
  readonly commitSha: string;
  readonly modularity: number;
  readonly communities: readonly CommunityEntry[];
  readonly godNodes: readonly GodNode[];
  readonly edgeQuality: EdgeQuality;
  readonly crossClusterEdges: number;
}

export interface DriftEvent {
  readonly symbolId: string;
  readonly movedFrom: { readonly id: number; readonly label: string };
  readonly movedTo: { readonly id: number; readonly label: string };
  readonly firstSeenInNewCluster: string;
}

export interface BoundaryViolation {
  readonly from: {
    readonly symbolId: string;
    readonly communityId: number;
    readonly label: string;
  };
  readonly to: {
    readonly symbolId: string;
    readonly communityId: number;
    readonly label: string;
  };
  readonly edgeKind: EdgeKind;
  readonly historicalEdgesBetweenClusters: number;
  readonly severity: 'high' | 'medium';
}

// ── Persisted architectural artifacts ──────────────────────────
// Written by `ctxo index` next to communities.json so the static
// HTML visualizer can render Architecture views without re-running
// detectors in the browser.

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DriftEventsArtifact {
  readonly version: 1;
  readonly computedAt: string;
  readonly commitSha: string;
  readonly confidence: ConfidenceLevel;
  /** The number of history entries passed to the detector (kept for compatibility; confidence is built on `distinctCommits`). */
  readonly snapshotsAvailable: number;
  /** Commits other than `commitSha` that the history covers; `confidence` is built on this. */
  readonly distinctCommits: number;
  readonly hint?: string;
  readonly events: readonly DriftEvent[];
}

export interface BoundaryViolationsArtifact {
  readonly version: 1;
  readonly computedAt: string;
  readonly commitSha: string;
  readonly confidence: ConfidenceLevel;
  /** The number of history entries passed to the detector (kept for compatibility; confidence is built on `distinctCommits`). */
  readonly snapshotsAvailable: number;
  /** Commits other than `commitSha` that the history covers; `confidence` is built on this. */
  readonly distinctCommits: number;
  readonly hint?: string;
  readonly violations: readonly BoundaryViolation[];
}
