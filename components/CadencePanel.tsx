/**
 * CadencePanel.tsx — Cadence & Efficiency Metrics panel (SPEC.md's Phase 3
 * section): histogram of daily step cadence bucketed against HR zones.
 * Source is `stp.stage` activity segments (CadenceEngine.ts's
 * cadenceByHrZone) — available every day regardless of recorded workouts.
 * One small bar chart per HR zone that has data, stacked vertically.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { useCadencePanel } from '../hooks/useCadencePanel';
import { todayLocalDate } from '../hooks/localDateRange';
import { Card } from './Card';
import { humanizeReason } from './humanizeReason';
import { StateMessage } from './StateMessage';
import { colors, spacing } from './theme';
import { useChartFont } from './useChartFont';

const ZONE_CHART_HEIGHT = 90;

interface CadenceRow {
  readonly stepsPerMin: number;
  readonly minutes: number;
  readonly [key: string]: unknown;
}

export function CadencePanel(): React.JSX.Element {
  const [localDate] = useState(todayLocalDate);
  const state = useCadencePanel(localDate);

  return (
    <Card title="Cadence & Efficiency" badge="local">
      {state.status === 'loading' && <StateMessage text="Loading…" />}
      {state.status === 'error' && <StateMessage text={`Couldn't load cadence data: ${state.message}`} tone="error" />}
      {state.status === 'ready' && state.data.kind === 'insufficient-data' && (
        <StateMessage text={`No cadence-by-zone data yet (${humanizeReason(state.data.reason)}).`} />
      )}
      {state.status === 'ready' && state.data.kind === 'ok' && <CadenceZones zones={state.data.value} />}
    </Card>
  );
}

function CadenceZones({
  zones,
}: {
  readonly zones: readonly { readonly zone: string; readonly cadenceBuckets: readonly { readonly stepsPerMin: number; readonly minutes: number }[] }[];
}): React.JSX.Element {
  return (
    <View>
      {zones.map((z) => (
        <ZoneBarChart key={z.zone} zone={z.zone} buckets={z.cadenceBuckets} />
      ))}
    </View>
  );
}

function ZoneBarChart({
  zone,
  buckets,
}: {
  readonly zone: string;
  readonly buckets: readonly { readonly stepsPerMin: number; readonly minutes: number }[];
}): React.JSX.Element {
  const rows = useMemo<CadenceRow[]>(
    () => buckets.map((b) => ({ stepsPerMin: b.stepsPerMin, minutes: b.minutes })),
    [buckets],
  );
  const font = useChartFont();

  return (
    <View style={styles.zoneRow}>
      <Text style={styles.zoneLabel}>{zone}</Text>
      <View style={{ height: ZONE_CHART_HEIGHT, flex: 1 }}>
        <CartesianChart<CadenceRow, 'stepsPerMin', 'minutes'>
          data={rows}
          xKey="stepsPerMin"
          yKeys={['minutes']}
          domainPadding={{ left: 20, right: 20 }}
          axisOptions={{ font, labelColor: colors.textSecondary, lineColor: colors.cardBorder }}
        >
          {({ points, chartBounds }) => (
            <Bar points={points.minutes} chartBounds={chartBounds} color={colors.accentVo2} roundedCorners={{ topLeft: 4, topRight: 4 }} />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  zoneLabel: {
    width: 28,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});
