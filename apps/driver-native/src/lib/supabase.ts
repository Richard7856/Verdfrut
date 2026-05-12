// Cliente Supabase para la app native del chofer.
//
// Diferencias vs el cliente de las apps web (@tripdrive/supabase):
//   - Usa AsyncStorage en lugar de cookies para persistir la sesión.
//   - Imports vienen directos de @supabase/supabase-js (sin abstracciones SSR).
//   - URL polyfill para que `fetch` funcione bien en React Native.
//
// Las credenciales se leen de `extra` en app.json al build time vía
// Constants.expoConfig.extra. En dev se pueden override con .env local.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import 'react-native-url-polyfill/auto';

// Variables expuestas via app.json `extra` (set en build time por EAS Secrets
// o env local). En N1 esperamos override manual; en N2+ migramos a EAS Secrets.
const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const SUPABASE_URL =
  extra.supabaseUrl ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  '';
const SUPABASE_ANON_KEY =
  extra.supabaseAnonKey ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // En vez de throw, log claro — el form de login mostrará "credenciales
  // no configuradas" en lugar de crash del bundle.
  console.warn(
    '[supabase] Faltan SUPABASE_URL o SUPABASE_ANON_KEY. Configura via EAS Secrets ' +
      'o EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY en .env local.',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native deeplinks vienen como tripdrive:// — no se procesan por URL del browser.
    detectSessionInUrl: false,
  },
});
