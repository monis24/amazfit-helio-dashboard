import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CadencePanel } from '../components/CadencePanel';
import { HypnogramPanel } from '../components/HypnogramPanel';
import { InsightsPanel } from '../components/InsightsPanel';
import { SyncStatusBanner } from '../components/SyncStatusBanner';
import { VitalsPanel } from '../components/VitalsPanel';
import { colors, spacing } from '../components/theme';

export function DashboardScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <Text style={styles.heading}>Amazfit Helio</Text>
        <SyncStatusBanner />
        <VitalsPanel />
        <HypnogramPanel />
        <CadencePanel />
        <InsightsPanel />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
});
