import { posix } from 'node:path';
import type { BoundaryResult } from './boundaries.js';
import { githubSlugs, headingOrderProblems, type ParsedCard } from './card-parser.js';
import { DEFAULT_DOMAIN_CONFIG, type ConfigProblem, type DomainConfig } from './domain-config.js';
import type { LoaderRulesDiff } from './loader-rules.js';
import { createOwnership, type GlobMatcherFactory } from './ownership.js';
import type { DomainContext, DomainRegistry, LoadedRegistry } from './registry.js';
import type { UnresolvedRef } from './domain-graph.js';
import type { RuleLinks, RuleRef } from './rule-id-scan.js';
import { cardRefFile } from './rule-test-links.js';
import type { ParsedShadowSpecs, ResolutionEntry } from './shadow-specs-file.js';
import type { TouchedReport } from './touched.js';

export const VERIFY_CHECKS = ['1', '2', '3', '4a', '4b', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
export type VerifyCheckId = (typeof VERIFY_CHECKS)[number];

export interface Finding {
  readonly check: VerifyCheckId;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly context?: string;
}

export interface CheckOutcome {
  readonly id: VerifyCheckId;
  readonly title: string;
  readonly status: 'pass' | 'warn' | 'fail' | 'skipped';
  readonly findings: readonly Finding[];
}

export interface VerifyInput {
  readonly registry: LoadedRegistry;
  readonly config: DomainConfig;
  readonly configProblems: readonly ConfigProblem[];
  readonly indexedFiles: readonly string[];
  readonly isTestFile: (path: string) => boolean;
  readonly makeMatcher: GlobMatcherFactory;
  /** By card path; undefined when the file is missing. */
  readonly cards: ReadonlyMap<string, ParsedCard | undefined>;
  readonly fileExists: (repoPath: string) => boolean;
  /** A regular file, not a directory, for `Tests:` values (A39); defaults to `fileExists`. */
  readonly isRepoFile?: (repoPath: string) => boolean;
  /** Anchors of a markdown target; undefined when the target is not markdown or unreadable. */
  readonly headingSlugs: (repoPath: string) => ReadonlySet<string> | undefined;
  readonly ruleLinks: RuleLinks;
  /** P20: the unresolved card refs of `ruleTestLinks` and `ruleSymbolLinks`; defaults to none. */
  readonly cardRefProblems?: readonly UnresolvedRef[];
  /** P20: `resolveRuleRefs(...).unknown` of `scanRuleComments` over indexed non-test files; defaults to none. */
  readonly codeRuleRefs?: readonly RuleRef[];
  readonly loaderDiff: LoaderRulesDiff;
  readonly contextMapText?: string;
  readonly boundaries: BoundaryResult;
  /** Only with --since. */
  readonly touched?: TouchedReport;
  /** Check 12 (H6, W15): each context's `shadow-specs.yaml` with its resolutions applied; defaults to none. */
  readonly shadowSpecs?: readonly ShadowSpecsCheckInput[];
  /** Check 12: `shadow-specs.yaml` files whose folder names no context; defaults to none. */
  readonly orphanShadowSpecs?: readonly string[];
  /** Check 12: why the candidates could not be built, so staleness is unknown; absent when they were built. */
  readonly candidatesUnavailable?: string;
}

/** One context's resolution file for check 12. */
export interface ShadowSpecsCheckInput {
  readonly context: string;
  /** Repo-relative, posix. */
  readonly path: string;
  /** Absent: there is no file. */
  readonly parsed?: ParsedShadowSpecs;
  /** Entries matching no candidate of the context (`applyResolutions(...).stale`). */
  readonly stale: readonly ResolutionEntry[];
  /** Entries naming an unknown rule (`applyResolutions(...).unknownRules`). */
  readonly unknownRules: readonly ResolutionEntry[];
}

const TITLES: Record<VerifyCheckId, string> = {
  '1': 'Registry and config',
  '2': 'Cards present',
  '3': 'Path globs match',
  '4a': 'Single owner',
  '4b': 'Unowned files',
  '5': 'Card headings',
  '6': 'Rule IDs and test links',
  '7': 'Card links',
  '8': 'Generated loader rules',
  '9': 'Context map rungs',
  '10': 'Boundaries',
  '11': 'Fold since ref',
  '12': 'Shadow-spec resolutions',
};

const UNOWNED_LIST_LIMIT = 20;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function outcomeOf(id: VerifyCheckId, findings: readonly Finding[]): CheckOutcome {
  const status = findings.some((f) => f.severity === 'error') ? 'fail' : findings.length > 0 ? 'warn' : 'pass';
  return { id, title: TITLES[id], status, findings };
}

function skipped(id: VerifyCheckId): CheckOutcome {
  return { id, title: TITLES[id], status: 'skipped', findings: [] };
}

function error(check: VerifyCheckId, message: string, extra: Partial<Finding> = {}): Finding {
  return { check, severity: 'error', message, ...extra };
}

function warning(check: VerifyCheckId, message: string, extra: Partial<Finding> = {}): Finding {
  return { check, severity: 'warning', message, ...extra };
}

function check1(input: VerifyInput): CheckOutcome {
  const findings: Finding[] = [
    ...input.registry.problems.map((p) => error('1', `${p.path}: ${p.message}`, { file: input.registry.path })),
    ...input.configProblems.map((p) => error('1', `${p.path}: ${p.message}`)),
  ];
  return outcomeOf('1', findings);
}

function check2(registry: DomainRegistry, input: VerifyInput): CheckOutcome {
  const findings: Finding[] = [];
  for (const context of registry.contexts) {
    if (context.card === undefined) {
      if (context.rung !== 'fear') {
        findings.push(error('2', `${context.id}: rung "${context.rung}" needs a card; set "card" or lower the rung to fear`, { context: context.id }));
      }
      continue;
    }
    if (input.cards.get(context.card) === undefined) {
      findings.push(error('2', `${context.id}: card "${context.card}" does not exist`, { file: context.card, context: context.id }));
    }
  }
  return outcomeOf('2', findings);
}

function check3(registry: DomainRegistry, input: VerifyInput): CheckOutcome {
  const findings: Finding[] = [];
  for (const context of registry.contexts) {
    for (const glob of context.paths) {
      const matches = input.makeMatcher([glob]);
      if (!input.indexedFiles.some((file) => matches(file))) {
        findings.push(error('3', `${context.id}: "${glob}" matches no indexed file`, { context: context.id }));
      }
    }
  }
  return outcomeOf('3', findings);
}

function check4(registry: DomainRegistry, input: VerifyInput): [CheckOutcome, CheckOutcome] {
  const ownership = createOwnership(registry, input.makeMatcher);
  const multiple: Finding[] = [];
  const unowned: string[] = [];
  for (const file of [...input.indexedFiles].sort(compare)) {
    if (input.isTestFile(file)) continue;
    const owners = ownership.owners(file);
    if (owners.length >= 2) {
      multiple.push(error('4a', `${file} is owned by ${owners.length} contexts: ${owners.join(', ')}`, { file }));
    } else if (owners.length === 0 && !ownership.isAllowedUnowned(file)) {
      unowned.push(file);
    }
  }
  const findings: Finding[] = [];
  if (unowned.length > 0) {
    const message = `${unowned.length} indexed files belong to no context: ${unowned.slice(0, UNOWNED_LIST_LIMIT).join(', ')}`;
    findings.push(input.config.coverage.unowned === 'error' ? error('4b', message) : warning('4b', message));
  }
  return [outcomeOf('4a', multiple), outcomeOf('4b', findings)];
}

interface CardRef {
  readonly context: DomainContext;
  readonly path: string;
  readonly card: ParsedCard;
}

function presentCards(registry: DomainRegistry, input: VerifyInput): CardRef[] {
  const refs: CardRef[] = [];
  for (const context of registry.contexts) {
    if (context.card === undefined) continue;
    const card = input.cards.get(context.card);
    if (card !== undefined) refs.push({ context, path: context.card, card });
  }
  return refs;
}

function check5(cards: readonly CardRef[]): CheckOutcome {
  const findings: Finding[] = [];
  for (const { context, path, card } of cards) {
    for (const problem of headingOrderProblems(card.headings)) {
      findings.push(error('5', `${context.id}: ${problem}`, { file: path, context: context.id }));
    }
  }
  return outcomeOf('5', findings);
}

function idRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(DEFAULT_DOMAIN_CONFIG.rules.idPattern);
  }
}

/** A `Tests:` value may carry a `::name` or `#name` suffix after the path. */
function testPath(value: string): string {
  const cut = value.search(/::|#/);
  return (cut === -1 ? value : value.slice(0, cut)).trim();
}

function check6(registry: DomainRegistry, cards: readonly CardRef[], input: VerifyInput): CheckOutcome {
  const findings: Finding[] = [];
  const pattern = idRegExp(input.config.rules.idPattern);
  const seen = new Map<string, string>();
  for (const { context, path, card } of cards) {
    for (const rule of card.rules) {
      const at = { file: path, line: rule.line, context: context.id };
      if (!pattern.test(rule.id)) {
        findings.push(error('6', `${rule.id}: id does not match ${input.config.rules.idPattern}`, at));
      }
      if (context.rulePrefix !== undefined && !rule.id.startsWith(`${context.rulePrefix}-`)) {
        findings.push(error('6', `${rule.id}: id must start with "${context.rulePrefix}-" for context ${context.id}`, at));
      }
      const first = seen.get(rule.id);
      if (first !== undefined) {
        findings.push(error('6', `${rule.id}: duplicate rule id, first defined in ${first}`, at));
      } else {
        seen.set(rule.id, path);
      }
      for (const test of rule.tests) {
        const file = testPath(test);
        if (!(input.isRepoFile ?? input.fileExists)(file)) findings.push(error('6', `${rule.id}: Tests file "${file}" does not exist`, at));
      }
      const linked = (input.ruleLinks.links.get(rule.id)?.length ?? 0) > 0;
      if (!linked && rule.tests.length === 0 && rule.untested === undefined) {
        findings.push(error('6', `${rule.id}: no test link, no "Tests:" line and no "Untested:" line`, at));
      }
    }
  }
  const unknown = [...input.ruleLinks.unknown].sort(
    (a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.id, b.id),
  );
  for (const ref of unknown) {
    findings.push(error('6', `${ref.id}: referenced as "${ref.raw}" but no card defines it`, { file: ref.file, line: ref.line }));
  }
  findings.push(...cardRefFindings(cards, input.cardRefProblems ?? []));
  findings.push(...codeRuleFindings(registry, cards, input.codeRuleRefs ?? []));
  return outcomeOf('6', findings);
}

const prefixOf = (id: string): string => {
  const dash = id.indexOf('-');
  return dash < 0 ? id : id.slice(0, dash);
};

/**
 * F3 and P5: a `Code:` file that does not exist is an error; a symbol ID missing from the index is a warning (it
 * links to its file). A missing `Tests:` file is already reported from the card above, with 2B's wording.
 */
function cardRefFindings(cards: readonly CardRef[], problems: readonly UnresolvedRef[]): Finding[] {
  const contextOf = new Map(cards.map((c) => [c.path, c.context.id]));
  const sorted = [...problems].sort(
    (a, b) => compare(a.at.file, b.at.file) || a.at.line - b.at.line || compare(a.field, b.field) || compare(a.value, b.value) || compare(a.rule, b.rule),
  );
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const p of sorted) {
    if (p.reason === 'missing-file' && p.field === 'Tests') continue;
    const message =
      p.reason === 'missing-file'
        ? `${p.rule}: ${p.field} file "${cardRefFile(p.value)}" does not exist`
        : `${p.rule}: ${p.field}: "${p.value}" is not an indexed symbol; it links to its file`;
    const key = `${p.at.file}\n${p.at.line}\n${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const context = contextOf.get(p.at.file);
    const at = { file: p.at.file, line: p.at.line, ...(context === undefined ? {} : { context }) };
    findings.push(p.reason === 'missing-file' ? error('6', message, at) : warning('6', message, at));
  }
  return findings;
}

/** F4: an unknown ID in a production `rule:` comment warns only when its prefix is a rule prefix (`# rule: E501` stays silent). */
function codeRuleFindings(registry: DomainRegistry, cards: readonly CardRef[], refs: readonly RuleRef[]): Finding[] {
  const prefixes = new Set<string>();
  for (const { card } of cards) for (const rule of card.rules) prefixes.add(prefixOf(rule.id));
  for (const context of registry.contexts) if (context.rulePrefix !== undefined) prefixes.add(context.rulePrefix);
  const sorted = [...refs].sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.id, b.id));
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const ref of sorted) {
    if (!prefixes.has(prefixOf(ref.id))) continue;
    const key = `${ref.file}\n${ref.line}\n${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(warning('6', `rule: comment names unknown rule ${ref.id}`, { file: ref.file, line: ref.line }));
  }
  return findings;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function check7(cards: readonly CardRef[], input: VerifyInput): CheckOutcome {
  const findings: Finding[] = [];
  for (const { context, path, card } of cards) {
    const ownSlugs = githubSlugs(card.headings);
    for (const link of card.links) {
      const target = link.target.trim();
      if (target === '' || SCHEME.test(target) || target.startsWith('//')) continue;
      const at = { file: path, line: link.line, context: context.id };
      const hash = target.indexOf('#');
      const rawPath = hash === -1 ? target : target.slice(0, hash);
      const anchor = hash === -1 ? '' : decode(target.slice(hash + 1)).toLowerCase();
      const pathPart = decode(rawPath.split('?')[0]!).replace(/\\/g, '/');

      let slugs: ReadonlySet<string> | undefined;
      if (pathPart === '') {
        slugs = ownSlugs;
      } else {
        const resolved = pathPart.startsWith('/') ? posix.normalize(pathPart.slice(1)) : posix.normalize(posix.join(posix.dirname(path), pathPart));
        if (resolved === '..' || resolved.startsWith('../') || !input.fileExists(resolved.replace(/\/$/, ''))) {
          findings.push(error('7', `link target "${target}" does not exist`, at));
          continue;
        }
        slugs = input.headingSlugs(resolved);
      }
      if (anchor !== '' && slugs !== undefined && !slugs.has(anchor)) {
        findings.push(error('7', `link anchor "#${anchor}" not found in ${pathPart === '' ? path : pathPart}`, at));
      }
    }
  }
  return outcomeOf('7', findings);
}

function check8(diff: LoaderRulesDiff): CheckOutcome {
  const findings: Finding[] = [];
  for (const file of diff.missing) findings.push(error('8', `${file} is missing; run ctxo domain rules --write`, { file }));
  for (const file of diff.outdated) findings.push(error('8', `${file} is outdated; run ctxo domain rules --write`, { file }));
  for (const file of diff.stale) findings.push(error('8', `${file} is stale; run ctxo domain rules --write`, { file }));
  for (const file of diff.blocked) {
    findings.push(error('8', `${file} exists without the generated marker; rename it or delete it, then run --write`, { file }));
  }
  return outcomeOf('8', findings);
}

function stripMarkup(cell: string): string {
  return cell
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*~]/g, '')
    .trim()
    .replace(/^_+|_+$/g, '')
    .trim();
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

const SEPARATOR_CELL = /^:?-+:?$/;

/** The first table with Context and Rung columns: stripped context cell -> stripped rung cell. */
export function contextMapRows(text: string): Map<string, string> | undefined {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.trim().startsWith('|')) {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]!.trim().startsWith('|')) end++;
    const block = lines.slice(i, end);
    i = end;
    if (block.length < 2) continue;
    const separator = splitRow(block[1]!);
    if (!separator.every((cell) => SEPARATOR_CELL.test(cell))) continue;
    const header = splitRow(block[0]!).map((cell) => stripMarkup(cell).toLowerCase());
    const contextColumn = header.indexOf('context');
    const rungColumn = header.indexOf('rung');
    if (contextColumn === -1 || rungColumn === -1) continue;
    const rows = new Map<string, string>();
    for (const line of block.slice(2)) {
      const cells = splitRow(line);
      const key = stripMarkup(cells[contextColumn] ?? '');
      if (key === '' || rows.has(key)) continue;
      rows.set(key, stripMarkup(cells[rungColumn] ?? ''));
    }
    return rows;
  }
  return undefined;
}

function check9(registry: DomainRegistry, input: VerifyInput): CheckOutcome {
  const file = registry.contextMap;
  if (input.contextMapText === undefined) {
    if (registry.contexts.length === 0) return outcomeOf('9', []);
    return outcomeOf('9', [warning('9', `${file} does not exist; the context map should list every context with its rung`, { file })]);
  }
  if (registry.contexts.length === 0) return outcomeOf('9', []);
  const rows = contextMapRows(input.contextMapText);
  if (rows === undefined) {
    return outcomeOf('9', [error('9', `${file} has no table with "Context" and "Rung" columns`, { file })]);
  }
  const findings: Finding[] = [];
  const matched = new Set<string>();
  for (const context of registry.contexts) {
    const wanted = new Set([context.id.toLowerCase(), context.name.toLowerCase()]);
    const key = [...rows.keys()].find((k) => wanted.has(k.toLowerCase()));
    if (key === undefined) {
      findings.push(error('9', `${context.id}: missing from the context map table`, { file, context: context.id }));
      continue;
    }
    matched.add(key);
    const rung = rows.get(key)!;
    if (rung.toLowerCase() !== context.rung) {
      findings.push(error('9', `${context.id}: context map says rung "${rung}", the registry says "${context.rung}"`, { file, context: context.id }));
    }
  }
  for (const key of rows.keys()) {
    if (!matched.has(key)) findings.push(warning('9', `context map row "${key}" matches no context in the registry`, { file }));
  }
  return outcomeOf('9', findings);
}

function check10(boundaries: BoundaryResult): CheckOutcome {
  const findings: Finding[] = boundaries.violations.map((v) => {
    // new-only with a base: new violations first, each finding says which group it is in.
    const group = v.baseline === 'new' ? ' (new)' : v.baseline === 'existing' ? ' (existing at the base)' : '';
    const message = `${v.from.context} -> ${v.to.context}: ${v.from.symbolId} ${v.edgeKind} ${v.to.symbolId} is outside the contracts${group}`;
    const extra = { file: v.from.file, context: v.from.context };
    return v.severity === 'error' ? error('10', message, extra) : warning('10', message, extra);
  });
  return outcomeOf('10', findings);
}

function check11(touched: TouchedReport | undefined): CheckOutcome {
  if (touched === undefined) return skipped('11');
  const findings = touched.unresolved.map((id) => {
    const context = touched.contexts.find((c) => c.id === id);
    const card = context?.card !== undefined ? `update ${context.card} or add` : 'add';
    return error('11', `${id}: code changed without a card change; ${card} the trailer "Domain-Unchanged: ${id} (reason)"`, {
      context: id,
      ...(context?.card !== undefined ? { file: context.card } : {}),
    });
  });
  return outcomeOf('11', findings);
}

/**
 * H6: each parse problem at its severity, each stale entry and each unknown rule a warning (an entry can be both:
 * two findings, never summed), one warning when the candidates could not be built and a file has entries, each
 * orphan file a warning. Day one, with no file, passes.
 */
function check12(input: VerifyInput): CheckOutcome {
  const findings: Finding[] = [];
  for (const spec of input.shadowSpecs ?? []) {
    const extra = { context: spec.context };
    for (const problem of spec.parsed?.problems ?? []) {
      // Located like the other file findings: the human line prints `<path>:<line> <message>`.
      const at = { file: spec.path, line: problem.line, ...extra };
      findings.push(problem.severity === 'error' ? error('12', problem.message, at) : warning('12', problem.message, at));
    }
    for (const entry of spec.stale) {
      findings.push(
        warning('12', `stale resolution "${entry.fingerprint}" matches no candidate of ${spec.context}`, { file: spec.path, line: entry.line, ...extra }),
      );
    }
    for (const entry of spec.unknownRules) {
      if (!('rule' in entry.resolution)) continue;
      findings.push(warning('12', `resolution names unknown rule ${entry.resolution.rule}`, { file: spec.path, line: entry.line, ...extra }));
    }
  }
  // Without candidates no entry is called stale; one warning says the check did not run (only when there are entries).
  const hasEntries = (input.shadowSpecs ?? []).some((spec) => (spec.parsed?.entries.length ?? 0) > 0);
  if (input.candidatesUnavailable !== undefined && hasEntries) {
    findings.push(warning('12', `stale resolutions were not checked: ${input.candidatesUnavailable}`));
  }
  for (const path of [...(input.orphanShadowSpecs ?? [])].sort(compare)) {
    findings.push(warning('12', `${path} belongs to no context`));
  }
  return outcomeOf('12', findings);
}

/** Runs the twelve verify-domain checks (spec 10.5). Pure: every I/O result arrives in the input. */
export function runVerifyChecks(input: VerifyInput): CheckOutcome[] {
  const first = check1(input);
  const registry = input.registry.registry;
  if (input.registry.problems.length > 0 || registry === undefined) {
    return [first, ...VERIFY_CHECKS.slice(1).map(skipped)];
  }
  const cards = presentCards(registry, input);
  const [fourA, fourB] = check4(registry, input);
  return [
    first,
    check2(registry, input),
    check3(registry, input),
    fourA,
    fourB,
    check5(cards),
    check6(registry, cards, input),
    check7(cards, input),
    check8(input.loaderDiff),
    check9(registry, input),
    check10(input.boundaries),
    check11(input.touched),
    check12(input),
  ];
}
