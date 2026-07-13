import { render } from '@testing-library/react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import { DatabaseReactContext } from '../../hooks/DatabaseContext';
import { SyncProvider } from '../../hooks/SyncContext';
import { DashboardScreen } from '../DashboardScreen';
import type { SqliteDatabase } from '../../db/Database';

describe('DashboardScreen', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('renders all four panel cards against an empty (never-synced) database', async () => {
    const { getByText } = await render(
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <DatabaseReactContext.Provider value={db}>
          <SyncProvider>
            <DashboardScreen />
          </SyncProvider>
        </DatabaseReactContext.Provider>
      </SafeAreaProvider>,
    );
    expect(getByText('Continuous Vitals')).toBeTruthy();
    expect(getByText('Sleep Hypnogram')).toBeTruthy();
    expect(getByText('Cadence & Efficiency')).toBeTruthy();
    expect(getByText('Insights')).toBeTruthy();
  });
});
