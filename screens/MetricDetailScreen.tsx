/**
 * MetricDetailScreen.tsx — full-day view for one Continuous Vitals metric
 * (HR or stress), reached by tapping its compact preview on the dashboard.
 * Swipe left/right to page to the next/previous day (calendar-app
 * convention: swipe right reveals the previous day, swipe left the next),
 * re-fetching that day's window rather than pushing a new screen per day.
 */

import { useCallback, useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useHrMax } from '../hooks/useHrMax';
import { useVitalsPanel } from '../hooks/useVitalsPanel';
import { localDayWindow, shiftLocalDate, todayLocalDate } from '../hooks/localDateRange';
import { HrChart } from '../components/HrChart';
import { StressChart } from '../components/StressChart';
import { StateMessage } from '../components/StateMessage';
import { colors, spacing } from '../components/theme';
import type { RootStackParamList } from '../navigation/types';

const SWIPE_THRESHOLD_PX = 60;
const ONE_DAY_SECONDS = 86400;

type Props = NativeStackScreenProps<RootStackParamList, 'MetricDetail'>;

function formatDayHeading(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year as number, (month as number) - 1, day as number);
  const isToday = dateStr === todayLocalDate();
  const label = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return isToday ? `Today — ${label}` : label;
}

export function MetricDetailScreen({ route, navigation }: Props): React.JSX.Element {
  const { metric } = route.params;
  const [date, setDate] = useState(route.params.date);

  useLayoutEffect(() => {
    navigation.setOptions({ title: metric === 'hr' ? 'Heart Rate' : 'Stress' });
  }, [navigation, metric]);

  const goToPreviousDay = useCallback(() => setDate((d) => shiftLocalDate(d, -1)), []);
  const goToNextDay = useCallback(() => setDate((d) => shiftLocalDate(d, 1)), []);

  const swipeGesture = Gesture.Pan().onEnd((e) => {
    if (e.translationX > SWIPE_THRESHOLD_PX) runOnJS(goToPreviousDay)();
    else if (e.translationX < -SWIPE_THRESHOLD_PX) runOnJS(goToNextDay)();
  });

  const window = localDayWindow(date);
  const state = useVitalsPanel(window);
  const hrMaxState = useHrMax();

  return (
    <GestureDetector gesture={swipeGesture}>
      <View style={styles.root}>
        <Text style={styles.dateHeading}>{formatDayHeading(date)}</Text>
        <View style={styles.chartArea}>
          {state.status === 'loading' && <StateMessage text="Loading…" />}
          {state.status === 'error' && <StateMessage text={`Couldn't load data: ${state.message}`} tone="error" />}
          {state.status === 'ready' && metric === 'hr' && (
            <HrChart
              samples={state.data.hrSamples}
              hrMax={hrMaxState.status === 'ready' && hrMaxState.data.kind === 'ok' ? hrMaxState.data.value : undefined}
              windowSeconds={ONE_DAY_SECONDS}
              height={320}
            />
          )}
          {state.status === 'ready' && metric === 'stress' && <StressChart points={state.data.stressPoints} height={320} />}
        </View>
        <Text style={styles.swipeHint}>Swipe for the previous/next day</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  dateHeading: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  chartArea: {
    flex: 1,
  },
  swipeHint: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
