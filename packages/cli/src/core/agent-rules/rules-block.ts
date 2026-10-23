/**
 * The ctxo rules block that `ctxo init` writes into an agent's instruction file (CLAUDE.md,
 * AGENTS.md, .cursor/rules/ctxo.mdc and the rest), and the parser that finds it again.
 *
 * Two tiers share one pair of versioned markers:
 * - compact: a few lines for Claude Code when the safe-edit guard, the skills and the gate back it up;
 * - full: the complete tool guide for every other client.
 *
 * The parser also recognises unversioned marked blocks and the pre-marker body that older ctxo
 * versions wrote, so an upgrade replaces them in place instead of appending a second block.
 *
 * Pure: no file system, no clock, no environment.
 */

export type RulesTier = 'compact' | 'full';

/**
 * The CLI minor in which the template text last changed (hand-set, not read from package.json),
 * so a release that leaves the template alone does not mark every committed block outdated.
 */
export const RULES_TEMPLATE_VERSION: string = '0.13';

/**
 * The CLI minor in which the bundled skills last changed (hand-set, like RULES_TEMPLATE_VERSION). Each
 * bundled SKILL.md ends with it as `<!-- ctxo-skill v<M.m> -->`, so an older ctxo leaves a skill
 * written by a newer one alone instead of downgrading it.
 */
export const SKILLS_TEMPLATE_VERSION: string = '0.13';

/** Marker lines; they also match inside a fenced code block, so a fenced copy of a block counts as one. */
const START_MARKER_RE = /^<!-- ctxo-rules-start(?: v(\S+))? -->[ \t]*$/gm;
const END_MARKER_RE = /^<!-- ctxo-rules-end -->[ \t]*$/gm;
const VERSION_RE = /^\d+\.\d+$/;
const END_MARKER = '<!-- ctxo-rules-end -->';
const BOM = '\uFEFF';

/* ------------------------------------------------------------------ */
/*  Rule texts                                                         */
/* ------------------------------------------------------------------ */

/**
 * The body every ctxo version before the tiers wrote (`ruleBody()` in `cli/ai-rules.ts`), verbatim.
 * Used only to recognise old blocks; its em dashes stay as escapes.
 */
export const LEGACY_RULE_BODY = `## ctxo MCP Tool Usage (MANDATORY)

**ALWAYS use ctxo MCP tools before reading source files or making code changes.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification
1. Call \`get_blast_radius\` for the symbol you are about to change \u2014 understand what breaks
2. Call \`get_why_context\` for the same symbol \u2014 check for revert history or anti-patterns
3. Only then read and edit source files

### Before Starting a Task
| Task Type | REQUIRED First Call |
|---|---|
| Fixing a bug | \`get_context_for_task(taskType: "fix")\` |
| Adding/extending a feature | \`get_context_for_task(taskType: "extend")\` |
| Refactoring | \`get_context_for_task(taskType: "refactor")\` |
| Understanding code | \`get_context_for_task(taskType: "understand")\` |

### Before Reviewing a PR or Diff
- Call \`get_pr_impact\` \u2014 single call gives full risk assessment with co-change analysis

### When Exploring or Searching Code
- Use \`search_symbols\` for name/regex lookup \u2014 DO NOT grep source files for symbol discovery
- Use \`get_ranked_context\` for natural language queries \u2014 DO NOT manually browse directories

### Orientation in Unfamiliar Areas
- Call \`get_architectural_overlay\` to understand layer boundaries
- Call \`get_symbol_importance\` to identify critical symbols

### NEVER Do These
- NEVER edit a function without first calling \`get_blast_radius\` on it
- NEVER skip \`get_why_context\` \u2014 reverted code and anti-patterns are invisible without it
- NEVER grep source files to find symbols when \`search_symbols\` exists
- NEVER manually trace imports when \`find_importers\` gives the full reverse dependency graph`;

/**
 * The Cursor frontmatter every ctxo version before the tiers wrote (`cursorFrontmatter()` in
 * `cli/ai-rules.ts`), verbatim. Used only to recognise old files; its em dash stays as an escape.
 */
export const LEGACY_CURSOR_FRONTMATTER = `---
description: ctxo MCP tool usage rules \u2014 always applied
globs:
alwaysApply: true
---

`;

/*
 * Both bodies are written in the layout Prettier prints (a blank line after each heading, a padded
 * table), so a repo that formats its markdown leaves them byte-for-byte alone.
 *
 * The spec caps the compact tier at 8 lines including its heading. Prettier forces blank lines after
 * the start marker, after the heading and before the end marker, so the cap counts non-blank lines
 * only: the rendered compact block has 6 (both markers, the heading, three lines of text), 9 in all.
 */

const COMPACT_RULE_BODY = `## ctxo

This repo has a ctxo index: dependency graph, git intent, change health. For structural questions (who depends on X, what breaks if X changes, why X looks like this), use the ctxo MCP tools before grepping.
A pre-edit guard blocks the first edit to a high-impact symbol until \`get_blast_radius\` has been called for it.
Skills: \`ctxo-understand\` (orient at task start), \`ctxo-safe-edit\` (before changing a symbol), \`ctxo-review-pr\` (before reviewing a diff).`;

/**
 * LEGACY_RULE_BODY with eight lines reworded (narrowed first sentence, no em dashes) and Prettier's
 * layout (blank lines after the headings, a padded table); same heading.
 */
const FULL_RULE_BODY = `## ctxo MCP Tool Usage (MANDATORY)

**For structural questions (dependencies, impact, history), use ctxo tools first; reading a file to see its contents needs no index call.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification

1. Call \`get_blast_radius\` for the symbol you are about to change, to see what breaks
2. Call \`get_why_context\` for the same symbol, to check for revert history or anti-patterns
3. Only then edit the source

### Before Starting a Task

| Task Type                  | REQUIRED First Call                            |
| -------------------------- | ---------------------------------------------- |
| Fixing a bug               | \`get_context_for_task(taskType: "fix")\`        |
| Adding/extending a feature | \`get_context_for_task(taskType: "extend")\`     |
| Refactoring                | \`get_context_for_task(taskType: "refactor")\`   |
| Understanding code         | \`get_context_for_task(taskType: "understand")\` |

### Before Reviewing a PR or Diff

- Call \`get_pr_impact\`: a single call gives a full risk assessment with co-change analysis

### When Exploring or Searching Code

- Use \`search_symbols\` for name/regex lookup; DO NOT grep source files for symbol discovery
- Use \`get_ranked_context\` for natural language queries; DO NOT manually browse directories

### Orientation in Unfamiliar Areas

- Call \`get_architectural_overlay\` to understand layer boundaries
- Call \`get_symbol_importance\` to identify critical symbols

### NEVER Do These

- NEVER edit a function without first calling \`get_blast_radius\` on it
- NEVER skip \`get_why_context\`: reverted code and anti-patterns are invisible without it
- NEVER grep source files to find symbols when \`search_symbols\` exists
- NEVER manually trace imports when \`find_importers\` gives the full reverse dependency graph`;

/** The rules body for a tier, without markers and without a trailing newline. */
export function ruleBody(options: { readonly tier: RulesTier }): string {
  return options.tier === 'compact' ? COMPACT_RULE_BODY : FULL_RULE_BODY;
}

/**
 * The body between a versioned start marker and the end marker, joined by '\n', no trailing newline.
 * A blank line separates each marker from the body, as Prettier prints it.
 */
export function renderRulesBlock(tier: RulesTier): string {
  return [`<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->`, '', ruleBody({ tier }), '', END_MARKER].join('\n');
}

/* ------------------------------------------------------------------ */
/*  BOM and line endings                                               */
/* ------------------------------------------------------------------ */

export type LineEnding = '\n' | '\r\n';

/**
 * A text file's BOM and dominant line ending, with its normalised text. Every ctxo writer that
 * must keep a user's file bytes (rules files, skills) detects and restores them through this.
 */
export interface TextShape {
  /** The content started with a UTF-8 BOM (U+FEFF). */
  readonly bom: boolean;
  /** '\r\n' when CRLF line breaks outnumber LF ones; otherwise '\n' (also on a tie or with none). */
  readonly eol: LineEnding;
  /** The content without the BOM and with every '\r\n' turned into '\n'. */
  readonly text: string;
  /** Gives text this shape's line endings only: every line break becomes `eol`. For a part of a file. */
  withEol(normalised: string): string;
  /** Gives text this whole shape: `withEol`, plus the BOM prepended when `bom`. For a whole file. */
  restore(normalised: string): string;
}

export function textShape(content: string): TextShape {
  const bom = content.startsWith(BOM);
  const raw = bom ? content.slice(BOM.length) : content;
  let crlf = 0;
  let lf = 0;
  for (let i = raw.indexOf('\n'); i >= 0; i = raw.indexOf('\n', i + 1)) {
    if (i > 0 && raw[i - 1] === '\r') crlf++;
    else lf++;
  }
  const eol: LineEnding = crlf > lf ? '\r\n' : '\n';
  const withEol = (normalised: string): string => normalised.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  return {
    bom,
    eol,
    text: raw.replace(/\r\n/g, '\n'),
    withEol,
    restore: (normalised) => (bom ? BOM : '') + withEol(normalised),
  };
}

/* ------------------------------------------------------------------ */
/*  Format-insensitive comparison                                      */
/* ------------------------------------------------------------------ */

/**
 * One line in its comparison form: trailing whitespace removed, and a table row without the padding
 * around its cells (the dashes of a separator row collapse to one). Leading whitespace is kept.
 */
function comparisonLine(line: string): string {
  const trimmed = line.trimEnd();
  if (!trimmed.trimStart().startsWith('|')) return trimmed;
  const row = trimmed.trim().replace(/[ \t]*\|[ \t]*/g, '|');
  return /^\|(?::?-+:?\|)+$/.test(row) ? row.replace(/-+/g, '-') : row;
}

/**
 * The comparison form of markdown text, so what a formatter (Prettier, markdownlint --fix, an editor)
 * changes is not an edit: no BOM, '\n' line endings, no trailing whitespace, no blank lines (every run
 * of blank lines collapses into the line break it sits in, so leading and trailing ones go too), and
 * table rows without cell padding. Blocks, legacy bodies and skills are all compared in this form.
 */
export function normaliseMarkdown(text: string): string {
  return textShape(text).text.split('\n').map(comparisonLine).filter((line) => line !== '').join('\n');
}

/**
 * The equality form of markdown text: `normaliseMarkdown`, then every whitespace run (line breaks
 * included) as one space, trimmed. Re-wrapped prose (Prettier's `proseWrap: always` or `never`),
 * indentation and padding then never count as edits. Used only to test equality (block
 * classification, the formatting-only `unchanged` upsert, the skill comparison); the tier and the
 * legacy body are still read line by line.
 */
export function comparableMarkdown(text: string): string {
  return normaliseMarkdown(text).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/*  Scanning                                                           */
/* ------------------------------------------------------------------ */

export interface RulesBlockSpan {
  /** [start, end) in the normalised text; end is right after the end marker (or the legacy body). */
  readonly start: number;
  readonly end: number;
  /** False: the legacy body found without markers. */
  readonly marked: boolean;
  /** 'M.m' from the start marker; absent when unversioned, malformed or legacy. */
  readonly version?: string;
  /** Text between the marker lines ('\n' line breaks). */
  readonly body: string;
}

export interface RulesScan {
  readonly blocks: readonly RulesBlockSpan[];
  /** A start marker has no end marker before the next start marker or the end of the text. */
  readonly unterminated: boolean;
  /** An end marker closes no block: no start marker before it, or its block was already closed. */
  readonly orphanEnd: boolean;
}

/** Finds every ctxo block in a file's content. Strips a leading BOM and normalises '\r\n' first. */
export function scanRulesBlocks(content: string): RulesScan {
  return scanNormalised(textShape(content).text);
}

function scanNormalised(text: string): RulesScan {
  const starts = [...text.matchAll(START_MARKER_RE)];
  const ends = [...text.matchAll(END_MARKER_RE)];
  const marked: RulesBlockSpan[] = [];
  let unterminated = false;

  starts.forEach((start, i) => {
    const startLineEnd = start.index + start[0].length;
    const end = ends.find((m) => m.index > startLineEnd);
    const next = starts[i + 1];
    if (!end || (next && next.index < end.index)) {
      unterminated = true;
      return;
    }
    const rawVersion = start[1];
    const version = rawVersion !== undefined && VERSION_RE.test(rawVersion) ? rawVersion : undefined;
    marked.push({
      start: start.index,
      end: end.index + end[0].length,
      marked: true,
      ...(version !== undefined ? { version } : {}),
      body: text.slice(startLineEnd + 1, end.index - 1),
    });
  });

  const closing = new Set(marked.map((b) => b.end));
  const orphanEnd = ends.some((m) => !closing.has(m.index + m[0].length));
  const blocks = [...marked, ...legacySpans(text, marked)].sort((a, b) => a.start - b.start);
  return { blocks, unterminated, orphanEnd };
}

/** LEGACY_RULE_BODY's lines in their comparison form, blank lines left out. */
const LEGACY_LINES: readonly string[] = normaliseMarkdown(LEGACY_RULE_BODY).split('\n');

/**
 * Occurrences of LEGACY_RULE_BODY on whole lines, outside every marked block, compared line by line
 * in the `normaliseMarkdown` form: a copy a formatter reshaped (blank lines added, a table padded,
 * trailing spaces) is still found. A span runs from its first line to the end of its last one.
 */
function legacySpans(text: string, marked: readonly RulesBlockSpan[]): RulesBlockSpan[] {
  const lines: Array<{ readonly start: number; readonly end: number; readonly key: string }> = [];
  for (let start = 0; start <= text.length; ) {
    const lineBreak = text.indexOf('\n', start);
    const end = lineBreak < 0 ? text.length : lineBreak;
    lines.push({ start, end, key: comparisonLine(text.slice(start, end)) });
    start = end + 1;
  }

  const spans: RulesBlockSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    if (first === undefined || first.key !== LEGACY_LINES[0]) continue;
    let matched = 1;
    let last = first;
    let j = i + 1;
    for (; j < lines.length && matched < LEGACY_LINES.length; j++) {
      const line = lines[j];
      if (line === undefined || line.key === '') continue;
      if (line.key !== LEGACY_LINES[matched]) break;
      matched += 1;
      last = line;
    }
    if (matched < LEGACY_LINES.length) continue;
    if (marked.some((b) => first.start < b.end && last.end > b.start)) continue;
    spans.push({ start: first.start, end: last.end, marked: false, body: text.slice(first.start, last.end) });
    i = j - 1;
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/*  Upsert                                                             */
/* ------------------------------------------------------------------ */

export type UpsertResult =
  | { readonly kind: 'inserted' | 'replaced' | 'unchanged'; readonly content: string }
  | { readonly kind: 'unterminated' }
  | { readonly kind: 'orphan-end' }
  | { readonly kind: 'newer'; readonly version: string };

/**
 * Writes `block` into a file's content: replaces the first ctxo block in place (marked, unmarked or
 * legacy), removes any later ones, or appends when there is none.
 *
 * Leaves the content alone when a start marker is unterminated, when an end marker closes no block
 * (a deleted start line would otherwise leave the old body and a second block), or when a block comes
 * from a newer template (D8, D2). Every byte outside the ctxo blocks is kept, the BOM included; the new
 * block takes the dominant line ending of the text around it, so a mixed-ending file is never
 * rewritten wholesale.
 * A single block with the same marker version as `block` and a body that differs only in formatting,
 * line wrapping included (`comparableMarkdown`), is `unchanged`, so ctxo and a formatter never rewrite
 * each other's output.
 */
export function upsertRulesBlock(existing: string, block: string): UpsertResult {
  const shape = textShape(existing);
  const raw = shape.bom ? existing.slice(BOM.length) : existing;
  const bom = shape.bom ? BOM : '';
  const text = shape.text;
  const scan = scanNormalised(text);
  if (scan.unterminated) return { kind: 'unterminated' };
  if (scan.orphanEnd) return { kind: 'orphan-end' };

  for (const b of scan.blocks) {
    if (b.version !== undefined && compareTemplateVersions(b.version, RULES_TEMPLATE_VERSION) > 0) {
      return { kind: 'newer', version: b.version };
    }
  }

  const [first, ...later] = scan.blocks;
  if (!first) {
    const eolShape = textShape(raw);
    const gap = raw.length === 0 ? '' : raw.endsWith('\n') ? eolShape.eol : eolShape.eol + eolShape.eol;
    return { kind: 'inserted', content: bom + raw + gap + eolShape.withEol(block) + eolShape.eol };
  }
  if (later.length === 0 && sameBlock(first, block)) return { kind: 'unchanged', content: existing };

  const toRaw = rawOffsetMapper(raw);
  const kept: string[] = [];
  let cursor = first.end;
  for (const span of later) {
    const blankBefore = text[span.start - 1] === '\n' && text[span.start - 2] === '\n';
    const from = Math.max(cursor, span.start - (blankBefore ? 1 : 0));
    const to = span.end + (text[span.end] === '\n' ? 1 : 0);
    kept.push(raw.slice(toRaw(cursor), toRaw(from)));
    cursor = to;
  }
  kept.push(raw.slice(toRaw(cursor)));

  const prefix = raw.slice(0, toRaw(first.start));
  const suffix = kept.join('');
  const around = prefix + suffix;
  // The surrounding lines set the ending; a file that is nothing but the block keeps the block's own.
  const eolShape = textShape(around.length > 0 ? around : raw.slice(toRaw(first.start), toRaw(first.end)));
  const content = bom + prefix + eolShape.withEol(block) + suffix;
  if (content === existing) return { kind: 'unchanged', content: existing };
  return { kind: 'replaced', content };
}

/** Whether `found` is a marked block with `block`'s marker version and a body equal to its in `comparableMarkdown` form. */
function sameBlock(found: RulesBlockSpan, block: string): boolean {
  const target = scanNormalised(textShape(block).text).blocks[0];
  return (
    target !== undefined &&
    found.marked &&
    target.marked &&
    found.version !== undefined &&
    found.version === target.version &&
    comparableMarkdown(found.body) === comparableMarkdown(target.body)
  );
}

/**
 * Maps an offset in the normalised text to the same place in the raw text (BOM already removed).
 * An offset that points at a normalised '\n' maps to the '\r' of its '\r\n'.
 */
function rawOffsetMapper(raw: string): (normalisedOffset: number) => number {
  const crlfAt: number[] = [];
  for (let i = raw.indexOf('\r\n'); i >= 0; i = raw.indexOf('\r\n', i + 2)) {
    crlfAt.push(i - crlfAt.length);
  }
  return (offset) => {
    let lo = 0;
    let hi = crlfAt.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((crlfAt[mid] as number) < offset) lo = mid + 1;
      else hi = mid;
    }
    return offset + lo;
  };
}

/* ------------------------------------------------------------------ */
/*  Classification and tier policy                                     */
/* ------------------------------------------------------------------ */

/** Compares two 'M.m' template versions: numeric major, then numeric minor. */
export function compareTemplateVersions(a: string, b: string): number {
  const [aMajor, aMinor] = versionParts(a);
  const [bMajor, bMinor] = versionParts(b);
  return aMajor - bMajor || aMinor - bMinor;
}

function versionParts(version: string): [number, number] {
  const [major = '', minor = ''] = version.split('.');
  return [Number(major) || 0, Number(minor) || 0];
}

const SKILL_MARKER_RE = /^<!-- ctxo-skill v(\d+\.\d+) -->[ \t]*$/m;

/** The 'M.m' version from a skill's own `<!-- ctxo-skill v<M.m> -->` line; undefined without one. */
export function skillTemplateVersion(content: string): string | undefined {
  return SKILL_MARKER_RE.exec(textShape(content).text)?.[1];
}

/**
 * The tier a body was written in, read from its first non-blank line: a formatter may put a blank
 * line after the start marker.
 */
export function blockTier(body: string): RulesTier | 'unknown' {
  const heading = body.split('\n').map((line) => line.trimEnd()).find((line) => line !== '') ?? '';
  if (heading === '## ctxo') return 'compact';
  if (heading.startsWith('## ctxo MCP Tool Usage')) return 'full';
  return 'unknown';
}

/** Each tier's body in the `comparableMarkdown` form. */
const COMPARABLE_BODIES: Readonly<Record<RulesTier, string>> = {
  compact: comparableMarkdown(COMPACT_RULE_BODY),
  full: comparableMarkdown(FULL_RULE_BODY),
};

export type BlockStatus =
  | { readonly state: 'current'; readonly tier: RulesTier }
  | { readonly state: 'outdated'; readonly reason: 'unversioned' | 'older' | 'edited'; readonly tier: RulesTier | 'unknown' }
  | { readonly state: 'newer'; readonly version: string; readonly tier: RulesTier | 'unknown' };

/**
 * Outdated: no version, an older version, or the current version with an edited body. A body that
 * differs from the template only in formatting, line wrapping included (`comparableMarkdown`), is not
 * edited. A block from a newer template is never outdated.
 */
export function classifyRulesBlock(block: RulesBlockSpan): BlockStatus {
  const tier = blockTier(block.body);
  if (!block.marked || block.version === undefined) return { state: 'outdated', reason: 'unversioned', tier };
  const order = compareTemplateVersions(block.version, RULES_TEMPLATE_VERSION);
  if (order > 0) return { state: 'newer', version: block.version, tier };
  if (order < 0) return { state: 'outdated', reason: 'older', tier };
  if (tier !== 'unknown' && comparableMarkdown(block.body) === COMPARABLE_BODIES[tier]) return { state: 'current', tier };
  return { state: 'outdated', reason: 'edited', tier };
}

export interface TierFacts {
  readonly guardPresent: boolean;
  readonly skillsComplete: boolean;
  readonly gateEnabled: boolean;
  /** The rules file is also another client's rules file (a linked AGENTS.md and CLAUDE.md); absent: not shared. */
  readonly sharedFile?: boolean;
}

/**
 * Compact only for Claude Code with the guard hook, every skill and an enabled gate, in a rules file
 * no other client reads; full otherwise. A shared file serves clients the guard and skills do not
 * back, so it gets the full tier.
 */
export function expectedRulesTier(platformId: string, facts: TierFacts): RulesTier {
  return platformId === 'claude-code' &&
    facts.guardPresent &&
    facts.skillsComplete &&
    facts.gateEnabled &&
    facts.sharedFile !== true
    ? 'compact'
    : 'full';
}

/**
 * Whether a file's block implies the guard and the skills should be installed: legacy, unversioned
 * and compact blocks do; a versioned full block records an opt-out, and no block expects nothing.
 */
export function guardAndSkillsExpected(block: RulesBlockSpan | undefined): boolean {
  if (!block) return false;
  return !block.marked || block.version === undefined || blockTier(block.body) === 'compact';
}
