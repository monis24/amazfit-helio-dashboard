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
  accentVo2: '#4FD1C5',
  // Stress band colors — match the Zepp app's own convention (0-39 relaxed,
  // 40-59 normal, 60-79 medium, 80-100 high), not an invented palette.
  stressRelaxed: '#29ABE2',
  stressNormal: '#1BC47D',
  stressMedium: '#F5A623',
  stressHigh: '#F0552A',
  // HR zone colors — Zepp's own "Heart Rate Zone" names (Light/Intensive/
  // Aerobic/Anaerobic/VO2 Max); Light/Aerobic/Intensive match its visible
  // purple/green/blue bars, Anaerobic/VO2 Max fill in the warm end of the
  // progression (that screen's own bars were empty/colorless at 0%).
  hrResting: '#5B7A94',
  hrLight: '#9B59D0',
  hrIntensive: '#4A90D9',
  hrAerobic: '#2FA86B',
  hrAnaerobic: '#F5A623',
  hrVo2Max: '#E74C3C',
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
