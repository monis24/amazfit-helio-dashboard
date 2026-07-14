/**
 * StressChart.tsx — the stress bar chart, extracted out of VitalsPanel.tsx
 * so the dashboard's compact preview and the full-day MetricDetailScreen
 * can share one implementation. Stress's native ~5-minute cadence
 * (SPEC.md Phase 2) doesn't need HrChart.tsx's window-adaptive bucketing —
 * even a full day is only ~288 points.
 */

import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Bar, CartesianChart, useChartTransformState } from 'victory-native';

import { STRESS_BANDS, stressBandFor } from './stressBands';
import { formatClockLabel, formatHourLabel } from './chartTimeFormat';
import { colors } from './theme';
import { useChartFont } from './useChartFont';
import { chartStyles } from './chartStyles';
import { StateMessage } from './StateMessage';

interface StressRow {
  readonly t: number;
  readonly value: number;
  readonly [key: string]: unknown;
}

export interface StressChartProps {
  readonly points: readonly { readonly t: number; readonly value: number }[];
  readonly height?: number;
  readonly showLegend?: boolean;
  readonly showLatest?: boolean;
  readonly emptyMessage?: string;
}

export function StressChart({
  points,
  height = 160,
  showLegend = true,
  showLatest = true,
  emptyMessage = 'No stress data for this window yet.',
}: StressChartProps): React.JSX.Element {
  const font = useChartFont();
  const { state: transformState } = useChartTransformState();
  const rows = useMemo<StressRow[]>(() => [...points].sort((a, b) => a.t - b.t).map((p) => ({ t: p.t, value: p.value })), [points]);
  const latest = rows[rows.length - 1];

  return (
    <View>
      <View style={chartStyles.headerRow}>
        <Text style={chartStyles.seriesLabel}>Stress (device-computed, 0-100)</Text>
        {showLatest && latest !== undefined && (
          <View style={chartStyles.latest}>
            <Text style={chartStyles.latestValue}>{Math.round(latest.value)}</Text>
            <Text style={chartStyles.latestTime}>as of {formatClockLabel(latest.t)}</Text>
          </View>
        )}
      </View>
      {rows.length === 0 ? (
        <StateMessage text={emptyMessage} />
      ) : (
        <>
          <View style={{ height }}>
            <CartesianChart<StressRow, 't', 'value'>
              data={rows}
              xKey="t"
              yKeys={['value']}
              domain={{ y: [0, 100] }}
              axisOptions={{ font, labelColor: colors.textSecondary, lineColor: colors.cardBorder, formatXLabel: formatHourLabel }}
              transformState={transformState}
              transformConfig={{ pan: { dimensions: 'x' } }}
            >
              {({ points: chartPoints, chartBounds }) => (
                <>
                  {STRESS_BANDS.map((bandDef) => {
                    const bandPoints = rows
                      .map((row, i) => ({ row, point: chartPoints.value[i] }))
                      .filter(({ row }) => stressBandFor(row.value).band === bandDef.band)
                      .map(({ point }) => point)
                      .filter((p) => p !== undefined);
                    if (bandPoints.length === 0) return null;
                    return (
                      <Bar
                        key={bandDef.band}
                        points={bandPoints}
                        chartBounds={chartBounds}
                        color={bandDef.color}
                        barCount={rows.length}
                        innerPadding={0.3}
                      />
                    );
                  })}
                </>
              )}
            </CartesianChart>
          </View>
          {showLegend && (
            <View style={chartStyles.legend}>
              {STRESS_BANDS.map((b) => (
                <LegendDot key={b.band} color={b.color} label={b.label} />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function LegendDot({ color, label }: { readonly color: string; readonly label: string }): React.JSX.Element {
  return (
    <View style={chartStyles.legendItem}>
      <View style={[chartStyles.dot, { backgroundColor: color }]} />
      <Text style={chartStyles.legendText}>{label}</Text>
    </View>
  );
}
