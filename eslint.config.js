import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '**/__tests__/**'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message: 'core/ must not import from adapters/ (hexagonal boundary)',
            },
            {
              group: ['**/ports/**'],
              message: 'core/ must not import from ports/ (hexagonal boundary)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message: 'ports/ must not import from adapters/ (hexagonal boundary)',
            },
          ],
        },
      ],
    },
  },
);
