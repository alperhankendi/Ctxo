import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // The first test in each worker pays one-time module init (language plugins
    // + sql.js WASM): ~6s on a cold CI runner vs ~0.8s warm. The 5s default
    // flaked on Node 22 in PR #122.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts', 'src/types/**', 'src/ports/**', 'src/core/diagnostics/types.ts', 'src/core/stats/stats-types.ts'],
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      thresholds: {
        'src/core/**': {
          statements: 88,
          branches: 88,
          functions: 90,
          lines: 88,
        },
      },
    },
  },
});
