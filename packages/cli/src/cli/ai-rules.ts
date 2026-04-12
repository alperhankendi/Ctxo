/**
 * Platform configurations and MCP tool usage rule generator.
 *
 * Each platform entry defines where the AI coding assistant reads its
 * project-level instructions and how ctxo should write them.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface Platform {
  id: string;
  name: string;
  file: string;
  /** 'append' inserts a marked section into an existing file; 'create' writes from scratch */
  mode: 'append' | 'create';
  /** Paths to check for auto-detection (relative to project root) */
  detectPaths: string[];
  /** Show a star next to this platform name */
  starred: boolean;
}

export const PLATFORMS: Platform[] = [
  { id: 'claude-code',    name: 'Claude Code',        file: 'CLAUDE.md',                      mode: 'append',  detectPaths: ['CLAUDE.md', '.claude'],                    starred: true },
  { id: 'cursor',         name: 'Cursor',             file: '.cursor/rules/ctxo-mcp.mdc',     mode: 'create',  detectPaths: ['.cursor', '.cursorrules'],                  starred: false },
  { id: 'github-copilot', name: 'GitHub Copilot',     file: '.github/copilot-instructions.md', mode: 'create',  detectPaths: ['.github', '.vscode'],                      starred: false },
  { id: 'windsurf',       name: 'Windsurf',           file: '.windsurfrules',                  mode: 'create',  detectPaths: ['.windsurfrules', '.windsurf'],              starred: false },
  { id: 'antigravity',    name: 'Google Antigravity',  file: 'AGENTS.md',                      mode: 'create',  detectPaths: ['AGENTS.md', 'GEMINI.md', '.gemini'],       starred: false },
  { id: 'augment',        name: 'Augment Code',       file: 'augment-guidelines.md',           mode: 'create',  detectPaths: ['augment-guidelines.md', '.augment'],        starred: false },
  { id: 'amazonq',        name: 'Amazon Q',           file: '.amazonq/rules/ctxo-mcp.md',     mode: 'create',  detectPaths: ['.amazonq'],                                starred: false },
];

export function detectPlatforms(projectRoot: string): Set<string> {
  const detected = new Set<string>();
  for (const p of PLATFORMS) {
    if (p.detectPaths.some(d => existsSync(join(projectRoot, d)))) {
      detected.add(p.id);
    }
  }
  return detected;
}

const SECTION_START = '<!-- ctxo-rules-start -->';
const SECTION_END = '<!-- ctxo-rules-end -->';

/* ------------------------------------------------------------------ */
/*  Rule content                                                       */
/* ------------------------------------------------------------------ */

function ruleBody(): string {
  return `## ctxo MCP Tool Usage (MANDATORY)

**ALWAYS use ctxo MCP tools before reading source files or making code changes.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification
1. Call \`get_blast_radius\` for the symbol you are about to change — understand what breaks
2. Call \`get_why_context\` for the same symbol — check for revert history or anti-patterns
3. Only then read and edit source files

### Before Starting a Task
| Task Type | REQUIRED First Call |
|---|---|
| Fixing a bug | \`get_context_for_task(taskType: "fix")\` |
| Adding/extending a feature | \`get_context_for_task(taskType: "extend")\` |
| Refactoring | \`get_context_for_task(taskType: "refactor")\` |
| Understanding code | \`get_context_for_task(taskType: "understand")\` |

### Before Reviewing a PR or Diff
- Call \`get_pr_impact\` — single call gives full risk assessment with co-change analysis

### When Exploring or Searching Code
- Use \`search_symbols\` for name/regex lookup — DO NOT grep source files for symbol discovery
- Use \`get_ranked_context\` for natural language queries — DO NOT manually browse directories

### Orientation in Unfamiliar Areas
- Call \`get_architectural_overlay\` to understand layer boundaries
- Call \`get_symbol_importance\` to identify critical symbols

### NEVER Do These
- NEVER edit a function without first calling \`get_blast_radius\` on it
- NEVER skip \`get_why_context\` — reverted code and anti-patterns are invisible without it
- NEVER grep source files to find symbols when \`search_symbols\` exists
- NEVER manually trace imports when \`find_importers\` gives the full reverse dependency graph`;
}

/* ------------------------------------------------------------------ */
/*  Per-platform rendering                                             */
/* ------------------------------------------------------------------ */

function cursorFrontmatter(): string {
  return `---
description: ctxo MCP tool usage rules — always applied
globs:
alwaysApply: true
---

`;
}

export function generateRules(platformId: string): string {
  const body = ruleBody();

  if (platformId === 'cursor') {
    return cursorFrontmatter() + body + '\n';
  }

  return body + '\n';
}

/* ------------------------------------------------------------------ */
/*  File operations                                                    */
/* ------------------------------------------------------------------ */

export interface InstallResult {
  file: string;
  action: 'created' | 'updated' | 'skipped';
}

export function installRules(projectRoot: string, platformId: string): InstallResult {
  const platform = PLATFORMS.find(p => p.id === platformId);
  if (!platform) throw new Error(`Unknown platform: ${platformId}`);

  const filePath = join(projectRoot, platform.file);
  const content = generateRules(platformId);

  // Ensure parent directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (platform.mode === 'create') {
    // For 'create' mode: write or replace entire file
    writeFileSync(filePath, content, 'utf-8');
    return { file: platform.file, action: existsSync(filePath) ? 'updated' : 'created' };
  }

  // 'append' mode: insert marked section into existing file
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf-8');
    return { file: platform.file, action: 'created' };
  }

  const existing = readFileSync(filePath, 'utf-8');

  // Already has ctxo rules section — replace it
  if (existing.includes(SECTION_START)) {
    const re = new RegExp(`${escapeRegExp(SECTION_START)}[\\s\\S]*?${escapeRegExp(SECTION_END)}`, 'm');
    const updated = existing.replace(re, `${SECTION_START}\n${content}${SECTION_END}`);
    writeFileSync(filePath, updated, 'utf-8');
    return { file: platform.file, action: 'updated' };
  }

  // Append new section
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  const updated = existing + separator + `${SECTION_START}\n${content}${SECTION_END}\n`;
  writeFileSync(filePath, updated, 'utf-8');
  return { file: platform.file, action: 'updated' };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/*  Project scaffolding (automatic, not prompted)                      */
/* ------------------------------------------------------------------ */

const GITIGNORE_ENTRY = '.ctxo/.cache/';

export function ensureGitignore(projectRoot: string): InstallResult {
  const filePath = join(projectRoot, '.gitignore');

  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Ctxo local cache (auto-rebuilt, never committed)\n${GITIGNORE_ENTRY}\n`, 'utf-8');
    return { file: '.gitignore', action: 'created' };
  }

  const existing = readFileSync(filePath, 'utf-8');
  if (existing.includes(GITIGNORE_ENTRY)) {
    return { file: '.gitignore', action: 'skipped' };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  const updated = existing + `${separator}# Ctxo local cache (auto-rebuilt, never committed)\n${GITIGNORE_ENTRY}\n`;
  writeFileSync(filePath, updated, 'utf-8');
  return { file: '.gitignore', action: 'updated' };
}

const DEFAULT_CONFIG = `# ctxo project configuration
# Docs: https://github.com/alperhankendi/Ctxo
version: "1.0"
`;

export function ensureConfig(projectRoot: string): InstallResult {
  const filePath = join(projectRoot, '.ctxo', 'config.yaml');
  const dir = dirname(filePath);

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(filePath)) {
    return { file: '.ctxo/config.yaml', action: 'skipped' };
  }

  writeFileSync(filePath, DEFAULT_CONFIG, 'utf-8');
  return { file: '.ctxo/config.yaml', action: 'created' };
}

/* ------------------------------------------------------------------ */
/*  MCP server registration                                            */
/* ------------------------------------------------------------------ */

const CTXO_MCP_ENTRY = { command: 'npx', args: ['-y', '@ctxo/cli'] };

interface McpConfigTarget {
  file: string;
  /** JSON key that holds server map */
  serverKey: 'mcpServers' | 'servers';
  /** Extra fields per server entry */
  extraFields?: Record<string, string>;
}

/**
 * Returns which MCP config files to create/update based on selected platforms.
 * Multiple platforms may map to the same config file (deduplicated).
 */
export function getMcpConfigTargets(selectedPlatformIds: string[]): McpConfigTarget[] {
  const targets = new Map<string, McpConfigTarget>();

  for (const id of selectedPlatformIds) {
    switch (id) {
      case 'claude-code':
      case 'cursor':
      case 'windsurf':
      case 'augment':
      case 'antigravity':
        // .mcp.json is the universal project-level MCP config
        targets.set('.mcp.json', { file: '.mcp.json', serverKey: 'mcpServers' });
        break;
      case 'github-copilot':
        targets.set('.vscode/mcp.json', { file: '.vscode/mcp.json', serverKey: 'servers', extraFields: { type: 'stdio' } });
        break;
      case 'amazonq':
        targets.set('.amazonq/mcp.json', { file: '.amazonq/mcp.json', serverKey: 'mcpServers' });
        break;
    }
  }

  return [...targets.values()];
}

export function ensureMcpConfig(projectRoot: string, target: McpConfigTarget): InstallResult {
  const filePath = join(projectRoot, target.file);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const entry = target.extraFields
    ? { ...target.extraFields, ...CTXO_MCP_ENTRY }
    : { ...CTXO_MCP_ENTRY };

  if (!existsSync(filePath)) {
    const config = { [target.serverKey]: { ctxo: entry } };
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { file: target.file, action: 'created' };
  }

  // Merge into existing config
  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    // Corrupt JSON — overwrite
    const config = { [target.serverKey]: { ctxo: entry } };
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { file: target.file, action: 'updated' };
  }

  const servers = (existing[target.serverKey] ?? {}) as Record<string, unknown>;
  if (servers['ctxo']) {
    return { file: target.file, action: 'skipped' };
  }

  servers['ctxo'] = entry;
  existing[target.serverKey] = servers;
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  return { file: target.file, action: 'updated' };
}
