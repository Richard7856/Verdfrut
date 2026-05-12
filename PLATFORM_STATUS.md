# TripDrive — Estado de la plataforma

> Documento vivo. Cada cambio significativo (feature, refactor, bug-fix grande)
> debe actualizar la sección correspondiente. Fuente de verdad para "¿cómo
> está el producto hoy?".
>
> **Última actualización**: 2026-05-12.
> **Owner**: Richard.

---

## Índice

1. [Identidad del producto](#1-identidad-del-producto)
2. [Arquitectura actual](#2-arquitectura-actual)
3. [Lo que funciona bien (pilot validado)](#3-lo-que-funciona-bien-pilot-validado)
4. [Lo que ocupa revisión](#4-lo-que-ocupa-revisión)
5. [Bugs conocidos](#5-bugs-conocidos)
6. [Medidas de seguridad implementadas](#6-medidas-de-seguridad-implementadas)
7. [Riesgos por área](#7-riesgos-por-área)
8. [Roadmap: streams en curso](#8-roadmap-streams-en-curso)
9. [Decisiones técnicas cerradas](#9-decisiones-técnicas-cerradas)
10. [Decisiones técnicas pendientes](#10-decisiones-técnicas-pendientes)
11. [Stack y dependencias](#11-stack-y-dependencias)
12. [URLs y entornos](#12-urls-y-entornos)

---

## 1. Identidad del producto

**TripDrive** es una plataforma SaaS de optimización de rutas y gestión de
flotilla para empresas de logística de última milla en México.

- **Buyer persona**: Operations Manager / COO de empresas con 10-200 choferes
  que hoy arman rutas en Excel o usan SaaS extranjero caro (Onfleet, Routific,
  Beetrack).
- **Diferenciador 1**: Multi-cliente real (atender NETO + OXXO + Bimbo desde
  una plataforma con KPIs separados, flow del chofer configurable por cuenta).
  **Estado**: planeado, shell UI desplegado, integración real pospuesta a fase
  posterior.
- **Diferenciador 2**: Optimización con IA Claude para mediar incidencias del
  chofer + tracking GPS en vivo. **Estado**: implementado y validado.
- **Diferenciador 3**: Hecho en México, soporte en pesos, sin licencias en USD.
  **Estado**: posicionamiento, no afecta código.

---

## 2. Arquitectura actual

```
┌──────────────────────────────────────────────────────────────────┐
│  PLATFORM (Next.js 16 web)                                       │
│  apps/platform — admin / dispatcher / zone_manager               │
│  https://app.tripdrive.xyz                                       │
│  Mapbox GL JS para visualización de rutas + dashboards           │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  DRIVER PWA (Next.js 16 + Serwist)                              │
│  apps/driver — chofer / zone_manager móvil                       │
│  https://driver.tripdrive.xyz                                    │
│  APK Bubblewrap TWA distribuida por sideload                     │
│  ⚠️ DEPRECADA — se reemplaza por app nativa en Stream B          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE (Next.js 16 web)                                  │
│  apps/control-plane — super-admin TripDrive (tenants, KPIs)     │
│  https://admin.tripdrive.xyz                                     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  OPTIMIZER (FastAPI + VROOM)                                     │
│  services/optimizer — server-side                                │
│  https://verdfrut-production.up.railway.app                      │
│  VROOM 1.14 + matrix de Mapbox Distance                          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  SUPABASE (BD multi-tenant)                                      │
│  - 1 proyecto Supabase por tenant (cliente que paga a TripDrive) │
│  - Control Plane = proyecto Supabase separado                    │
│  - Postgres + RLS + Realtime + Storage + Auth                    │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  PACKAGES (workspace pnpm)                                       │
│  - @tripdrive/types      → TS interfaces compartidas             │
│  - @tripdrive/supabase   → Client factory + Database types       │
│  - @tripdrive/ui         → Componentes Tailwind v4 + tokens oklch│
│  - @tripdrive/maps       → Wrapper Mapbox GL JS                  │
│  - @tripdrive/flow-engine → Máquina de flujos del driver         │
│  - @tripdrive/ai         → Wrapper Claude Vision + chat mediator │
│  - @tripdrive/utils      → GPS, fechas, imágenes                 │
│  - @tripdrive/observability → Logger + Sentry init compartido    │
└──────────────────────────────────────────────────────────────────┘
```

**Stack base**: Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 (oklch
tokens) + Geist font + Supabase + Mapbox + Claude API + Sentry + Vercel +
Railway.

---

## 3. Lo que funciona bien (pilot validado)

Operación con NETO Tiendas (cliente real, ~55 tiendas activas en CDMX,
operación piloto iniciada 2026-05-12) validó:

### Flujos end-to-end probados
- ✅ **Dispatcher arma tiros**: crea tiro, agrega N camionetas, optimiza
  automático, ve mapa multi-route, ajusta drag-drop, publica.
- ✅ **Importación masiva de tiendas**: 40 tiendas nuevas importadas en 1
  sesión via Places API + override manual (`scripts/import-stores-v2-places.mjs`).
- ✅ **Selector de tiendas a escala**: con 55+ tiendas, paste-list + buscador
  + filter de coord_verified resuelve el caso "elegir 40 de 55".
- ✅ **Driver PWA**: chofer ve ruta, reporta entregas con foto + OCR
  (Claude Vision), chat con zone_manager mediado por Claude AI.
- ✅ **Push notifications** (PWA Web Push) llegan en Android Chrome.
- ✅ **Tracking GPS** vía Supabase Realtime Broadcast (no DB writes).
- ✅ **Reportes operativos** en `/reports` con drill-down básico.
- ✅ **Multi-route map** con polylines por color, fullscreen, métricas.
- ✅ **Split/merge robusto** de tiros con RPC atómica (ADR-053).
- ✅ **Auto-recalc de ETAs** post drag-drop.

### Infraestructura validada
- ✅ Deploy Vercel (3 apps) + Railway (optimizer Python).
- ✅ Custom domains funcionando (`app.`, `driver.`, `admin.tripdrive.xyz`).
- ✅ Sentry observability captura errores en 3 apps.
- ✅ DNS en Vercel (nameservers cambiados de Hostinger).
- ✅ Rate limit en Postgres con cron de cleanup.
- ✅ React Doctor score: **96/100** (post Ola 1 de fixes).

### Bug fixes históricos importantes resueltos
- ✅ ADR-053: race conditions en split/merge resueltas con RPC atómica.
- ✅ Multi-cliente shell UI (en preview, sin BD).
- ✅ Editor de tiendas con mapa interactivo + Google Geocoding.
- ✅ Tokens fantasma `--vf-surface-1/2/3` que hacían modales transparentes
  (fix raíz en tokens.css agrega los aliases).
- ✅ Badges WCAG AA en dark mode (warn/ok/info/crit fg ahora claros).
- ✅ DataTable con altura mínima fija (56px) — respiración visual.
- ✅ Assetlinks.json público (proxy del driver bloqueaba — ADR pendiente).

---

## 4. Lo que ocupa revisión

### Decisiones técnicas grandes pendientes
- [ ] **Migración a app nativa (Stream B)** — PWA driver se deprecará en
  cuanto la versión Expo esté en beta validada. Ver `STREAM_B_NATIVE_APP.md`
  cuando se cree.
- [ ] **Integración Google Routes API en optimizer (Stream C)** — actualmente
  el optimizer usa Mapbox Matrix nocturno. Falta capa de "re-optimización en
  vivo con tráfico actual" usando Google Routes.
- [ ] **Multi-customer real (Stream A, pospuesto)** — shell UI está
  desplegado. La integración con BD (tabla `customers` + FK en stores y
  dispatches) entra después del cutover de la native app.

### Refactors pendientes (no urgentes)
- [ ] `--vf-*` legacy CSS variables → migrar gradualmente a `--td-*`
  cuando se toque cada componente (ADR-056).
- [ ] 22 `console.error` legacy ya migrados a `logger.error` (#125 cerrado).
- [ ] `flow-engine` actual es máquina de estados hardcoded → refactor a
  data-driven cuando llegue Stream A Fase 5 (Flow Viewer per customer).
- [ ] Test suite automatizada: hoy NO existe. Smoke tests manuales
  documentados por fase. Considerar agregar Vitest + Playwright cuando
  el equipo crezca.

### UX que vale la pena revisar (post-pilot feedback)
- [ ] Mapas del driver actual tardan en cargar (Mapbox bundle 750 KB).
  **Solución**: lo elimina la migración a native app.
- [ ] Estilo del mapa "se ve genérico". **Solución**: igual que arriba —
  native usa Google Maps SDK nativo, ve como Waze.
- [ ] Flujo del chofer es lineal y rígido — no adapta por cliente. **Solución**:
  Flow Viewer (Stream A Fase 5).
- [ ] Importador real de XLS (no solo paste-list) si los clientes lo piden.
  Hoy paste-list cubre 95% del caso.

### Áreas sin tests automatizados
- Server actions críticas (`createAndOptimizeRoute`, `reorderStopsAction`,
  `restructureDispatch`).
- Rate limiting bajo carga real.
- Race conditions en concurrent edits (admin + chofer editando misma ruta).
- Validación de datos del optimizer (qué pasa si VROOM devuelve nonsense).

---

## 5. Bugs conocidos

Ver `KNOWN_ISSUES.md` para lista completa con severidades. Resumen al 2026-05-12:

### Importantes (afectan operación en escala)
- **#12** TTL fijo de 24h en links de invite sin renegociación.
- **#13** Validación débil de password (solo length >= 8).
- **#22** Importador CSV upload pendiente (solo paste-list y descarga).
- **#25** Optimizer usa OSRM público cuando no hay token Mapbox (lento + rate
  limit). Mitigación: en producción `MAPBOX_DIRECTIONS_TOKEN` está set.
- **#29** Mapbox Matrix limita 25 coords; rutas con >23 paradas caen a
  haversine.
- **#31** iOS Safari mata `watchPosition` al bloquear pantalla. **Mitigación
  permanente**: migración a app nativa.
- **#51** `visibilitychange` iOS Safari puede no dispararse → gap event
  eterno. Cron horario mitiga.
- **#52** `route_transfer` sin transacción Postgres → estado inconsistente
  posible. Pendiente refactor a RPC.
- **#L4** Admin reorder POST-PUBLISH no invalida métricas (banner agregado
  como mitigación, pendiente recalc opcional).

### Cosméticos / nice-to-have
- ~30 issues catalogados en `KNOWN_ISSUES.md` sección "Cosméticos".
- React Doctor reporta 7 warnings cosméticos restantes (post Ola 1).

---

## 6. Medidas de seguridad implementadas

### Autenticación
- **Supabase Auth** con email + password en `platform` y `driver` apps.
- **Control Plane**: shared password + cookie HMAC firmado (sin Supabase Auth
  — staff TripDrive interno).
- `must_reset_password` flag fuerza cambio en primer login del chofer.

### Autorización (RLS)
- Cada tabla tenant tiene RLS habilitada.
- Helpers: `requireRole('admin','dispatcher')`, `requireDriverProfile()`,
  `requireAdminOrDispatcher()` en server actions.
- Wrappers en `@/lib/auth` que SIEMPRE verifican sesión antes de query.

### Manejo de secretos
- ENV vars en Vercel (production) — nunca commiteados.
- `SUPABASE_SERVICE_ROLE_KEY` solo usado server-side, never bundled.
- `GOOGLE_GEOCODING_API_KEY` solo en `.env.local` + Vercel.

### Rate limiting
- Tabla `rate_limit_buckets` en Postgres (ADR-054).
- Cron de cleanup configurado.

### Observability
- Sentry en `platform`, `driver`, `control-plane` (ADR-051).
- Logger estructurado `@tripdrive/observability` — captura errores +
  warnings con contexto.

### CSRF / XSS
- Next.js Server Actions por default tienen CSRF protection.
- React escapa output JSX por default — no `dangerouslySetInnerHTML`
  con input de usuario.

### Migration safety
- Todas las migraciones se prueban en sandbox antes de prod.
- `apply_migration` MCP bloqueado para Claude sin user explicit OK.

---

## 7. Riesgos por área

### Operacionales
- **Riesgo**: chofer no encuentra tienda por coords incorrectas.
  **Mitigación**: flag `coord_verified` + editor visual con mapa + Google
  Geocoding. 22 tiendas pendientes de validación manual.
- **Riesgo**: caída del optimizer Railway = no se pueden crear rutas nuevas.
  **Mitigación**: VROOM es read-only, no afecta operación activa. Pendiente
  setup de health check externo (UptimeRobot).
- **Riesgo**: Supabase Realtime se cae = pierde tracking GPS en vivo.
  **Mitigación**: chofer sigue operando, supervisor lo ve en gris hasta
  reconexión. Sin pérdida de datos (breadcrumbs van por API normal).
- **Riesgo**: chofer cierra app, gap eterno (#51).
  **Mitigación parcial**: cron horario cierra gaps zombie. **Solución
  permanente**: app nativa con background tasks.

### Técnicos
- **Riesgo**: race conditions en concurrent edits de ruta.
  **Mitigación parcial**: RPC atómica para split/merge (ADR-053).
  **Pendiente**: lock optimista (`?version=N`) en reorder concurrente.
- **Riesgo**: Mapbox cambia precios / API → rompe optimizer.
  **Mitigación**: VROOM es self-hosted, solo el Matrix depende de Mapbox.
  Se puede migrar a otro provider (Google Routes, HERE) sin tocar VROOM.
- **Riesgo**: Supabase tier upgrade necesario al escalar choferes.
  **Mitigación**: monitoring de connection pool, plan a $25/mes ya tiene
  bastante margen.

### Comerciales
- **Riesgo**: pricing no validado en mercado MX, puede estar high vs
  competencia.
  **Mitigación**: cerrar contrato NETO con número escrito → primer
  data-point real. Iterar después de 2-3 cierres.
- **Riesgo**: cliente exige features custom (SAP integration, CFDI, etc.)
  no planeadas.
  **Mitigación**: add-ons paid documentados en landing — son revenue
  extra, no fricción.
- **Riesgo**: dependencia de 1 cliente (NETO) para case study. Si
  fracasa el pilot, no hay segunda vuelta de venta a OXXO.
  **Mitigación**: operación cuidadosa primeras 2 semanas, smoke tests
  diarios, soporte WhatsApp directo al chofer si lo necesita.

### Legales / compliance
- **Falta**: términos de servicio + privacy policy (abogado pendiente).
- **Falta**: aviso de privacidad LFPDPPP (datos personales MX).
- **Falta**: CFDI 4.0 si TripDrive empieza a facturar (Tier Pro+).
- **Riesgo**: datos del chofer en Supabase US — verificar cumplimiento
  transfronterizo.

### Comunicación / soporte
- **Riesgo**: chofer sin soporte 5am cuando algo falla.
  **Mitigación temp**: WhatsApp directo al fundador.
  **Plan**: SLA escrito con tiempos en Tier Enterprise.

---

## 8. Roadmap: streams en curso

### Stream B — Migración a App Nativa (Expo) 🔴 EN CURSO
Reemplaza el PWA driver actual por app React Native nativa.

| Fase | Meta | DoD |
|---|---|---|
| N1 | Setup Expo + auth Supabase + scaffold | App arranca con login, navega a pantalla vacía "Mi ruta del día" |
| N2 | Pantalla "Mi ruta del día" | Lista paradas + mapa nativo overview |
| N3 | Detalle parada + deeplink Google Maps + GPS bg | Chofer puede "Navegar", app trackea en bg |
| N4 | Evidencia: cámara + OCR + offline queue | Foto + ticket extraction funciona offline |
| N5 | Chat + push notifs nativas | Chat con supervisor funciona como en PWA actual |
| N6 | Beta interna con 1 chofer | 1 chofer operando 1 semana sin issues |
| N7 | TestFlight + Play Internal Testing | Build de release firmado en ambas stores |
| N8 | Publish stores | App descargable desde App Store + Play Store |
| N9 | Cutover + deprecar PWA | `apps/driver` eliminado del repo |

### Stream C — Optimizer mejorado con Google Routes 🟡 PRÓXIMO
| Fase | Meta | DoD |
|---|---|---|
| O1 | Integrar Google Routes API | Botón "Re-optimizar con tráfico actual" funciona |
| O2 | Re-optimización automática trigger >15min | Chofer atrasado dispara re-cálculo automático |
| O3 | Predicción ETAs por hora del día | Planning del día sugiere shift óptimo |
| O4 | ML-learned service time por tienda | `service_time_seconds` calculado de histórico |

### Stream A — Multi-Customer real ⚪ POSPUESTO
Pospuesto hasta después del cutover de native app + 1 mes de operación estable.

Plan completo conservado en `MULTI_CUSTOMER.md` (a crear cuando arranque).

### Otros (no en stream activo)
- **Landing pública** — armada en paralelo por user con Claude Design.
- **Google Workspace setup** — en propagación, mientras avanzamos código.
- **APK demo TWA actual** — funcional hasta que la native esté ready.

---

## 9. Decisiones técnicas cerradas

### Confirmadas y aplicadas
- ✅ Multi-tenant con 1 Supabase por cliente que paga (tenant).
- ✅ Monorepo pnpm + Turbo.
- ✅ Next.js 16 App Router.
- ✅ Tailwind v4 con tokens oklch en `packages/ui/src/tokens.css`.
- ✅ Geist Sans + Geist Mono (fuentes fijas).
- ✅ VROOM como optimizer self-hosted.
- ✅ Supabase Auth (tenant) + cookie HMAC (Control Plane).
- ✅ Sentry para observability.
- ✅ Brand: TripDrive (rebrand de VerdFrut completo).
- ✅ Dominio: tripdrive.xyz, subdominios app./driver./admin.

### Decisiones recientes (este chat)
- ✅ Eliminar PWA driver, migrar a app nativa Expo.
- ✅ Google Maps Platform para nav + Mapbox para admin (híbrido).
- ✅ Optimizer es el componente más crítico — todo lo demás secundario.
- ✅ Multi-cliente como differentiator vendible, pero pospuesto post-native.
- ✅ Email: Google Workspace para tripdrive.xyz.
- ✅ Modelo de pricing: 3 tiers + add-ons + setup fee + mínimo perfiles.
- ✅ Navegación turn-by-turn delegada a Waze/Google Maps nativo, no propia.
- ✅ Roadmap por metas (DoD), no por tiempos.

---

## 10. Decisiones técnicas pendientes

| # | Decisión | Recomendación default |
|---|---|---|
| 1 | Stack native: Expo o React Native CLI bare | **Expo (managed)** — más rápido, OTA updates |
| 2 | Map SDK en native: `react-native-maps` (Google nativo) o `@rnmapbox/maps` | **`react-native-maps`** — costo $0 |
| 3 | Storage local en native: AsyncStorage, SQLite, MMKV | **Expo SQLite** para outbox / queue + AsyncStorage para preferences |
| 4 | Background GPS: `expo-location` task | **Sí** + foreground service Android |
| 5 | Push provider: Expo Notifications (FCM/APNS) o custom | **Expo Notifications** — simple |
| 6 | OTA updates con EAS o sin | **Sí EAS Update** — iteración rápida |
| 7 | Compartir packages workspace en native (types, supabase client) | **Sí**, ya estructurado para esto |
| 8 | Cuándo eliminar `apps/driver` | **Cuando 1 chofer opere nativa 1 semana sin issues** |
| 9 | iOS desde día 1 o Android primero | **Solo Android** primero (sideload rápido, Apple review tarda) |
| 10 | Stripe/Conekta vs facturación manual | **Manual primero**, automatizar cuando >5 clientes pagando |

---

## 11. Stack y dependencias

### Web platform
- Next.js 16 / React 19 / TypeScript 5
- Tailwind CSS v4
- Supabase JS SDK 2.x
- Mapbox GL JS 3.x
- @sentry/nextjs
- Geist (Vercel font)

### Driver PWA actual (a deprecar)
- Next.js 16 / React 19
- Serwist (service worker)
- Web Push (VAPID)
- Bubblewrap (APK TWA wrapper)

### Driver nativa (próxima)
- Expo SDK 53+
- React Native 0.76+
- TypeScript
- `react-native-maps` (Google nativo)
- `expo-location` (GPS background)
- `expo-camera` (evidencia)
- `expo-notifications` (push)
- `expo-sqlite` (offline queue)
- Supabase JS SDK (compartido con web)

### Optimizer
- Python 3.11
- FastAPI
- VROOM 1.14 (binary o pyvroom binding)
- requests (Mapbox Matrix HTTP client)
- googlemaps Python client (cuando entre Stream C)

### Infra
- Vercel (3 apps web)
- Railway (optimizer)
- Supabase (BD multi-tenant + 1 Control Plane)
- Cloudflare (futuro: WAF + CDN)
- Sentry (observability)
- Resend (email transaccional — pendiente setup)
- Google Workspace (email humano — en propagación)
- Apple Developer Program ($99/año, próxima compra)
- Google Play Console ($25 una vez, próxima compra)
- EAS Build ($29/mes production, próxima compra)

---

## 12. URLs y entornos

### Producción
```
Landing (próxima)       https://tripdrive.xyz
Platform admin          https://app.tripdrive.xyz
Driver PWA (deprecada)  https://driver.tripdrive.xyz
Control Plane           https://admin.tripdrive.xyz
Optimizer               https://verdfrut-production.up.railway.app
Tenant Supabase         https://hidlxgajcjbtlwyxerhy.supabase.co
Sentry                  org=tripdrive project=tripdrive
```

### Legacy (redirect cuando aplique)
```
https://verdfrut-platform.vercel.app
https://verdfrut-driver.vercel.app
https://verdfrut-control-plane.vercel.app
```

### GitHub
```
Repo            github.com/Richard7856/Verdfrut
Branch          main
```

---

## Apéndice — Cómo mantener este documento

1. Cuando cierre una fase de un stream, actualizar sección 8 (Roadmap).
2. Cuando entre/salga un bug, actualizar sección 5 (Bugs).
3. Cuando se tome una decisión técnica grande, mover de sección 10 a 9.
4. Cuando se agregue una medida de seguridad nueva, actualizar sección 6.
5. Cuando aparezca un riesgo nuevo, evaluar si va a sección 7.
6. Cada commit grande, actualizar fecha en el header del documento.

Convención para evitar drift:
- Este documento NUNCA debe tener placeholders tipo "TBD" abiertos por
  más de 1 semana. Si está abierto, debe tener owner + fecha objetivo.
- Si una sección crece mucho (>500 líneas), mover a archivo separado y
  dejar link en esta.

