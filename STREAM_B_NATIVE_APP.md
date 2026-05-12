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

### Fase N2 — Pantalla "Mi ruta del día" ⚪

**Meta**: chofer logueado ve la lista de sus paradas del día con mini-mapa
arriba mostrando todas. Pull-to-refresh recarga datos. Offline muestra
último estado cacheado.

**DoD**:
- [ ] Query `getDriverRouteForDate(date)` reutilizable (queries.ts del native).
- [ ] Mapa con `react-native-maps` + `PROVIDER_GOOGLE`:
  - Pin verde por parada con número de secuencia.
  - Pin azul para CEDIS/depot.
  - Bounds auto-ajustadas.
  - Tap en pin → scroll a esa parada en lista.
- [ ] Lista debajo del mapa con StopCard por cada parada:
  - Número de secuencia
  - Código + nombre tienda
  - Hora estimada de llegada
  - Estado (pending / arrived / completed / skipped)
  - Tap → navega a `/stop/[id]`.
- [ ] Pull-to-refresh con `RefreshControl`.
- [ ] Skeleton screen mientras carga.
- [ ] Sin conexión: muestra último cache + banner "Modo offline".
- [ ] Header: nombre chofer + fecha + logout.

**Documentación entregable**:
- ADR-068: estrategia de cache offline en native.

**Riesgos**:
- Google Maps API key requerida para `PROVIDER_GOOGLE`. Crear en GCP console,
  agregarla a `app.json` config.
- Performance con 50+ pins en mapa. Mitigación: clustering si pasa de 30.

---

### Fase N3 — Detalle parada + Navegación + GPS background ⚪

**Meta**: chofer abre detalle de una parada y ve toda la info. Tap "Navegar"
abre Waze o Google Maps con la dirección. Durante la ruta, GPS background
trackea posición y la sube a Supabase Realtime cada N segundos.

**DoD**:
- [ ] Pantalla `/stop/[id]` con:
  - Foto satelital de la tienda (Google Maps Static API).
  - Código + nombre + dirección.
  - Hora estimada + hora real (si llegó).
  - Demanda (kg, cajas).
  - Botón **"Navegar"** primary → lanza `geo:` URI con fallback a `https://google.com/maps/dir`.
  - Botón "Marcar llegada" → cambia status a `arrived`.
  - Botón "Reportar entrega" → navega a `/stop/[id]/evidence`.
- [ ] GPS background task con `expo-location`:
  - Pide permisos `BACKGROUND` y `ALWAYS`.
  - Solo activo cuando hay ruta `IN_PROGRESS`.
  - Reporta cada 8s a Supabase Realtime (canal `route:gps`).
  - Foreground service notification en Android (requerido por Android 12+).
- [ ] Foreground service Android con icono notification + texto "TripDrive
      tracking tu ruta".
- [ ] Auto-detection de llegada por geofencing (cuando chofer entra en
      radius 50m de la parada) → toast "Ya llegaste — marca llegada".

**Documentación entregable**:
- ADR-069: GPS background + foreground service.
- ADR-070: deeplink strategy (Waze/Google Maps).

**Riesgos**:
- iOS `Always` location permission requiere justificación en App Store review.
  Mitigación: copy claro en `app.json` `NSLocationAlwaysUsageDescription`.
- Android 12+ obliga foreground service para background location → impacto en
  UX (notif persistente). Mitigación: copy claro "Estamos tracking tu ruta
  para tu supervisor — al terminar ruta, se apaga solo".

---

### Fase N4 — Evidencia: cámara + OCR + offline queue ⚪

**Meta**: chofer toma foto del ticket de entrega. App extrae datos con
Claude Vision (OCR). Si está offline, se encola y sincroniza al recuperar
señal.

**DoD**:
- [ ] Pantalla `/stop/[id]/evidence`:
  - Captura con `expo-camera`.
  - Preview + retry.
  - Compresión a JPEG 70% antes de upload.
- [ ] Upload a Supabase Storage (bucket `delivery-evidence`).
- [ ] Llamada a Claude Vision con la imagen → extrae fecha, monto, productos.
- [ ] Confirmación del chofer (puede editar campos extraídos).
- [ ] Submit final crea `delivery_report` row.
- [ ] **Outbox offline** con `expo-sqlite`:
  - Si offline al submit: guarda en queue local con timestamp.
  - Background sync cuando vuelve conexión.
  - Indicador visible "N entregas pendientes de sincronizar".
- [ ] Compresión defensiva (timeout 5s en `compressImage` → fallback a
      imagen sin comprimir, ya implementado en PWA).

**Documentación entregable**:
- ADR-071: outbox pattern en native con SQLite.

**Riesgos**:
- Tamaño de evidencia (varios MB) consume datos del chofer. Mitigación:
  warning antes de upload en redes celulares lentas.
- OCR Claude Vision tarda 2-4s. Mitigación: spinner + texto "Leyendo
  ticket..." — no bloquear UI.

---

### Fase N5 — Chat con supervisor + push nativas ⚪

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
