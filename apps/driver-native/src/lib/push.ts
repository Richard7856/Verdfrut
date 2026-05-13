// Registro y manejo de push notifications nativas (Expo Notifications).
//
// Flujo (ADR-081):
//   1. Pide permiso al usuario (Android 13+ POST_NOTIFICATIONS).
//   2. Obtiene `ExpoPushToken` con el projectId de EAS.
//   3. Inserta/upsert en `push_subscriptions` con platform='expo' + role/zone
//      snapshot del user (mismas reglas que web push para que la fanout query
//      no diferencie por plataforma — el index por role+zone sirve a ambas).
//   4. Lo expone un listener para que el OS muestre la notif foreground.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// Cómo se muestran las notifs cuando la app está en foreground.
// Default: el OS las suprime. Forzamos que se vean como banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'permission_denied' | 'not_device' | 'token_failed' | 'persist_failed'; message: string };

/**
 * Ejecuta el flujo completo de registro. Idempotente — si ya hay token
 * registrado para este user+device, hace upsert (sin duplicar).
 *
 * Llamar en mount del (driver) layout (después de auth gate).
 */
export async function registerPushAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return {
      ok: false,
      reason: 'not_device',
      message: 'Las push notifications no funcionan en emulador.',
    };
  }

  // Permiso. Android 13+ (API 33) requiere POST_NOTIFICATIONS explícito.
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) {
    return {
      ok: false,
      reason: 'permission_denied',
      message: 'Permiso de notificaciones denegado.',
    };
  }

  // Android channel para que los pushes tengan importance alta + sonido.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'TripDrive',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#34c97c',
    });
  }

  // Token. Requiere projectId del EAS configurado en app.json/extra.
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId || projectId === 'PENDING_EAS_PROJECT_ID') {
    return {
      ok: false,
      reason: 'token_failed',
      message:
        'Falta projectId de EAS. Corre `pnpm eas:configure` para vincular el proyecto.',
    };
  }

  let tokenString: string;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    tokenString = token.data;
  } catch (err) {
    return {
      ok: false,
      reason: 'token_failed',
      message: err instanceof Error ? err.message : 'No se pudo obtener token de Expo.',
    };
  }

  // Resolver role + zone del user para snapshot en la tabla (igual que el web).
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return {
      ok: false,
      reason: 'persist_failed',
      message: 'Sesión expirada antes de persistir.',
    };
  }

  // user_profiles tiene role + zone_id. El chofer puede leer su propio profile.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, zone_id')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) {
    return {
      ok: false,
      reason: 'persist_failed',
      message: 'No se encontró tu perfil para registrar las notificaciones.',
    };
  }

  // Upsert: si ya existe (user_id, expo_token), no-op. Si no, insert.
  // El UNIQUE index parcial idx_push_user_expo_token garantiza idempotencia.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        platform: 'expo',
        expo_token: tokenString,
        role: (profile as { role: string }).role,
        zone_id: (profile as { zone_id: string | null }).zone_id,
        // Campos web-specific: NULL (la migración 034 permite).
        endpoint: null,
        p256dh: null,
        auth: null,
      },
      { onConflict: 'user_id,expo_token' },
    );

  if (error) {
    return {
      ok: false,
      reason: 'persist_failed',
      message: `No se pudo guardar el token: ${error.message}`,
    };
  }

  return { ok: true, token: tokenString };
}

/**
 * Suscribe a eventos del SO de notificación tappeada.
 * El callback recibe la data del payload — esperamos un { reportId, url? }.
 *
 * Devuelve el unsubscriber para que la pantalla lo limpie en desmount.
 */
export function addNotificationResponseListener(
  callback: (data: { reportId?: string; url?: string }) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response.notification.request.content.data ?? {}) as {
      reportId?: string;
      url?: string;
    };
    callback(data);
  });
  return () => sub.remove();
}

/**
 * Desregistra el token del backend. Se llama en signOut para que el supervisor
 * no le siga mandando push a un device que ya no usa este chofer.
 */
export async function unregisterPushAsync(): Promise<void> {
  try {
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId || projectId === 'PENDING_EAS_PROJECT_ID') return;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userData.user.id)
      .eq('expo_token', token.data);
  } catch (err) {
    console.warn('[push.unregister] falló (no es bloqueante):', err);
  }
}
