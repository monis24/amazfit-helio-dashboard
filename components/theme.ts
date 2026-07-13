/**
 * theme.ts — shared tokens for the "SwiftUI-inspired... dark mode by
 * default" look SPEC.md's Phase 3 section calls for: clean cards, tight
 * spacing. Not a theming system (no light mode, no ThemeProvider) — this
 * project has one fixed look, so a plain const object is the whole need.
 */

export const colors = {
  background: '#0B0B0F',
  card: '#1C1C22',
  cardBorder: '#2A2A32',
  textPrimary: '#F5F5F7',
  textSecondary: '#9A9AA5',
  accentHr: '#FF5A5F',
  accentStress: '#F2B705',
  accentVo2: '#4FD1C5',
  accentDeep: '#5B6EF5',
  accentLight: '#8AA4F8',
  accentRem: '#C88AF8',
  accentAwake: '#FF8A65',
  positive: '#4CD964',
  negative: '#FF6B6B',
  neutral: '#9A9AA5',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radii = {
  card: 16,
  chip: 8,
} as const;
