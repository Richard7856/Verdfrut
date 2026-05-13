# Stream B — Migración a App Nativa (Android-only, Expo)

> Plan detallado para reemplazar el PWA driver actual (`apps/driver`) por
> una app Android nativa construida con Expo + React Native.
>
> **Plataformas en V1**: **solo Android (APK + Play Store)**.
> **iOS**: pospuesto post-cutover. Decisión 2026-05-12: 95% choferes del
> primer cliente son Android, el otro 5% puede conseguir Android. No vale
> la pena el costo de Apple Developer + review process en esta etapa.
>
> **Estado**: 🔴 Próximo a arrancar (espera confirmación de decisiones).
> **Owner**: Richard + Claude.
> **No tiene timeline** — se mide por metas (Definition of Done) por fase.

---

## 0. Por qué migramos

Quejas del usuario sobre el PWA actual:
1. "Tarda mucho en cargar" — Mapbox GL JS bundle 750 KB + tiles HTTP.
2. "Se ve genérico" — estilo Mapbox default no compite vs Waze/Google.
3. iOS Safari mata `watchPosition` al bloquear pantalla (#31 KNOWN_ISSUES).
4. Push web limitado vs push nativo (UX inconsistente entre Android/iOS).
5. APK Bubblewrap TWA tiene problemas de validación assetlinks.

**La migración a nativa resuelve los 5 al mismo tiempo**. Además:
- App nativa = signal de seriedad para vender a clientes enterprise.
- Permite OTA updates (push de fixes sin re-publicar en stores).
- Permite background tasks reales (GPS, sync, alarms).

---

## 1. Stack confirmado

```
Frontend       Expo SDK 53+ (managed workflow)
Lenguaje       TypeScript estricto
Plataforma     Android únicamente (APK + Play Store)
UI             React Native + nativewind (Tailwind para RN)
Maps           react-native-maps con PROVIDER_GOOGLE (Google Maps nativo Android)
Navigation     Expo Router (file-based, similar a Next.js App Router)
Storage        expo-sqlite (outbox/queue) + AsyncStorage (preferences)
GPS            expo-location con background task + foreground service Android
Camera         expo-camera + expo-image-picker
Push           expo-notifications (FCM Android)
Build          EAS Build (Expo Application Services)
Updates OTA    EAS Update (push de JS bundle sin re-publicar APK)
Backend conn   Supabase JS SDK (compartido con web)
Validation     Zod (compartido con packages/types)
```

### Por qué Android-only en V1

- 95% choferes del primer cliente operan Android.
- Costo Apple Developer Program ($99/año) + review process (1-3 semanas
  por submission) = bloqueo innecesario para esta etapa.
- Expo permite agregar iOS más tarde con cambios mínimos (mismo código RN,
  solo agregar `eas build --platform ios` cuando se decida).
- Sideload de APK es trivial en Android (WhatsApp → instalar), no requiere
  store hasta Fase N8.
- Si entra un cliente con flota mixta Android+iOS, se evalúa iOS entonces.

### Por qué Expo y no React Native bare

- **Managed workflow** te evita pelearte con CocoaPods, Xcode signing, Gradle.
- **EAS Build** compila en cloud (no necesitas Mac para iOS).
- **EAS Update** permite hotfix sin re-submit a stores.
- **Expo modules** cubren 95% de native APIs sin escribir Swift/Kotlin.
- Si en algún momento Expo limita, podés **eject a bare**. Camino sin lock-in.

### Por qué `react-native-maps` y no `@rnmapbox/maps`

- `react-native-maps` con `PROVIDER_GOOGLE` usa el SDK nativo de Google
  embebido en el dispositivo. **Costo = $0** para visualización.
- Mapbox Native SDK cobra por MAU (~$0.50/1000 monthly active users).
- Para overview de paradas (lo único que la app native muestra como mapa),
  Google nativo se ve familiar al chofer y no tiene costo.
- Si después se necesita styling avanzado o tiles offline custom, se migra
  a Mapbox sin tocar lógica de negocio.

---

## 2. Arquitectura

```
apps/driver-native/                ← nuevo monorepo workspace
├── app.json                       ← Expo config (bundle id, splash, etc.)
├── eas.json                       ← EAS Build config
├── package.json
├── tsconfig.json
├── app/                           ← Expo Router (file-based routing)
│   ├── _layout.tsx                ← Root layout (auth gate, theme)
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (driver)/
│   │   ├── _layout.tsx            ← Bottom tab layout
│   │   ├── route.tsx              ← "Mi ruta del día"
│   │   ├── stop/[id].tsx          ← Detalle de parada
│   │   ├── stop/[id]/evidence.tsx ← Cámara + OCR
│   │   ├── stop/[id]/chat.tsx     ← Chat con supervisor
│   │   └── settings.tsx
│   └── +not-found.tsx
├── src/
│   ├── components/
│   │   ├── map/RouteMap.tsx
│   │   ├── stop/StopCard.tsx
│   │   ├── stop/NavigateButton.tsx (lanza intent Google Maps/Waze)
│   │   ├── camera/EvidenceCapture.tsx
│   │   └── chat/...
│   ├── lib/
│   │   ├── auth.ts                ← Supabase auth wrapper
│   │   ├── supabase.ts            ← Client factory native
│   │   ├── location.ts            ← GPS background task
│   │   ├── outbox.ts              ← SQLite queue para offline
│   │   ├── push.ts                ← Push registration + handlers
│   │   └── ocr.ts                 ← Claude Vision wrapper
│   ├── hooks/
│   │   ├── useRoute.ts
│   │   ├── useNextStop.ts
│   │   ├── useGpsTracking.ts
│   │   └── useOutboxSync.ts
│   └── types/                     ← re-exports de @tripdrive/types
├── assets/
│   ├── icon.png                   ← 1024x1024 (genera todos los tamaños)
│   ├── splash.png                 ← 1284x2778 (iPhone Pro Max)
│   ├── adaptive-icon.png          ← 1024x1024 (Android adaptive)
│   └── notification-icon.png
└── README.md
```

### Comparte con el monorepo

- `@tripdrive/types` → directo, sin cambios.
- `@tripdrive/supabase` → Supabase JS funciona idéntico en RN.
- `@tripdrive/ai` → wrapper Claude Vision se reutiliza.
- `@tripdrive/utils` → fechas, GPS helpers, validaciones.
- `@tripdrive/flow-engine` → cuando se refactorice a data-driven (Stream A
  Fase 5), los steps se renderizan en RN también.

### NO se comparte con web

- Components UI (RN tiene `<View>`, `<Text>`, no `<div>`).
- Estilos (RN no usa CSS; usa StyleSheet o nativewind).
- Routing (Expo Router vs Next.js App Router — similares pero distintos).

---

## 3. Fases (Definition of Done)

### Fase N1 — Setup + Auth + Scaffold ✅ DONE 2026-05-12 (ADR-075)

**Meta**: la app arranca en un dispositivo Android. Chofer puede hacer login
con su email/password de Supabase y ve una pantalla vacía "Mi ruta del día".

**DoD**:
- [ ] `apps/driver-native/` creado con Expo SDK 53.
- [ ] `pnpm-workspace.yaml` incluye nueva app.
- [ ] EAS configurado (`eas.json` con development + preview profiles, **solo Android**).
- [ ] Bundle ID Android: `xyz.tripdrive.driver`.
- [ ] Logo + splash screen + adaptive icon generados desde `tripdrive-icon.png`.
- [ ] Pantalla `/login` funcional con Supabase auth.
- [ ] Pantalla `/route` placeholder ("Tu ruta del día — pronto").
- [ ] Build de desarrollo (`eas build --profile development --platform android`)
      genera APK instalable en 1 dispositivo Android via `adb install` o
      WhatsApp sideload.
- [ ] README con instrucciones de setup local.

**Documentación entregable**:
- ADR-067: stack y razones de Expo + decisión Android-only V1.
- `apps/driver-native/README.md` con setup.

**Riesgos**:
- EAS Build cuenta no creada → bloqueante. Crear primero (free tier suficiente
  para 30 builds/mes Android, alcanza para iteración).
- Bundle ID conflicto con APK Bubblewrap actual (`com.verdfrut.driver`).
  Mitigación: usar bundle ID nuevo `xyz.tripdrive.driver`. APK actual queda
  como "app legacy" que se desinstala al cutover.

---

### Fase N2 — Pantalla "Mi ruta del día" ✅ DONE 2026-05-12 (ADR-076)

**Meta**: chofer logueado ve la lista de sus paradas del día con mini-mapa
arriba mostrando todas. Pull-to-refresh recarga datos. Offline muestra
último estado cacheado.

**DoD**:
- [x] Queries duplicadas en `src/lib/queries/route.ts`: `getDriverRouteForDate`,
      `getRouteStopsWithStores`, `getRouteDepot`, `getDriverRouteBundle`.
- [x] Mapa con `react-native-maps` + `PROVIDER_GOOGLE`:
  - Pin azul = pending, amarillo = arrived, verde = completed, gris = skipped.
  - Pin morado para CEDIS/depot.
  - Bounds auto-ajustadas (`fitToCoordinates`).
  - Tap en pin → scroll a esa parada + resaltado verde.
- [x] Lista debajo del mapa con StopCard por cada parada:
  - Número de secuencia con badge circular.
  - Código + nombre tienda + dirección.
  - ETA (hora estimada de llegada).
  - Status pill con color por status.
  - Tap → highlight (navegación a `/stop/[id]` queda para N3).
- [x] Pull-to-refresh con `RefreshControl`.
- [x] Skeleton screen mientras carga (sin cache).
- [x] Sin conexión: muestra último cache + banner "📡 Datos en cache".
- [x] Header: brand + fecha localizada + progreso N/M + logout.
- [x] Empty state "Sin ruta asignada" con retry.
- [x] Type-check del workspace verde (`@types/react` bumpeado a ~19.2.0).
- [x] `app.config.js` que extiende `app.json` para inyectar API keys desde env.

**Documentación entregable**:
- [x] ADR-076: queries duplicados, cache stale-while-revalidate, mapa nativo.

**Pendientes operativos del user (no-bloqueantes para development local)**:
- Habilitar **Maps SDK for Android** en GCP Console para la API key actual
  (hoy tiene Routes + Geocoding). Sin esto el mapa renderiza gris pero
  funcional (pines y bounds visibles sobre fondo placeholder).
- Crear `.env.local` en `apps/driver-native/` con:
  ```
  GOOGLE_MAPS_ANDROID_API_KEY=...
  EXPO_PUBLIC_SUPABASE_URL=https://hidlxgajcjbtlwyxerhy.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=...
  ```
- Cuando se buildee con EAS para preview/production, mover a EAS Secrets
  (issue #168, ya documentado).

**Riesgos resueltos / aceptados**:
- Performance con 30+ pines: mitigado con `tracksViewChanges={false}`.
  Clustering deferred a issue #174 si reportan lag.
- Cache stale: banner amarillo lo marca visualmente; invalidación por push
  entra en N5 (issue #177).

---

### Fase N3 — Detalle parada + Navegación + GPS background ✅ DONE 2026-05-12 (ADR-077, ADR-078)

**Meta**: chofer abre detalle de una parada y ve toda la info. Tap "Navegar"
abre Waze o Google Maps con la dirección. Durante la ruta, GPS background
trackea posición y persiste breadcrumbs cada 30s para que el supervisor lo vea.

**DoD**:
- [x] Pantalla `/stop/[id]` con:
  - Código + nombre + dirección + ventana horaria.
  - Demanda (kg + cajas si disponible).
  - ETA planeada + llegada real (si arrived/completed).
  - Contacto tappeable (`tel:` URI).
  - Botón **"Navegar"** primary → Waze → geo: picker → fallback HTTP.
  - Botón "Marcar llegada" con validación geo client-side (radius 300m).
  - Botón "Reportar entrega" placeholder → alert "Próximamente (Fase N4)".
  - Banner warning si `coord_verified=false`.
  - Notas del dispatcher si existen.
- [x] GPS background task con `expo-location` + `expo-task-manager`:
  - Pide permisos foreground + background con prompts del sistema.
  - Sólo activo cuando `route.status === 'IN_PROGRESS'` Y `driverId` presente.
  - Persiste a `route_breadcrumbs` cada 30s (sin broadcast Realtime — diff
    vs web documentado en ADR-077).
  - Foreground service Android obligatorio (Android 12+ requirement).
  - Auto-detiene al `signOut`.
- [x] Foreground service Android con copy "TripDrive — siguiendo tu ruta".
- [x] Indicador GPS en `RouteHeader` (verde activo / rojo denegado / amarillo failed).
- [x] Wire de tap en StopCard → `router.push('/(driver)/stop/[id]')`.
- [x] `signOut` apaga el GPS task + limpia cache del usuario saliente.
- [x] `app.config.js` configurado con plugin expo-location + permission strings.
- [x] Type-check del workspace verde.

**Documentación entregable**:
- [x] ADR-077: GPS bg + validación arrival client-side.
- [x] ADR-078: deeplink strategy Waze→geo:→HTTP.

**Pendientes operativos del user** (no-bloqueantes para development):
- Conceder permiso `ACCESS_BACKGROUND_LOCATION` al primer prompt (Android lo
  pide en 2 pasos: foreground primero, luego "Permitir todo el tiempo" en
  Settings).
- Rebuild EAS dev client: agregamos native modules (expo-location,
  expo-task-manager) — el bundle JS solo no alcanza, hay que regenerar APK
  con `pnpm build:android` y reinstalar.

**Deferred (issues abiertos)**:
- Geofencing auto-arrival → issue #181.
- Realtime broadcast sobre breadcrumbs (live view supervisor) → issue #180.
- Migrar `markArrived` a Edge Function + detectar `mock_location` → issue #179.
- Doc por marca de cómo deshabilitar battery optimization → issue #182.

---

### Fase N4 — Evidencia: cámara + OCR + offline queue ✅ DONE 2026-05-12 (ADR-079, ADR-080)

**Meta**: chofer captura foto del exhibidor + ticket, opcionalmente OCR
extrae datos, marca merma/incidente, encola al outbox SQLite que sincroniza
en background. Single-screen, no wizard.

**DoD**:
- [x] Pantalla `/stop/[id]/evidence` single-screen con secciones:
  - Foto exhibidor (required, bucket `evidence` público).
  - Foto ticket (required, bucket `ticket-images` privado) + OCR opcional
    + editor de campos (número/fecha/total) + toggle "datos verificados".
  - Switch "¿Hubo merma?" → foto + descripción opcional.
  - Switch "¿Otro incidente?" → descripción libre.
  - Botón "Enviar entrega" → encola + vuelve a `/route`.
- [x] OCR vía proxy: `POST /api/ocr/ticket` en `apps/platform/` con auth JWT,
  rate limit 30/h/chofer, delega a `extractTicketFromImageUrl` de `@tripdrive/ai`.
- [x] Outbox SQLite (`expo-sqlite`) con tabla `outbox`:
  - 1 sola op type: `submit_delivery`.
  - Worker singleton con polling 30s + kick por NetInfo.
  - Backoff exponencial (5s · 30s · 5min · 30min, cap 1h).
  - Max 10 attempts antes de dead-letter.
  - Idempotente: uploads usan timestamp determinístico,
    `delivery_reports` UNIQUE(stop_id) maneja duplicates como already-applied.
- [x] Fotos persistidas a `documentDirectory/outbox/{opId}/{slot}.jpg`
  (no cacheDirectory que el OS puede limpiar).
- [x] Compresión con `expo-image-manipulator` a 1600px lado largo + JPEG 78%.
- [x] Indicador outbox en `RouteHeader` (azul "N pendientes" / amarillo "N con error").
- [x] `signOut` apaga el worker (mantiene SQLite — el siguiente login reanuda).
- [x] Auto-promueve ruta a `COMPLETED` cuando todas las stops están done.
- [x] Type-check del workspace verde.

**Documentación entregable**:
- [x] ADR-079: OCR proxy via platform (no key en bundle).
- [x] ADR-080: Outbox SQLite + single-screen.

**Pendientes operativos del user** (no-bloqueantes para desarrollo local):
- **`ANTHROPIC_API_KEY` en Vercel del platform** (pendiente desde Sprint H1).
  Sin esto el endpoint OCR devuelve 503 y la UI degrada a entrada manual.
- **Rebuild EAS dev client** — agregamos `expo-sqlite`, `expo-image-picker`,
  `expo-image-manipulator`, `expo-file-system`, `@react-native-community/netinfo`.
- **Verificar buckets `evidence` y `ticket-images` existen en Supabase** —
  migración `00000000000008_storage_buckets.sql` ya los crea desde Sprint 8.

**Deferred a N4-bis (issues abiertos)**:
- `type='tienda_cerrada'` + `type='bascula'` → issue #190.
- `incident_cart` con chat al supervisor → issue #191 (N5).
- `IncidentDetail[]` por SKU UI → issue #192.
- Edit-after-submit → issue #193.
- Compresión defensiva con timeout → issue #194.
- Notificar supervisor de dead-letter → issue #195.
- Sweep de huérfanos al worker init → issue #196.

### Fase N5 — Chat con supervisor + push nativas ✅ DONE 2026-05-12 (ADR-081, ADR-082)

**Meta**: chofer chatea con supervisor en tiempo real desde la app native.
Cuando el chofer envía, el supervisor recibe push en su web (y vice versa
cuando un chofer-web manda — el chofer-native no recibe pushes del supervisor
todavía, eso es issue #202).

**DoD**:
- [x] Migración SQL `00000000000034_push_subscriptions_expo.sql` — agrega
  `platform` + `expo_token` con CHECK constraints. Backward-compatible.
- [x] Native `src/lib/push.ts` — `registerPushAsync` + `unregisterPushAsync`
  con `expo-notifications` + upsert a `push_subscriptions`.
- [x] Native `useChatRealtime` con `postgres_changes` filter por report_id
  + refetch on AppState active.
- [x] Native `/stop/[id]/chat` pantalla estilo WhatsApp con bubbles diferenciadas,
  KeyboardAvoidingView, auto-scroll, send con feedback de error.
- [x] Native `sendMessage` action — insert directo via Supabase con RLS.
- [x] Native `usePushRegistration` hook montado en `(driver)/_layout.tsx`.
- [x] Native: botón "Chat con supervisor" en `/stop/[id]/index` (sólo si
  stop completed/skipped — i.e. hay delivery_report).
- [x] Web `push-fanout.ts` extendido para enviar a Expo tokens vía
  `@expo/expo-server-sdk` además de Web Push. Idempotente: `DeviceNotRegistered`
  → borra el row.
- [x] `signOut` desregistra el token del device.
- [x] `app.config.js` con plugin `expo-notifications` + icon/color.
- [x] Type-check del workspace verde (con `Database` type extendida con los
  campos nuevos pendientes de aplicar migration en DB real).

**Documentación entregable**:
- [x] ADR-081: tabla compartida web+expo + fanout dividido.
- [x] ADR-082: chat native con insert directo (sin AI mediator).

**Pendientes operativos del user**:
- **Aplicar la migración** `00000000000034_push_subscriptions_expo.sql` —
  pendiente porque CLAUDE.md restringe `apply_migration` MCP sin OK
  explícito. Aplicar via MCP o `supabase db push` cuando esté listo.
- **Rebuild EAS dev client** — agregamos `expo-notifications` + `expo-device`
  (native modules). Sin rebuild, registerPushAsync devuelve `token_failed`.
- **Configurar EAS projectId** — `pnpm eas:configure` reemplaza el placeholder
  `PENDING_EAS_PROJECT_ID` con el real. Sin esto, push tokens fallan.
- **`expo-server-sdk` requerirá deploy del web driver** — el push-fanout
  cambió. Vercel re-deploy del `tripdrive-driver` (Next 16). El platform NO
  necesita re-deploy.

**Deferred a N5-bis (issues abiertos)**:
- AI mediator desde native (proxy endpoint) → issue #197.
- Push fanout cuando native envía mensaje (al supervisor) → issue #198.
- Imagen en chat → issue #199.
- Push handler deeplink → issue #201.
- Push supervisor → chofer (nativos) → issue #202.
- Tipos de push (chat_new, route_updated, etc.) → issue #203.
- Outbox para mensajes de chat → issue #204.
- Presence/typing indicator → issue #205.
- Marcar chat como `driver_resolved` desde native → issue #206.

**Meta**: chofer chatea con zone_manager en tiempo real. Push notifications
nativas (FCM/APNS) al supervisor cuando hay nuevo mensaje. AI mediator de
Claude clasifica mensajes y auto-responde triviales.

**DoD**:
- [ ] Pantalla `/stop/[id]/chat` con UI tipo WhatsApp.
- [ ] Mensajes via `messages` table con Supabase Realtime.
- [ ] Foto en chat (reuse de `evidence` capture).
- [ ] Push registration con `expo-notifications`:
  - Token guardado en `push_subscriptions` con `platform: 'expo'`.
  - Backend (Edge Function) envía via Expo Push API (gateway a FCM/APNS).
- [ ] Push handler: tap en notif → abre el chat correspondiente.
- [ ] AI mediator del chat (Claude Haiku) — reuse del `@tripdrive/ai`
      wrapper existente.

**Documentación entregable**:
- ADR-072: push provider migración (Web Push → Expo Push).

**Riesgos**:
- Expo Push gateway es free pero rate-limited (~100k/mes). Para escala mayor,
  migrar a FCM/APNS directo.
- iOS push requiere setup APNS key en developer.apple.com.

---

### Fase N6 — Beta interna con 1 chofer ⚪

**Meta**: 1 chofer real de NETO usa la app nativa durante 1 semana en
operación real. Reportes diarios de bugs/UX. Cero issues críticos al cierre
de semana.

**DoD**:
- [ ] APK preview (`eas build --profile preview`) distribuida via WhatsApp
      al chofer beta.
- [ ] Chofer instala (sideload).
- [ ] Operación de 5 días laborales completos.
- [ ] Diario: capturas + comentarios del chofer (audio o texto).
- [ ] Bugs resueltos vía EAS Update (sin re-build).
- [ ] Métricas: # crashes (objetivo 0), # bugs P1 (objetivo <3), tiempo
      promedio carga inicial (<2s).

**Documentación entregable**:
- `BETA_REPORT_N6.md` con feedback del chofer + acciones tomadas.

**Riesgos**:
- Chofer rechaza la nueva app (UX worse que PWA). Mitigación: feedback
  diario, iteración rápida con EAS Update.
- Bug critical en producción real. Mitigación: PWA actual sigue disponible
  como fallback hasta cutover.

---

### Fase N7 — Play Internal Testing ⚪

**Meta**: app subida a Play Console en modo "Internal Testing". Equipo
TripDrive + 2-3 choferes adicionales pueden instalar vía link directo
de Play Internal Testing (no store público todavía).

**DoD**:
- [ ] Google Play Console activado ($25 USD una vez).
- [ ] Bundle ID Android `xyz.tripdrive.driver` registrado.
- [ ] Build de release con `eas build --profile production --platform android`.
- [ ] Generar **AAB** (Android App Bundle) en lugar de APK puro (Play
      Store requiere AAB desde 2021).
- [ ] Upload a Play Console (Internal Testing track).
- [ ] Listing básico: título, descripción corta, descripción larga,
      ícono 512×512, feature graphic 1024×500.
- [ ] Screenshots: 2-8 capturas del dispositivo Android.
- [ ] Privacy policy URL (vive en landing tripdrive.xyz/privacy).
- [ ] Data Safety form completado (declarar qué datos usa la app:
      ubicación, fotos, identificadores).
- [ ] Beta testers invitados via email (lista hasta 100 personas).

**Documentación entregable**:
- `RELEASE_CHECKLIST.md` con pasos de submit a Play Store.

**Riesgos**:
- Google Play review primera vez puede tardar 7-14 días (después es ~24h
  por update). Mitigación: empezar pronto.
- Data Safety mal declarado = rechazo. Mitigación: revisar manifest y
  declarar TODO lo que se usa (location ALWAYS, camera, foreground service).
- Background location justification requiere consent screen explícito al
  chofer. Mitigación: prompt claro "Necesitamos tu ubicación cuando estás
  en ruta para que tu supervisor pueda verte en el mapa".

---

### Fase N8 — Publish Play Store ⚪

**Meta**: app descargable desde Google Play Store por cualquier chofer
con el link.

**DoD**:
- [ ] Promote de Internal Testing → Production en Play Console.
- [ ] Google aprueba (típicamente 1-3 días post-internal-testing).
- [ ] URL pública funciona:
  - `https://play.google.com/store/apps/details?id=xyz.tripdrive.driver`
- [ ] Landing actualizada con badge "Disponible en Google Play".
- [ ] Apple Store: **NO aplica en V1** — pospuesto.

**Riesgos**:
- Google puede pedir cambios menores. Mitigación: responder rápido,
  EAS Update permite hotfix sin re-submit.
- App rechazada por background location → revisar Permissions Declaration
  Form en Play Console. Justificación: tracking de chofer durante turno
  laboral con consent visible.

---

### Fase N9 — Cutover + deprecar PWA ⚪

**Meta**: todos los choferes activos están usando la native app. PWA
deprecada formalmente. Código `apps/driver` eliminado del repo.

**DoD**:
- [ ] Banner en PWA: "Esta app dejará de funcionar el [fecha]. Descarga
      la versión nueva: [link stores]".
- [ ] Comunicación a NETO supervisor: explicación del cambio.
- [ ] Cutover date establecido (mínimo 2 semanas post-publish).
- [ ] En cutover date:
  - Redirect 301 de `driver.tripdrive.xyz` a una landing simple con links a stores.
  - Repo: `apps/driver/` eliminado.
  - `mobile/driver-apk/` eliminado.
  - DOCS actualizados (PLATFORM_STATUS.md, KNOWN_ISSUES.md).
- [ ] Tag git `pwa-deprecated-2026-XX-XX`.

**Documentación entregable**:
- ADR-073: cutover y deprecation del PWA.

**Riesgos**:
- Chofer no actualiza a tiempo. Mitigación: aviso 2 semanas + WhatsApp
  directo + el supervisor presiona.
- Bugs ocultos en native que solo aparecen post-cutover. Mitigación:
  rollback plan = revertir DNS de `driver.tripdrive.xyz` al PWA viejo
  durante 1 semana de gracia.

---

## 4. Costos durante Stream B (Android-only)

| Item | Costo | Cuándo se paga |
|---|---|---|
| Apple Developer Program | ~~$99 USD/año~~ | **NO APLICA V1** |
| Google Play Console | $25 USD (una vez) | Antes de Fase N7 |
| EAS Build (Free tier hasta 30 builds/mes Android) | $0 | Free tier alcanza para iteración inicial |
| EAS Build (Production tier si free no alcanza) | $29 USD/mes | Solo si excede free tier |
| Google Maps Platform | ~$0/mes (Android nativo gratis) | N3 |
| Push notifications (Expo) | $0 (gratis hasta 100K/mes) | N5 |
| **Total recurrente** | **$0-$29 USD/mes** | |
| **Total setup** | **$25 USD una vez** | |

**Ahorros vs plan original** (con iOS): -$99/año + ~$8/mes promedio.

---

## 5. Decisiones pendientes antes de N1

| # | Decisión | Default |
|---|---|---|
| 1 | Bundle ID Android | `xyz.tripdrive.driver` |
| 2 | Nombre visible en Play Store | "TripDrive Conductor" |
| 3 | Icon: usar `tripdrive-icon.png` actual o diseñar nuevo | Usar actual primero, redesign opcional |
| 4 | Splash screen: ícono o lockup completo | Ícono centrado + background dark `--vf-bg` |
| 5 | Estilo de mapa: dark / light / system | System (auto follow OS) |
| 6 | Compartir packages workspace via symlinks o npm | Symlinks (workspace) — no agregar npm |

**iOS = pospuesto V1**: cuando un cliente con flota iOS aparezca, evaluamos.
Mientras tanto, todo el código es portable (Expo soporta ambos sin cambios
de lógica).

---

## 6. Cómo medimos éxito de Stream B

KPIs al cierre (post Fase N9):

| KPI | Objetivo | Cómo medimos |
|---|---|---|
| Tiempo de carga inicial | <2s en 4G | Performance API en native |
| Crash-free rate | >99.5% | Sentry mobile |
| Tasa de adopción post-cutover | 100% choferes activos | Login analytics |
| Satisfacción chofer (encuesta) | ≥8/10 | WhatsApp survey post-1-mes |
| Reducción de issues "se cae app" | -80% vs PWA | Comparativa Sentry mensual |
| Tickets soporte "no carga" | -90% vs PWA | Tracking manual |

---

## 7. Plan de comunicación al usuario final (chofer)

- **Pre-cutover (-2 semanas)**: banner en PWA + WhatsApp del supervisor.
- **Cutover day**: redirect del PWA a landing de descarga.
- **Post-cutover (semana 1)**: WhatsApp del supervisor para resolver dudas.
- **Post-cutover (mes 1)**: encuesta de satisfacción.

Tono: "Mejoramos tu app para que cargue más rápido y se vea como Waze."
NO técnico ("migramos de PWA a React Native"). El chofer no necesita
saber qué es PWA.
