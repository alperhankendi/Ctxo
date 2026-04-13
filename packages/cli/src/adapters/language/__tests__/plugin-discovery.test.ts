import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPlugins } from '../plugin-discovery.js';

function writeManifest(dir: string, body: unknown): string {
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

async function writePluginModule(
  pluginDir: string,
  source: string,
): Promise<string> {
  mkdirSync(pluginDir, { recursive: true });
  const indexPath = join(pluginDir, 'index.mjs');
  writeFileSync(indexPath, source);
  return indexPath;
}

describe('discoverPlugins', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ctxo-disc-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty when manifest path does not exist', async () => {
    const result = await discoverPlugins({ manifestPath: join(tmp, 'missing.json') });
    expect(result.plugins).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('returns empty when manifest has no ctxo-lang-* deps', async () => {
    const path = writeManifest(tmp, { dependencies: { 'left-pad': '^1.0.0' } });
    const result = await discoverPlugins({ manifestPath: path });
    expect(result.plugins).toEqual([]);
  });

  it('loads a valid local plugin via explicit path', async () => {
    const pluginDir = join(tmp, 'my-plugin');
    await writePluginModule(
      pluginDir,
      `export default {
        apiVersion: '1',
        id: 'kotlin',
        name: 'Kotlin',
        version: '1.0.0',
        extensions: ['.kt'],
        tier: 'syntax',
        createAdapter: () => ({
          extractSymbols: async () => [],
          extractEdges: async () => [],
          extractComplexity: async () => [],
          isSupported: () => true,
        }),
      };`,
    );
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./my-plugin/index.mjs'],
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.plugin.id).toBe('kotlin');
    expect(result.plugins[0]!.specifier).toBe('./my-plugin/index.mjs');
  });

  it('rejects a plugin with an unsupported apiVersion', async () => {
    const pluginDir = join(tmp, 'bad-api');
    await writePluginModule(
      pluginDir,
      `export default {
        apiVersion: '2',
        id: 'future',
        name: 'Future',
        version: '0.0.1',
        extensions: ['.fx'],
        tier: 'syntax',
        createAdapter: () => ({}),
      };`,
    );
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./bad-api/index.mjs'],
    });
    expect(result.plugins).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toMatch(/unsupported apiVersion 2/);
  });

  it('rejects a plugin missing createAdapter', async () => {
    const pluginDir = join(tmp, 'no-factory');
    await writePluginModule(
      pluginDir,
      `export default {
        apiVersion: '1',
        id: 'broken',
        name: 'Broken',
        version: '0.0.1',
        extensions: ['.x'],
        tier: 'syntax',
      };`,
    );
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./no-factory/index.mjs'],
    });
    expect(result.failures[0]!.reason).toMatch(/createAdapter/);
  });

  it('rejects a plugin with an invalid tier', async () => {
    const pluginDir = join(tmp, 'weird-tier');
    await writePluginModule(
      pluginDir,
      `export default {
        apiVersion: '1',
        id: 'weird',
        name: 'Weird',
        version: '0.0.1',
        extensions: ['.w'],
        tier: 'experimental',
        createAdapter: () => ({}),
      };`,
    );
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./weird-tier/index.mjs'],
    });
    expect(result.failures[0]!.reason).toMatch(/invalid tier/);
  });

  it('rejects a plugin with missing id', async () => {
    const pluginDir = join(tmp, 'no-id');
    await writePluginModule(
      pluginDir,
      `export default {
        apiVersion: '1',
        id: '',
        name: 'Nameless',
        version: '0.0.1',
        extensions: ['.x'],
        tier: 'syntax',
        createAdapter: () => ({}),
      };`,
    );
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./no-id/index.mjs'],
    });
    expect(result.failures[0]!.reason).toMatch(/id/);
  });

  it('rejects a plugin whose module throws on import', async () => {
    const pluginDir = join(tmp, 'explodes');
    await writePluginModule(pluginDir, `throw new Error('kaboom');`);
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./explodes/index.mjs'],
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toMatch(/kaboom/);
  });

  it('honours shouldSkipSpecifier and never imports skipped plugins', async () => {
    const pluginDir = join(tmp, 'skip-me');
    await writePluginModule(pluginDir, `throw new Error('should not be imported');`);
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./skip-me/index.mjs'],
      shouldSkipSpecifier: (spec) => spec.includes('skip-me'),
    });
    expect(result.plugins).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('accepts named plugin export as fallback to default', async () => {
    const pluginDir = join(tmp, 'named-export');
    await writePluginModule(
      pluginDir,
      `export const plugin = {
        apiVersion: '1',
        id: 'named',
        name: 'Named',
        version: '0.1.0',
        extensions: ['.n'],
        tier: 'syntax',
        createAdapter: () => ({}),
      };`,
    );
    writeManifest(tmp, {});
    const result = await discoverPlugins({
      manifestPath: join(tmp, 'package.json'),
      explicit: ['./named-export/index.mjs'],
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.plugin.id).toBe('named');
  });
});
