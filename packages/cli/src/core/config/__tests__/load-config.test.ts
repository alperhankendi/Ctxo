import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  statsEnabled,
  indexIgnorePatterns,
  indexIgnoreProjectPatterns,
  makeGlobMatcher,
} from '../load-config.js';

describe('loadConfig', () => {
  let ctxoRoot: string;

  beforeEach(() => {
    ctxoRoot = mkdtempSync(join(tmpdir(), 'ctxo-config-'));
  });

  afterEach(() => {
    rmSync(ctxoRoot, { recursive: true, force: true });
  });

  function writeConfig(yaml: string): void {
    mkdirSync(ctxoRoot, { recursive: true });
    writeFileSync(join(ctxoRoot, 'config.yaml'), yaml);
  }

  it('returns defaults when config.yaml is absent', () => {
    const loaded = loadConfig(ctxoRoot);
    expect(loaded.exists).toBe(false);
    expect(loaded.errors).toEqual([]);
    expect(statsEnabled(loaded.config)).toBe(true);
    expect(indexIgnorePatterns(loaded.config)).toEqual([]);
    expect(indexIgnoreProjectPatterns(loaded.config)).toEqual([]);
  });

  it('parses index.ignore and index.ignoreProjects', () => {
    writeConfig(`version: "1.0"
index:
  ignore:
    - "packages/**/fixtures/**"
    - "tools/legacy-*/**"
  ignoreProjects:
    - "packages/experimental-*"
    - "examples/*"
`);
    const loaded = loadConfig(ctxoRoot);
    expect(loaded.errors).toEqual([]);
    expect(indexIgnorePatterns(loaded.config)).toEqual([
      'packages/**/fixtures/**',
      'tools/legacy-*/**',
    ]);
    expect(indexIgnoreProjectPatterns(loaded.config)).toEqual([
      'packages/experimental-*',
      'examples/*',
    ]);
  });

  it('preserves stats.enabled = false for backward compatibility', () => {
    writeConfig(`version: "1.0"
stats:
  enabled: false
`);
    const loaded = loadConfig(ctxoRoot);
    expect(statsEnabled(loaded.config)).toBe(false);
  });

  it('defaults stats.enabled to true when stats block absent', () => {
    writeConfig(`version: "1.0"
`);
    expect(statsEnabled(loadConfig(ctxoRoot).config)).toBe(true);
  });

  it('reports zod errors for malformed index.ignore (non-array)', () => {
    writeConfig(`version: "1.0"
index:
  ignore: "packages/**"
`);
    const loaded = loadConfig(ctxoRoot);
    expect(loaded.errors.length).toBeGreaterThan(0);
    // falls back to defaults
    expect(indexIgnorePatterns(loaded.config)).toEqual([]);
  });

  it('rejects unknown keys under index', () => {
    writeConfig(`version: "1.0"
index:
  ignore: []
  bogusKey: true
`);
    const loaded = loadConfig(ctxoRoot);
    expect(loaded.errors.length).toBeGreaterThan(0);
  });

  it('reports invalid YAML gracefully (no throw)', () => {
    writeConfig(`: : ][ not yaml`);
    const loaded = loadConfig(ctxoRoot);
    expect(loaded.errors.length).toBeGreaterThan(0);
    expect(statsEnabled(loaded.config)).toBe(true);
  });
});

describe('makeGlobMatcher', () => {
  it('returns false predicate for empty patterns', () => {
    const m = makeGlobMatcher([]);
    expect(m('packages/foo/bar.ts')).toBe(false);
  });

  it('matches file globs with forward-slash normalisation', () => {
    const m = makeGlobMatcher(['packages/**/fixtures/**']);
    expect(m('packages/cli/fixtures/foo.ts')).toBe(true);
    expect(m('packages\\cli\\fixtures\\foo.ts')).toBe(true);
    expect(m('packages/cli/src/foo.ts')).toBe(false);
  });

  it('matches project globs', () => {
    const m = makeGlobMatcher(['packages/experimental-*', 'examples/*']);
    expect(m('packages/experimental-foo')).toBe(true);
    expect(m('examples/demo')).toBe(true);
    expect(m('packages/cli')).toBe(false);
  });
});
