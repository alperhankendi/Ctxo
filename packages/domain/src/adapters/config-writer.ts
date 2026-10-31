import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap } from 'yaml';
import { DEFAULT_DOMAIN_CONFIG, type BoundaryMode, type TestConvention } from '../core/domain-config.js';

const BOM = String.fromCharCode(0xfeff);

/** The `domain:` block an absent section gets (D15); `<mode>` is the boundary mode. */
const DOMAIN_BLOCK = String.raw`domain:
  registry: docs/domain/contexts.yaml
  coverage:
    unowned: warn            # warn | error
  boundaries:
    enforce: <mode>          # by-rung | new-only | report
    blockingRungs: [bounded, boring]
  rules:
    idPattern: "^[A-Z][A-Z0-9]*-\\d+$"
    trackerPrefixes: []
  tests:
    ruleTraitKeys: [Rule]
    characterization:
      annotations: ["Trait:Kind=Characterization", "Tag:characterization"]
      paths: ["**/Characterization/**"]
      names: ["[characterization]"]
    contract:
      annotations: ["Trait:Kind=Contract", "Tag:contract"]
      paths: ["**/Contract/**", "**/Contracts.Tests/**"]
      names: ["[contract]"]
  rungs:
    pinnedCoverage: 0.8
  guard:
    enabled: true
    subagents: false
`;

/** A convention as a plain tree for `addMissing`; the lists are written in flow style. */
function conventionTree(convention: TestConvention): Record<string, unknown> {
  return { annotations: [...convention.annotations], paths: [...convention.paths], names: [...convention.names] };
}

/**
 * The defaults as a plain tree, the order the block lists them in; `guard.base` has no default, and the fact
 * lists are left out (H14): they stay defaults until someone writes them.
 */
function defaultTree(mode: BoundaryMode): Record<string, unknown> {
  const d = DEFAULT_DOMAIN_CONFIG;
  return {
    registry: d.registry,
    coverage: { unowned: d.coverage.unowned },
    boundaries: { enforce: mode, blockingRungs: [...d.boundaries.blockingRungs] },
    rules: { idPattern: d.rules.idPattern, trackerPrefixes: [...d.rules.trackerPrefixes] },
    tests: {
      ruleTraitKeys: [...d.tests.ruleTraitKeys],
      characterization: conventionTree(d.tests.characterization),
      contract: conventionTree(d.tests.contract),
    },
    rungs: { pinnedCoverage: d.rungs.pinnedCoverage },
    guard: { enabled: d.guard.enabled, subagents: d.guard.subagents },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Adds every key of `defaults` that `map` lacks, recursing into mappings on both sides; true when one was added. */
function addMissing(doc: Document, map: YAMLMap, defaults: Record<string, unknown>): boolean {
  let added = false;
  for (const [key, value] of Object.entries(defaults)) {
    const existing = map.get(key, true);
    if (existing === undefined) {
      map.set(key, doc.createNode(value, { flow: Array.isArray(value) }));
      added = true;
    } else if (isPlainRecord(value) && isMap(existing)) {
      added = addMissing(doc, existing, value) || added;
    }
  }
  return added;
}

/**
 * Adds the `domain:` defaults to the text of `.ctxo/config.yaml` (D15). An absent section is appended as
 * the commented block, with `mode` as `boundaries.enforce`, and the rest of the text is kept byte for byte.
 * Otherwise only missing keys are added through the `yaml` Document API (comments kept), and existing
 * values are never changed; a complete section returns the text unchanged. A UTF-8 BOM and CRLF line
 * endings are kept. Throws when the text is not valid YAML or `domain` is neither empty nor a mapping.
 */
export function mergeDomainDefaults(text: string, mode: BoundaryMode): { readonly text: string; readonly changed: boolean } {
  const bom = text.startsWith(BOM);
  const raw = bom ? text.slice(BOM.length) : text;
  const crlf = raw.includes('\r\n');
  const body = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  const restore = (out: string): string => (bom ? BOM : '') + (crlf ? out.replace(/\n/g, '\r\n') : out);

  const doc = parseDocument(body);
  if (doc.errors.length > 0) throw new Error(`not valid YAML: ${doc.errors[0]!.message}`);
  const root = doc.contents;
  if (root !== null && !isMap(root) && !(isScalar(root) && (root.value === null || root.value === ''))) {
    throw new Error('the config must be a mapping');
  }

  const section = isMap(root) ? root.get('domain', true) : undefined;
  if (section === undefined) {
    const block = DOMAIN_BLOCK.replace('<mode>', mode);
    const separator = body.trim() === '' ? '' : body.endsWith('\n') ? '\n' : '\n\n';
    return { text: restore((body.trim() === '' ? '' : body) + separator + block), changed: true };
  }

  const defaults = defaultTree(mode);
  const sectionValue: unknown = isScalar(section) ? section.value : undefined;
  if (isScalar(section) && (sectionValue === null || sectionValue === '')) {
    (root as YAMLMap).set('domain', doc.createNode(defaults));
    return { text: restore(doc.toString({ lineWidth: 0 })), changed: true };
  }
  if (!isMap(section)) throw new Error('domain must be a mapping');
  if (!addMissing(doc, section, defaults)) return { text, changed: false };
  return { text: restore(doc.toString({ lineWidth: 0 })), changed: true };
}

export interface DiscoveryValues {
  readonly trackerPrefixes: readonly string[];
  readonly ruleTraitKeys: readonly string[];
  readonly indexTests: readonly string[];
  /** Globs for `domain.tests.characterization.paths`. */
  readonly characterizationPaths: readonly string[];
  /** Globs for `domain.tests.contract.paths`. */
  readonly contractPaths: readonly string[];
  /** Matchers for `domain.tests.characterization.annotations` (#191); absent adds none. */
  readonly characterizationAnnotations?: readonly string[];
  /** Matchers for `domain.tests.contract.annotations` (#191); absent adds none. */
  readonly contractAnnotations?: readonly string[];
}

/** Makes sure every ancestor of `path` is a mapping (a null scalar is replaced), so `setIn` can reach the leaf. */
function ensureParents(doc: Document, path: readonly string[]): void {
  for (let depth = 1; depth < path.length; depth++) {
    const parent = path.slice(0, depth);
    const node = doc.getIn(parent, true);
    if (node === undefined || (isScalar(node) && (node.value === null || node.value === ''))) {
      doc.setIn(parent, doc.createNode({}));
    } else if (!isMap(node)) {
      throw new Error(`${parent.join('.')} must be a mapping`);
    }
  }
}

/**
 * Appends the values the sequence at `path` lacks, keeping the order and the comments of what is there. An
 * absent sequence starts from `seed` (the default the key replaces), so a proposal adds to the defaults.
 */
function unionInto(doc: Document, path: readonly string[], values: readonly string[], seed: readonly string[] = []): boolean {
  if (values.length === 0) return false;
  ensureParents(doc, path);
  const node = doc.getIn(path, true);
  if (node === undefined || (isScalar(node) && (node.value === null || node.value === ''))) {
    doc.setIn(path, doc.createNode([...new Set([...seed, ...values])], { flow: true }));
    return true;
  }
  if (!isSeq(node)) throw new Error(`${path.join('.')} must be a sequence`);
  const have = new Set(node.items.map((item) => String(isScalar(item) ? item.value : item)));
  const missing = values.filter((value) => !have.has(value));
  for (const value of missing) node.add(doc.createNode(value));
  return missing.length > 0;
}

/**
 * Unions a discovery proposal into the text of `.ctxo/config.yaml`: `domain.rules.trackerPrefixes`,
 * `domain.tests.ruleTraitKeys`, `index.tests` and the `paths` of `domain.tests.characterization` and
 * `domain.tests.contract`, and their `annotations` (an absent list starts from its defaults). Existing values stay in place and in order, new ones are
 * appended; comments, a UTF-8 BOM and CRLF line endings are kept. Nothing new returns the text unchanged.
 * Throws when the text is not valid YAML or a target is not a sequence.
 */
export function mergeDiscoveryProposal(text: string, proposal: DiscoveryValues): { readonly text: string; readonly changed: boolean } {
  const bom = text.startsWith(BOM);
  const raw = bom ? text.slice(BOM.length) : text;
  const crlf = raw.includes('\r\n');
  const body = crlf ? raw.replace(/\r\n/g, '\n') : raw;

  const doc = parseDocument(body);
  if (doc.errors.length > 0) throw new Error(`not valid YAML: ${doc.errors[0]!.message}`);
  const root = doc.contents;
  if (root !== null && !isMap(root) && !(isScalar(root) && (root.value === null || root.value === ''))) {
    throw new Error('the config must be a mapping');
  }

  let changed = unionInto(doc, ['domain', 'rules', 'trackerPrefixes'], proposal.trackerPrefixes);
  changed = unionInto(doc, ['domain', 'tests', 'ruleTraitKeys'], proposal.ruleTraitKeys) || changed;
  changed = unionInto(doc, ['index', 'tests'], proposal.indexTests) || changed;
  const tests = DEFAULT_DOMAIN_CONFIG.tests;
  changed =
    unionInto(doc, ['domain', 'tests', 'characterization', 'paths'], proposal.characterizationPaths, tests.characterization.paths) ||
    changed;
  changed = unionInto(doc, ['domain', 'tests', 'contract', 'paths'], proposal.contractPaths, tests.contract.paths) || changed;
  changed =
    unionInto(
      doc,
      ['domain', 'tests', 'characterization', 'annotations'],
      proposal.characterizationAnnotations ?? [],
      tests.characterization.annotations,
    ) || changed;
  changed =
    unionInto(doc, ['domain', 'tests', 'contract', 'annotations'], proposal.contractAnnotations ?? [], tests.contract.annotations) || changed;
  if (!changed) return { text, changed: false };
  const out = doc.toString({ lineWidth: 0 });
  return { text: (bom ? BOM : '') + (crlf ? out.replace(/\n/g, '\r\n') : out), changed: true };
}
