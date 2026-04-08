import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
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
