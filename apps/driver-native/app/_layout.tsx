// Root layout — auth gate + theme.
// Expo Router file-based: este es el wrapper de TODA la app.

import { Stack, Redirect, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/lib/auth';

// Side-effect import — TaskManager.defineTask debe ejecutarse top-level cuando
// el bundle carga, no en useEffect. Sin esto, el OS no encuentra la tarea
// cuando wakea el JS engine en background.
import '@/lib/gps-task';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthGate />
    </SafeAreaProvider>
  );
}

/**
 * Auth gate — si no hay sesión, redirige a (auth)/login.
 * Si hay sesión y el usuario está en (auth), redirige a (driver).
 * Mientras carga la sesión inicial, muestra spinner.
 */
function AuthGate() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const inAuthGroup = segments[0] === '(auth)';

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1d2521',
        }}
      >
        <ActivityIndicator size="large" color="#34c97c" />
      </View>
    );
  }

  // Casos:
  //  - sin sesión + fuera de (auth) → redirigir a login
  //  - con sesión + dentro de (auth) → redirigir a (driver)/route
  if (!session && !inAuthGroup) {
    return <Redirect href="/(auth)/login" />;
  }
  if (session && inAuthGroup) {
    return <Redirect href="/(driver)/route" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(driver)" />
    </Stack>
  );
}
