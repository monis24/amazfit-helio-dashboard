/**
 * HypnogramPanel.tsx — Granular Sleep Hypnogram (SPEC.md's Phase 3 section):
 * Gantt-style horizontal timeline of exact epoch-timestamp stage
 * transitions, plus a companion restlessness graph
 * (RestlessnessEngine.ts's transition-density proxy — no cloud endpoint
 * exposes raw accelerometer data; see SPEC.md's BLE research note).
 *
 * The Gantt bar is drawn with @shopify/react-native-skia's raw Canvas/Rect
 * directly, not through victory-native's CartesianChart — a Gantt timeline
 * isn't a cartesian x/y series (it's one row of colored, variable-width
 * segments), and Skia's own primitives fit that more directly than forcing
 * it through a scale/axis abstraction built for point data. This is the
 * reason Victory Native (Skia-based) was chosen over wagmi-charts in the
 * first place (CLAUDE.md's Stack section) — direct Skia canvas access for
 * exactly this shape of chart.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Rect } from '@shopify/react-native-skia';
import { Bar, CartesianChart } from 'victory-native';

import { useHypnogram, type HypnogramSegment } from '../hooks/useHypnogram';
import { todayLocalDate } from '../hooks/localDateRange';
import { Card } from './Card';
import { StateMessage } from './StateMessage';
import { colors, spacing } from './theme';

const GANTT_HEIGHT = 36;
const RESTLESSNESS_HEIGHT = 90;

const STAGE_COLOR: Readonly<Record<string, string>> = {
  Light: colors.accentLight,
  Deep: colors.accentDeep,
  REM: colors.accentRem,
  Awake: colors.accentAwake,
};

interface RestlessnessRow {
  readonly t: number;
  readonly score: number;
  readonly [key: string]: unknown;
}

export function HypnogramPanel(): React.JSX.Element {
  const [wakeDate] = useState(todayLocalDate);
  const state = useHypnogram(wakeDate);

  return (
    <Card title="Sleep Hypnogram" badge="device-computed">
      {state.status === 'loading' && <StateMessage text="Loading…" />}
      {state.status === 'error' && <StateMessage text={`Couldn't load sleep data: ${state.message}`} tone="error" />}
      {state.status === 'ready' && state.data.session === undefined && (
        <StateMessage text="No sleep session recorded for last night yet." />
      )}
      {state.status === 'ready' && state.data.session !== undefined && (
        <HypnogramContent
          session={state.data.session}
          segments={state.data.segments}
          restlessness={state.data.restlessness}
        />
      )}
    </Card>
  );
}

function HypnogramContent({
  session,
  segments,
  restlessness,
}: {
  readonly session: { readonly startUtc: number; readonly endUtc: number };
  readonly segments: readonly HypnogramSegment[];
  readonly restlessness: readonly { readonly t: number; readonly score: number }[];
}): React.JSX.Element {
  const [canvasWidth, setCanvasWidth] = useState(0);
  const totalDuration = session.endUtc - session.startUtc;

  const restlessnessRows: RestlessnessRow[] = restlessness.map((p) => ({ t: p.t, score: p.score }));

  return (
    <View>
      <View onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}>
        <Canvas style={{ width: '100%', height: GANTT_HEIGHT }}>
          {canvasWidth > 0 &&
            totalDuration > 0 &&
            segments.map((seg, i) => {
              const x = ((seg.startUtc - session.startUtc) / totalDuration) * canvasWidth;
              const width = Math.max(((seg.endUtc - seg.startUtc) / totalDuration) * canvasWidth, 1);
              return <Rect key={i} x={x} y={0} width={width} height={GANTT_HEIGHT} color={STAGE_COLOR[seg.label] ?? colors.neutral} />;
            })}
        </Canvas>
      </View>

      <View style={styles.legend}>
        {(['Deep', 'Light', 'REM', 'Awake'] as const).map((label) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: STAGE_COLOR[label] }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>

      {restlessnessRows.length > 0 && (
        <View>
          <Text style={styles.subheading}>Restlessness (stage-transition density) — local</Text>
          <View style={{ height: RESTLESSNESS_HEIGHT }}>
            <CartesianChart<RestlessnessRow, 't', 'score'>
              data={restlessnessRows}
              xKey="t"
              yKeys={['score']}
              domainPadding={{ left: 10, right: 10, top: 10 }}
              axisOptions={{ labelColor: colors.textSecondary, lineColor: colors.cardBorder }}
            >
              {({ points, chartBounds }) => (
                <Bar points={points.score} chartBounds={chartBounds} color={colors.accentRem} roundedCorners={{ topLeft: 2, topRight: 2 }} />
              )}
            </CartesianChart>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
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
  subheading: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
});
