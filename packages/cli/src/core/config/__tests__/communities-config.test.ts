import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { communityDetectorOptions, loadConfig } from '../load-config.js';

describe('communities config', () => {
  let ctxoRoot: string;

  beforeEach(() => {
    ctxoRoot = mkdtempSync(join(tmpdir(), 'ctxo-communities-config-'));
  });

  afterEach(() => {
    rmSync(ctxoRoot, { recursive: true, force: true });
  });

  function load(yaml: string) {
    writeFileSync(join(ctxoRoot, 'config.yaml'), yaml);
    return loadConfig(ctxoRoot);
  }

  it('communityDetectorOptions returns the configured values', () => {
    const { config, errors } = load(
      'communities:\n  resolution: 0.5\n  godNodeMinBridged: 4\n  godNodeMaxResults: 5\n',
    );
    expect(errors).toEqual([]);
    expect(communityDetectorOptions(config)).toEqual({ resolution: 0.5, godNodeMinBridged: 4, godNodeMaxResults: 5 });
  });

  it('communityDetectorOptions is empty when the section is absent', () => {
    expect(communityDetectorOptions(load('version: "1.0"\n').config)).toEqual({});
  });

  it('the schema rejects resolution 0, godNodeMinBridged 0 and an unknown key under communities', () => {
    for (const yaml of [
      'communities:\n  resolution: 0\n',
      'communities:\n  godNodeMinBridged: 0\n',
      'communities:\n  bogus: 1\n',
    ]) {
      const { errors } = load(yaml);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/^communities/);
    }
  });
});
