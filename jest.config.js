/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // Jest runs CommonJS; the project tsconfig targets ES2022 modules
        // for tsx-run scripts. Override just for the test transform.
        tsconfig: { module: 'commonjs', moduleResolution: 'node', types: ['node', 'jest'] },
      },
    ],
  },
};
