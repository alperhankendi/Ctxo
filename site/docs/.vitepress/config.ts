import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Ctxo Docs',
  description:
    'Dependency-aware, history-enriched context for AI coding assistants',
  base: '/Ctxo/docs/',
  cleanUrls: true,
  lastUpdated: true,
  appearance: false,
  ignoreDeadLinks: [
    // links to pages outside VitePress (landing, visualizer) served from pages/
    /^\/Ctxo\//,
  ],

  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark-dimmed',
    },
  },

  head: [
    ['link', { rel: 'icon', href: '/Ctxo/docs/logo.svg', type: 'image/svg+xml' }],
  ],

  themeConfig: {
    siteTitle: 'Ctxo',
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/Ctxo/', target: '_self' } as any,
      {
        text: 'Guide',
        items: [
          { text: 'What is Ctxo?', link: '/introduction/what-is-ctxo' },
          { text: 'Installation', link: '/introduction/installation' },
          { text: 'Quick Start', link: '/introduction/quick-start' },
          { text: 'MCP Client Setup', link: '/introduction/mcp-client-setup' },
        ],
      },
      { text: 'CLI', link: '/cli/overview' },
      { text: 'MCP Tools', link: '/mcp-tools/overview' },
      { text: 'Architecture', link: '/architecture/hexagonal' },
      { text: 'Reference', link: '/reference/config-schema' },
      { text: 'Visualizer', link: '/Ctxo/ctxo-visualizer.html', target: '_self' } as any,
      { text: 'GitHub', link: 'https://github.com/alperhankendi/Ctxo' },
    ],

    sidebar: {
      '/': [
        {
          text: '🚀 Introduction',
          collapsed: false,
          items: [
            { text: 'What is Ctxo?', link: '/introduction/what-is-ctxo' },
            { text: 'Why Ctxo?', link: '/introduction/why-ctxo' },
            { text: 'Installation', link: '/introduction/installation' },
            { text: 'Quick Start', link: '/introduction/quick-start' },
            { text: 'MCP Client Setup', link: '/introduction/mcp-client-setup' },
          ],
        },
        {
          text: '🧠 Core Concepts',
          collapsed: true,
          items: [
            { text: 'Logic-Slices', link: '/concepts/logic-slices' },
            { text: 'Dependency Graph', link: '/concepts/dependency-graph' },
            { text: 'Blast Radius', link: '/concepts/blast-radius' },
            { text: 'Git Intent & Anti-Patterns', link: '/concepts/git-intent' },
            { text: 'Change Intelligence', link: '/concepts/change-intelligence' },
            { text: 'PageRank Importance', link: '/concepts/pagerank' },
            { text: 'Masking Pipeline', link: '/concepts/masking' },
          ],
        },
        {
          text: '⚙️ CLI Reference',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/cli/overview' },
            { text: 'ctxo install', link: '/cli/install' },
            { text: 'ctxo init', link: '/cli/init' },
            { text: 'ctxo index', link: '/cli/index' },
            { text: 'ctxo watch', link: '/cli/watch' },
            { text: 'ctxo sync', link: '/cli/sync' },
            { text: 'ctxo status', link: '/cli/status' },
            { text: 'ctxo doctor', link: '/cli/doctor' },
            { text: 'ctxo visualize', link: '/cli/visualize' },
            { text: 'config.yaml reference', link: '/cli/config-yaml' },
            { text: 'Environment variables', link: '/cli/env-vars' },
          ],
        },
        {
          text: '🛠 MCP Tools',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/mcp-tools/overview' },
            { text: 'Tool Selection Guide', link: '/mcp-tools/tool-selection-guide' },
            { text: 'Response Format', link: '/mcp-tools/response-format' },
            {
              text: 'Context & Search',
              collapsed: true,
              items: [
                { text: 'get_logic_slice', link: '/mcp-tools/get-logic-slice' },
                { text: 'get_context_for_task', link: '/mcp-tools/get-context-for-task' },
                { text: 'get_ranked_context', link: '/mcp-tools/get-ranked-context' },
                { text: 'search_symbols', link: '/mcp-tools/search-symbols' },
              ],
            },
            {
              text: 'Impact & Change',
              collapsed: true,
              items: [
                { text: 'get_blast_radius', link: '/mcp-tools/get-blast-radius' },
                { text: 'get_pr_impact', link: '/mcp-tools/get-pr-impact' },
                { text: 'get_change_intelligence', link: '/mcp-tools/get-change-intelligence' },
                { text: 'get_changed_symbols', link: '/mcp-tools/get-changed-symbols' },
              ],
            },
            {
              text: 'Structure & Deps',
              collapsed: true,
              items: [
                { text: 'find_importers', link: '/mcp-tools/find-importers' },
                { text: 'get_class_hierarchy', link: '/mcp-tools/get-class-hierarchy' },
                { text: 'get_architectural_overlay', link: '/mcp-tools/get-architectural-overlay' },
                { text: 'get_symbol_importance', link: '/mcp-tools/get-symbol-importance' },
              ],
            },
            {
              text: 'History & Cleanup',
              collapsed: true,
              items: [
                { text: 'get_why_context', link: '/mcp-tools/get-why-context' },
                { text: 'find_dead_code', link: '/mcp-tools/find-dead-code' },
              ],
            },
          ],
        },
        {
          text: '🔌 Integrations',
          collapsed: true,
          items: [
            { text: 'Claude Code', link: '/integrations/claude-code' },
            { text: 'Cursor', link: '/integrations/cursor' },
            { text: 'GitHub Copilot', link: '/integrations/copilot' },
            { text: 'Windsurf', link: '/integrations/windsurf' },
            { text: 'Cline', link: '/integrations/cline' },
            { text: 'Raw MCP Client', link: '/integrations/raw-mcp-client' },
          ],
        },
        {
          text: '🧩 Languages',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/languages/overview' },
            { text: 'TypeScript', link: '/languages/typescript' },
            { text: 'Go', link: '/languages/go' },
            { text: 'C#', link: '/languages/csharp' },
            { text: 'Writing a Plugin', link: '/languages/writing-a-plugin' },
          ],
        },
        {
          text: '🏛 Architecture',
          collapsed: true,
          items: [
            { text: 'Hexagonal Design', link: '/architecture/hexagonal' },
            { text: 'Plugin API v1', link: '/architecture/plugin-api' },
            { text: 'Storage Layout', link: '/architecture/storage' },
            { text: 'Index JSON Schema', link: '/architecture/index-schema' },
            { text: 'Error Handling', link: '/architecture/error-handling' },
            { text: 'ADRs', link: '/architecture/adrs' },
          ],
        },
        {
          text: '📊 Comparisons',
          collapsed: true,
          items: [
            { text: 'Blast Radius — ctxo vs Manual', link: '/comparisons/blast-radius' },
            { text: 'Dead Code — ctxo vs knip/tsr/deadcode', link: '/comparisons/dead-code' },
          ],
        },
        {
          text: '📚 Reference',
          collapsed: true,
          items: [
            { text: 'Config Schema', link: '/reference/config-schema' },
            { text: 'Symbol IDs', link: '/reference/symbol-ids' },
            { text: 'Edge Kinds', link: '/reference/edge-kinds' },
            { text: 'Response Envelope', link: '/reference/response-envelope' },
            { text: 'CI Integration', link: '/reference/ci-integration' },
            { text: 'Release Process', link: '/reference/release-process' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/alperhankendi/Ctxo' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024–present Alper Hankendi',
    },

    editLink: {
      pattern:
        'https://github.com/alperhankendi/Ctxo/edit/master/site/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
