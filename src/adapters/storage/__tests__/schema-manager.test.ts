import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SchemaManager } from '../schema-manager.js';

describe('SchemaManager', () => {
  let tempDir: string;
  let manager: SchemaManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-schema-'));
    manager = new SchemaManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes schema version on first run', () => {
    manager.writeVersion();

    const stored = manager.readStoredVersion();
    expect(stored).toBe(manager.currentVersion());
  });

  it('reads existing schema version', () => {
    manager.writeVersion();
    expect(manager.readStoredVersion()).toBe('1.0.0');
  });

  it('returns undefined when no version file exists', () => {
    expect(manager.readStoredVersion()).toBeUndefined();
  });

  it('detects compatible version', () => {
    manager.writeVersion();
    expect(manager.isCompatible()).toBe(true);
  });

  it('detects incompatible when no version file exists', () => {
    expect(manager.isCompatible()).toBe(false);
  });

  it('overwrites version on repeated write', () => {
    manager.writeVersion();
    manager.writeVersion();
    expect(manager.readStoredVersion()).toBe('1.0.0');
  });
});
