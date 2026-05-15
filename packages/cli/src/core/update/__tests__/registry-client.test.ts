import { describe, it, expect } from 'vitest';
import {
  fetchDistTags,
  fetchDistTagsBatch,
  type HttpsFetcher,
  type RegistryHit,
  type RegistryMiss,
} from '../registry-client.js';

function fakeFetcher(map: Record<string, { status: number; body: string } | Error>): HttpsFetcher {
  return async (url) => {
    const entry = Object.entries(map).find(([key]) => url.includes(encodeURIComponent(key)) || url.includes(key));
    if (!entry) throw new Error(`unexpected URL ${url}`);
    const value = entry[1];
    if (value instanceof Error) throw value;
    return value;
  };
}

describe('fetchDistTags', () => {
  it('returns a RegistryHit with dist-tags on 200 response', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '0.7.0', alpha: '0.7.1-alpha.0' } }) },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toEqual<RegistryHit>({
      name: '@ctxo/cli',
      distTags: { latest: '0.7.0', alpha: '0.7.1-alpha.0' },
    });
  });

  it('returns a registry-404 miss when status is 404', async () => {
    const fetcher = fakeFetcher({
      'ctxo-lang-kotlin': { status: 404, body: '{"error":"Not found"}' },
    });
    const result = await fetchDistTags('ctxo-lang-kotlin', { fetcher });
    expect(result).toEqual<RegistryMiss>({
      name: 'ctxo-lang-kotlin',
      reason: 'registry-404',
      status: 404,
    });
  });

  it('returns a registry-error miss for non-2xx, non-404 statuses', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 503, body: 'temporarily unavailable' },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'registry-error', status: 503 });
  });

  it('returns a registry-error miss when body is not JSON', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: 'not-json{' },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'registry-error' });
  });

  it('returns a registry-error miss when dist-tags is missing or not an object', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: JSON.stringify({ name: '@ctxo/cli' }) },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'registry-error' });
  });

  it('returns a timeout miss when fetcher throws a timeout error', async () => {
    const fetcher: HttpsFetcher = async () => { const e: NodeJS.ErrnoException = new Error('timeout'); e.code = 'ETIMEDOUT'; throw e; };
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'timeout' });
  });

  it('returns a network miss when fetcher throws a connection error', async () => {
    const fetcher: HttpsFetcher = async () => { const e: NodeJS.ErrnoException = new Error('refused'); e.code = 'ECONNREFUSED'; throw e; };
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'network' });
  });

  it('url-encodes scoped package names', async () => {
    let seenUrl = '';
    const fetcher: HttpsFetcher = async (url) => { seenUrl = url; return { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '1.0.0' } }) }; };
    await fetchDistTags('@ctxo/cli', { fetcher });
    expect(seenUrl).toBe('https://registry.npmjs.org/%40ctxo%2Fcli');
  });
});

describe('fetchDistTagsBatch', () => {
  it('preserves input order and mixes hits with misses', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '0.7.0' } }) },
      'ctxo-lang-kotlin': { status: 404, body: '{}' },
    });
    const results = await fetchDistTagsBatch(['@ctxo/cli', 'ctxo-lang-kotlin'], { fetcher });
    expect(results.map((r) => r.name)).toEqual(['@ctxo/cli', 'ctxo-lang-kotlin']);
    expect((results[0] as RegistryHit).distTags.latest).toBe('0.7.0');
    expect((results[1] as RegistryMiss).reason).toBe('registry-404');
  });
});
