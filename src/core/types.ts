import { z } from 'zod';

// ── Symbol Kinds ────────────────────────────────────────────────

export const SYMBOL_KINDS = [
  'function',
  'class',
  'interface',
  'method',
  'variable',
  'type',
] as const;

export const SymbolKindSchema = z.enum(SYMBOL_KINDS);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

// ── Edge Kinds ──────────────────────────────────────────────────

export const EDGE_KINDS = [
  'imports',
  'calls',
  'extends',
  'implements',
  'uses',
] as const;

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
  })
  .refine((node) => node.endLine >= node.startLine, {
    message: 'endLine must be >= startLine',
  });
export type SymbolNode = z.infer<typeof SymbolNodeSchema>;

// ── Graph Edge ──────────────────────────────────────────────────

export const GraphEdgeSchema = z.object({
  from: SymbolIdSchema,
  to: SymbolIdSchema,
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

// ── Commit Record (from git adapter) ────────────────────────────

export interface CommitRecord {
  readonly hash: string;
  readonly message: string;
  readonly date: string;
  readonly author: string;
}

// ── Blame Line (from git adapter) ───────────────────────────────

export interface BlameLine {
  readonly hash: string;
  readonly lineNumber: number;
  readonly author: string;
  readonly date: string;
}
