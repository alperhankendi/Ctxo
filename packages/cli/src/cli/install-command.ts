import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  KNOWN_LANGUAGES,
  officialPluginFor,
  detectLanguages,
  decideNeededLanguages,
  type KnownLanguage,
} from '../core/detection/detect-languages.js';
import {
  resolvePackageManager,
  buildInstallCommand,
  isPackageManager,
  PACKAGE_MANAGERS,
  type PackageManager,
  type Resolution,
} from '../core/install/package-manager.js';

export interface InstallOptions {
  readonly languages?: readonly string[];
  readonly yes?: boolean;
  readonly global?: boolean;
  readonly dryRun?: boolean;
  readonly pm?: string;
  readonly version?: string;
  readonly force?: boolean;
}

export interface InstallPlan {
  readonly languages: readonly KnownLanguage[];
  readonly packages: readonly string[];
  readonly manager: PackageManager;
  readonly managerSource: Resolution['source'];
  readonly global: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

export class InstallCommand {
  constructor(private readonly projectRoot: string) {}

  async run(options: InstallOptions = {}): Promise<void> {
    const resolvedLangs = this.resolveLanguages(options);
    if (resolvedLangs.length === 0) {
      console.error('[ctxo] Nothing to install. Specify a language (e.g. "ctxo install python") or add one to your project.');
      process.exitCode = 0;
      return;
    }

    let resolution: Resolution;
    try {
      resolution = resolvePackageManager({
        flag: options.pm,
        projectRoot: this.projectRoot,
      });
    } catch (err) {
      console.error(`[ctxo] ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }

    if (!options.global && !existsSync(join(this.projectRoot, 'package.json'))) {
      console.error('[ctxo] No package.json in the current project. Re-run with --global or create a package.json first.');
      process.exitCode = 1;
      return;
    }

    if (!options.force && !options.global && isLockedCI(process.env)) {
      console.error('[ctxo] CI environment detected with a frozen lockfile. Refusing to mutate dependencies. Use --force or switch to --global.');
      process.exitCode = 1;
      return;
    }

    const specifiers = resolvedLangs.map((lang) =>
      options.version ? `${officialPluginFor(lang)}@${options.version}` : officialPluginFor(lang),
    );

    const invocation = buildInstallCommand(resolution.manager, specifiers, {
      global: options.global,
    });

    const plan: InstallPlan = {
      languages: resolvedLangs,
      packages: specifiers,
      manager: resolution.manager,
      managerSource: resolution.source,
      global: options.global ?? false,
      command: invocation.command,
      args: [...invocation.args],
    };

    console.error(`[ctxo] Plan: install ${plan.packages.join(', ')}`);
    console.error(`[ctxo] Using ${plan.manager} (${plan.managerSource}${resolution.detail ? `: ${resolution.detail}` : ''})${plan.global ? ', global' : ''}`);
    console.error(`[ctxo] Command: ${plan.command} ${plan.args.join(' ')}`);

    if (options.dryRun) {
      console.error('[ctxo] --dry-run set; not executing.');
      return;
    }

    const code = await spawnInstall(plan.command, plan.args, this.projectRoot);
    if (code !== 0) {
      console.error(`[ctxo] ${plan.command} exited with code ${code}`);
      process.exitCode = code;
      return;
    }

    console.error(`[ctxo] Installed ${plan.packages.join(', ')}`);
  }

  private resolveLanguages(options: InstallOptions): KnownLanguage[] {
    const requested = options.languages ?? [];
    if (requested.length > 0) {
      const out: KnownLanguage[] = [];
      for (const raw of requested) {
        const lang = normalizeLanguage(raw);
        if (!lang) {
          console.error(
            `[ctxo] Unknown language "${raw}". Known: ${KNOWN_LANGUAGES.join(', ')}. Community plugins: see the ctxo-lang-template scaffolding guide.`,
          );
          process.exitCode = 1;
          return [];
        }
        if (!out.includes(lang)) out.push(lang);
      }
      return out;
    }

    // No explicit languages — detect missing.
    const detection = detectLanguages(this.projectRoot);
    const needed = decideNeededLanguages(detection);
    if (needed.length === 0) return [];
    const missing = needed.filter((lang) => !isPluginInstalled(lang));
    if (missing.length === 0) {
      console.error('[ctxo] All detected languages already have plugins installed.');
      return [];
    }
    console.error(`[ctxo] Detected missing plugins for: ${missing.join(', ')}`);
    return missing;
  }
}

function normalizeLanguage(input: string): KnownLanguage | null {
  const lowered = input.toLowerCase();
  if ((KNOWN_LANGUAGES as readonly string[]).includes(lowered)) {
    return lowered as KnownLanguage;
  }
  // Accept common aliases.
  const aliases: Record<string, KnownLanguage> = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    'c#': 'csharp',
    'cs': 'csharp',
    'net': 'csharp',
    golang: 'go',
    kt: 'kotlin',
    rb: 'ruby',
    rs: 'rust',
  };
  return aliases[lowered] ?? null;
}

function isPluginInstalled(lang: KnownLanguage): boolean {
  try {
    const { createRequire } = require('node:module') as typeof import('node:module');
    const r = createRequire(import.meta.url);
    r.resolve(`${officialPluginFor(lang)}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function isLockedCI(env: NodeJS.ProcessEnv): boolean {
  if (env['CI'] !== 'true' && env['CI'] !== '1') return false;
  // npm ci / pnpm --frozen-lockfile / yarn install --frozen-lockfile run in CI and must not mutate.
  return true;
}

function spawnInstall(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => reject(err));
  });
}

export { isPackageManager, PACKAGE_MANAGERS };
