import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CtxoLanguagePlugin } from '@ctxo/plugin-api';

// Plugin discovery is stubbed, so this stays out of update-command.test.ts, which exercises the real one.
const discoverPlugins = vi.hoisted(() => vi.fn());
vi.mock('../../adapters/language/plugin-discovery.js', () => ({ discoverPlugins }));

import { defaultDiscoverInstalled } from '../update-command.js';

const SQL_PLUGIN: CtxoLanguagePlugin = {
  apiVersion: '2',
  id: 'sql',
  name: 'SQL (T-SQL definitions and data access)',
  version: '0.1.0',
  extensions: ['.sql'],
  tier: 'syntax',
  createAdapter: () => {
    throw new Error('discovery must not create adapters');
  },
};

describe('defaultDiscoverInstalled', () => {
  let dir: string;

  beforeEach(() => {
    discoverPlugins.mockReset();
    dir = mkdtempSync(join(tmpdir(), 'ctxo-update-discovery-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'library-app', devDependencies: { '@ctxo/lang-sql': '^0.1.0' } }),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('defaultDiscoverInstalled lists a v2 plugin with its version', async () => {
    discoverPlugins.mockResolvedValue({
      plugins: [{ plugin: SQL_PLUGIN, specifier: '@ctxo/lang-sql' }],
      failures: [],
    });

    const installed = await defaultDiscoverInstalled(dir);

    expect(installed.map((p) => p.name)).toEqual(['@ctxo/cli', '@ctxo/lang-sql']);
    expect(installed.find((p) => p.name === '@ctxo/lang-sql')).toEqual({ name: '@ctxo/lang-sql', version: '0.1.0' });
    expect(discoverPlugins).toHaveBeenCalledTimes(1);
  });
});
