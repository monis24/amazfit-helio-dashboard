/**
 * StressChart.tsx — the stress bar chart, extracted out of VitalsPanel.tsx
 * so the dashboard's compact preview and the full-day MetricDetailScreen
 * can share one implementation. Bucketed to the same 5-minute width
 * HrChart.tsx uses (see that file's doc comment) — stress's native cadence
 * is close to 5 minutes but not exactly uniform (real device sync can
 * produce irregular gaps), and rendering raw, unevenly-spaced points made
 * the bars look inconsistently spaced next to HrChart's now-fixed-width
 * bars. Bucketing guarantees both charts have the same uniform bar rhythm
 * regardless of the underlying data's actual cadence.
 *
 * `barCount` is computed from the requested `window`'s total possible
 * 5-minute slots, not from `rows.length` (see HrChart.tsx's doc comment for
 * why using the populated-slot count instead makes sparse data render as
 * inconsistently-sized bars rather than correctly-sized bars with genuinely
 * blank gaps).
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

const BUCKET_SECONDS = 5 * 60;

interface StressRow {
  readonly t: number;
  readonly value: number;
  readonly [key: string]: unknown;
}

function bucketAverage(samples: readonly StressRow[], bucketSeconds: number): StressRow[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const s of samples) {
    const bucketStart = Math.floor(s.t / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketStart) ?? { sum: 0, count: 0 };
    existing.sum += s.value;
    existing.count += 1;
    buckets.set(bucketStart, existing);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([t, { sum, count }]) => ({ t, value: sum / count }));
}

export interface StressChartProps {
  readonly points: readonly { readonly t: number; readonly value: number }[];
  readonly window: { readonly fromUtc: number; readonly toUtc: number };
  readonly height?: number;
  readonly showLegend?: boolean;
  readonly showLatest?: boolean;
  readonly emptyMessage?: string;
}

export function StressChart({
  points,
  window,
  height = 160,
  showLegend = true,
  showLatest = true,
  emptyMessage = 'No stress data for this window yet.',
}: StressChartProps): React.JSX.Element {
  const font = useChartFont();
  const { state: transformState } = useChartTransformState();
  const sorted = useMemo(() => [...points].sort((a, b) => a.t - b.t), [points]);
  const rows = useMemo<StressRow[]>(
    () => bucketAverage(sorted.map((p) => ({ t: p.t, value: p.value })), BUCKET_SECONDS),
    [sorted],
  );
  const totalBucketSlots = Math.max(1, Math.ceil((window.toUtc - window.fromUtc) / BUCKET_SECONDS));
  const latest = sorted[sorted.length - 1];

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
              domain={{ x: [window.fromUtc, window.toUtc], y: [0, 100] }}
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
                        barCount={totalBucketSlots}
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
