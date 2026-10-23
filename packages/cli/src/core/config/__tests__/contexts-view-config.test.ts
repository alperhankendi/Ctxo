import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resolveContextsViewConfig } from '../load-config.js';
import { DEFAULT_TECHNICAL_TERMS } from '../config-schema.js';

describe('contextsView config', () => {
  let ctxoRoot: string;

  beforeEach(() => {
    ctxoRoot = mkdtempSync(join(tmpdir(), 'ctxo-contexts-config-'));
  });

  afterEach(() => {
    rmSync(ctxoRoot, { recursive: true, force: true });
  });

  function load(yaml: string) {
    writeFileSync(join(ctxoRoot, 'config.yaml'), yaml);
    return loadConfig(ctxoRoot);
  }

  it('resolveContextsViewConfig returns the spec defaults when the section is absent', () => {
    const resolved = resolveContextsViewConfig(load('version: "1.0"\n').config);
    expect(resolved).toEqual({
      weights: { dependency: 1, coChange: 1, data: 0 },
      exclude: [],
      hubs: { auto: true, topPercent: 1, minDependents: 10, paths: [] },
      resolution: 1,
      minCandidateFiles: 3,
      technicalTerms: [...DEFAULT_TECHNICAL_TERMS],
    });
    expect(DEFAULT_TECHNICAL_TERMS).toEqual([
      'Service',
      'Repository',
      'Controller',
      'Handler',
      'Manager',
      'Dto',
      'Impl',
      'Async',
    ]);
  });

  it('resolveContextsViewConfig takes configured values and drops invalid globs', () => {
    const tooLong = 'a'.repeat(65_537);
    const loaded = load(
      [
        'contextsView:',
        '  weights: { dependency: 0.5, coChange: 2, data: 0.25 }',
        `  exclude: ["docs/**", "${tooLong}"]`,
        `  hubs: { auto: false, topPercent: 5, minDependents: 4, paths: ["src/shared/**", "${tooLong}"] }`,
        '  resolution: 1.5',
        '  minCandidateFiles: 2',
        '  technicalTerms: [Facade]',
        '',
      ].join('\n'),
    );
    expect(loaded.errors).toEqual([]);
    expect(loaded.invalidGlobs).toEqual([
      expect.stringContaining('contextsView.exclude: '),
      expect.stringContaining('contextsView.hubs.paths: '),
    ]);
    expect(resolveContextsViewConfig(loaded.config)).toEqual({
      weights: { dependency: 0.5, coChange: 2, data: 0.25 },
      exclude: ['docs/**'],
      hubs: { auto: false, topPercent: 5, minDependents: 4, paths: ['src/shared/**'] },
      resolution: 1.5,
      minCandidateFiles: 2,
      technicalTerms: ['Facade'],
    });
  });

  it('the schema rejects resolution 0, a negative weight, topPercent 0 or 101, minCandidateFiles 0 and unknown keys', () => {
    for (const body of [
      'resolution: 0',
      'weights: { dependency: -1 }',
      'hubs: { topPercent: 0 }',
      'hubs: { topPercent: 101 }',
      'minCandidateFiles: 0',
      'bogus: 1',
      'weights: { bogus: 1 }',
      'hubs: { bogus: 1 }',
    ]) {
      const loaded = load(`contextsView:\n  ${body}\n`);
      expect(loaded.errors.length, body).toBeGreaterThan(0);
    }
  });

  it('the defaults include weights.data 0', () => {
    expect(resolveContextsViewConfig(load('version: "1.0"\n').config).weights).toEqual({
      dependency: 1,
      coChange: 1,
      data: 0,
    });
    // Another weight set alone leaves data at its default.
    expect(resolveContextsViewConfig(load('contextsView:\n  weights: { coChange: 0.5 }\n').config).weights).toEqual({
      dependency: 1,
      coChange: 0.5,
      data: 0,
    });
  });

  it('the schema rejects a negative data weight', () => {
    expect(load('contextsView:\n  weights: { data: -0.5 }\n').errors.length).toBeGreaterThan(0);
    const accepted = load('contextsView:\n  weights: { data: 0.5 }\n');
    expect(accepted.errors).toEqual([]);
    expect(resolveContextsViewConfig(accepted.config).weights.data).toBe(0.5);
  });
});
