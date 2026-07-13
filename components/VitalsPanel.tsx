/**
 * VitalsPanel.tsx — Continuous Vitals Panel (SPEC.md's Phase 3 section):
 * minute-by-minute HR for the past 24 hours as the primary line, overlaid
 * device-computed stress scatter points on the same time axis. Dual y-axis
 * (bpm ~30-220, stress 0-100) since the two scales aren't comparable —
 * cramming stress onto the HR axis would flatten it near zero. Zoomable and
 * pannable per SPEC.md, via Victory Native's transformState (pinch + pan
 * gestures, composed through GestureHandlerRootView at the app root) — the
 * chart has no built-in reset gesture, so a tap resets the transform.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CartesianChart, Line, Scatter, useChartTransformState } from 'victory-native';

import { useVitalsPanel } from '../hooks/useVitalsPanel';
import { Card } from './Card';
import { StateMessage } from './StateMessage';
import { colors } from './theme';

const WINDOW_HOURS = 24;
const CHART_HEIGHT = 220;

interface VitalsRow {
  readonly t: number;
  readonly hr: number | null;
  readonly stress: number | null;
  readonly [key: string]: unknown;
}

export function VitalsPanel(): React.JSX.Element {
  const window = useMemo(() => {
    const toUtc = Math.floor(Date.now() / 1000);
    return { fromUtc: toUtc - WINDOW_HOURS * 3600, toUtc };
  }, []);

  const state = useVitalsPanel(window);

  return (
    <Card title="Continuous Vitals" badge="device">
      {state.status === 'loading' && <StateMessage text="Loading…" />}
      {state.status === 'error' && <StateMessage text={`Couldn't load vitals: ${state.message}`} tone="error" />}
      {state.status === 'ready' && <VitalsChart hrSamples={state.data.hrSamples} stressPoints={state.data.stressPoints} />}
    </Card>
  );
}

function VitalsChart({
  hrSamples,
  stressPoints,
}: {
  readonly hrSamples: readonly { readonly t: number; readonly bpm: number }[];
  readonly stressPoints: readonly { readonly t: number; readonly value: number }[];
}): React.JSX.Element {
  const rows = useMemo<VitalsRow[]>(() => {
    const byTime = new Map<number, VitalsRow>();
    for (const s of hrSamples) byTime.set(s.t, { t: s.t, hr: s.bpm, stress: null });
    for (const p of stressPoints) {
      const existing = byTime.get(p.t);
      byTime.set(p.t, existing !== undefined ? { ...existing, stress: p.value } : { t: p.t, hr: null, stress: p.value });
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [hrSamples, stressPoints]);

  const [resetKey, setResetKey] = useState(0);

  if (hrSamples.length === 0) {
    return <StateMessage text="No heart-rate data for the last 24 hours yet." />;
  }

  return (
    <View style={{ height: CHART_HEIGHT }}>
      <ZoomableChart key={resetKey} rows={rows} />
      <View style={styles.legend}>
        <LegendDot color={colors.accentHr} label="Heart rate (device)" />
        <LegendDot color={colors.accentStress} label="Stress (device-computed)" />
      </View>
      <Pressable onPress={() => setResetKey((k) => k + 1)}>
        <Text style={styles.resetLink}>Reset zoom</Text>
      </Pressable>
    </View>
  );
}

/**
 * Isolated so its transformState (a fresh Reanimated matrix per mount) can
 * be reset by remounting via the parent's `key` — Victory Native's
 * transform matrix has no public reset API, but a fresh
 * useChartTransformState() call does the same thing.
 */
function ZoomableChart({ rows }: { readonly rows: VitalsRow[] }): React.JSX.Element {
  const { state: transformState } = useChartTransformState();

  return (
    <CartesianChart<VitalsRow, 't', 'hr' | 'stress'>
      data={rows}
      xKey="t"
      yKeys={['hr', 'stress']}
      yAxis={[
        { yKeys: ['hr'], domain: [30, 220] },
        { yKeys: ['stress'], domain: [0, 100] },
      ]}
      axisOptions={{ labelColor: colors.textSecondary, lineColor: colors.cardBorder }}
      transformState={transformState}
      transformConfig={{ pan: { dimensions: 'x' } }}
    >
      {({ points }) => (
        <>
          <Line points={points.hr} color={colors.accentHr} strokeWidth={2} connectMissingData curveType="linear" />
          <Scatter points={points.stress} color={colors.accentStress} radius={3} />
        </>
      )}
    </CartesianChart>
  );
}

function LegendDot({ color, label }: { readonly color: string; readonly label: string }): React.JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    gap: 16,
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
  resetLink: {
    color: colors.accentVo2,
    fontSize: 12,
    marginTop: 8,
  },
});
