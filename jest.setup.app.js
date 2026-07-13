jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// @shopify/react-native-skia's real jest setup needs canvaskit-wasm + a
// custom TestEnvironment (see its own jestEnv.js) to actually rasterize —
// real pixel output isn't something these component tests need or exercise;
// that's covered by driving the app on a simulator/device (CLAUDE.md's
// Build & test section / the "run" skill), not Jest. These tests only need
// the module to load and compose without touching the native JSI binding,
// so Canvas/Rect/etc. are stubbed as no-op components.
//
// jest.mock() factories are hoisted above imports and can't close over
// outer-scope variables — `react`/`react-native` are required lazily inside
// the factory itself, not at this file's top level.
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Canvas: ({ children }) => React.createElement(View, null, children),
    Rect: () => null,
    RoundedRect: () => null,
    Group: ({ children }) => React.createElement(View, null, children),
    Path: () => null,
  };
});

// victory-native's charts render through Skia — same reasoning as above,
// stub the chart primitives so /screens component tests can verify data
// wiring and conditional rendering without needing a real canvas.
jest.mock('victory-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CartesianChart: ({ children, data }) =>
      React.createElement(
        View,
        null,
        typeof children === 'function'
          ? children({ points: {}, chartBounds: { top: 0, bottom: 0, left: 0, right: 0 }, chartData: data })
          : null,
      ),
    Line: () => null,
    Bar: () => null,
    Scatter: () => null,
    useChartTransformState: () => ({ state: {} }),
  };
});
