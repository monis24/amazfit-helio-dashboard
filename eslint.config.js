// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', 'data/**', 'scripts/discovery-output/**', '*.config.js', 'jest.setup.app.js'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // CLAUDE.md style rule: strict TypeScript throughout, no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
