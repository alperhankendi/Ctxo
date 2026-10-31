import { statSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import type { WatchPathKind } from '@ctxo/cli/internal';
import type { DomainConfig } from '../core/domain-config.js';
import type { DomainRegistry } from '../core/registry.js';
import { shadowSpecsPath } from '../core/shadow-specs-file.js';
import { readRegistry } from './registry-reader.js';

/** A repo path as watch reports it: forward slashes, no `./`, no trailing slash. */
function normalize(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** The files the index pass reads besides the index: the cards, the glossary and each context's shadow-specs file. */
function registryInputs(registry: DomainRegistry, registryPath: string): Set<string> {
  const inputs = new Set<string>();
  for (const context of registry.contexts) {
    if (context.card !== undefined) inputs.add(normalize(context.card));
    inputs.add(normalize(shadowSpecsPath(registryPath, context.id)));
  }
  inputs.add(normalize(registry.glossary));
  return inputs;
}

/**
 * `classifyWatchPath` for `ctxo watch` (the domain index pass under watch). With the domain config read once:
 *
 * - `input`: the registry (also while it is missing or invalid, so creating or fixing it refreshes), and, from a
 *   valid registry, each card, the glossary and each context's `shadow-specs.yaml`.
 * - `source`, only while the registry is valid: an indexed file (ownership, boundaries, facts and rule links read
 *   the index) and a file with a `domain.facts.textScanExtensions` extension (the text scan reads it).
 * - Anything else is undefined: the pass does not read it.
 *
 * The registry is re-read when its mtime or size changes, or when the registry itself is the changed path. Never
 * throws: a failure answers undefined.
 */
export function createWatchPathClassifier(
  projectRoot: string,
  config: () => DomainConfig,
): (path: string, indexed: boolean) => WatchPathKind | undefined {
  let resolved: { registryPath: string; absolute: string; extensions: ReadonlySet<string> } | undefined;
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
          registryPath: normalize(cfg.registry),
          absolute: resolve(projectRoot, cfg.registry),
          extensions: new Set(cfg.facts.textScanExtensions.map((e) => e.toLowerCase())),
        };
      }
      const file = normalize(path);
      if (file === resolved.registryPath) {
        cache = undefined;
        return 'input';
      }
      const stamp = stampOf(resolved.absolute);
      if (cache === undefined || cache.stamp !== stamp) {
        const loaded = readRegistry(projectRoot, resolved.registryPath);
        const valid = loaded?.registry !== undefined && loaded.problems.length === 0 ? loaded.registry : undefined;
        cache = { stamp, inputs: valid === undefined ? undefined : registryInputs(valid, resolved.registryPath) };
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
