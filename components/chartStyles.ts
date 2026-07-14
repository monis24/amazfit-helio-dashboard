import { StyleSheet } from 'react-native';

import { colors } from './theme';

/** Shared styles for HrChart.tsx/StressChart.tsx — both used from
 *  VitalsPanel's compact preview and MetricDetailScreen's full view. */
export const chartStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  seriesLabel: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  latest: {
    alignItems: 'flex-end',
  },
  latestValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  latestUnit: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '400',
  },
  latestTime: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
});
