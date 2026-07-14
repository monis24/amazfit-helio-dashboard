/**
 * HrChart.tsx — the HR bar chart, extracted out of VitalsPanel.tsx so the
 * dashboard's compact 3-hour preview and the full-day MetricDetailScreen
 * can share one implementation instead of two copies. Bucket width adapts
 * to the window shown: at 1-minute native cadence (db/schema.ts's
 * hr_days), a short (<=4h) window's ~180-or-fewer raw samples already read
 * as discrete bars, but a full day (up to 1440 samples) needs averaging
 * down to 5-minute buckets or bars merge into a solid block at this
 * chart's on-screen width (see VitalsPanel.tsx's original doc comment for
 * the empirical version of this).
 */

import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Bar, CartesianChart, useChartTransformState } from 'victory-native';

import { HR_ZONE_BANDS, hrZoneBandFor } from './hrZoneBands';
import { formatClockLabel, formatHourLabel } from './chartTimeFormat';
import { colors } from './theme';
import { useChartFont } from './useChartFont';
import { chartStyles } from './chartStyles';
import { StateMessage } from './StateMessage';

const SHORT_WINDOW_SECONDS = 4 * 3600;
const SHORT_BUCKET_SECONDS = 60;
const LONG_BUCKET_SECONDS = 5 * 60;
/** Neutral fallback color while HR_max isn't resolvable yet (no profile
 *  synced) — the data still renders, just without zone color. */
const HR_NEUTRAL_COLOR = colors.hrIntensive;

interface HrRow {
  readonly t: number;
  readonly value: number;
  readonly [key: string]: unknown;
}

function bucketAverage(samples: readonly HrRow[], bucketSeconds: number): HrRow[] {
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

export interface HrChartProps {
  readonly samples: readonly { readonly t: number; readonly bpm: number }[];
  readonly hrMax: number | undefined;
  readonly windowSeconds: number;
  readonly height?: number;
  readonly showLegend?: boolean;
  readonly showLatest?: boolean;
  readonly emptyMessage?: string;
}

export function HrChart({
  samples,
  hrMax,
  windowSeconds,
  height = 160,
  showLegend = true,
  showLatest = true,
  emptyMessage = 'No heart-rate data for this window yet.',
}: HrChartProps): React.JSX.Element {
  const font = useChartFont();
  const { state: transformState } = useChartTransformState();
  const sorted = useMemo(() => [...samples].sort((a, b) => a.t - b.t), [samples]);
  const bucketSeconds = windowSeconds <= SHORT_WINDOW_SECONDS ? SHORT_BUCKET_SECONDS : LONG_BUCKET_SECONDS;
  const rows = useMemo<HrRow[]>(
    () => bucketAverage(sorted.map((s) => ({ t: s.t, value: s.bpm })), bucketSeconds),
    [sorted, bucketSeconds],
  );
  const latest = sorted[sorted.length - 1];

  return (
    <View>
      <View style={chartStyles.headerRow}>
        <Text style={chartStyles.seriesLabel}>Heart rate (bpm)</Text>
        {showLatest && latest !== undefined && (
          <View style={chartStyles.latest}>
            <Text style={chartStyles.latestValue}>
              {Math.round(latest.bpm)}
              <Text style={chartStyles.latestUnit}> bpm</Text>
            </Text>
            <Text style={chartStyles.latestTime}>as of {formatClockLabel(latest.t)}</Text>
          </View>
        )}
      </View>
      {rows.length === 0 ? (
        <StateMessage text={emptyMessage} />
      ) : (
        <>
          <View style={{ height }}>
            <CartesianChart<HrRow, 't', 'value'>
              data={rows}
              xKey="t"
              yKeys={['value']}
              domain={{ y: [30, 220] }}
              axisOptions={{ font, labelColor: colors.textSecondary, lineColor: colors.cardBorder, formatXLabel: formatHourLabel }}
              transformState={transformState}
              transformConfig={{ pan: { dimensions: 'x' } }}
            >
              {({ points: chartPoints, chartBounds }) => {
                if (hrMax === undefined) {
                  return <Bar points={chartPoints.value} chartBounds={chartBounds} color={HR_NEUTRAL_COLOR} barCount={rows.length} innerPadding={0.3} />;
                }
                return (
                  <>
                    {HR_ZONE_BANDS.map((bandDef) => {
                      const bandPoints = rows
                        .map((row, i) => ({ row, point: chartPoints.value[i] }))
                        .filter(({ row }) => hrZoneBandFor(row.value, hrMax)?.zone === bandDef.zone)
                        .map(({ point }) => point)
                        .filter((p) => p !== undefined);
                      if (bandPoints.length === 0) return null;
                      return (
                        <Bar
                          key={bandDef.zone}
                          points={bandPoints}
                          chartBounds={chartBounds}
                          color={bandDef.color}
                          barCount={rows.length}
                          innerPadding={0.3}
                        />
                      );
                    })}
                  </>
                );
              }}
            </CartesianChart>
          </View>
          {showLegend && hrMax !== undefined && (
            <View style={chartStyles.legend}>
              {HR_ZONE_BANDS.map((b) => (
                <LegendDot key={b.zone} color={b.color} label={b.zone} />
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
