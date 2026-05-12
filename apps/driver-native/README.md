# @tripdrive/driver-native

App nativa Android del chofer TripDrive. Construida con Expo + React Native.

**Estado**: Fase N1 (scaffold + login + placeholder). Ver `STREAM_B_NATIVE_APP.md`
en el root del repo para roadmap completo.

**Plataforma**: Android únicamente en V1. iOS pospuesto (ver ADR-075 + ADR-067).

---

## Setup local

### Pre-requisitos

- Node 22+ (mismo que el resto del monorepo).
- pnpm 9.12+ (ya instalado para monorepo).
- Android Studio + Android SDK (para `expo run:android` local).
  - O dispositivo Android físico con USB debugging activado.
- EAS CLI: `npm install -g eas-cli` (solo si vas a hacer builds en cloud).
- Cuenta Expo (free tier alcanza para iteración).

### Instalación

Desde el root del monorepo:

```bash
pnpm install
```

### Variables de entorno

Crear `apps/driver-native/.env.local` (NO commitear):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://hidlxgajcjbtlwyxerhy.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key-del-tenant>
```

En producción, las credenciales se setean via EAS Secrets (`eas secret:create`)
para que viajen al build sin estar en el repo.

### Correr en desarrollo

```bash
cd apps/driver-native

# Opción A: Expo Go (sin native modules custom, más rápido)
pnpm start
# Escanea el QR con la app "Expo Go" en tu Android. Limitación: NO soporta
# expo-location background ni expo-camera avanzado.

# Opción B: Development Build (con todos los native modules)
pnpm build:android   # ~10 min primer build, cloud EAS
# Te genera APK descargable. Instalas via "Install" de Android.
pnpm start --dev-client
# Abre la app instalada y conecta al Metro de tu máquina.
```

### Build de preview (para entregar a 1 chofer)

```bash
pnpm build:preview
# Output: URL de descarga de APK. Compártela por WhatsApp.
# El chofer instala y la app funciona standalone (no necesita Metro).
```

---

## Estructura

```
apps/driver-native/
├── app/                       — Expo Router (file-based)
│   ├── _layout.tsx           — Root layout + AuthGate
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── login.tsx         — Form email/password
│   ├── (driver)/
│   │   ├── _layout.tsx       — Layout con header dark
│   │   └── route.tsx         — Placeholder de "Mi ruta del día"
│   └── +not-found.tsx
├── src/
│   └── lib/
│       ├── supabase.ts       — Client native (AsyncStorage)
│       └── auth.ts           — useAuth() hook + sign in/out
├── assets/
│   ├── icon.png              — 1024×1024 master
│   ├── splash.png            — 1284×2778 background dark + icon
│   └── adaptive-icon.png     — 1024×1024 para Android adaptive
├── app.json                   — Expo config (bundle id, permissions)
├── eas.json                   — EAS Build profiles (dev/preview/prod)
├── babel.config.js
├── metro.config.js            — Soporte pnpm monorepo
└── tsconfig.json
```

---

## Decisiones técnicas clave

- **Expo SDK 53 managed workflow**: sin Xcode/CocoaPods, EAS compila en cloud.
- **Expo Router**: file-based routing similar a Next.js App Router.
- **AsyncStorage** para persistir sesión Supabase.
- **react-native-url-polyfill** para que `fetch` funcione en RN sin problemas.
- **Compartir packages** con monorepo (`@tripdrive/types`) via symlinks pnpm.
  Metro config tiene `watchFolders` para que detecte cambios.
- **Bundle ID Android**: `xyz.tripdrive.driver` (distinto del PWA legacy
  `com.verdfrut.driver` para evitar conflicto al instalar ambos).

---

## Próximas fases

Ver `STREAM_B_NATIVE_APP.md` en el root del repo:

- **N2**: Pantalla "Mi ruta del día" con mapa nativo (react-native-maps).
- **N3**: Detalle parada + deeplink Google Maps/Waze + GPS background.
- **N4**: Cámara + OCR + offline queue.
- **N5**: Chat + push notifications nativas.
- **N6**: Beta interna con 1 chofer.
- **N7**: Play Internal Testing.
- **N8**: Play Store publish.
- **N9**: Cutover + deprecar PWA.

---

## Troubleshooting

### "Cannot find module @tripdrive/types"
Metro no resolvió el symlink del workspace. Verifica que `metro.config.js`
tenga `watchFolders` y `nodeModulesPaths` apuntando al workspace root.

### Login dice "credenciales no configuradas"
Faltan `EXPO_PUBLIC_SUPABASE_URL` o `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Crea
`.env.local` o setealas en EAS Secrets para builds cloud.

### Build EAS falla con "ANDROID_KEYSTORE_PATH"
Primera vez que buildeás: EAS te ofrece "Generate new keystore" — acepta.
Lo guarda en su cloud y lo reusa para todos los builds (debes usar la
MISMA cuenta EAS para no perder la firma).

### App no abre en Android 12+ después de instalar
Probablemente bloqueada por Permissions. Ve a Settings → Apps → TripDrive
→ Permissions → habilitá Ubicación, Cámara, Notificaciones.
