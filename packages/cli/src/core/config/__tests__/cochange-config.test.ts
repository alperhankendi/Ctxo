import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CtxoConfigSchema, DEFAULT_CONFIG } from '../config-schema.js';
import { loadConfig, resolveCoChangeConfig } from '../load-config.js';

const DEFAULT_RESOLVED = {
  maxCommits: 2000,
  maxFilesPerCommit: 30,
  minShared: 2,
  include: [],
  exclude: [],
};

describe('cochange config schema', () => {
  it('accepts a full cochange block', () => {
    const result = CtxoConfigSchema.safeParse({
      cochange: {
        maxCommits: 500,
        since: '12m',
        maxFilesPerCommit: 25,
        minShared: 3,
        include: ['**/*.sql'],
        exclude: ['packages/**/fixtures/**'],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts maxCommits 'all'", () => {
    expect(CtxoConfigSchema.safeParse({ cochange: { maxCommits: 'all' } }).success).toBe(true);
  });

  it('accepts the smallest valid limits', () => {
    const result = CtxoConfigSchema.safeParse({
      cochange: { maxCommits: 1, maxFilesPerCommit: 1, minShared: 1 },
    });

    expect(result.success).toBe(true);
  });

  it('leaves the whole block optional', () => {
    expect(CtxoConfigSchema.safeParse({}).success).toBe(true);
    expect(CtxoConfigSchema.safeParse({ cochange: {} }).success).toBe(true);
  });

  it.each(['30d', '2w', '12m', '1y'])('accepts since %s', (since) => {
    expect(CtxoConfigSchema.safeParse({ cochange: { since } }).success).toBe(true);
  });

  it('rejects an invalid since through the schema', () => {
    for (const since of ['12h', '12', '-3m', '', '1.5y', '12M', ' 12m', 12, null]) {
      const result = CtxoConfigSchema.safeParse({ cochange: { since } });
      expect(result.success, `since ${JSON.stringify(since)}`).toBe(false);
    }
  });

  it.each([
    0,
    -1,
    -2000,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '500',
    'ALL',
    'none',
    null,
    true,
  ])('rejects maxCommits %o', (maxCommits) => {
    expect(CtxoConfigSchema.safeParse({ cochange: { maxCommits } }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, '30'])('rejects maxFilesPerCommit %o', (maxFilesPerCommit) => {
    expect(CtxoConfigSchema.safeParse({ cochange: { maxFilesPerCommit } }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, '2'])('rejects minShared %o', (minShared) => {
    expect(CtxoConfigSchema.safeParse({ cochange: { minShared } }).success).toBe(false);
  });

  it('requires include and exclude to be arrays of non-empty strings', () => {
    expect(CtxoConfigSchema.safeParse({ cochange: { include: '**/*.sql' } }).success).toBe(false);
    expect(CtxoConfigSchema.safeParse({ cochange: { exclude: [''] } }).success).toBe(false);
    expect(CtxoConfigSchema.safeParse({ cochange: { exclude: [5] } }).success).toBe(false);
  });

  it('rejects unknown keys under cochange (typo protection)', () => {
    expect(CtxoConfigSchema.safeParse({ cochange: { maxCommit: 500 } }).success).toBe(false);
  });

  it('DEFAULT_CONFIG carries the defaults and validates', () => {
    expect(DEFAULT_CONFIG.cochange).toEqual(DEFAULT_RESOLVED);
    expect(CtxoConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
});

describe('resolveCoChangeConfig', () => {
  const configured = {
    cochange: {
      maxCommits: 500,
      since: '6m',
      maxFilesPerCommit: 10,
      minShared: 3,
      include: ['**/*.sql'],
      exclude: ['docs/**'],
    },
  };

  it('resolveCoChangeConfig applies defaults 2000/30/2 and CLI overrides win', () => {
    expect(resolveCoChangeConfig({})).toStrictEqual(DEFAULT_RESOLVED);
    expect(resolveCoChangeConfig(DEFAULT_CONFIG)).toStrictEqual(DEFAULT_RESOLVED);

    expect(resolveCoChangeConfig(configured)).toStrictEqual({
      maxCommits: 500,
      since: '6m',
      maxFilesPerCommit: 10,
      minShared: 3,
      include: ['**/*.sql'],
      exclude: ['docs/**'],
    });

    expect(resolveCoChangeConfig(configured, { maxCommits: 'all', since: '1y' })).toStrictEqual({
      maxCommits: 'all',
      since: '1y',
      maxFilesPerCommit: 10,
      minShared: 3,
      include: ['**/*.sql'],
      exclude: ['docs/**'],
    });
  });

  it('lets a CLI override replace the default when the config sets nothing', () => {
    expect(resolveCoChangeConfig({}, { maxCommits: 50, since: '30d' })).toStrictEqual({
      ...DEFAULT_RESOLVED,
      maxCommits: 50,
      since: '30d',
    });
  });

  it('overrides one setting without touching the others', () => {
    expect(resolveCoChangeConfig(configured, { maxCommits: 100 })).toMatchObject({ maxCommits: 100, since: '6m' });
    expect(resolveCoChangeConfig(configured, { since: '2w' })).toMatchObject({ maxCommits: 500, since: '2w' });
    expect(resolveCoChangeConfig(configured, {})).toMatchObject({ maxCommits: 500, since: '6m' });
  });

  it('leaves since out entirely when nothing sets it', () => {
    expect('since' in resolveCoChangeConfig({})).toBe(false);
    expect('since' in resolveCoChangeConfig(DEFAULT_CONFIG)).toBe(false);
  });

  it('skips an override the schema would reject and falls back to the config', () => {
    for (const maxCommits of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveCoChangeConfig(configured, { maxCommits }).maxCommits, `maxCommits ${maxCommits}`).toBe(500);
    }
    expect(resolveCoChangeConfig(configured, { since: '12h' }).since).toBe('6m');
    expect(resolveCoChangeConfig({}, { maxCommits: -1, since: 'soon' })).toStrictEqual(DEFAULT_RESOLVED);
  });

  it('falls back to the defaults for config values the schema would reject', () => {
    const bypassed = {
      cochange: { maxCommits: -1, since: 'soon', maxFilesPerCommit: 0, minShared: 1.5 },
    } as never;

    expect(resolveCoChangeConfig(bypassed)).toStrictEqual(DEFAULT_RESOLVED);
  });

  it('drops include and exclude patterns that are not valid globs', () => {
    const bypassed = { cochange: { include: ['**/*.sql', ''], exclude: ['', 'docs/**'] } } as never;

    expect(resolveCoChangeConfig(bypassed)).toMatchObject({ include: ['**/*.sql'], exclude: ['docs/**'] });
  });

  it('returns lists that do not alias the configuration', () => {
    const resolved = resolveCoChangeConfig(configured);

    expect(resolved.include).not.toBe(configured.cochange.include);
    expect(resolved.exclude).not.toBe(configured.cochange.exclude);
    expect(resolveCoChangeConfig({}).include).not.toBe(resolveCoChangeConfig({}).include);
  });
});

describe('loadConfig with a cochange block', () => {
  let ctxoRoot: string;

  beforeEach(() => {
    ctxoRoot = mkdtempSync(join(tmpdir(), 'ctxo-cochange-config-'));
    // loadConfig warns on stderr for every rejected file; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(ctxoRoot, { recursive: true, force: true });
  });

  function writeConfig(yaml: string): void {
    mkdirSync(ctxoRoot, { recursive: true });
    writeFileSync(join(ctxoRoot, 'config.yaml'), yaml);
  }

  it('resolves the defaults when config.yaml is absent', () => {
    expect(resolveCoChangeConfig(loadConfig(ctxoRoot).config)).toStrictEqual(DEFAULT_RESOLVED);
  });

  it('resolves the defaults when config.yaml has no cochange block', () => {
    writeConfig('version: "1.0"\n');

    expect(resolveCoChangeConfig(loadConfig(ctxoRoot).config)).toStrictEqual(DEFAULT_RESOLVED);
  });

  it('reads the cochange block from config.yaml', () => {
    writeConfig(`version: "1.0"
cochange:
  maxCommits: all
  since: 12m
  maxFilesPerCommit: 25
  minShared: 3
  include:
    - "**/*.sql"
  exclude:
    - "packages/**/fixtures/**"
`);

    const loaded = loadConfig(ctxoRoot);

    expect(loaded.errors).toEqual([]);
    expect(loaded.invalidGlobs).toEqual([]);
    expect(resolveCoChangeConfig(loaded.config)).toStrictEqual({
      maxCommits: 'all',
      since: '12m',
      maxFilesPerCommit: 25,
      minShared: 3,
      include: ['**/*.sql'],
      exclude: ['packages/**/fixtures/**'],
    });
  });

  it('reads a numeric maxCommits', () => {
    writeConfig('cochange:\n  maxCommits: 750\n');

    const loaded = loadConfig(ctxoRoot);

    expect(loaded.errors).toEqual([]);
    expect(resolveCoChangeConfig(loaded.config).maxCommits).toBe(750);
  });

  it('rejects an invalid since and falls back to the defaults', () => {
    writeConfig('cochange:\n  since: 12h\n');

    const loaded = loadConfig(ctxoRoot);

    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toMatch(/^cochange\.since: /);
    expect(resolveCoChangeConfig(loaded.config)).toStrictEqual(DEFAULT_RESOLVED);
  });

  it.each(['0', '-5', '1.5', '.nan', '.inf', '-.inf', 'none', '"500"', 'true', '[1]'])(
    'rejects maxCommits: %s and falls back to the default window',
    (yamlValue) => {
      writeConfig(`cochange:\n  maxCommits: ${yamlValue}\n`);

      const loaded = loadConfig(ctxoRoot);

      expect(loaded.errors.length).toBeGreaterThan(0);
      expect(loaded.errors[0]).toMatch(/^cochange\.maxCommits: /);
      expect(resolveCoChangeConfig(loaded.config).maxCommits).toBe(2000);
    },
  );

  it('explains what maxCommits accepts', () => {
    writeConfig('cochange:\n  maxCommits: none\n');

    expect(loadConfig(ctxoRoot).errors[0]).toContain('positive integer or "all"');
  });

  it.each(['maxFilesPerCommit', 'minShared'])('rejects a zero %s', (key) => {
    writeConfig(`cochange:\n  ${key}: 0\n`);

    const loaded = loadConfig(ctxoRoot);

    expect(loaded.errors[0]).toMatch(new RegExp(`^cochange\\.${key}: `));
  });

  it('rejects unknown keys under cochange', () => {
    writeConfig('cochange:\n  maxCommit: 500\n');

    expect(loadConfig(ctxoRoot).errors.length).toBeGreaterThan(0);
  });

  it('reports invalid cochange globs the way index.ignore does and drops them from the resolved config', () => {
    // picomatch refuses patterns above 65536 characters, which is the one way a non-empty string fails.
    const tooLong = 'a'.repeat(65_537);
    writeConfig(`cochange:
  include:
    - "${tooLong}"
  exclude:
    - "docs/**"
    - "${tooLong}"
`);

    const loaded = loadConfig(ctxoRoot);

    expect(loaded.errors).toEqual([]);
    expect(loaded.invalidGlobs).toEqual([`cochange.include: ${tooLong}`, `cochange.exclude: ${tooLong}`]);
    expect(resolveCoChangeConfig(loaded.config)).toMatchObject({ include: [], exclude: ['docs/**'] });
  });
});
