import { StyleSheet, Text } from 'react-native';

import { useSyncStatus } from '../hooks/SyncContext';
import { colors, spacing } from './theme';

/** Small, unobtrusive sync-status line under the dashboard heading —
 *  SyncStatusObservable (Phase 1) had no UI subscriber before this; every
 *  panel below would otherwise silently read an empty, never-synced DB
 *  with no indication why (After-Phase-3 checkpoint finding). */
export function SyncStatusBanner(): React.JSX.Element | null {
  const status = useSyncStatus();

  if (status.phase === 'idle') return null;

  if (status.phase === 'syncing') {
    return <Text style={styles.text}>Syncing{status.detail !== undefined ? ` — ${status.detail}` : ''}…</Text>;
  }

  if (status.phase === 'error') {
    const message = status.endpoint === 'auth' ? status.message : `Sync error (${status.endpoint}): ${status.message}`;
    return <Text style={[styles.text, styles.error]}>{message}</Text>;
  }

  // 'done'
  const endpointCount = status.summary.endpoints.length;
  const recordCount = status.summary.endpoints.reduce((sum, e) => sum + e.recordsSynced, 0);
  return (
    <Text style={styles.text}>
      Synced {recordCount} record{recordCount === 1 ? '' : 's'} across {endpointCount} endpoint{endpointCount === 1 ? '' : 's'}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.textSecondary,
    fontSize: 12,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  error: {
    color: colors.negative,
  },
});
