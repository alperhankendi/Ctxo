import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Canonical short language ids. Plugins use these same ids (e.g. `@ctxo/lang-typescript`
 * declares id: 'typescript'). Keep in sync with plugin id fields.
 */
export const KNOWN_LANGUAGES = [
  'typescript',
  'javascript',
  'go',
  'csharp',
  'python',
  'java',
  'rust',
  'ruby',
  'kotlin',
] as const;

export type KnownLanguage = (typeof KNOWN_LANGUAGES)[number];

/**
 * Extension → canonical language id. Multiple extensions may map to the same
 * language (e.g. .ts + .tsx → typescript).
 */
export const EXTENSION_LANGUAGE: Readonly<Record<string, KnownLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.go': 'go',
  '.cs': 'csharp',
  '.py': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rs': 'rust',
  '.rb': 'ruby',
};

export interface DetectionResult {
  /** Language id → manifest filename that surfaced it. */
  byManifest: Record<string, string>;
  /** Language id → source file count (from git ls-files). */
  byExtension: Record<string, number>;
  /** Total source files counted (sum of byExtension). */
  totalFiles: number;
  /** Extensions seen that don't map to a known language id. */
  unknownExtensions: Record<string, number>;
}

interface ManifestProbe {
  readonly id: KnownLanguage;
  readonly check: (root: string) => string | null;
}

const MANIFEST_PROBES: readonly ManifestProbe[] = [
  {
    id: 'typescript',
    check: (root) => (existsSync(join(root, 'tsconfig.json')) ? 'tsconfig.json' : null),
  },
  {
    id: 'python',
    check: (root) => {
      if (existsSync(join(root, 'pyproject.toml'))) return 'pyproject.toml';
      if (existsSync(join(root, 'setup.py'))) return 'setup.py';
      if (existsSync(join(root, 'requirements.txt'))) return 'requirements.txt';
      return null;
    },
  },
  {
    id: 'java',
    check: (root) => {
      if (existsSync(join(root, 'pom.xml'))) return 'pom.xml';
      if (existsSync(join(root, 'build.gradle'))) return 'build.gradle';
      if (existsSync(join(root, 'build.gradle.kts'))) return 'build.gradle.kts';
      return null;
    },
  },
  {
    id: 'go',
    check: (root) => (existsSync(join(root, 'go.mod')) ? 'go.mod' : null),
  },
  {
    id: 'csharp',
    check: (root) => {
      try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
          if (entry.isFile() && (entry.name.endsWith('.csproj') || entry.name.endsWith('.sln'))) {
            return entry.name;
          }
        }
      } catch {
        // ignore
      }
      return null;
    },
  },
  {
    id: 'rust',
    check: (root) => (existsSync(join(root, 'Cargo.toml')) ? 'Cargo.toml' : null),
  },
  {
    id: 'ruby',
    check: (root) => (existsSync(join(root, 'Gemfile')) ? 'Gemfile' : null),
  },
];

function listGitFiles(root: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Detect languages present in a project root.
 *
 * - Manifest signals: presence of language-specific build files (pyproject.toml, pom.xml, go.mod, ...)
 * - Extension counts: derived from `git ls-files` (falls back to empty when not a git repo)
 *
 * Pure I/O: no network, bounded by git output. Safe to call repeatedly.
 */
export function detectLanguages(root: string): DetectionResult {
  const byManifest: Record<string, string> = {};
  for (const probe of MANIFEST_PROBES) {
    const manifest = probe.check(root);
    if (manifest) byManifest[probe.id] = manifest;
  }

  const byExtension: Record<string, number> = {};
  const unknownExtensions: Record<string, number> = {};
  let totalFiles = 0;

  for (const file of listGitFiles(root)) {
    const ext = extname(file).toLowerCase();
    if (!ext) continue;
    totalFiles += 1;
    const lang = EXTENSION_LANGUAGE[ext];
    if (lang) {
      byExtension[lang] = (byExtension[lang] ?? 0) + 1;
    } else {
      unknownExtensions[ext] = (unknownExtensions[ext] ?? 0) + 1;
    }
  }

  return { byManifest, byExtension, totalFiles, unknownExtensions };
}

export interface LanguageNeedsOptions {
  /** Minimum source files needed to flag an extension-only language. Default 5. */
  minFiles?: number;
  /** Minimum ratio (0..1) of total files needed for extension-only detection. Default 0.02. */
  minRatio?: number;
}

/**
 * Decide which languages the project needs plugins for.
 *
 * Rules (from PRD §4.6):
 *   - Manifest-backed language → always in `needed`
 *   - Extension-only language → needed if count >= minFiles AND ratio >= minRatio
 */
export function decideNeededLanguages(
  result: DetectionResult,
  options: LanguageNeedsOptions = {},
): KnownLanguage[] {
  const minFiles = options.minFiles ?? 5;
  const minRatio = options.minRatio ?? 0.02;
  const needed = new Set<KnownLanguage>();

  for (const id of Object.keys(result.byManifest)) {
    needed.add(id as KnownLanguage);
  }

  for (const [id, count] of Object.entries(result.byExtension)) {
    if (result.byManifest[id]) continue;
    const ratio = result.totalFiles > 0 ? count / result.totalFiles : 0;
    if (count >= minFiles && ratio >= minRatio) {
      needed.add(id as KnownLanguage);
    }
  }

  return [...needed];
}

/** Map a language id to its canonical official npm plugin package name. */
export function officialPluginFor(language: KnownLanguage): string {
  return `@ctxo/lang-${language}`;
}
