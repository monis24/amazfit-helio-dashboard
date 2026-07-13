/** @type {import('jest').Config} */
// Separate from jest.config.js (Node-side ts-jest for scripts/services/types/engines/db):
// jest-expo needs React Native's own environment/transform pipeline, which the Node-side
// config deliberately doesn't carry. See CLAUDE.md's Stack section.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.app.js'],
  // jest-expo's own default only whitelists Expo/RN-maintained packages for
  // transformation; victory-native's package.json "exports" map resolves to
  // raw (untranspiled) TS source under the "react-native" condition, which
  // Jest's RN-aware resolver picks up same as Metro would — so it needs to
  // be added to the whitelist too, or Jest hits raw `export`/TS syntax under
  // node_modules and fails to parse it.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|victory-native|@shopify/react-native-skia))',
  ],
};
