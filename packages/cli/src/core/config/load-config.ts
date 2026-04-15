import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import picomatch from 'picomatch';
import { createLogger } from '../logger.js';
import { CtxoConfigSchema, DEFAULT_CONFIG, type CtxoConfig } from './config-schema.js';

const log = createLogger('ctxo:config');

export interface LoadedConfig {
  readonly config: CtxoConfig;
  readonly errors: readonly string[];
  readonly invalidGlobs: readonly string[];
  readonly path: string;
  readonly exists: boolean;
}

function isValidGlob(pattern: string): boolean {
  try {
    picomatch(pattern);
    return true;
  } catch {
    return false;
  }
}

function validateGlobs(patterns: string[] | undefined, field: string, invalid: string[]): void {
  if (!patterns) return;
  for (const p of patterns) {
    if (!isValidGlob(p)) invalid.push(`${field}: ${p}`);
  }
}

export function loadConfig(ctxoRoot: string): LoadedConfig {
  const path = join(ctxoRoot, 'config.yaml');
  const errors: string[] = [];
  const invalidGlobs: string[] = [];

  if (!existsSync(path)) {
    return { config: DEFAULT_CONFIG, errors, invalidGlobs, path, exists: false };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    errors.push(`Cannot read ${path}: ${(err as Error).message}`);
    return { config: DEFAULT_CONFIG, errors, invalidGlobs, path, exists: true };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    errors.push(`Invalid YAML in ${path}: ${(err as Error).message}`);
    log.warn(`Invalid YAML in config.yaml, falling back to defaults: ${(err as Error).message}`);
    return { config: DEFAULT_CONFIG, errors, invalidGlobs, path, exists: true };
  }

  if (parsed === null || parsed === undefined) {
    return { config: DEFAULT_CONFIG, errors, invalidGlobs, path, exists: true };
  }

  const result = CtxoConfigSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
    log.warn(`Invalid config.yaml (${errors.length} issue(s)), falling back to defaults`);
    return { config: DEFAULT_CONFIG, errors, invalidGlobs, path, exists: true };
  }

  validateGlobs(result.data.index?.ignore, 'index.ignore', invalidGlobs);
  validateGlobs(result.data.index?.ignoreProjects, 'index.ignoreProjects', invalidGlobs);
  for (const pattern of invalidGlobs) {
    log.warn(`Invalid glob pattern in config.yaml — ${pattern}`);
  }

  return { config: result.data, errors, invalidGlobs, path, exists: true };
}

export function statsEnabled(config: CtxoConfig): boolean {
  return config.stats?.enabled !== false;
}

export function indexIgnorePatterns(config: CtxoConfig): string[] {
  return (config.index?.ignore ?? []).filter(isValidGlob);
}

export function indexIgnoreProjectPatterns(config: CtxoConfig): string[] {
  return (config.index?.ignoreProjects ?? []).filter(isValidGlob);
}

export function maskingClusterLabelPatterns(config: CtxoConfig): string[] {
  return (config.masking?.clusterLabels ?? []).filter(isValidGlob);
}

/**
 * Build a single predicate that returns true when the given path matches any
 * of the supplied glob patterns. Paths are normalised to forward slashes.
 */
export function makeGlobMatcher(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const matchers = patterns.map((p) => picomatch(p, { dot: true }));
  return (input: string) => {
    const normalised = input.replace(/\\/g, '/');
    return matchers.some((m) => m(normalised));
  };
}
