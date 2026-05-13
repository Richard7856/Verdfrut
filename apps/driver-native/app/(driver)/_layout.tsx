import { Stack } from 'expo-router';
import { useOutboxWorker } from '@/hooks/useOutboxWorker';
import { usePushRegistration } from '@/hooks/usePushRegistration';

export default function DriverLayout() {
  // Worker singleton del outbox — arranca con el primer mount del layout
  // (después del login) y se detiene en signOut.
  useOutboxWorker();
  // Registra el Expo push token del device para que el supervisor lo alcance.
  // Si falla (permiso denegado, emulador, etc.) NO bloquea el resto de la app.
  usePushRegistration();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: '#1d2521' },
        headerTintColor: '#f1f3f0',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="route" />
      <Stack.Screen name="stop/[id]/index" />
      <Stack.Screen name="stop/[id]/evidence" />
      <Stack.Screen name="stop/[id]/chat" />
    </Stack>
  );
}
