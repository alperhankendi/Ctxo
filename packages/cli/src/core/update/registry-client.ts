import { request } from 'node:https';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:update:registry');

export interface RegistryDistTags {
  readonly [tag: string]: string;
}

export interface RegistryHit {
  readonly name: string;
  readonly distTags: RegistryDistTags;
}

export interface RegistryMiss {
  readonly name: string;
  readonly reason: 'registry-404' | 'registry-error' | 'timeout' | 'network';
  readonly status?: number;
  readonly message?: string;
}

export type RegistryResult = RegistryHit | RegistryMiss;

export interface FetchOptions {
  readonly timeoutMs?: number;
  readonly fetcher?: HttpsFetcher;
}

export type HttpsFetcher = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>;

const DEFAULT_TIMEOUT_MS = 5_000;

export async function fetchDistTags(
  packageName: string,
  options: FetchOptions = {},
): Promise<RegistryResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher = options.fetcher ?? defaultHttpsFetcher;
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

  let response: { status: number; body: string };
  try {
    response = await fetcher(url, timeoutMs);
  } catch (err) {
    return classifyFetchError(packageName, err);
  }

  if (response.status === 404) {
    return { name: packageName, reason: 'registry-404', status: 404 };
  }
  if (response.status < 200 || response.status >= 300) {
    return { name: packageName, reason: 'registry-error', status: response.status };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return { name: packageName, reason: 'registry-error', status: response.status, message: 'invalid JSON' };
  }
  const distTags = (parsed as { 'dist-tags'?: unknown })['dist-tags'];
  if (!distTags || typeof distTags !== 'object') {
    return { name: packageName, reason: 'registry-error', status: response.status, message: 'missing dist-tags' };
  }
  return { name: packageName, distTags: distTags as RegistryDistTags };
}

export async function fetchDistTagsBatch(
  packageNames: readonly string[],
  options: FetchOptions = {},
): Promise<RegistryResult[]> {
  return Promise.all(packageNames.map((name) => fetchDistTags(name, options)));
}

function classifyFetchError(name: string, err: unknown): RegistryMiss {
  const code = (err as NodeJS.ErrnoException)?.code;
  const message = (err as Error)?.message ?? String(err);
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return { name, reason: 'timeout', message };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { name, reason: 'network', message };
  }
  log.error(`unexpected fetch error for ${name}: ${message}`);
  return { name, reason: 'network', message };
}

const defaultHttpsFetcher: HttpsFetcher = (url, timeoutMs) => new Promise((resolve, reject) => {
  const req = request(url, { method: 'GET', headers: { 'user-agent': 'ctxo-update', accept: 'application/json' } }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    res.on('error', reject);
  });
  req.setTimeout(timeoutMs, () => {
    req.destroy(Object.assign(new Error(`timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
  });
  req.on('error', reject);
  req.end();
});
