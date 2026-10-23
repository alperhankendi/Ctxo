import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import picomatch from 'picomatch';
import { parseCoChangeSince } from '../co-change/co-change-window.js';
import { createLogger } from '../logger.js';
import {
  CtxoConfigSchema,
  DEFAULT_COCHANGE_MAX_COMMITS,
  DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT,
  DEFAULT_COCHANGE_MIN_SHARED,
  DEFAULT_CONFIG,
  DEFAULT_WATCH_SNAPSHOT_MIN_FILE_CHANGES,
  type CtxoConfig,
} from './config-schema.js';

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
  validateGlobs(result.data.cochange?.include, 'cochange.include', invalidGlobs);
  validateGlobs(result.data.cochange?.exclude, 'cochange.exclude', invalidGlobs);
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

export function watchSnapshotMinFileChanges(config: CtxoConfig): number {
  const value = config.watch?.snapshotMinFileChanges;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) return value;
  return DEFAULT_WATCH_SNAPSHOT_MIN_FILE_CHANGES;
}

/** The co-change settings with every default applied; what `buildCoChangeMatrix` and its callers use. */
export interface ResolvedCoChangeConfig {
  readonly maxCommits: number | 'all';
  readonly since?: string;
  readonly maxFilesPerCommit: number;
  readonly minShared: number;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function positiveIntegerOr(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

function validMaxCommits(value: unknown): number | 'all' | undefined {
  if (value === 'all') return 'all';
  return isPositiveInteger(value) ? value : undefined;
}

function validSince(value: unknown): string | undefined {
  return typeof value === 'string' && parseCoChangeSince(value) !== undefined ? value : undefined;
}

/**
 * Resolves the `cochange` section. Each setting comes from the first source that has a usable value:
 * the CLI override (`--cochange-commits`, `--cochange-since`), then `.ctxo/config.yaml`, then the
 * built-in default (2000 commits, 30 files per commit, 2 shared commits, no `since`).
 *
 * A value the schema would reject is skipped rather than trusted, and so is an invalid glob. That
 * matters for a value that did not come through `loadConfig`, and above all for `maxCommits`, where
 * a zero or negative number would otherwise turn into an unbounded window.
 */
export function resolveCoChangeConfig(
  config: CtxoConfig,
  overrides: { maxCommits?: number | 'all'; since?: string } = {},
): ResolvedCoChangeConfig {
  const section = config.cochange;
  const since = validSince(overrides.since) ?? validSince(section?.since);
  return {
    maxCommits:
      validMaxCommits(overrides.maxCommits) ??
      validMaxCommits(section?.maxCommits) ??
      DEFAULT_COCHANGE_MAX_COMMITS,
    ...(since !== undefined ? { since } : {}),
    maxFilesPerCommit: positiveIntegerOr(section?.maxFilesPerCommit, DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT),
    minShared: positiveIntegerOr(section?.minShared, DEFAULT_COCHANGE_MIN_SHARED),
    include: (section?.include ?? []).filter(isValidGlob),
    exclude: (section?.exclude ?? []).filter(isValidGlob),
  };
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
