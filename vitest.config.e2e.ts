import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 30_000,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit-e2e.xml',
    },
  },
});
