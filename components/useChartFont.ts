import { useMemo } from 'react';
import { matchFont } from '@shopify/react-native-skia';
import type { SkFont } from '@shopify/react-native-skia';

/**
 * Victory Native's axis label font defaults to size 0 (invisible) unless a
 * real SkFont is passed — Skia draws text with actual glyph data, it has no
 * "use the OS default font" fallback the way RN's <Text> does. matchFont()
 * resolves the device's system font synchronously via Skia's FontMgr, so no
 * font file needs to be bundled. Shared/memoized so every chart's axis uses
 * one font instance rather than re-resolving on every render.
 */
export function useChartFont(fontSize = 11): SkFont {
  return useMemo(() => matchFont({ fontFamily: 'System', fontSize }), [fontSize]);
}
