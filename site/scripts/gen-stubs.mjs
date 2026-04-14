// Create stub md pages for the full docs tree.
// Skips files that already exist (so hand-written pages aren't clobbered).

import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..', 'docs');

const pages = [
  // Introduction
  ['introduction/what-is-ctxo', 'What is Ctxo?', 'The one-paragraph pitch and elevator summary.'],
  ['introduction/why-ctxo', 'Why Ctxo?', 'The problem (agents code blind) and how Ctxo solves it.'],
  ['introduction/installation', 'Installation', 'Installing @ctxo/cli and language plugins via npx, pnpm, or npm.'],
  ['introduction/quick-start', 'Quick Start', 'Index a codebase and make your first MCP call in under 5 minutes.'],
  ['introduction/mcp-client-setup', 'MCP Client Setup', 'Wire Ctxo into Claude Code, Cursor, Copilot, Windsurf, and Cline.'],

  // Core Concepts
  ['concepts/logic-slices', 'Logic-Slices', 'Symbol + transitive dependencies with L1-L4 progressive detail.'],
  ['concepts/dependency-graph', 'Dependency Graph', 'Symbols as nodes, imports/calls/extends/uses as edges.'],
  ['concepts/blast-radius', 'Blast Radius', 'Tiered impact scoring: confirmed, likely, potential.'],
  ['concepts/git-intent', 'Git Intent & Anti-Patterns', 'Commit messages tell the why; reverts surface incidents.'],
  ['concepts/change-intelligence', 'Change Intelligence', 'Complexity x churn composite score.'],
  ['concepts/pagerank', 'PageRank Importance', 'Symbol centrality via link-based ranking.'],
  ['concepts/masking', 'Masking Pipeline', 'How responses are sanitized before delivery to the client.'],

  // CLI Reference
  ['cli/overview', 'CLI Overview', 'All ctxo commands at a glance.'],
  ['cli/install', 'ctxo install', 'Install detected or selected language plugins.'],
  ['cli/init', 'ctxo init', 'Bootstrap a project: git hooks + plugin install prompt.'],
  ['cli/index', 'ctxo index', 'Build the full codebase index.'],
  ['cli/watch', 'ctxo watch', 'File watcher for incremental re-index.'],
  ['cli/sync', 'ctxo sync', 'Rebuild the SQLite cache from committed JSON.'],
  ['cli/status', 'ctxo status', 'Show the index manifest and freshness.'],
  ['cli/doctor', 'ctxo doctor', 'Health check every subsystem.'],
  ['cli/visualize', 'ctxo visualize', 'Generate an interactive dependency graph HTML.'],
  ['cli/config-yaml', 'config.yaml reference', 'The .ctxo/config.yaml schema: ignore globs, stats, defaults.'],
  ['cli/env-vars', 'Environment variables', 'DEBUG namespaces, CTXO_RESPONSE_LIMIT, and other env knobs.'],

  // MCP Tools
  ['mcp-tools/overview', 'MCP Tools Overview', 'All 14 tools with what they return and when to use them.'],
  ['mcp-tools/tool-selection-guide', 'Tool Selection Guide', 'Which tool answers which question? A decision tree.'],
  ['mcp-tools/response-format', 'Response Format', 'The _meta envelope, intent filtering, and truncation rules.'],
  // Context & Search
  ['mcp-tools/get-logic-slice', 'get_logic_slice', 'Symbol plus transitive dependencies with progressive detail levels.'],
  ['mcp-tools/get-context-for-task', 'get_context_for_task', 'Task-aware context for fix / extend / refactor / understand.'],
  ['mcp-tools/get-ranked-context', 'get_ranked_context', 'Two-phase BM25 + PageRank search within a token budget.'],
  ['mcp-tools/search-symbols', 'search_symbols', 'Symbol name/regex search across the index.'],
  // Impact & Change
  ['mcp-tools/get-blast-radius', 'get_blast_radius', 'What breaks if I change this symbol?'],
  ['mcp-tools/get-pr-impact', 'get_pr_impact', 'Full PR risk assessment (changes + blast + co-changes).'],
  ['mcp-tools/get-change-intelligence', 'get_change_intelligence', 'Complexity x churn composite score per file.'],
  ['mcp-tools/get-changed-symbols', 'get_changed_symbols', 'Symbols in recently changed files (git diff).'],
  // Structure & Dependencies
  ['mcp-tools/find-importers', 'find_importers', 'Reverse dependency lookup.'],
  ['mcp-tools/get-class-hierarchy', 'get_class_hierarchy', 'Class inheritance tree: ancestors + descendants.'],
  ['mcp-tools/get-architectural-overlay', 'get_architectural_overlay', 'Project layer map (Domain / Infra / Adapters).'],
  ['mcp-tools/get-symbol-importance', 'get_symbol_importance', 'PageRank centrality ranking.'],
  // History & Cleanup
  ['mcp-tools/get-why-context', 'get_why_context', 'Git commit intent + anti-pattern warnings for a symbol.'],
  ['mcp-tools/find-dead-code', 'find_dead_code', 'Unreachable symbols and files.'],

  // Integrations
  ['integrations/claude-code', 'Claude Code', 'Wire Ctxo into Claude Code stdio transport.'],
  ['integrations/cursor', 'Cursor', 'Cursor MCP setup.'],
  ['integrations/copilot', 'GitHub Copilot', 'Copilot Chat MCP setup.'],
  ['integrations/windsurf', 'Windsurf', 'Windsurf MCP setup.'],
  ['integrations/cline', 'Cline', 'Cline MCP setup.'],
  ['integrations/raw-mcp-client', 'Raw MCP Client', 'Talk to Ctxo via the Model Context Protocol SDK.'],

  // Languages
  ['languages/overview', 'Languages Overview', 'Language support tiers and plugin architecture.'],
  ['languages/typescript', 'TypeScript', '@ctxo/lang-typescript: ts-morph, full tier.'],
  ['languages/go', 'Go', '@ctxo/lang-go: tree-sitter + ctxo-go-analyzer.'],
  ['languages/csharp', 'C#', '@ctxo/lang-csharp: Roslyn + tree-sitter.'],
  ['languages/writing-a-plugin', 'Writing a Plugin', 'Implement the Plugin API v1 contract for a new language.'],

  // Architecture
  ['architecture/hexagonal', 'Hexagonal Design', 'Ports, adapters, and the composition root.'],
  ['architecture/plugin-api', 'Plugin API v1', 'The stable contract between @ctxo/cli and language plugins.'],
  ['architecture/storage', 'Storage Layout', '.ctxo/index JSON + .ctxo/.cache SQLite.'],
  ['architecture/index-schema', 'Index JSON Schema', 'The strict per-file index contract.'],
  ['architecture/error-handling', 'Error Handling', 'Warn-and-continue at the adapter boundary.'],
  ['architecture/adrs', 'ADRs', 'Architecture Decision Records index.'],

  // Reference
  ['reference/config-schema', 'Config Schema', '.ctxo/config.yaml full reference.'],
  ['reference/symbol-ids', 'Symbol IDs', 'The deterministic id format for every symbol.'],
  ['reference/edge-kinds', 'Edge Kinds', 'imports | calls | extends | implements | uses.'],
  ['reference/response-envelope', 'Response Envelope', 'The _meta wrapper and truncation rules.'],
  ['reference/ci-integration', 'CI Integration', 'ctxo index --check as a CI gate.'],
  ['reference/release-process', 'Release Process', 'Changesets workflow and npm publishing.'],
];

let created = 0;
let skipped = 0;

for (const [slug, title, description] of pages) {
  const file = join(docsDir, `${slug}.md`);
  try {
    await access(file, constants.F_OK);
    skipped++;
    continue;
  } catch {
    // doesn't exist, create it
  }
  await mkdir(dirname(file), { recursive: true });
  const esc = (s) => s.replace(/"/g, '\\"');
  const body = `---
title: "${esc(title)}"
description: "${esc(description)}"
---

# ${title}

::: tip Coming soon
${description}
:::

<!-- TODO: write this page -->
`;
  await writeFile(file, body, 'utf8');
  created++;
}

console.log(`[gen-stubs] created ${created} new stub(s), skipped ${skipped} existing`);
