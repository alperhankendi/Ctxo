import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PLATFORMS, detectPlatforms, installRules, ensureGitignore, ensureConfig, getMcpConfigTargets, ensureMcpConfig } from './ai-rules.js';
import {
  detectLanguages,
  decideNeededLanguages,
  officialPluginFor,
  type KnownLanguage,
} from '../core/detection/detect-languages.js';
import { InstallCommand } from './install-command.js';

const requireCjs = createRequire(import.meta.url);

function resolveInstalledPlugins(needed: readonly KnownLanguage[]): {
  installed: KnownLanguage[];
  missing: KnownLanguage[];
} {
  const installed: KnownLanguage[] = [];
  const missing: KnownLanguage[] = [];
  for (const lang of needed) {
    try {
      requireCjs.resolve(`${officialPluginFor(lang)}/package.json`);
      installed.push(lang);
    } catch {
      missing.push(lang);
    }
  }
  return { installed, missing };
}

/* ------------------------------------------------------------------ */
/*  Git hook content                                                   */
/* ------------------------------------------------------------------ */

const CTXO_START = '# ctxo-start';
const CTXO_END = '# ctxo-end';

const POST_COMMIT_CONTENT = `
${CTXO_START}
# Incremental re-index on commit (only changed files)
if command -v ctxo >/dev/null 2>&1; then
  for file in $(git diff --name-only HEAD~1 HEAD 2>/dev/null); do
    ctxo index --file "$file" 2>/dev/null || true
  done
fi
${CTXO_END}
`.trim();

const POST_MERGE_CONTENT = `
${CTXO_START}
# Rebuild SQLite cache after merge (index updated via git pull)
if command -v ctxo >/dev/null 2>&1; then
  ctxo sync 2>/dev/null || true
fi
${CTXO_END}
`.trim();

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export interface InitOptions {
  tools?: string[];
  yes?: boolean;
  rulesOnly?: boolean;
  dryRun?: boolean;
  /** Skip language detection prompt + any install invocation. */
  noInstall?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Terminal UI helpers (zero dependency — picocolors only)            */
/* ------------------------------------------------------------------ */

import type picocolorsType from 'picocolors';
type PC = typeof picocolorsType;

const STRIP_ANSI = /\u001b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(STRIP_ANSI, '');

function box(lines: string[], opts: { title?: string; border?: (s: string) => string; width?: number }, pc: PC): string {
  const border = opts.border ?? pc.dim;
  const w = opts.width ?? Math.max(...lines.map(l => strip(l).length), strip(opts.title ?? '').length + 4, 48);
  const pad = (s: string) => s + ' '.repeat(Math.max(0, w - strip(s).length));

  const hr = '\u2500'.repeat(w + 2);
  let top: string;
  if (opts.title) {
    const tLen = strip(opts.title).length;
    top = border('\u256d\u2500 ') + opts.title + border(` ${ '\u2500'.repeat(Math.max(0, w - tLen - 2))}\u256e`);
  } else {
    top = border(`\u256d${hr}\u256e`);
  }
  const bot = border(`\u2570${hr}\u256f`);
  const body = lines.map(l => `${border('\u2502')} ${pad(l)} ${border('\u2502')}`).join('\n');
  return `${top}\n${body}\n${bot}`;
}

function stepHeader(step: number, total: number, title: string, desc: string, pc: PC): string {
  const stepLabel = pc.bold(pc.cyan(`${step}/${total}`));
  const titleStr = pc.bold(title);
  return box(
    [`${pc.dim(desc)}`],
    { title: `${stepLabel} ${titleStr}`, border: pc.cyan },
    pc,
  );
}

/* ------------------------------------------------------------------ */
/*  ASCII banner with faux gradient                                    */
/* ------------------------------------------------------------------ */

function renderBanner(_version: string | undefined, pc: PC): string {
  const art = [
    '  \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 ',
    '  \u2588\u2588\u2554\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u255a\u2588\u2588\u2557\u2588\u2588\u2554\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557',
    '  \u2588\u2588\u2551       \u2588\u2588\u2551    \u255a\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2551   \u2588\u2588\u2551',
    '  \u2588\u2588\u2551       \u2588\u2588\u2551    \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551   \u2588\u2588\u2551',
    '  \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551   \u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d',
    '   \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u255d   \u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d ',
  ];

  // Faux vertical gradient: cyan → blueBright → magentaBright
  const colors = [pc.cyan, pc.cyan, pc.blueBright, pc.blueBright, pc.magentaBright, pc.magentaBright] as const;
  const coloredArt = art.map((line, i) => colors[i]!(line));

  const tagline1 = pc.bold(pc.white('  Code intelligence for AI agents.'));
  const tagline2 = pc.dim('  One call instead of hundreds.');

  const inner = [
    '',
    ...coloredArt,
    '',
    tagline1,
    tagline2,
    '',
  ];

  return box(inner, { border: pc.dim }, pc);
}

/* ------------------------------------------------------------------ */
/*  InitCommand                                                        */
/* ------------------------------------------------------------------ */

export class InitCommand {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  installHooks(): void {
    const hooksDir = join(this.projectRoot, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    this.installHook(hooksDir, 'post-commit', POST_COMMIT_CONTENT);
    this.installHook(hooksDir, 'post-merge', POST_MERGE_CONTENT);
  }

  async run(options: InitOptions = {}): Promise<void> {
    if (!existsSync(join(this.projectRoot, '.git'))) {
      console.error('[ctxo] Not a git repository. Run "git init" first.');
      process.exit(1);
    }

    if (options.dryRun) return this.dryRun(options);
    if (options.yes || options.tools) return await this.runNonInteractive(options);
    return this.runInteractive(options);
  }

  /* ---------------------------------------------------------------- */
  /*  Interactive flow                                                 */
  /* ---------------------------------------------------------------- */

  private async runInteractive(options: InitOptions): Promise<void> {
    const clack = await import('@clack/prompts');
    const pc = (await import('picocolors')).default;

    const version = await this.getVersion();
    const totalSteps = options.rulesOnly ? 1 : 3;

    // ── Banner ──
    console.error('');
    console.error(renderBanner(version, pc));
    console.error('');

    // ── Step 1: Index directory ──
    let stepNum = 0;
    if (!options.rulesOnly) {
      stepNum++;
      console.error(stepHeader(stepNum, totalSteps, 'Index Directory', 'Where ctxo stores the symbol graph and metadata.', pc));
      console.error('');

      const indexDir = await clack.text({
        message: pc.cyan('Directory path'),
        placeholder: '.ctxo/index',
        initialValue: '.ctxo/index',
        validate: (val) => {
          if (!val?.trim()) return 'Directory path is required';
          return undefined;
        },
      });

      if (clack.isCancel(indexDir)) { clack.cancel('Setup cancelled.'); process.exit(0); }

      const fullPath = join(this.projectRoot, indexDir as string);
      if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true });
      console.error('');
    }

    // ── Step 2: AI tool selection ──
    stepNum++;
    const detected = detectPlatforms(this.projectRoot);
    const detectedCount = detected.size;
    const detectedHint = detectedCount > 0 ? pc.green(` ${detectedCount} detected`) : '';

    console.error(stepHeader(stepNum, totalSteps, `AI Tools${detectedHint}`, 'Select your tools. Generates MCP usage rules for each.', pc));
    console.error('');

    const toolChoices = PLATFORMS.map(p => {
      const isDetected = detected.has(p.id);
      const star = p.starred ? pc.yellow(' \u2605') : '';
      const detect = isDetected ? pc.green(' (detected)') : '';
      return {
        value: p.id,
        label: `${p.name}${star}${detect}`,
        hint: isDetected ? undefined : pc.dim(p.file),
      };
    });

    const selectedTools = await clack.multiselect({
      message: pc.cyan('Select tools'),
      options: toolChoices,
      initialValues: [...detected],
      required: false,
    });

    if (clack.isCancel(selectedTools)) { clack.cancel('Setup cancelled.'); process.exit(0); }
    console.error('');

    // ── Step 2.5: Language plugins (skipped in --rules / --no-install) ──
    let pluginsToInstall: KnownLanguage[] = [];
    if (!options.rulesOnly && !options.noInstall) {
      const detection = detectLanguages(this.projectRoot);
      const needed = decideNeededLanguages(detection);
      const { missing } = resolveInstalledPlugins(needed);
      if (missing.length > 0) {
        console.error(stepHeader(
          stepNum + 1,
          totalSteps + 1,
          `Language Plugins ${pc.yellow('missing')}`,
          `Detected: ${missing.join(', ')} — ctxo needs a plugin per language to index it.`,
          pc,
        ));
        console.error('');
        const confirm = await clack.confirm({
          message: pc.cyan(`Install ${missing.map(officialPluginFor).join(' ')}?`),
          initialValue: true,
        });
        if (clack.isCancel(confirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
        if (confirm) {
          pluginsToInstall = missing;
          stepNum++;
        }
        console.error('');
      }
    }

    // ── Step 3: Git hooks ──
    let installGitHooks = false;
    if (!options.rulesOnly) {
      stepNum++;
      console.error(stepHeader(stepNum, totalSteps, `Git Hooks ${pc.yellow('recommended')}`, 'Auto-updates index on every commit and pull.', pc));
      console.error('');

      const hooks = await clack.confirm({
        message: pc.cyan('Install hooks?'),
        initialValue: true,
      });

      if (clack.isCancel(hooks)) { clack.cancel('Setup cancelled.'); process.exit(0); }
      installGitHooks = hooks as boolean;
      console.error('');
    }

    // ── Execute with spinner ──
    const s = clack.spinner();
    s.start(pc.dim('Configuring...'));

    const results: string[] = [];

    // Automatic scaffolding (always runs, no prompt needed)
    const gitignoreResult = ensureGitignore(this.projectRoot);
    const configResult = ensureConfig(this.projectRoot);

    if (!options.rulesOnly) {
      results.push(`${pc.green('\u2713')} ${pc.bold('.ctxo/index/')}  ${pc.dim('index directory')}`);
    }

    if (configResult.action !== 'skipped') {
      results.push(`${pc.green('\u2713')} ${pc.bold(configResult.file)}  ${pc.dim(configResult.action)}`);
    }

    if (gitignoreResult.action !== 'skipped') {
      results.push(`${pc.green('\u2713')} ${pc.bold(gitignoreResult.file)}  ${pc.dim(gitignoreResult.action)}`);
    }

    for (const toolId of (selectedTools as string[])) {
      const result = installRules(this.projectRoot, toolId);
      results.push(`${pc.green('\u2713')} ${pc.bold(result.file)}  ${pc.dim(result.action)}`);
    }

    // MCP server registration (automatic based on selected tools)
    const mcpTargets = getMcpConfigTargets(selectedTools as string[]);
    for (const target of mcpTargets) {
      const result = ensureMcpConfig(this.projectRoot, target);
      if (result.action !== 'skipped') {
        results.push(`${pc.green('\u2713')} ${pc.bold(result.file)}  ${pc.dim(result.action + ' \u2014 MCP server registered')}`);
      }
    }

    if (installGitHooks) {
      this.installHooks();
      results.push(`${pc.green('\u2713')} ${pc.bold('post-commit, post-merge')}  ${pc.dim('hooks installed')}`);
    }

    if (pluginsToInstall.length > 0) {
      s.stop(pc.dim('Installing language plugins...'));
      const installer = new InstallCommand(this.projectRoot);
      await installer.run({ languages: pluginsToInstall, yes: true });
      results.push(`${pc.green('\u2713')} ${pc.bold(pluginsToInstall.map(officialPluginFor).join(', '))}  ${pc.dim('language plugins installed')}`);
      s.start(pc.dim('Finalizing...'));
    }

    s.stop(pc.green('Done!'));

    // ── Summary box ──
    if (results.length > 0) {
      console.error('');
      console.error(box(results, { title: pc.green('\u2713 Created'), border: pc.green }, pc));
    }

    // ── Next steps box ──
    const hasWork = (selectedTools as string[]).length > 0 || installGitHooks;
    if (hasWork) {
      const steps = [
        `${pc.cyan('\u25b6')} npx ctxo index     ${pc.dim('\u2500 build codebase index')}`,
        `${pc.cyan('\u25b6')} npx ctxo doctor    ${pc.dim('\u2500 verify everything works')}`,
      ];
      console.error('');
      console.error(box(steps, { title: pc.cyan('\u2192 Next steps'), border: pc.cyan }, pc));
    }

    console.error('');
    console.error(`  ${pc.dim('Happy coding!')} ${pc.magentaBright('\u2764')}`);
    console.error('');
  }

  /* ---------------------------------------------------------------- */
  /*  Non-interactive flow                                             */
  /* ---------------------------------------------------------------- */

  private async runNonInteractive(options: InitOptions): Promise<void> {
    const toolIds = options.tools ?? [];

    for (const id of toolIds) {
      if (!PLATFORMS.find(p => p.id === id)) {
        console.error(`[ctxo] Unknown tool: "${id}". Valid: ${PLATFORMS.map(p => p.id).join(', ')}`);
        process.exit(1);
      }
    }

    // Automatic scaffolding
    const gitignoreResult = ensureGitignore(this.projectRoot);
    const configResult = ensureConfig(this.projectRoot);

    if (!options.rulesOnly) {
      const indexDir = join(this.projectRoot, '.ctxo', 'index');
      if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
      console.error('[ctxo] \u2713 .ctxo/index/ ready');
    }

    if (configResult.action !== 'skipped') {
      console.error(`[ctxo] \u2713 ${configResult.file} \u2014 ${configResult.action}`);
    }
    if (gitignoreResult.action !== 'skipped') {
      console.error(`[ctxo] \u2713 ${gitignoreResult.file} \u2014 ${gitignoreResult.action}`);
    }

    for (const toolId of toolIds) {
      const result = installRules(this.projectRoot, toolId);
      console.error(`[ctxo] \u2713 ${result.file} \u2014 ${result.action}`);
    }

    // MCP server registration
    const mcpTargets = getMcpConfigTargets(toolIds);
    for (const target of mcpTargets) {
      const result = ensureMcpConfig(this.projectRoot, target);
      if (result.action !== 'skipped') {
        console.error(`[ctxo] \u2713 ${result.file} \u2014 ${result.action} (MCP server registered)`);
      }
    }

    if (!options.rulesOnly) {
      this.installHooks();
      console.error('[ctxo] \u2713 Git hooks installed');
    }

    // Language detection + plugin install (skipped under --no-install or --rules)
    if (!options.rulesOnly && !options.noInstall) {
      const detection = detectLanguages(this.projectRoot);
      const needed = decideNeededLanguages(detection);
      const { missing } = resolveInstalledPlugins(needed);
      if (missing.length > 0) {
        if (options.yes) {
          console.error(`[ctxo] Installing missing plugins: ${missing.join(', ')}`);
          await new InstallCommand(this.projectRoot).run({ languages: missing, yes: true });
        } else {
          console.error(
            `[ctxo] Detected missing plugins: ${missing.join(', ')}. Run "ctxo install ${missing.join(' ')}" to install.`,
          );
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Dry run                                                          */
  /* ---------------------------------------------------------------- */

  private dryRun(options: InitOptions): void {
    const toolIds = options.tools ?? PLATFORMS.map(p => p.id);

    console.error('[ctxo] Dry run \u2014 the following files would be created/updated:\n');

    if (!options.rulesOnly) {
      console.error('  .ctxo/index/              (index directory)');
    }

    for (const id of toolIds) {
      const platform = PLATFORMS.find(p => p.id === id);
      if (platform) {
        const exists = existsSync(join(this.projectRoot, platform.file));
        const action = platform.mode === 'append' && exists ? 'append section' : 'create';
        console.error(`  ${platform.file.padEnd(42)} (${action})`);
      }
    }

    if (!options.rulesOnly) {
      console.error('  .git/hooks/post-commit    (git hook)');
      console.error('  .git/hooks/post-merge     (git hook)');
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  private async getVersion(): Promise<string | undefined> {
    try {
      const pkgPath = join(this.projectRoot, 'node_modules', '@ctxo', 'cli', 'package.json');
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
      }
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      return require('../../package.json').version;
    } catch {
      return undefined;
    }
  }

  private installHook(hooksDir: string, hookName: string, hookContent: string): void {
    const hookPath = join(hooksDir, hookName);

    let existing = '';
    if (existsSync(hookPath)) {
      existing = readFileSync(hookPath, 'utf-8');
      if (existing.includes(CTXO_START)) return;
    } else {
      existing = '#!/bin/sh\n';
    }

    const updated = existing.endsWith('\n')
      ? existing + '\n' + hookContent + '\n'
      : existing + '\n\n' + hookContent + '\n';

    writeFileSync(hookPath, updated, 'utf-8');
    chmodSync(hookPath, 0o755);
  }
}
