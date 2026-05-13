// Config dinámica que extiende app.json con valores leídos de env vars.
//
// ¿Por qué este archivo además de app.json?
//   La Google Maps API key no debe vivir en repo (es un secret, aunque restringido
//   por SHA-1 en producción). Expo prioriza app.config.js > app.json si ambos
//   existen, así que partimos de la config estática (`config` argument que viene
//   de app.json) y le inyectamos campos dinámicos.
//
// En local: define las vars en `.env.local` y Expo CLI las carga.
// En EAS Build: usar EAS Secrets (`eas secret:create`).
//
// Vars esperadas:
//   GOOGLE_MAPS_ANDROID_API_KEY  → para que react-native-maps con PROVIDER_GOOGLE
//                                  renderice tiles (Maps SDK for Android).
//   EXPO_PUBLIC_SUPABASE_URL     → ya en supabase.ts (cliente).
//   EXPO_PUBLIC_SUPABASE_ANON_KEY → idem.
//
// El cliente Supabase tradicionalmente lee de process.env (EXPO_PUBLIC_*) directo,
// pero también soporta extra.* para builds. Duplicamos extra.* aquí para que
// funcione el patrón Constants.expoConfig.extra que ya usa src/lib/supabase.ts.

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '',
      },
    },
  },
  // Plugins de Expo que requieren native config. expo-location pide locationPermission
  // strings que Android muestra al usuario al solicitar permisos foreground/background.
  // El plugin también enlaza el ForegroundService con expo-location automáticamente.
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'TripDrive necesita tu ubicación para compartirla con tu supervisor mientras tu ruta está activa.',
        locationAlwaysPermission:
          'TripDrive sigue tu posición durante la ruta para que el supervisor te vea moverse. Se apaga al terminar la jornada.',
        locationWhenInUsePermission:
          'TripDrive usa tu ubicación para confirmar que llegaste a cada tienda.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-notifications',
      {
        // Icono que Android muestra en la status bar (debe ser PNG blanco
        // transparente — el sistema lo tintea). Si falta, usa el icono default.
        icon: './assets/adaptive-icon.png',
        color: '#34c97c',
      },
    ],
  ],
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
});
