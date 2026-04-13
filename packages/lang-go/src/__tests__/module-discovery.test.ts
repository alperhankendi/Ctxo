import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { discoverGoModule } from '../analyzer/module-discovery.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'ctxo-modtest-'));
}

describe('discoverGoModule', () => {
  it('finds go.mod at the start directory', () => {
    const root = tmp();
    writeFileSync(join(root, 'go.mod'), 'module fixture\n');
    expect(discoverGoModule(root)).toBe(root);
  });

  it('walks up to find a parent go.mod', () => {
    const root = tmp();
    writeFileSync(join(root, 'go.mod'), 'module fixture\n');
    const sub = join(root, 'cmd', 'app');
    mkdirSync(sub, { recursive: true });
    expect(discoverGoModule(sub)).toBe(root);
  });

  it('prefers go.work when present alongside go.mod up the chain', () => {
    const root = tmp();
    writeFileSync(join(root, 'go.work'), 'go 1.22\n');
    expect(discoverGoModule(root)).toBe(root);
  });

  it('falls back to a shallow recursive search when nothing is upward', () => {
    const root = tmp();
    const nested = join(root, 'services', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'go.mod'), 'module fixture\n');

    const found = discoverGoModule(root);
    expect(found?.replace(/[/\\]+/g, sep)).toBe(nested);
  });

  it('returns null when no module can be located', () => {
    const root = tmp();
    expect(discoverGoModule(root)).toBeNull();
  });
});
