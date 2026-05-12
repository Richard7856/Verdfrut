import { Stack } from 'expo-router';

export default function DriverLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1d2521' },
        headerTintColor: '#f1f3f0',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="route" options={{ title: 'Mi ruta del día' }} />
    </Stack>
  );
}
