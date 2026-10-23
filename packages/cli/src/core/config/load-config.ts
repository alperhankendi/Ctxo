import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import picomatch from 'picomatch';
import { parseCoChangeSince } from '../co-change/co-change-window.js';
import { createLogger } from '../logger.js';
import type { CommunityDetectorOptions } from '../overlay/community-detector.js';
import {
  CtxoConfigSchema,
  DEFAULT_COCHANGE_MAX_COMMITS,
  DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT,
  DEFAULT_COCHANGE_MIN_SHARED,
  DEFAULT_CONFIG,
  DEFAULT_TECHNICAL_TERMS,
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
  validateGlobs(result.data.index?.tests, 'index.tests', invalidGlobs);
  validateGlobs(result.data.cochange?.include, 'cochange.include', invalidGlobs);
  validateGlobs(result.data.cochange?.exclude, 'cochange.exclude', invalidGlobs);
  validateGlobs(result.data.contextsView?.exclude, 'contextsView.exclude', invalidGlobs);
  validateGlobs(result.data.contextsView?.hubs?.paths, 'contextsView.hubs.paths', invalidGlobs);
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

/** True when facts extraction is requested (`index.facts: true`). */
export function factsRequested(config: CtxoConfig): boolean {
  return config.index?.facts === true;
}

export function indexTestPatterns(config: CtxoConfig): string[] {
  return (config.index?.tests ?? []).filter(isValidGlob);
}

/**
 * The `communities` section as detector options. Only usable values are passed on, so the detector
 * keeps its own defaults (1.0, 3, 25) for anything absent or invalid.
 */
export function communityDetectorOptions(config: CtxoConfig): CommunityDetectorOptions {
  const section = config.communities;
  const resolution = section?.resolution;
  const minBridged = section?.godNodeMinBridged;
  const maxResults = section?.godNodeMaxResults;
  return {
    ...(typeof resolution === 'number' && Number.isFinite(resolution) && resolution > 0 ? { resolution } : {}),
    ...(typeof minBridged === 'number' && Number.isInteger(minBridged) && minBridged >= 1
      ? { godNodeMinBridged: minBridged }
      : {}),
    ...(typeof maxResults === 'number' && Number.isInteger(maxResults) && maxResults >= 0
      ? { godNodeMaxResults: maxResults }
      : {}),
  };
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

/** The `contextsView` section with every default applied; what the file graph and clustering use. */
export interface ResolvedContextsViewConfig {
  readonly weights: { readonly dependency: number; readonly coChange: number; readonly data: number };
  readonly exclude: readonly string[];
  readonly hubs: {
    readonly auto: boolean;
    readonly topPercent: number;
    readonly minDependents: number;
    readonly paths: readonly string[];
  };
  readonly resolution: number;
  readonly minCandidateFiles: number;
  readonly technicalTerms: readonly string[];
}

function nonNegativeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolves the `contextsView` section (defaults: weights 1, 1 and data 0, hubs auto with top 1% and at least
 * 10 dependents, resolution 1, minCandidateFiles 3). Unusable values and invalid globs are skipped.
 */
export function resolveContextsViewConfig(config: CtxoConfig): ResolvedContextsViewConfig {
  const section = config.contextsView;
  const hubs = section?.hubs;
  const topPercent = hubs?.topPercent;
  return {
    weights: {
      dependency: nonNegativeOr(section?.weights?.dependency, 1),
      coChange: nonNegativeOr(section?.weights?.coChange, 1),
      data: nonNegativeOr(section?.weights?.data, 0),
    },
    exclude: (section?.exclude ?? []).filter(isValidGlob),
    hubs: {
      auto: hubs?.auto !== false,
      topPercent: typeof topPercent === 'number' && topPercent > 0 && topPercent <= 100 ? topPercent : 1,
      minDependents: positiveIntegerOr(hubs?.minDependents, 10),
      paths: (hubs?.paths ?? []).filter(isValidGlob),
    },
    resolution: positiveOr(section?.resolution, 1),
    minCandidateFiles: positiveIntegerOr(section?.minCandidateFiles, 3),
    technicalTerms: section?.technicalTerms ? [...section.technicalTerms] : [...DEFAULT_TECHNICAL_TERMS],
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
