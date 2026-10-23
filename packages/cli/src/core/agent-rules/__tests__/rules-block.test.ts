import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  LEGACY_CURSOR_FRONTMATTER,
  LEGACY_RULE_BODY,
  RULES_TEMPLATE_VERSION,
  SKILLS_TEMPLATE_VERSION,
  blockTier,
  classifyRulesBlock,
  compareTemplateVersions,
  expectedRulesTier,
  guardAndSkillsExpected,
  normaliseMarkdown,
  renderRulesBlock,
  ruleBody,
  scanRulesBlocks,
  skillTemplateVersion,
  textShape,
  upsertRulesBlock,
} from '../rules-block.js';
import type { BlockStatus, RulesBlockSpan, UpsertResult } from '../rules-block.js';

const START = '<!-- ctxo-rules-start -->';
const END = '<!-- ctxo-rules-end -->';
const NARROWED =
  'For structural questions (dependencies, impact, history), use ctxo tools first; reading a file to see its contents needs no index call.';

function contentOf(result: UpsertResult): string {
  if (!('content' in result)) throw new Error(`expected content, got ${result.kind}`);
  return result.content;
}

function onlyBlock(content: string): RulesBlockSpan {
  const scan = scanRulesBlocks(content);
  expect(scan.unterminated).toBe(false);
  expect(scan.blocks).toHaveLength(1);
  const [block] = scan.blocks;
  if (!block) throw new Error('no block');
  return block;
}

function countStarts(content: string): number {
  return content.split('<!-- ctxo-rules-start').length - 1;
}

function crlf(text: string): string {
  return text.replace(/\n/g, '\r\n');
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('rule tiers', () => {
  it('the compact block is at most 8 lines including the heading and both markers', () => {
    // Prettier puts a blank line after the start marker, after the heading and before the end
    // marker, so the spec's 8-line limit counts only the non-blank lines.
    const lines = renderRulesBlock('compact').split('\n');
    expect(lines.filter((line) => line.trim() !== '')).toHaveLength(6);
    expect(lines.filter((line) => line.trim() !== '').length).toBeLessThanOrEqual(8);
    expect(lines[2]).toBe('## ctxo');
  });

  it('the compact body is the spec draft', () => {
    expect(ruleBody({ tier: 'compact' })).toBe(
      [
        '## ctxo',
        '',
        'This repo has a ctxo index: dependency graph, git intent, change health. For structural questions (who depends on X, what breaks if X changes, why X looks like this), use the ctxo MCP tools before grepping.',
        'A pre-edit guard blocks the first edit to a high-impact symbol until `get_blast_radius` has been called for it.',
        'Skills: `ctxo-understand` (orient at task start), `ctxo-safe-edit` (before changing a symbol), `ctxo-review-pr` (before reviewing a diff).',
      ].join('\n'),
    );
  });

  it('the full body differs from the legacy body in exactly the eight listed lines', () => {
    // Compared in the normaliseMarkdown form: the full body has Prettier's blank lines and table padding.
    const full = ruleBody({ tier: 'full' });
    const fullLines = normaliseMarkdown(full).split('\n');
    const legacyLines = normaliseMarkdown(LEGACY_RULE_BODY).split('\n');
    expect(fullLines).toHaveLength(legacyLines.length);
    const differing = fullLines.filter((line, i) => line !== legacyLines[i]);
    expect(differing).toEqual([
      `**${NARROWED}** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.`,
      '1. Call `get_blast_radius` for the symbol you are about to change, to see what breaks',
      '2. Call `get_why_context` for the same symbol, to check for revert history or anti-patterns',
      '3. Only then edit the source',
      '- Call `get_pr_impact`: a single call gives a full risk assessment with co-change analysis',
      '- Use `search_symbols` for name/regex lookup; DO NOT grep source files for symbol discovery',
      '- Use `get_ranked_context` for natural language queries; DO NOT manually browse directories',
      '- NEVER skip `get_why_context`: reverted code and anti-patterns are invisible without it',
    ]);
    expect(full).toContain(NARROWED);
    expect(full).not.toContain('ALWAYS use ctxo MCP tools before reading source files');
    expect(full.split('\n')[0]).toBe(LEGACY_RULE_BODY.split('\n')[0]);
  });

  it('normaliseMarkdown ignores line endings, a BOM, trailing whitespace, blank lines and table padding', () => {
    const plain = '# T\nline\n| a | b |\n|---|:-:|\n| x | y |';
    const reshaped = String.fromCharCode(0xfeff) + '\r\n\r\n# T  \r\n\r\n\r\nline\t\r\n\r\n|  a  | b |\r\n| --- | :--: |\r\n| x   | y |\r\n\r\n';
    expect(normaliseMarkdown(plain)).toBe('# T\nline\n|a|b|\n|-|:-:|\n|x|y|');
    expect(normaliseMarkdown(reshaped)).toBe(normaliseMarkdown(plain));
    expect(normaliseMarkdown('  indented\nx')).not.toBe(normaliseMarkdown('indented\nx'));
    expect(normaliseMarkdown('a b')).not.toBe(normaliseMarkdown('a  b'));
  });

  it('no new template text contains an em dash', () => {
    for (const tier of ['compact', 'full'] as const) {
      expect(ruleBody({ tier })).not.toMatch(/\u2014/);
      expect(renderRulesBlock(tier)).not.toMatch(/\u2014/);
    }
  });

  it('the legacy constants are the text ctxo shipped before the tiers', () => {
    // Fingerprints of ruleBody() and cursorFrontmatter() as evaluated from
    // packages/cli/src/cli/ai-rules.ts at bb97d5ba (unchanged since the file was created).
    expect(sha256(LEGACY_RULE_BODY)).toBe('d474d16d3eaff43bd0a38070cc69b0d902b147386f29f9a372ee74e6bf15c2d5');
    expect(sha256(LEGACY_CURSOR_FRONTMATTER)).toBe('2cb7dc91a311ce90a1566b563db31db8c5a3ebc08580a95ea84f30fff35ea9eb');
    expect(LEGACY_RULE_BODY.split('\n')).toHaveLength(33);
  });

  it('renderRulesBlock wraps the body in versioned markers', () => {
    expect(RULES_TEMPLATE_VERSION).toMatch(/^\d+\.\d+$/);
    for (const tier of ['compact', 'full'] as const) {
      const lines = renderRulesBlock(tier).split('\n');
      expect(lines[0]).toBe(`<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->`);
      expect(lines[1]).toBe('');
      expect(lines[lines.length - 2]).toBe('');
      expect(lines[lines.length - 1]).toBe(END);
      expect(lines.slice(2, -2).join('\n')).toBe(ruleBody({ tier }));
    }
  });
});

describe('scanRulesBlocks', () => {
  it('scanRulesBlocks reads versioned and unversioned markers', () => {
    const versioned = '<!-- ctxo-rules-start v0.9 -->\nA\n' + END;
    const unversioned = START + '\nB\nB2\n' + END;
    const malformed = '<!-- ctxo-rules-start vnext -->\nC\n' + END;
    const content = 'Intro\n' + versioned + '\nMid\n\n' + unversioned + '\n' + malformed + '\n';
    const at = (part: string): number => content.indexOf(part);

    expect(scanRulesBlocks(content)).toEqual({
      unterminated: false,
      orphanEnd: false,
      blocks: [
        { start: at(versioned), end: at(versioned) + versioned.length, marked: true, version: '0.9', body: 'A' },
        { start: at(unversioned), end: at(unversioned) + unversioned.length, marked: true, version: undefined, body: 'B\nB2' },
        { start: at(malformed), end: at(malformed) + malformed.length, marked: true, version: undefined, body: 'C' },
      ],
    });
  });

  it('scanRulesBlocks finds the legacy body without markers but not inside a marked block', () => {
    const legacy = scanRulesBlocks('# Mine\n\n' + LEGACY_RULE_BODY + '\n');
    expect(legacy).toEqual({
      unterminated: false,
      orphanEnd: false,
      blocks: [{ start: 8, end: 8 + LEGACY_RULE_BODY.length, marked: false, body: LEGACY_RULE_BODY }],
    });

    const wrapped = scanRulesBlocks(START + '\n' + LEGACY_RULE_BODY + '\n' + END + '\n');
    expect(wrapped.blocks).toHaveLength(1);
    expect(wrapped.blocks[0]).toMatchObject({ start: 0, marked: true, body: LEGACY_RULE_BODY });
  });

  it('scanRulesBlocks flags a start marker without an end marker', () => {
    expect(scanRulesBlocks(`A\n<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->\nbody\n`).unterminated).toBe(true);
    const nested = scanRulesBlocks(START + '\nold\n' + START + '\nnew\n' + END + '\n');
    expect(nested.unterminated).toBe(true);
    expect(nested.blocks.map((b) => b.body)).toEqual(['new']);
  });

  it('scanRulesBlocks ignores a marker that is not on its own line', () => {
    expect(scanRulesBlocks('see `<!-- ctxo-rules-start -->` here\n')).toEqual({ blocks: [], unterminated: false, orphanEnd: false });
  });

  it('scanRulesBlocks also reads markers inside a code fence, as documented', () => {
    const fenced = 'Docs\n\n```md\n' + START + '\nexample\n' + END + '\n```\n';
    expect(scanRulesBlocks(fenced).blocks.map((b) => b.body)).toEqual(['example']);
  });

  it('scanRulesBlocks flags an end marker without a start marker', () => {
    expect(scanRulesBlocks('Intro\n\nold rules\n' + END + '\n')).toEqual({ blocks: [], unterminated: false, orphanEnd: true });
    const after = scanRulesBlocks(START + '\nx\n' + END + '\n\n' + END + '\n');
    expect(after.orphanEnd).toBe(true);
    expect(after.blocks).toHaveLength(1);
    expect(scanRulesBlocks(END + '\n' + START + '\nx\n' + END + '\n').orphanEnd).toBe(true);
    expect(scanRulesBlocks(START + '\nx\n' + END + '\n').orphanEnd).toBe(false);
    expect(scanRulesBlocks(START + '\nold\n' + START + '\nnew\n' + END + '\n')).toMatchObject({ unterminated: true, orphanEnd: false });
  });

  it('scanRulesBlocks reads CRLF text with a BOM in normalised offsets', () => {
    const scan = scanRulesBlocks('\uFEFFTop\r\n' + crlf(START + '\nx\n' + END) + '\r\n');
    expect(scan.blocks).toEqual([{ start: 4, end: 4 + (START + '\nx\n' + END).length, marked: true, version: undefined, body: 'x' }]);
  });
});

describe('upsertRulesBlock', () => {
  const block = renderRulesBlock('compact');

  it('upsertRulesBlock replaces an unversioned block in place and keeps the text around it', () => {
    const result = upsertRulesBlock('Intro\n\n' + START + '\nold\n' + END + '\n\nOutro\n', block);
    expect(result).toEqual({ kind: 'replaced', content: 'Intro\n\n' + block + '\n\nOutro\n' });
  });

  it('upsertRulesBlock appends once, then reports unchanged', () => {
    const first = upsertRulesBlock('# P\n', block);
    expect(first).toEqual({ kind: 'inserted', content: '# P\n\n' + block + '\n' });
    const second = upsertRulesBlock(contentOf(first), block);
    expect(second).toEqual({ kind: 'unchanged', content: contentOf(first) });
    expect(countStarts(contentOf(second))).toBe(1);

    expect(upsertRulesBlock('', block)).toEqual({ kind: 'inserted', content: block + '\n' });
    expect(upsertRulesBlock('# P', block)).toEqual({ kind: 'inserted', content: '# P\n\n' + block + '\n' });
  });

  it('upsertRulesBlock replaces the legacy body in place', () => {
    const result = upsertRulesBlock('Top\n\n' + LEGACY_RULE_BODY + '\n\nBottom\n', block);
    expect(result).toEqual({ kind: 'replaced', content: 'Top\n\n' + block + '\n\nBottom\n' });
  });

  it('upsertRulesBlock collapses two blocks into one at the first position', () => {
    const before =
      LEGACY_RULE_BODY + '\n\nUser notes\n\n' + START + '\n' + LEGACY_RULE_BODY + '\n' + END + '\n';
    expect(upsertRulesBlock(before, block)).toEqual({ kind: 'replaced', content: block + '\n\nUser notes\n' });

    const three = 'A\n\n' + START + '\nx\n' + END + '\nB\n' + START + '\ny\n' + END + '\n\n' + START + '\nz\n' + END;
    expect(upsertRulesBlock(three, block)).toEqual({ kind: 'replaced', content: 'A\n\n' + block + '\nB\n' });
  });

  it('upsertRulesBlock reports a block that differs only in formatting as unchanged', () => {
    const reshaped = 'Top\n\n' + block.replace('## ctxo\n', '## ctxo   \n\n\n') + '\n';
    expect(upsertRulesBlock(reshaped, block)).toEqual({ kind: 'unchanged', content: reshaped });

    // Another marker version, an unversioned marker or a second block still gets rewritten.
    const older = 'Top\n\n' + block.replace(`v${RULES_TEMPLATE_VERSION}`, 'v0.1') + '\n';
    expect(upsertRulesBlock(older, block)).toEqual({ kind: 'replaced', content: 'Top\n\n' + block + '\n' });
    const unversioned = 'Top\n\n' + block.replace(` v${RULES_TEMPLATE_VERSION}`, '') + '\n';
    expect(upsertRulesBlock(unversioned, block).kind).toBe('replaced');
    expect(upsertRulesBlock(reshaped + '\n' + block + '\n', block)).toEqual({ kind: 'replaced', content: 'Top\n\n' + block + '\n' });
  });

  it('upsertRulesBlock leaves an unterminated block alone', () => {
    expect(upsertRulesBlock('# P\n\n' + START + '\nold\n', block)).toEqual({ kind: 'unterminated' });
  });

  it('upsertRulesBlock leaves a file with an orphan end marker alone instead of adding a second block', () => {
    expect(upsertRulesBlock('# P\n\nold rules\n' + END + '\n', block)).toEqual({ kind: 'orphan-end' });
    expect(upsertRulesBlock('# P\n\n' + START + '\nx\n' + END + '\n' + END + '\n', block)).toEqual({ kind: 'orphan-end' });
  });

  it('upsertRulesBlock leaves a block from a newer template alone', () => {
    const before = '# P\n\n<!-- ctxo-rules-start v99.0 -->\nfuture\n' + END + '\n';
    expect(upsertRulesBlock(before, block)).toEqual({ kind: 'newer', version: '99.0' });
  });

  it('upsertRulesBlock keeps CRLF line endings and a UTF-8 BOM', () => {
    const before = '\uFEFF' + START + '\r\nold\r\n' + END + '\r\nUser\r\n';
    const result = upsertRulesBlock(before, block);
    expect(result.kind).toBe('replaced');
    const content = contentOf(result);
    expect(content.startsWith('\uFEFF<!-- ctxo-rules-start v')).toBe(true);
    expect(content.endsWith('\r\nUser\r\n')).toBe(true);
    expect(content).not.toMatch(/(?<!\r)\n/);
    expect(countStarts(content)).toBe(1);
    expect(content).toBe('\uFEFF' + crlf(block) + '\r\nUser\r\n');
    expect(upsertRulesBlock(content, block)).toEqual({ kind: 'unchanged', content });

    const appended = contentOf(upsertRulesBlock('\uFEFF# P\r\n', block));
    expect(appended).toBe('\uFEFF# P\r\n\r\n' + crlf(block) + '\r\n');
  });

  it('upsertRulesBlock leaves the other lines of a mixed-ending file untouched', () => {
    // Mostly CRLF around the block: the block is written with CRLF, nothing else moves.
    const head = '# Title\r\nline one\nline two\r\n\r\n';
    const tail = '\r\nNotes\nmore\r\nend\r\n';
    const before = head + START + '\nold\r\n' + END + tail;
    const replaced = upsertRulesBlock(before, block);
    expect(replaced).toEqual({ kind: 'replaced', content: head + crlf(block) + tail });
    expect(upsertRulesBlock(contentOf(replaced), block).kind).toBe('unchanged');

    // Mostly LF around the block: the block is written with LF.
    const lfHead = '# T\nA\nB\r\n\n';
    const lfTail = '\nC\r\nD\n';
    const lfBefore = lfHead + START + '\r\nold\r\n' + END + lfTail;
    expect(upsertRulesBlock(lfBefore, block)).toEqual({ kind: 'replaced', content: lfHead + block + lfTail });

    // Appending keeps every existing byte and uses the dominant ending for the new lines.
    const plain = 'A\r\nB\nC\r\n';
    expect(upsertRulesBlock(plain, block)).toEqual({ kind: 'inserted', content: plain + '\r\n' + crlf(block) + '\r\n' });

    // Collapsing a second block removes only that block and its own line breaks.
    const two = 'A\r\n\r\n' + START + '\nx\n' + END + '\r\nB\n\r\n' + START + '\r\ny\r\n' + END + '\r\nC\n';
    expect(upsertRulesBlock(two, block)).toEqual({ kind: 'replaced', content: 'A\r\n\r\n' + crlf(block) + '\r\nB\nC\n' });
  });

  it('upsertRulesBlock never writes a BOM in front of the block', () => {
    // Only the leading BOM is the file's; a second one is content and must not be copied onto the block.
    const bomChar = String.fromCharCode(0xfeff);
    const before = bomChar + bomChar + 'Top\n';
    const inserted = contentOf(upsertRulesBlock(before, block));
    expect(inserted).toBe(before + '\n' + block + '\n');
    expect(upsertRulesBlock(inserted, block)).toEqual({ kind: 'unchanged', content: inserted });
  });
});

describe('textShape', () => {
  it('textShape detects a BOM and the dominant line ending and restores them', () => {
    const shape = textShape('\uFEFFa\r\nb\r\nc\n');
    expect(shape.bom).toBe(true);
    expect(shape.eol).toBe('\r\n');
    expect(shape.text).toBe('a\nb\nc\n');
    expect(shape.restore('x\ny\n')).toBe('\uFEFFx\r\ny\r\n');

    const lf = textShape('a\nb\r\nc\n');
    expect(lf.bom).toBe(false);
    expect(lf.eol).toBe('\n');
    expect(lf.restore('x\r\ny')).toBe('x\ny');

    expect(textShape('').eol).toBe('\n');
    expect(textShape('a\r\nb\n').eol).toBe('\n');
    expect(shape.withEol('x\ny')).toBe('x\r\ny');
  });
});

describe('block classification and tier policy', () => {
  const current = (tier: 'compact' | 'full'): RulesBlockSpan => onlyBlock(renderRulesBlock(tier));
  const marked = (version: string | undefined, body: string): RulesBlockSpan =>
    onlyBlock(`<!-- ctxo-rules-start${version === undefined ? '' : ` v${version}`} -->\n${body}\n${END}\n`);

  it('classifyRulesBlock covers current, edited, older, unversioned, legacy and newer blocks', () => {
    const rows: Array<[string, RulesBlockSpan, BlockStatus]> = [
      ['current compact', current('compact'), { state: 'current', tier: 'compact' }],
      ['current full', current('full'), { state: 'current', tier: 'full' }],
      [
        'edited',
        marked(RULES_TEMPLATE_VERSION, ruleBody({ tier: 'compact' }) + '\nMy own line'),
        { state: 'outdated', reason: 'edited', tier: 'compact' },
      ],
      ['older', marked('0.1', ruleBody({ tier: 'compact' })), { state: 'outdated', reason: 'older', tier: 'compact' }],
      ['unversioned', marked(undefined, LEGACY_RULE_BODY), { state: 'outdated', reason: 'unversioned', tier: 'full' }],
      ['legacy', onlyBlock(LEGACY_RULE_BODY + '\n'), { state: 'outdated', reason: 'unversioned', tier: 'full' }],
      ['newer', marked('99.0', 'future'), { state: 'newer', version: '99.0', tier: 'unknown' }],
    ];
    for (const [name, span, expected] of rows) {
      expect({ name, status: classifyRulesBlock(span) }).toEqual({ name, status: expected });
    }
  });

  it('blockTier reads the heading line', () => {
    expect(blockTier(ruleBody({ tier: 'compact' }))).toBe('compact');
    expect(blockTier(ruleBody({ tier: 'full' }))).toBe('full');
    expect(blockTier('\n\n## ctxo  \n\nx')).toBe('compact');
    expect(blockTier('\r\n## ctxo MCP Tool Usage (MANDATORY)\r\n')).toBe('full');
    expect(blockTier(LEGACY_RULE_BODY)).toBe('full');
    expect(blockTier('## ctxo notes\nx')).toBe('unknown');
    expect(blockTier('')).toBe('unknown');
  });

  it('expectedRulesTier is compact only for claude-code with the guard, every skill and an enabled gate', () => {
    for (const guardPresent of [false, true]) {
      for (const skillsComplete of [false, true]) {
        for (const gateEnabled of [false, true]) {
          const facts = { guardPresent, skillsComplete, gateEnabled };
          const expected = guardPresent && skillsComplete && gateEnabled ? 'compact' : 'full';
          expect({ facts, tier: expectedRulesTier('claude-code', facts) }).toEqual({ facts, tier: expected });
        }
      }
    }
    expect(expectedRulesTier('cursor', { guardPresent: true, skillsComplete: true, gateEnabled: true })).toBe('full');
    const backed = { guardPresent: true, skillsComplete: true, gateEnabled: true };
    expect(expectedRulesTier('claude-code', { ...backed, sharedFile: false })).toBe('compact');
    expect(expectedRulesTier('claude-code', { ...backed, sharedFile: true })).toBe('full');
  });

  it('guardAndSkillsExpected is true for legacy, unversioned and compact blocks and false for a versioned full block or none', () => {
    expect(guardAndSkillsExpected(onlyBlock(LEGACY_RULE_BODY + '\n'))).toBe(true);
    expect(guardAndSkillsExpected(marked(undefined, LEGACY_RULE_BODY))).toBe(true);
    expect(guardAndSkillsExpected(current('compact'))).toBe(true);
    expect(guardAndSkillsExpected(marked('0.1', ruleBody({ tier: 'compact' })))).toBe(true);
    expect(guardAndSkillsExpected(current('full'))).toBe(false);
    expect(guardAndSkillsExpected(undefined)).toBe(false);
  });

  it('skillTemplateVersion reads the skill marker line', () => {
    expect(SKILLS_TEMPLATE_VERSION).toMatch(/^\d+\.\d+$/);
    expect(skillTemplateVersion('# S\n\n<!-- ctxo-skill v0.13 -->\n')).toBe('0.13');
    expect(skillTemplateVersion(String.fromCharCode(0xfeff) + '# S\r\n\r\n<!-- ctxo-skill v1.2 -->  \r\n')).toBe('1.2');
    expect(skillTemplateVersion('# S\n')).toBeUndefined();
    expect(skillTemplateVersion('# S\n<!-- ctxo-skill vnext -->\n')).toBeUndefined();
    expect(skillTemplateVersion('see `<!-- ctxo-skill v0.13 -->` here\n')).toBeUndefined();
  });

  it('compareTemplateVersions compares numerically', () => {
    expect(compareTemplateVersions('0.9', '0.13')).toBeLessThan(0);
    expect(compareTemplateVersions('0.13', '0.13')).toBe(0);
    expect(compareTemplateVersions('1.0', '0.13')).toBeGreaterThan(0);
    expect(compareTemplateVersions('0.13', '0.9')).toBeGreaterThan(0);
  });
});
