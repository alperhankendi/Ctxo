import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['better-sqlite3', 'tree-sitter'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
