import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IWorkspace, IPackage } from '@ctxo/plugin-api';

const MANIFEST_CANDIDATES = [
  'package.json',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
];

function findManifest(dir: string): string {
  for (const name of MANIFEST_CANDIDATES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  const csproj = findFirstByExt(dir, '.csproj') ?? findFirstByExt(dir, '.sln');
  if (csproj) return csproj;
  return join(dir, 'package.json');
}

function findFirstByExt(dir: string, ext: string): string | null {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(ext)) return join(dir, entry.name);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * v0.7 implementation: always returns a single-package workspace rooted at `cwd`.
 * Future Nx/Turborepo/pnpm workspace detectors implement the same interface.
 */
export function detectWorkspace(cwd: string): IWorkspace {
  const root = resolve(cwd);
  const pkg: IPackage = {
    root,
    manifest: findManifest(root),
  };
  return {
    root,
    packages: [pkg],
  };
}
