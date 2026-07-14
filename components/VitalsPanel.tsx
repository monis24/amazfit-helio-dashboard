/**
 * VitalsPanel.tsx — Continuous Vitals Panel (SPEC.md's Phase 3 section):
 * compact 3-hour HR and stress previews. Tap either chart for the full-day
 * detail view (MetricDetailScreen) with day-paging — a full 24 hours
 * doesn't fit this card's compact height/width usefully, so the dashboard
 * shows a short recent window and the detail screen owns the "see the
 * whole day, page between days" job. Chart rendering itself (color-coded
 * bars by zone/band, axis fonts, latest-reading display) lives in
 * HrChart.tsx/StressChart.tsx, shared with MetricDetailScreen.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useHrMax } from '../hooks/useHrMax';
import { useVitalsPanel } from '../hooks/useVitalsPanel';
import { todayLocalDate } from '../hooks/localDateRange';
import { Card } from './Card';
import { HrChart } from './HrChart';
import { StressChart } from './StressChart';
import { StateMessage } from './StateMessage';
import type { RootStackParamList } from '../navigation/types';

const PREVIEW_WINDOW_HOURS = 3;
const PREVIEW_CHART_HEIGHT = 120;

export function VitalsPanel(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const window = useMemo(() => {
    const toUtc = Math.floor(Date.now() / 1000);
    return { fromUtc: toUtc - PREVIEW_WINDOW_HOURS * 3600, toUtc };
  }, []);

  const state = useVitalsPanel(window);
  const hrMaxState = useHrMax();

  const openDetail = (metric: 'hr' | 'stress') => navigation.navigate('MetricDetail', { metric, date: todayLocalDate() });

  return (
    <Card title="Continuous Vitals" badge="device">
      {state.status === 'loading' && <StateMessage text="Loading…" />}
      {state.status === 'error' && <StateMessage text={`Couldn't load vitals: ${state.message}`} tone="error" />}
      {state.status === 'ready' && state.data.hrSamples.length === 0 && (
        <StateMessage text={`No heart-rate data for the last ${PREVIEW_WINDOW_HOURS} hours yet.`} />
      )}
      {state.status === 'ready' && state.data.hrSamples.length > 0 && (
        <>
          <Pressable style={styles.block} onPress={() => openDetail('hr')}>
            <HrChart
              samples={state.data.hrSamples}
              hrMax={hrMaxState.status === 'ready' && hrMaxState.data.kind === 'ok' ? hrMaxState.data.value : undefined}
              windowSeconds={PREVIEW_WINDOW_HOURS * 3600}
              height={PREVIEW_CHART_HEIGHT}
              showLegend={false}
            />
          </Pressable>
          <Pressable style={styles.block} onPress={() => openDetail('stress')}>
            <StressChart
              points={state.data.stressPoints}
              height={PREVIEW_CHART_HEIGHT}
              showLegend={false}
              emptyMessage={`No stress data for the last ${PREVIEW_WINDOW_HOURS} hours yet.`}
            />
          </Pressable>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: 12,
  },
});
