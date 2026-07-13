/**
 * InsightsPanel.tsx — Local Insights Card (SPEC.md's Phase 3 section): VO2
 * Max trend (Model A and B, labeled separately), device-computed stress
 * 7-day trend, estimated recovery time remaining. Every stat is labeled
 * local vs. device-computed per SPEC.md's distinction rule — most rows will
 * legitimately read "insufficient data" on this account (SPEC.md's live
 * blocker: zero recorded workouts), which is the expected common case, not
 * a bug to hide.
 */

import { StyleSheet, Text, View } from 'react-native';

import { useInsights } from '../hooks/useInsights';
import type { EngineResult } from '../engines/BiometricEngine';
import { Card } from './Card';
import { StateMessage } from './StateMessage';
import { colors, spacing } from './theme';

export function InsightsPanel(): React.JSX.Element {
  const state = useInsights();

  return (
    <Card title="Insights">
      {state.status === 'loading' && <StateMessage text="Loading…" />}
      {state.status === 'error' && <StateMessage text={`Couldn't load insights: ${state.message}`} tone="error" />}
      {state.status === 'ready' && (
        <View>
          <StatRow
            label="VO2 Max — Model A"
            badge="local"
            result={state.data.vo2MaxModelA}
            format={(v) => `${v.vo2Max.toFixed(1)} mL/kg/min`}
          />
          <StatRow
            label="VO2 Max — Model B"
            badge="local"
            result={state.data.vo2MaxModelB}
            format={() => ''}
          />
          <StatRow
            label="Stress trend (7d)"
            badge="device-computed"
            result={state.data.stressTrend}
            format={(v) => `${v.direction} (${v.deltaAvg > 0 ? '+' : ''}${v.deltaAvg.toFixed(1)})`}
          />
          <StatRow
            label="Recovery time remaining"
            badge="local"
            result={state.data.hrr}
            format={(v) => (v.estimatedRecoveryMinutes === undefined ? 'not yet estimable' : `~${v.estimatedRecoveryMinutes.toFixed(0)} min`)}
          />
        </View>
      )}
    </Card>
  );
}

function StatRow<T>({
  label,
  badge,
  result,
  format,
}: {
  readonly label: string;
  readonly badge: 'local' | 'device-computed';
  readonly result: EngineResult<T>;
  readonly format: (value: T) => string;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.badge, badge === 'device-computed' && styles.badgeDevice]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      </View>
      {result.kind === 'ok' ? (
        <Text style={styles.value}>{format(result.value)}</Text>
      ) : (
        <Text style={styles.insufficientText}>Insufficient data — {result.reason}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.md,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  value: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  insufficientText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
  },
  badge: {
    backgroundColor: colors.cardBorder,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeDevice: {
    backgroundColor: '#3A2E0A',
  },
  badgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
