import type { FileIndex } from '@ctxo/cli/internal';
import type { ParsedCard } from './card-parser.js';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig, type TestConvention } from './domain-config.js';
import type { GlobMatcherFactory } from './ownership.js';
import type { DomainRegistry } from './registry.js';
import { annotationMatches, parseAnnotationMatcher } from './test-conventions.js';

/** Tracker-like keys: Jira, Linear and YouTrack ids such as `LEND-456`. */
export const TRACKER_KEY_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
/** Commits and branches a prefix must appear in before it is proposed as a tracker prefix. */
export const TRACKER_PREFIX_MIN = 5;

/**
 * Well-known external identifier families (#191): security weaknesses and advisories (CWE, CVE, GHSA, OWASP,
 * CAPEC), decision and standard documents (ADR, RFC, ISO, IEC, PEP, JSR, KEP, BIP, EIP). A key such as `CWE-22` is a
 * reference, not a team's tracker key nor a rule ID. Discovery reports these families as evidence only and never
 * proposes them: a plain mention never links as a rule ID anyway (only IDs that exist in a card link). A family that
 * equals a card rule prefix is flagged. In codepoint order.
 */
export const EXTERNAL_ID_FAMILIES: readonly string[] = [
  'ADR',
  'BIP',
  'CAPEC',
  'CVE',
  'CWE',
  'EIP',
  'GHSA',
  'IEC',
  'ISO',
  'JSR',
  'KEP',
  'OWASP',
  'PEP',
  'RFC',
];
/** The label of the external ID families, in the printed evidence and in the JSON. */
export const EXTERNAL_ID_NOTE = 'references, not rule IDs; no config needed';
/** Branches a lowercase `name-NN` family must appear in before it is reported as other identifiers. */
export const OTHER_IDENTIFIER_MIN = 3;
/** Runtime and language names that version branches carry (`chore/node-20`); never reported as identifiers. */
export const OTHER_IDENTIFIER_STOPLIST: readonly string[] = ['dotnet', 'go', 'java', 'net', 'node', 'php', 'python', 'ruby'];

export interface FolderCount {
  readonly folder: string;
  readonly files: number;
}

/** Markers of one test kind beyond folders (#191). Every list is in codepoint order of its first field. */
export interface TestKindMarkers {
  /** Trait, Category, TestCategory and Tag values naming the kind, as `annotations` matchers, with the annotations found. */
  readonly annotationValues: readonly { matcher: string; count: number }[];
  /** Custom test attributes naming the kind (`StorageContractFact`), with the annotations found. */
  readonly attributes: readonly { name: string; count: number }[];
  /**
   * Test file names ending in `<Kind>Tests` or `<Kind>Test` (`BlobStoreContractTests.cs`), or in the dotted and
   * snake-case forms (`loan.contract.test.ts`, `loan_contract_test.go`), as `**\/*<suffix>` globs, with the test files.
   * `entityTests` counts the files named after a non-test class, interface or type of the index
   * (`LoanContractTests.cs` next to a `LoanContract` class: unit tests of an entity) and `entityFiles` lists them in
   * codepoint order. They are left out of the glob's evidence: the glob is proposed on its other files only, and a
   * glob made only of entity files is evidence only.
   */
  readonly fileNames: readonly { glob: string; files: number; entityTests: number; entityFiles: readonly string[] }[];
}

export interface DiscoveryEvidence {
  readonly cardPrefixes: readonly { prefix: string; rules: number }[];
  /** Tracker-like prefixes; the external ID families are reported in `externalIds` instead. */
  readonly trackerKeys: readonly { prefix: string; occurrences: number; overlapsRulePrefix: boolean }[];
  /**
   * Tracker-like keys of a well-known external family (`EXTERNAL_ID_FAMILIES`), most frequent first. Evidence only,
   * never proposed; `overlapsRulePrefix` flags a family that is also a card rule prefix.
   */
  readonly externalIds: readonly { prefix: string; occurrences: number; overlapsRulePrefix: boolean; note: string }[];
  /**
   * GitHub-style issue references: subjects with one (at the start, as `(#N)`, or after fixes, closes, resolves,
   * refs, see, issue or pull request), the subjects ending in `(#N)`, all subjects, the `N-slug` branches, and
   * whether they are the largest identifier family with at least `GITHUB_TRACKER_MIN` references. Evidence only.
   */
  readonly githubIssues: {
    readonly subjects: number;
    readonly squashSuffixes: number;
    readonly totalSubjects: number;
    readonly branches: number;
    readonly largestFamily: boolean;
  };
  /**
   * Lowercase `name-NN` branch families in at least `OTHER_IDENTIFIER_MIN` branches, runtime names left out
   * (`OTHER_IDENTIFIER_STOPLIST`). `possibleTrackerKey` marks a family whose upper case is a card rule prefix, a
   * tracker key of the evidence or a configured tracker prefix. Evidence only, never proposed.
   */
  readonly otherIdentifiers: readonly { prefix: string; branches: number; possibleTrackerKey: boolean }[];
  readonly traitKeys: readonly { key: string; count: number; idLikeValues: number }[];
  readonly uncoveredTestFolders: readonly FolderCount[];
  readonly characterizationFolders: readonly FolderCount[];
  readonly contractFolders: readonly FolderCount[];
  readonly provenanceFolders: readonly FolderCount[];
  readonly testKindMarkers: { readonly characterization: TestKindMarkers; readonly contract: TestKindMarkers };
}

export interface DiscoveryProposal {
  readonly trackerPrefixes: readonly string[];
  readonly ruleTraitKeys: readonly string[];
  readonly indexTests: readonly string[];
  /**
   * Globs for `domain.tests.characterization.paths` that no configured glob covers: Characterization folders as
   * `<folder>/**` (H17) and file-name patterns as `**\/*CharacterizationTests<ext>`. A `names` marker matches test
   * case names and titles only, never file or class names, so file-name patterns are proposed as paths (#191).
   */
  readonly characterizationPaths: readonly string[];
  /** Like `characterizationPaths`, for `domain.tests.contract.paths`. */
  readonly contractPaths: readonly string[];
  /** Matchers for `domain.tests.characterization.annotations` that no configured matcher covers. */
  readonly characterizationAnnotations: readonly string[];
  /** Matchers for `domain.tests.contract.annotations` that no configured matcher covers. */
  readonly contractAnnotations: readonly string[];
}

export interface DiscoveryInput {
  readonly cards: readonly ParsedCard[];
  readonly registry?: DomainRegistry;
  readonly commitSubjects: readonly string[];
  /** Local branch names (`GitRefs.localBranches`). */
  readonly localBranches: readonly string[];
  /** Remote-tracking branches as `<remote>/<name>` (`GitRefs.remoteBranches`). */
  readonly remoteBranches: readonly string[];
  readonly indices: readonly FileIndex[];
  readonly trackedFiles: readonly string[];
  readonly isPathTestFile: (path: string) => boolean;
  readonly config: DomainConfig;
  readonly indexTests: readonly string[];
  /** The host's test-framework annotation names (`host.services.testFrameworkAnnotations`). */
  readonly testFrameworkAnnotations: readonly string[];
  /** The host's glob matcher (`host.services.makeGlobMatcher`), for the configured test convention paths. */
  readonly makeGlobMatcher: GlobMatcherFactory;
}

const CHARACTERIZATION_NAMES: ReadonlySet<string> = new Set(['Characterization']);
const CONTRACT_NAMES: ReadonlySet<string> = new Set(['Contract', 'Contracts', 'Contracts.Tests']);
const PROVENANCE_NAMES: ReadonlySet<string> = new Set(['adr', 'adrs', 'decisions', 'spec', 'specs', 'rfc', 'rfcs']);
const MARKDOWN_FILE = /\.md$/i;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const norm = (path: string): string => path.replace(/\\/g, '/');

function sortedUnion(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())].sort(compare);
}

function idRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(DEFAULT_DOMAIN_CONFIG.rules.idPattern);
  }
}

function prefixOf(id: string): string {
  const dash = id.indexOf('-');
  return dash < 0 ? id : id.slice(0, dash);
}

function hasTestAnnotation(index: FileIndex, names: ReadonlySet<string>): boolean {
  return index.symbols.some((symbol) => symbol.annotations?.some((annotation) => names.has(annotation.name)));
}

/**
 * One entry per distinct branch name: the local names, plus each remote-tracking ref with exactly its first
 * segment (the remote name) removed. A local branch named `origin/x` keeps that name.
 */
export function branchNames(localBranches: readonly string[], remoteBranches: readonly string[]): string[] {
  const names = new Set(localBranches);
  for (const ref of remoteBranches) {
    const slash = ref.indexOf('/');
    names.add(slash > 0 ? ref.slice(slash + 1) : ref);
  }
  return [...names].sort(compare);
}

function cardPrefixes(input: DiscoveryInput): DiscoveryEvidence['cardPrefixes'] {
  const counts = new Map<string, number>();
  for (const card of input.cards) {
    for (const rule of card.rules) counts.set(prefixOf(rule.id), (counts.get(prefixOf(rule.id)) ?? 0) + 1);
  }
  for (const context of input.registry?.contexts ?? []) {
    if (context.rulePrefix !== undefined && !counts.has(context.rulePrefix)) counts.set(context.rulePrefix, 0);
  }
  return [...counts.entries()]
    .map(([prefix, rules]) => ({ prefix, rules }))
    .sort((a, b) => b.rules - a.rules || compare(a.prefix, b.prefix));
}

const EXTERNAL_FAMILIES: ReadonlySet<string> = new Set(EXTERNAL_ID_FAMILIES);

/** Tracker-like prefixes per subject or branch, split into tracker keys and external ID families. */
function trackerKeys(
  input: DiscoveryInput,
  branches: readonly string[],
  rulePrefixes: ReadonlySet<string>,
): { readonly tracker: DiscoveryEvidence['trackerKeys']; readonly external: DiscoveryEvidence['externalIds'] } {
  const counts = new Map<string, number>();
  for (const text of [...input.commitSubjects, ...branches]) {
    const seen = new Set<string>();
    for (const match of text.matchAll(TRACKER_KEY_PATTERN)) seen.add(prefixOf(match[0]));
    for (const prefix of seen) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
  return {
    tracker: sorted
      .filter(([prefix]) => !EXTERNAL_FAMILIES.has(prefix))
      .map(([prefix, occurrences]) => ({ prefix, occurrences, overlapsRulePrefix: rulePrefixes.has(prefix) })),
    external: sorted
      .filter(([prefix]) => EXTERNAL_FAMILIES.has(prefix))
      .map(([prefix, occurrences]) => ({ prefix, occurrences, overlapsRulePrefix: rulePrefixes.has(prefix), note: EXTERNAL_ID_NOTE })),
  };
}

/**
 * An issue reference in a subject: `#N` at the start, a `(#N)` suffix or group, or `#N` after fixes, closes,
 * resolves, refs, see, issue or pull request. A bare `#N` elsewhere (`step #1 of the plan`) is not one.
 */
const ISSUE_REFS: readonly RegExp[] = [
  /^\s*#\d+\b/,
  /\(#\d+\)/,
  /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|refs?|see|issue|pull request)\s*:?\s+#\d+\b/i,
];
const SQUASH_SUFFIX = /\(#\d+\)\s*$/;
/**
 * `N-slug`, alone or after `type/`: a last segment of digits, a dash and a slug starting with a letter. A
 * year-like number (`release/2024-q1`) is not an issue.
 */
const ISSUE_BRANCH = /(?:^|\/)(?!(?:19|20)\d{2}-)\d+-[A-Za-z][^/]*$/;
/** Issue references (subjects plus branches) the GitHub tracker verdict needs, like a tracker prefix. */
export const GITHUB_TRACKER_MIN = TRACKER_PREFIX_MIN;

function githubIssues(subjects: readonly string[], branches: readonly string[], tracker: DiscoveryEvidence['trackerKeys']): DiscoveryEvidence['githubIssues'] {
  const withRef = subjects.filter((s) => ISSUE_REFS.some((re) => re.test(s))).length;
  const issueBranches = branches.filter((b) => ISSUE_BRANCH.test(b)).length;
  const total = withRef + issueBranches;
  const largestTracker = Math.max(0, ...tracker.map((t) => t.occurrences));
  return {
    subjects: withRef,
    squashSuffixes: subjects.filter((s) => SQUASH_SUFFIX.test(s)).length,
    totalSubjects: subjects.length,
    branches: issueBranches,
    largestFamily: total >= GITHUB_TRACKER_MIN && total > largestTracker,
  };
}

/** A lowercase `name-NN` key; a following dot or alphanumeric (a version such as `lib-1.2.3`) is not one. */
const LOWER_KEY = /(?<![A-Za-z0-9])([a-z][a-z0-9]*)-\d+(?![A-Za-z0-9.])/g;
const STOPLIST: ReadonlySet<string> = new Set(OTHER_IDENTIFIER_STOPLIST);

function otherIdentifiers(branches: readonly string[], knownPrefixes: ReadonlySet<string>): DiscoveryEvidence['otherIdentifiers'] {
  const counts = new Map<string, number>();
  for (const branch of branches) {
    const seen = new Set<string>();
    for (const match of branch.matchAll(LOWER_KEY)) if (!STOPLIST.has(match[1]!)) seen.add(match[1]!);
    for (const prefix of seen) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= OTHER_IDENTIFIER_MIN)
    .map(([prefix, n]) => ({ prefix, branches: n, possibleTrackerKey: knownPrefixes.has(prefix.toUpperCase()) }))
    .sort((a, b) => b.branches - a.branches || compare(a.prefix, b.prefix));
}

type TestKind = 'characterization' | 'contract';
type Annotation = NonNullable<FileIndex['symbols'][number]['annotations']>[number];

/** The kind a word names: `characterization` before `contract`, ASCII case ignored. Used on attribute names. */
function kindOf(text: string): TestKind | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('characterization')) return 'characterization';
  if (lower.includes('contract')) return 'contract';
  return undefined;
}

/**
 * The kind a test tag value names: the value equals the kind or ends with it, optionally followed by `Test` or
 * `Tests` (`StorageContract`, `Contract`, `Contracts`, `ContractTests`). A value that merely contains it
 * (`ContractRenewal`) names a business entity, not a test kind.
 */
function valueKindOf(value: string): TestKind | undefined {
  const lower = value.toLowerCase();
  const base = lower.replace(/tests?$/, '');
  if (base.endsWith('characterization')) return 'characterization';
  if (base.endsWith('contract') || lower.endsWith('contracts')) return 'contract';
  return undefined;
}

/** Annotations whose value names the kind: `Trait(key, value)` and the one-value category annotations, by last name segment. */
const VALUE_ANNOTATIONS: ReadonlySet<string> = new Set(['Category', 'TestCategory', 'Tag']);
/** A custom test attribute: the kind directly before a test attribute ending (`StorageContractFact`, not `ContractTestBase`). */
const KIND_ATTRIBUTE = /(?:Characterization|Contract)(?:Fact|Theory|Test|TestMethod|TestCase)(?:Attribute)?$/i;
/** Test file names of a kind: `BlobStoreContractTests.cs`, `loan.contract.test.ts`, `loan_contract_test.go`. */
const KIND_FILE_CAMEL = /(Characterization|Contract)(Tests?)(\.[A-Za-z0-9]+)$/i;
const KIND_FILE_DOTTED = /\.(characterization|contract)\.(test|spec)(\.[A-Za-z0-9]+)$/i;
const KIND_FILE_SNAKE = /_(characterization|contract)_test(\.[A-Za-z0-9]+)$/i;
/** Source extensions a test file-name pattern is taken from; `docs/ContractTests.md` is not a test. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.cjs', '.cs', '.fs', '.go', '.groovy', '.java', '.js', '.jsx', '.kt', '.mjs', '.php', '.py', '.rb', '.scala', '.swift', '.ts', '.tsx', '.vb',
]);
const ENTITY_KINDS: ReadonlySet<string> = new Set(['class', 'interface', 'type']);
/** Entity files the printout names per file-name glob; `--json` lists every one. */
export const ENTITY_FILES_SHOWN = 5;

function lastSegment(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(dot + 1);
}

function isKindAttribute(name: string): boolean {
  return KIND_ATTRIBUTE.test(lastSegment(name));
}

/**
 * The `annotations` matcher an annotation's kind value gives, with the kind; undefined for any other annotation and
 * for a matcher that would not match the annotation it came from (a value with `=`, for example).
 */
function valueMatcher(annotation: Annotation): { readonly kind: TestKind; readonly matcher: string } | undefined {
  const args = annotation.args ?? [];
  const short = lastSegment(annotation.name);
  let spec: string | undefined;
  let value: string | undefined;
  if (short === 'Trait' && args[0] !== undefined && args[1] !== undefined) {
    value = args[1].trim();
    spec = `${annotation.name}:${args[0].trim()}=${value}`;
  } else if (VALUE_ANNOTATIONS.has(short) && args[0] !== undefined) {
    value = args[0].trim();
    spec = `${annotation.name}:${value}`;
  }
  if (spec === undefined || value === undefined) return undefined;
  const kind = valueKindOf(value);
  const parsed = parseAnnotationMatcher(spec);
  if (kind === undefined || parsed === undefined || !annotationMatches(parsed, annotation)) return undefined;
  return { kind, matcher: spec };
}

/** The tag value of a value annotation without a trailing `Test` or `Tests`, for the entity check. */
function valueStem(annotation: Annotation): string {
  const args = annotation.args ?? [];
  const value = (lastSegment(annotation.name) === 'Trait' ? args[1] : args[0]) ?? '';
  return value.trim().replace(/Tests?$/, '');
}

/** The glob, kind and (CamelCase form only) entity stem a test file name gives; undefined for any other file. */
function fileFamily(base: string): { readonly kind: TestKind; readonly glob: string; readonly stem?: string } | undefined {
  const camel = KIND_FILE_CAMEL.exec(base);
  if (camel !== null) {
    return {
      kind: camel[1]!.toLowerCase() === 'characterization' ? 'characterization' : 'contract',
      glob: `**/*${camel[1]}${camel[2]}${camel[3]}`,
      stem: base.slice(0, base.length - camel[2]!.length - camel[3]!.length),
    };
  }
  const dotted = KIND_FILE_DOTTED.exec(base);
  if (dotted !== null) {
    return { kind: dotted[1]!.toLowerCase() === 'characterization' ? 'characterization' : 'contract', glob: `**/*.${dotted[1]}.${dotted[2]}${dotted[3]}` };
  }
  const snake = KIND_FILE_SNAKE.exec(base);
  if (snake !== null) {
    return { kind: snake[1]!.toLowerCase() === 'characterization' ? 'characterization' : 'contract', glob: `**/*_${snake[1]}_test${snake[2]}` };
  }
  return undefined;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

interface KindCounts {
  readonly values: Map<string, number>;
  readonly attributes: Map<string, number>;
  readonly files: Map<string, { files: string[]; entityFiles: string[] }>;
}

/** Test-kind markers beyond folders: annotation values and custom attributes in the index, file names of the test files. */
function testKindMarkers(
  input: DiscoveryInput,
  tracked: readonly string[],
  annotated: ReadonlySet<string>,
): { readonly markers: DiscoveryEvidence['testKindMarkers']; readonly files: Readonly<Record<TestKind, ReadonlyMap<string, readonly string[]>>> } {
  const counts: Record<TestKind, KindCounts> = {
    characterization: { values: new Map(), attributes: new Map(), files: new Map() },
    contract: { values: new Map(), attributes: new Map(), files: new Map() },
  };
  const testIndexed = new Set<string>();
  const entities = new Set<string>();
  const annotationsOf = (index: FileIndex): Annotation[] => index.symbols.flatMap((symbol) => symbol.annotations ?? []);
  // Values count in test files only; a custom test attribute makes a file a test file too.
  const isTest = (index: FileIndex): boolean =>
    input.isPathTestFile(index.file) || hasTestAnnotation(index, annotated) || annotationsOf(index).some((a) => isKindAttribute(a.name));
  for (const index of input.indices) {
    if (isTest(index)) testIndexed.add(norm(index.file));
    else for (const symbol of index.symbols) if (ENTITY_KINDS.has(symbol.kind)) entities.add(lastSegment(symbol.name));
  }
  for (const index of input.indices) {
    const all = annotationsOf(index);
    for (const annotation of all) {
      if (isKindAttribute(annotation.name)) bump(counts[kindOf(lastSegment(annotation.name))!].attributes, annotation.name);
    }
    if (!testIndexed.has(norm(index.file))) continue;
    for (const annotation of all) {
      const found = valueMatcher(annotation);
      // A value named after a non-test class (`Category("LoanContract")` next to `LoanContract`) tags an entity's tests.
      if (found !== undefined && !entities.has(valueStem(annotation))) bump(counts[found.kind].values, found.matcher);
    }
  }
  for (const raw of tracked) {
    const file = norm(raw);
    const base = file.slice(file.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    if (dot < 0 || !SOURCE_EXTENSIONS.has(base.slice(dot).toLowerCase())) continue;
    if (!input.isPathTestFile(file) && !testIndexed.has(file)) continue;
    const family = fileFamily(base);
    if (family === undefined) continue;
    const entry = counts[family.kind].files.get(family.glob) ?? { files: [], entityFiles: [] };
    entry.files.push(file);
    if (family.stem !== undefined && entities.has(family.stem)) entry.entityFiles.push(file);
    counts[family.kind].files.set(family.glob, entry);
  }
  const view = (c: KindCounts): TestKindMarkers => ({
    annotationValues: [...c.values.entries()].map(([matcher, count]) => ({ matcher, count })).sort((a, b) => compare(a.matcher, b.matcher)),
    attributes: [...c.attributes.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => compare(a.name, b.name)),
    fileNames: [...c.files.entries()]
      .map(([glob, entry]) => ({
        glob,
        files: entry.files.length,
        entityTests: entry.entityFiles.length,
        entityFiles: [...entry.entityFiles].sort(compare),
      }))
      .sort((a, b) => compare(a.glob, b.glob)),
  });
  // Entity tests are no evidence of the kind: a family is proposed on its other files, and not at all without any.
  const proposable = (c: KindCounts): Map<string, readonly string[]> => {
    const families = new Map<string, readonly string[]>();
    for (const [glob, entry] of c.files) {
      const entityFiles = new Set(entry.entityFiles);
      const rest = entry.files.filter((file) => !entityFiles.has(file));
      if (rest.length > 0) families.set(glob, rest);
    }
    return families;
  };
  return {
    markers: { characterization: view(counts.characterization), contract: view(counts.contract) },
    files: { characterization: proposable(counts.characterization), contract: proposable(counts.contract) },
  };
}

/** The matcher form of an annotation `matcher` spec, as an annotation, so a configured matcher can be tested against it. */
function asAnnotation(spec: string): Annotation | undefined {
  const parsed = parseAnnotationMatcher(spec);
  if (parsed === undefined) return undefined;
  if (parsed.value === undefined) return { name: parsed.name };
  return { name: parsed.name, args: parsed.key === undefined ? [parsed.value] : [parsed.key, parsed.value] };
}

/** The found matchers and attribute names no configured matcher of the convention accepts, in codepoint order. */
function uncoveredAnnotations(markers: TestKindMarkers, convention: TestConvention): string[] {
  const configured = convention.annotations.map(parseAnnotationMatcher).filter((m) => m !== undefined);
  const covered = (spec: string): boolean => {
    const annotation = asAnnotation(spec);
    return annotation !== undefined && configured.some((m) => annotationMatches(m, annotation));
  };
  const specs = [...markers.annotationValues.map((v) => v.matcher), ...markers.attributes.map((a) => a.name)];
  return sortedUnion(specs.filter((spec) => !covered(spec)));
}

/** The file-name globs with a file no configured `paths` glob covers. */
function uncoveredFileGlobs(files: ReadonlyMap<string, readonly string[]>, globs: readonly string[], makeMatcher: GlobMatcherFactory): string[] {
  const covered = globs.length > 0 ? makeMatcher([...globs]) : () => false;
  return [...files.entries()].filter(([, list]) => list.some((file) => !covered(file))).map(([glob]) => glob).sort(compare);
}

function traitKeys(input: DiscoveryInput, idPattern: RegExp, annotated: ReadonlySet<string>): DiscoveryEvidence['traitKeys'] {
  const stats = new Map<string, { count: number; idLikeValues: number }>();
  for (const index of input.indices) {
    if (!input.isPathTestFile(index.file) && !hasTestAnnotation(index, annotated)) continue;
    for (const symbol of index.symbols) {
      for (const annotation of symbol.annotations ?? []) {
        const key = annotation.name === 'Trait' ? annotation.args?.[0] : undefined;
        if (key === undefined) continue;
        const entry = stats.get(key) ?? { count: 0, idLikeValues: 0 };
        entry.count++;
        const value = annotation.args?.[1];
        if (value !== undefined && idPattern.test(value.trim())) entry.idLikeValues++;
        stats.set(key, entry);
      }
    }
  }
  return [...stats.entries()]
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => compare(a.key, b.key));
}

/** Directories of annotated test files that the path check rejects; nested ones fold into their topmost listed parent. */
function uncoveredTestFolders(input: DiscoveryInput, annotated: ReadonlySet<string>): FolderCount[] {
  const perDir = new Map<string, number>();
  for (const index of input.indices) {
    const file = norm(index.file);
    if (input.isPathTestFile(file) || !hasTestAnnotation(index, annotated)) continue;
    const slash = file.lastIndexOf('/');
    if (slash <= 0) continue;
    const dir = file.slice(0, slash);
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
  }
  const dirs = [...perDir.keys()].sort(compare);
  const tops: { dir: string; files: number }[] = [];
  for (const dir of dirs) {
    const top = tops.find((t) => dir === t.dir || dir.startsWith(`${t.dir}/`));
    if (top !== undefined) top.files += perDir.get(dir)!;
    else tops.push({ dir, files: perDir.get(dir)! });
  }
  return tops.map((t) => ({ folder: `${t.dir}/**`, files: t.files }));
}

/** Counts tracked files under the topmost directory whose name is in `names`; `accept` filters the files. */
function folderCounts(files: readonly string[], names: ReadonlySet<string>, caseInsensitive: boolean, accept: (file: string) => boolean): FolderCount[] {
  const counts = new Map<string, number>();
  for (const raw of files) {
    const file = norm(raw);
    if (!accept(file)) continue;
    const segments = file.split('/');
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = caseInsensitive ? segments[i]!.toLowerCase() : segments[i]!;
      if (!names.has(segment)) continue;
      const folder = segments.slice(0, i + 1).join('/');
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
      break;
    }
  }
  return [...counts.entries()].map(([folder, n]) => ({ folder, files: n })).sort((a, b) => compare(a.folder, b.folder));
}

/** `<folder>/**` for each folder no configured glob covers; the probe path is `<folder>/x` (H17). */
function uncoveredConventionPaths(folders: readonly FolderCount[], globs: readonly string[], makeMatcher: GlobMatcherFactory): string[] {
  // The host matcher takes a mutable string[] (PF26): hand it a copy of the readonly list.
  const covered = globs.length > 0 ? makeMatcher([...globs]) : () => false;
  return folders
    .filter((f) => !covered(`${f.folder}/x`))
    .map((f) => `${f.folder}/**`)
    .sort(compare);
}

/** Reads conventions from the repository (spec 10.9): tracker prefixes, test tag keys, test folders and doc folders. */
export function discoverConventions(input: DiscoveryInput): { readonly evidence: DiscoveryEvidence; readonly proposal: DiscoveryProposal } {
  const idPattern = idRegExp(input.config.rules.idPattern);
  const cards = cardPrefixes(input);
  const rulePrefixes = new Set(cards.map((c) => c.prefix));
  const branches = branchNames(input.localBranches, input.remoteBranches);
  const { tracker, external } = trackerKeys(input, branches, rulePrefixes);
  const annotated = new Set(input.testFrameworkAnnotations);
  const traits = traitKeys(input, idPattern, annotated);
  const uncovered = uncoveredTestFolders(input, annotated);
  const tracked = [...new Set(input.trackedFiles)];
  const kinds = testKindMarkers(input, tracked, annotated);
  const tests = input.config.tests;

  const knownPrefixes = new Set([...rulePrefixes, ...tracker.map((t) => t.prefix), ...input.config.rules.trackerPrefixes]);
  const evidence: DiscoveryEvidence = {
    cardPrefixes: cards,
    trackerKeys: tracker,
    externalIds: external,
    githubIssues: githubIssues(input.commitSubjects, branches, tracker),
    otherIdentifiers: otherIdentifiers(branches, knownPrefixes),
    traitKeys: traits,
    uncoveredTestFolders: uncovered,
    characterizationFolders: folderCounts(tracked, CHARACTERIZATION_NAMES, false, () => true),
    contractFolders: folderCounts(tracked, CONTRACT_NAMES, false, () => true),
    provenanceFolders: folderCounts(tracked, PROVENANCE_NAMES, true, (file) => MARKDOWN_FILE.test(file)),
    testKindMarkers: kinds.markers,
  };
  // External ID families are evidence only: never proposed (#191).
  const proposal: DiscoveryProposal = {
    trackerPrefixes: sortedUnion(
      input.config.rules.trackerPrefixes,
      tracker.filter((t) => t.occurrences >= TRACKER_PREFIX_MIN).map((t) => t.prefix),
    ),
    ruleTraitKeys: sortedUnion(
      input.config.tests.ruleTraitKeys,
      traits.filter((t) => t.idLikeValues >= 1).map((t) => t.key),
    ),
    indexTests: sortedUnion(input.indexTests, uncovered.map((f) => f.folder)),
    characterizationPaths: sortedUnion(
      uncoveredConventionPaths(evidence.characterizationFolders, tests.characterization.paths, input.makeGlobMatcher),
      uncoveredFileGlobs(kinds.files.characterization, tests.characterization.paths, input.makeGlobMatcher),
    ),
    contractPaths: sortedUnion(
      uncoveredConventionPaths(evidence.contractFolders, tests.contract.paths, input.makeGlobMatcher),
      uncoveredFileGlobs(kinds.files.contract, tests.contract.paths, input.makeGlobMatcher),
    ),
    characterizationAnnotations: uncoveredAnnotations(kinds.markers.characterization, tests.characterization),
    contractAnnotations: uncoveredAnnotations(kinds.markers.contract, tests.contract),
  };
  return { evidence, proposal };
}

const LABEL_WIDTH = 22;
const row = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;
const folderList = (folders: readonly FolderCount[]): string => folders.map((f) => `${f.folder} (${f.files})`).join(', ');
/**
 * A YAML flow list with each value as a JSON string, which is a valid YAML double-quoted scalar (D-I2): an unquoted
 * glob would start an alias at `*` and make the pasted block unparsable.
 */
const flow = (values: readonly string[]): string => `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;

/** The human report in the spec 10.9 layout, followed by the proposed config; `config` is the resolved domain config. */
export function formatDiscovery(evidence: DiscoveryEvidence, proposal: DiscoveryProposal, config: DomainConfig): string {
  const lines: string[] = ['Rule IDs'];
  lines.push(
    row(
      '  card prefixes:',
      evidence.cardPrefixes.length === 0
        ? 'none'
        : evidence.cardPrefixes.map((c) => `${c.prefix} (${c.rules} ${c.rules === 1 ? 'rule' : 'rules'})`).join(', '),
    ),
  );
  if (evidence.trackerKeys.length === 0) {
    lines.push(row('  tracker-like keys:', 'none'));
  } else {
    const width = Math.max(...evidence.trackerKeys.map((t) => t.prefix.length));
    evidence.trackerKeys.forEach((t, i) => {
      const text = `${t.prefix.padEnd(width)} in ${t.occurrences} commit subjects/branches${t.overlapsRulePrefix ? '   <- overlaps a rule prefix' : ''}`;
      lines.push(row(i === 0 ? '  tracker-like keys:' : '', text).trimEnd());
    });
  }
  if (evidence.externalIds.length > 0) {
    const text = evidence.externalIds.map((t) => `${t.prefix} (${t.occurrences})`).join(', ');
    lines.push(row('  external IDs:', `${text}   <- ${EXTERNAL_ID_NOTE}`));
    for (const t of evidence.externalIds.filter((e) => e.overlapsRulePrefix)) {
      lines.push(row('', `${t.prefix}   <- also a card rule prefix; never proposed`));
    }
  }
  const github = evidence.githubIssues;
  if (github.subjects > 0 || github.branches > 0) {
    const share = github.totalSubjects > 0 ? Math.round((github.subjects / github.totalSubjects) * 100) : 0;
    const text =
      `${github.subjects} of ${github.totalSubjects} subjects (${share}%), ${github.squashSuffixes} with a (#N) suffix; ` +
      `${github.branches} branches${github.largestFamily ? '   <- the issue tracker (GitHub); no config key needed' : ''}`;
    lines.push(row('  GitHub issues (#N):', text));
  }
  if (evidence.otherIdentifiers.length > 0) {
    const text = evidence.otherIdentifiers
      .map((o) => `${o.prefix}-NN in ${o.branches} branches${o.possibleTrackerKey ? ' (possible tracker key, lowercase)' : ''}`)
      .join(', ');
    lines.push(row('  other identifiers:', `${text}   <- lowercase identifiers; not proposed`));
  }

  lines.push(
    row(
      'Test tagging',
      evidence.traitKeys.length === 0
        ? 'no xUnit Trait keys in use'
        : `xUnit Trait keys in use: ${[...evidence.traitKeys]
            .sort((a, b) => b.count - a.count || compare(a.key, b.key))
            .map((t) => `${t.key} (${t.count})`)
            .join(', ')}`,
    ),
  );

  const folderParts: string[] = [];
  if (evidence.uncoveredTestFolders.length > 0) folderParts.push(`annotated tests outside the default globs: ${folderList(evidence.uncoveredTestFolders)}`);
  folderParts.push(
    evidence.characterizationFolders.length > 0 ? `Characterization: ${folderList(evidence.characterizationFolders)}` : 'no Characterization folders',
  );
  folderParts.push(evidence.contractFolders.length > 0 ? `Contract: ${folderList(evidence.contractFolders)}` : 'no Contract folders');
  lines.push(row('Test folders', folderParts.join('; ')));
  const markers = evidence.testKindMarkers;
  const fileGlobs = new Set([...markers.characterization.fileNames, ...markers.contract.fileNames].map((f) => f.glob));
  const notCovered = (paths: readonly string[], key: string, files: boolean): void => {
    for (const path of paths) if (fileGlobs.has(path) === files) lines.push(row('', `${path}   <- not covered by ${key}`));
  };
  notCovered(proposal.characterizationPaths, 'domain.tests.characterization.paths', false);
  notCovered(proposal.contractPaths, 'domain.tests.contract.paths', false);

  const markerText = (kind: string, m: TestKindMarkers): string | undefined => {
    const parts: string[] = [];
    if (m.annotationValues.length > 0) parts.push(`values ${m.annotationValues.map((v) => `${v.matcher} (${v.count})`).join(', ')}`);
    if (m.attributes.length > 0) parts.push(`attributes ${m.attributes.map((a) => `${a.name} (${a.count})`).join(', ')}`);
    if (m.fileNames.length > 0) {
      const entityNote = (f: TestKindMarkers['fileNames'][number]): string => {
        if (f.entityTests === 0) return '';
        const verdict = f.entityTests === f.files ? 'so not proposed' : 'left out';
        // The printout names the first few; --json keeps the full list.
        const shown = f.entityFiles.slice(0, ENTITY_FILES_SHOWN).join(', ');
        const more = f.entityFiles.length > ENTITY_FILES_SHOWN ? `, and ${f.entityFiles.length - ENTITY_FILES_SHOWN} more` : '';
        return `, ${f.entityTests} named after a non-test class, ${verdict}: ${shown}${more}`;
      };
      const files = m.fileNames.map((f) => `${f.glob} (${f.files}${entityNote(f)})`);
      parts.push(`file names ${files.join(', ')}`);
    }
    return parts.length > 0 ? `${kind}: ${parts.join('; ')}` : undefined;
  };
  const markerParts = [markerText('characterization', markers.characterization), markerText('contract', markers.contract)].filter(
    (part): part is string => part !== undefined,
  );
  lines.push(row('Test kind markers', markerParts.length > 0 ? markerParts.join('; ') : 'none beyond folders'));
  for (const spec of proposal.characterizationAnnotations) lines.push(row('', `${spec}   <- not covered by domain.tests.characterization.annotations`));
  notCovered(proposal.characterizationPaths, 'domain.tests.characterization.paths', true);
  for (const spec of proposal.contractAnnotations) lines.push(row('', `${spec}   <- not covered by domain.tests.contract.annotations`));
  notCovered(proposal.contractPaths, 'domain.tests.contract.paths', true);
  lines.push(row('Provenance folders', evidence.provenanceFolders.length > 0 ? folderList(evidence.provenanceFolders) : 'none'));

  lines.push('', 'Proposed config (.ctxo/config.yaml)');
  lines.push('  domain:', '    rules:', `      trackerPrefixes: ${flow(proposal.trackerPrefixes)}`);
  lines.push('    tests:', `      ruleTraitKeys: ${flow(proposal.ruleTraitKeys)}`);
  // The configured values first, then the new ones: the list `--write` leaves, so a hand-pasted block keeps the defaults.
  const withConfigured = (configured: readonly string[], added: readonly string[]): string[] => [...new Set([...configured, ...added])];
  const convention = (key: TestKind, annotations: readonly string[], paths: readonly string[]): void => {
    if (annotations.length === 0 && paths.length === 0) return;
    lines.push(`      ${key}:`);
    if (annotations.length > 0) lines.push(`        annotations: ${flow(withConfigured(config.tests[key].annotations, annotations))}`);
    if (paths.length > 0) lines.push(`        paths: ${flow(withConfigured(config.tests[key].paths, paths))}`);
  };
  convention('characterization', proposal.characterizationAnnotations, proposal.characterizationPaths);
  convention('contract', proposal.contractAnnotations, proposal.contractPaths);
  lines.push('  index:', `    tests: ${flow(proposal.indexTests)}`);
  return lines.join('\n');
}

/** True when the proposal holds a value the current config does not. */
export function proposalAddsSomething(proposal: DiscoveryProposal, config: DomainConfig, indexTests: readonly string[]): boolean {
  const missing = (proposed: readonly string[], configured: readonly string[]): boolean => {
    const have = new Set(configured);
    return proposed.some((value) => !have.has(value));
  };
  return (
    missing(proposal.trackerPrefixes, config.rules.trackerPrefixes) ||
    missing(proposal.ruleTraitKeys, config.tests.ruleTraitKeys) ||
    missing(proposal.indexTests, indexTests) ||
    missing(proposal.characterizationPaths, config.tests.characterization.paths) ||
    missing(proposal.contractPaths, config.tests.contract.paths) ||
    missing(proposal.characterizationAnnotations, config.tests.characterization.annotations) ||
    missing(proposal.contractAnnotations, config.tests.contract.annotations)
  );
}
