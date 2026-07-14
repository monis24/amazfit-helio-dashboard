import { StatusBar } from 'expo-status-bar';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DatabaseProvider } from './hooks/DatabaseContext';
import { SyncProvider } from './hooks/SyncContext';
import { DashboardScreen } from './screens/DashboardScreen';
import { MetricDetailScreen } from './screens/MetricDetailScreen';
import { colors } from './components/theme';
import type { RootStackParamList } from './navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.card,
    border: colors.cardBorder,
    text: colors.textPrimary,
  },
};

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <DatabaseProvider>
          <SyncProvider>
            <NavigationContainer theme={navigationTheme}>
              <Stack.Navigator>
                <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
                <Stack.Screen name="MetricDetail" component={MetricDetailScreen} />
              </Stack.Navigator>
            </NavigationContainer>
          </SyncProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
