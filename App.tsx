import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DatabaseProvider } from './hooks/DatabaseContext';
import { SyncProvider } from './hooks/SyncContext';
import { DashboardScreen } from './screens/DashboardScreen';

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <DatabaseProvider>
          <SyncProvider>
            <DashboardScreen />
          </SyncProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
