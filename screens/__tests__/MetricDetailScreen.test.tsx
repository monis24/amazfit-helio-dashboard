import { render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import { DatabaseReactContext } from '../../hooks/DatabaseContext';
import { todayLocalDate } from '../../hooks/localDateRange';
import { MetricDetailScreen } from '../MetricDetailScreen';
import type { RootStackParamList } from '../../navigation/types';
import type { SqliteDatabase } from '../../db/Database';

const Stack = createNativeStackNavigator<RootStackParamList>();
const TODAY = todayLocalDate();
const SOURCE = 111;

function deviceTzOffsetSeconds(): number {
  return -new Date().getTimezoneOffset() * 60;
}

function wrapperFor(db: SqliteDatabase, metric: 'hr' | 'stress') {
  return function Wrapper() {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <DatabaseReactContext.Provider value={db}>
          <NavigationContainer>
            <Stack.Navigator initialRouteName="MetricDetail">
              <Stack.Screen name="Dashboard">{() => <Text>dashboard placeholder</Text>}</Stack.Screen>
              <Stack.Screen name="MetricDetail" component={MetricDetailScreen} initialParams={{ metric, date: TODAY }} />
            </Stack.Navigator>
          </NavigationContainer>
        </DatabaseReactContext.Provider>
      </GestureHandlerRootView>
    );
  };
}

describe('MetricDetailScreen', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('shows the HR chart title and an empty-state message when no data is synced', async () => {
    const Wrapper = wrapperFor(db, 'hr');
    const { getByText } = await render(<Wrapper />);
    await waitFor(() => expect(getByText('Heart rate (bpm)')).toBeTruthy());
    expect(getByText(/No heart-rate data/)).toBeTruthy();
  });

  it('shows the stress chart title for the stress metric', async () => {
    const Wrapper = wrapperFor(db, 'stress');
    const { getByText } = await render(<Wrapper />);
    await waitFor(() => expect(getByText('Stress (device-computed, 0-100)')).toBeTruthy());
  });

  it('renders real HR data for the selected day instead of the empty state', async () => {
    const hrMinutes = new Uint8Array(1440).fill(70);
    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      [TODAY, SOURCE, 'dev1', deviceTzOffsetSeconds(), hrMinutes],
    );

    const Wrapper = wrapperFor(db, 'hr');
    const { queryByText } = await render(<Wrapper />);
    await waitFor(() => expect(queryByText(/No heart-rate data/)).toBeNull());
  });
});
