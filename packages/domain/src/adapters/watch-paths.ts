import { statSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import type { WatchPathKind } from '@ctxo/cli/internal';
import type { DomainConfig } from '../core/domain-config.js';
import type { DomainRegistry } from '../core/registry.js';
import { readRegistry } from './registry-reader.js';

/** Windows and macOS file systems are case-insensitive by default, so paths are compared case-folded there. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** A repo path as watch reports it: forward slashes, no `./`, no trailing slash; case-folded where the file system is. */
function keyOf(path: string, caseInsensitive: boolean): string {
  const normalized = posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * The files the index pass reads besides the index and the registry: the cards and the glossary. A context's
 * `shadow-specs.yaml` is not one: resolutions apply when the tools read them, so its edit needs no pass.
 */
function registryInputs(registry: DomainRegistry, caseInsensitive: boolean): Set<string> {
  const inputs = new Set<string>();
  for (const context of registry.contexts) if (context.card !== undefined) inputs.add(keyOf(context.card, caseInsensitive));
  inputs.add(keyOf(registry.glossary, caseInsensitive));
  return inputs;
}

export interface WatchPathClassifierOptions {
  /** Compare case-folded; by default on Windows and macOS. */
  readonly caseInsensitive?: boolean;
}

/**
 * `classifyWatchPath` for `ctxo watch` (the domain index pass under watch), with the domain config the module read
 * once:
 *
 * - `input`: the registry (also while it is missing or invalid, so creating or fixing it refreshes), and, from a
 *   valid registry, each card and the glossary.
 * - `source`, only while the registry is valid: an indexed file (ownership, boundaries, facts and rule links read
 *   the index) and a file with a `domain.facts.textScanExtensions` extension (the text scan reads it).
 * - Anything else is undefined: the pass does not read it.
 *
 * The registry is re-read when its mtime or size changes, or when the registry itself is the changed path. Paths
 * are compared case-folded on case-insensitive file systems. Never throws: a failure answers undefined.
 */
export function createWatchPathClassifier(
  projectRoot: string,
  config: () => DomainConfig,
  options: WatchPathClassifierOptions = {},
): (path: string, indexed: boolean) => WatchPathKind | undefined {
  const fold = options.caseInsensitive ?? CASE_INSENSITIVE;
  let resolved: { registryPath: string; registryKey: string; absolute: string; extensions: ReadonlySet<string> } | undefined;
  let cache: { stamp: string; inputs: ReadonlySet<string> | undefined } | undefined;

  const stampOf = (absolute: string): string => {
    try {
      const stat = statSync(absolute);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return 'missing';
    }
  };

  return (path, indexed) => {
    try {
      if (resolved === undefined) {
        const cfg = config();
        resolved = {
          registryPath: keyOf(cfg.registry, false),
          registryKey: keyOf(cfg.registry, fold),
          absolute: resolve(projectRoot, cfg.registry),
          extensions: new Set(cfg.facts.textScanExtensions.map((e) => e.toLowerCase())),
        };
      }
      const file = keyOf(path, fold);
      if (file === resolved.registryKey) {
        cache = undefined;
        return 'input';
      }
      const stamp = stampOf(resolved.absolute);
      if (cache === undefined || cache.stamp !== stamp) {
        const loaded = readRegistry(projectRoot, resolved.registryPath);
        const valid = loaded?.registry !== undefined && loaded.problems.length === 0 ? loaded.registry : undefined;
        cache = { stamp, inputs: valid === undefined ? undefined : registryInputs(valid, fold) };
      }
      if (cache.inputs === undefined) return undefined;
      if (cache.inputs.has(file)) return 'input';
      if (indexed || resolved.extensions.has(extensionOf(file))) return 'source';
      return undefined;
    } catch {
      return undefined;
    }
  };
}
