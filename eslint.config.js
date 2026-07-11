// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', 'data/**', 'scripts/discovery-output/**', '*.config.js'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // CLAUDE.md style rule: strict TypeScript throughout, no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
