import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Ctxo Docs',
  description:
    'Dependency-aware, history-enriched context for AI coding assistants',
  base: '/Ctxo/docs/',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: [
    // links to pages outside VitePress (landing, visualizer) served from pages/
    /^\/Ctxo\//,
  ],

  head: [
    ['link', { rel: 'icon', href: '/Ctxo/docs/favicon.svg', type: 'image/svg+xml' }],
  ],

  themeConfig: {
    siteTitle: 'Ctxo',

    nav: [
      { text: 'Home', link: '/Ctxo/', target: '_self' } as any,
      { text: 'Docs', link: '/' },
      { text: 'Visualizer', link: '/Ctxo/ctxo-visualizer.html', target: '_self' } as any,
      { text: 'GitHub', link: 'https://github.com/alperhankendi/Ctxo' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Landing', link: '/' },
          { text: 'Quick Start', link: '/quick-start' },
        ],
      },
      {
        text: 'MCP Tools',
        collapsed: false,
        items: [
          { text: 'get_logic_slice', link: '/mcp-tools/get-logic-slice' },
        ],
      },
      {
        text: 'Comparisons',
        collapsed: false,
        items: [
          { text: 'Blast Radius', link: '/comparisons/blast-radius' },
          { text: 'Dead Code', link: '/comparisons/dead-code' },
        ],
      },
    ],

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
