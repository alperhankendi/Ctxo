import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleHost, type CtxoModuleRegistration, type IndexPassContext } from '@ctxo/cli/internal';
import { register } from '../../index.js';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../../core/domain-config.js';
import { createDomainState } from '../../mcp/domain-state.js';
import { ARTIFACTS, createLoopProject, POLICY_FILE, REGISTRY, type LoopProject } from '../../mcp/__tests__/loop-fixture.js';
import { createWatchPathClassifier } from '../watch-paths.js';
import { FACTS_MISSING_WARNING } from '../../index-pass/domain-index-pass.js';

const CARD_PATH = 'docs/domain/lending/domain.md';
const REGISTRY_PATH = 'docs/domain/contexts.yaml';

let loop: LoopProject;

beforeEach(() => {
  loop = createLoopProject();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  loop.dispose();
});

describe('createWatchPathClassifier', () => {
  const classifier = (config: DomainConfig = DEFAULT_DOMAIN_CONFIG) => createWatchPathClassifier(loop.root, () => config);

  it('the registry is an input, also while it is missing', () => {
    const classify = classifier();
    expect(classify(REGISTRY_PATH, false)).toBe('input');
    expect(classify('./docs/domain/contexts.yaml', false)).toBe('input');
    expect(classify('docs\\domain\\contexts.yaml', false)).toBe('input');
    // No registry: nothing else is read.
    expect(classify(CARD_PATH, false)).toBeUndefined();
    expect(classify('src/Lending/Loan.ts', true)).toBeUndefined();
  });

  it('cards and the glossary are inputs; indexed and text-scan files are sources; shadow-specs files are not read', async () => {
    await loop.index();
    const classify = classifier();
    expect(classify(CARD_PATH, false)).toBe('input');
    expect(classify('docs/domain/glossary.md', false)).toBe('input');
    // Resolutions apply when the tools read them: no pass.
    expect(classify('docs/domain/lending/shadow-specs.yaml', false)).toBeUndefined();
    expect(classify('docs/domain/billing/shadow-specs.yaml', false)).toBeUndefined();
    expect(classify(POLICY_FILE, true)).toBe('source');
    expect(classify('src/Lending/rules.dart', false)).toBe('source');
    expect(classify('README.md', false)).toBeUndefined();
    expect(classify('docs/domain/other.md', false)).toBeUndefined();
  });

  it('follows a registry edit that names a new card', async () => {
    await loop.index();
    const classify = classifier();
    expect(classify('docs/domain/billing/domain.md', false)).toBeUndefined();
    loop.write(REGISTRY_PATH, REGISTRY.replace('    paths: ["src/Billing/**"]', '    card: docs/domain/billing/domain.md\n    paths: ["src/Billing/**"]'));
    expect(classify(REGISTRY_PATH, false)).toBe('input');
    expect(classify('docs/domain/billing/domain.md', false)).toBe('input');
  });

  it('an invalid registry leaves only the registry itself as an input', async () => {
    await loop.index();
    loop.write(REGISTRY_PATH, 'version: 2\n');
    const classify = classifier();
    expect(classify(REGISTRY_PATH, false)).toBe('input');
    expect(classify(CARD_PATH, false)).toBeUndefined();
    expect(classify(POLICY_FILE, true)).toBeUndefined();
  });

  it('a custom registry path and text-scan extensions are honoured', async () => {
    await loop.index();
    const config: DomainConfig = {
      ...DEFAULT_DOMAIN_CONFIG,
      registry: 'domain/contexts.yaml',
      facts: { ...DEFAULT_DOMAIN_CONFIG.facts, textScanExtensions: ['.rb'] },
    };
    loop.write('domain/contexts.yaml', REGISTRY);
    const classify = classifier(config);
    expect(classify('domain/contexts.yaml', false)).toBe('input');
    expect(classify(REGISTRY_PATH, false)).toBeUndefined();
    expect(classify('domain/lending/shadow-specs.yaml', false)).toBeUndefined();
    expect(classify('src/x.rb', false)).toBe('source');
    expect(classify('src/x.dart', false)).toBeUndefined();
  });

  it('matches the registry and cards case-folded on a case-insensitive file system', async () => {
    await loop.index();
    const folded = createWatchPathClassifier(loop.root, () => DEFAULT_DOMAIN_CONFIG, { caseInsensitive: true });
    expect(folded('Docs/Domain/Lending/DOMAIN.md', false)).toBe('input');
    expect(folded('docs/domain/CONTEXTS.yaml', false)).toBe('input');
    const exact = createWatchPathClassifier(loop.root, () => DEFAULT_DOMAIN_CONFIG, { caseInsensitive: false });
    expect(exact('Docs/Domain/Lending/DOMAIN.md', false)).toBeUndefined();
    expect(exact('docs/domain/CONTEXTS.yaml', false)).toBeUndefined();
  });

  it('never throws: a config that fails gives undefined', () => {
    const classify = createWatchPathClassifier(loop.root, () => {
      throw new Error('no config');
    });
    expect(classify(REGISTRY_PATH, false)).toBeUndefined();
  });
});

describe('the domain pass under ctxo watch', () => {
  /** What `ctxo watch` hands the pass: the merged JSON index and the config, no change log. */
  async function watchPass(registration: CtxoModuleRegistration, factsRequested?: boolean): Promise<void> {
    const { services } = createModuleHost({ projectRoot: loop.root, mode: 'cli' });
    const indices = services.readIndex(loop.ctxoRoot);
    const config = services.loadConfig(loop.ctxoRoot).config;
    const ctx: IndexPassContext = {
      projectRoot: loop.root,
      ctxoRoot: loop.ctxoRoot,
      config,
      indices,
      graph: () => services.buildGraph(indices),
      isTestFile: services.createTestFileCheck(config, indices),
      ...(factsRequested === undefined ? {} : { factsRequested }),
    };
    await registration.indexPass!(ctx);
  }

  const artifacts = () =>
    Object.fromEntries(ARTIFACTS.map((name) => [name, readFileSync(join(loop.ctxoRoot, 'index', 'domain', name), 'utf-8')]));

  async function registration(): Promise<CtxoModuleRegistration> {
    const registered = await register(createModuleHost({ projectRoot: loop.root, mode: 'cli' }));
    expect(registered?.classifyWatchPath).toBeTypeOf('function');
    return registered!;
  }

  it('a card edit is an input, and the pass clears stale', async () => {
    await loop.index();
    const reg = await registration();
    const state = createDomainState(loop.host());
    loop.write(CARD_PATH, `${readFileSync(join(loop.root, CARD_PATH), 'utf-8')}\n### LEND-05 A fine is a tenth of the price\n`);
    loop.age(CARD_PATH);
    const before = state.load();
    expect(before.ok && before.snapshot.staleCards).toBe(true);

    expect(reg.classifyWatchPath!(CARD_PATH, false)).toBe('input');
    await watchPass(reg);
    for (const name of ARTIFACTS) loop.age(`.ctxo/index/domain/${name}`);

    const after = state.load();
    expect(after.ok).toBe(true);
    expect(after.ok && after.snapshot.staleCards).toBe(false);
    expect(after.ok && after.snapshot.graph.rules.map((r) => r.id)).toContain('rule:LEND-05');
  });

  it('a registry edit is an input, and the pass rebuilds the graph for it', async () => {
    await loop.index();
    const reg = await registration();
    const state = createDomainState(loop.host());
    loop.write(REGISTRY_PATH, `${REGISTRY}# edited\n`);
    loop.age(REGISTRY_PATH);
    const before = state.load();
    expect(!before.ok && before.reason).toBe('stale-registry');

    expect(reg.classifyWatchPath!(REGISTRY_PATH, false)).toBe('input');
    await watchPass(reg);
    for (const name of ARTIFACTS) loop.age(`.ctxo/index/domain/${name}`);
    const after = state.load();
    expect(after.ok).toBe(true);
  });

  it('a second pass on the same input writes the same bytes', async () => {
    await loop.index();
    const fromIndex = artifacts();
    const reg = await registration();
    await watchPass(reg);
    expect(artifacts()).toEqual(fromIndex);
    await watchPass(reg);
    expect(artifacts()).toEqual(fromIndex);
  });

  it('a registry that appeared after watch started (no facts requested) writes nothing and warns once', async () => {
    await loop.index();
    const domainDir = join(loop.ctxoRoot, 'index', 'domain');
    rmSync(domainDir, { recursive: true, force: true });
    const reg = await registration();
    const warnings: string[] = [];
    vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    await watchPass(reg, false);
    await watchPass(reg, false);
    expect(existsSync(domainDir)).toBe(false);
    expect(warnings.filter((w) => w.includes(FACTS_MISSING_WARNING))).toHaveLength(1);
    // With facts requested (a watch started after the registry existed) the pass writes as usual.
    await watchPass(reg, true);
    expect(Object.keys(artifacts())).toEqual([...ARTIFACTS]);
  });

  it('watchArtifactsStale: fresh after the index pass, stale after a card or registry edit, not without a registry', async () => {
    await loop.index();
    expect((await registration()).watchArtifactsStale!()).toBe(false);
    loop.write(CARD_PATH, `${readFileSync(join(loop.root, CARD_PATH), 'utf-8')}\nmore\n`);
    loop.age(CARD_PATH);
    expect((await registration()).watchArtifactsStale!()).toBe(true);
    await loop.index();
    loop.write(REGISTRY_PATH, `${REGISTRY}# edited\n`);
    loop.age(REGISTRY_PATH);
    expect((await registration()).watchArtifactsStale!()).toBe(true);
    rmSync(join(loop.root, REGISTRY_PATH));
    expect((await registration()).watchArtifactsStale!()).toBe(false);
  });

  it('without a registry the classifier asks for no pass on source edits', async () => {
    await loop.index();
    rmSync(join(loop.root, REGISTRY_PATH));
    const reg = await registration();
    expect(reg.classifyWatchPath!(POLICY_FILE, true)).toBeUndefined();
    expect(reg.classifyWatchPath!(REGISTRY_PATH, false)).toBe('input');
  });
});
