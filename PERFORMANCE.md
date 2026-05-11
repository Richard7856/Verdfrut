# TripDrive — Performance Playbook

> Sprint H4 (2026-05-11) · ADR-054. Reglas y patrones para que la plataforma siga rápida conforme escala.

---

## TL;DR de qué se midió y qué se hizo

| Pantalla | Antes | Después | Cómo |
|---|---|---|---|
| `/dispatches/[id]` (tiro detalle) | N+1 stops (1 query por ruta) | 1 query batch | `listStopsForRoutes(ids[])` ya existía desde H1 |
| `/share/dispatch/[token]` | N+1 stops | 1 query batch | Idem |
| `/map` (live map) | 3×N queries (stops + breadcrumb + profile por ruta) | 4 queries totales | Helpers nuevos `getLastBreadcrumbsByRouteIds`, `getUserProfilesByIds` + reuso `listStopsForRoutes` |
| `multi-route-map-server.tsx` | N+1 stops | 1 query batch | Reuso de `listStopsForRoutes` |
| Rate limit | In-memory por instancia | Postgres distribuido | RPC `tripdrive_rate_limit_check` |
| Compresión imagen iOS | Podía colgar en Low Power | Timeout 5s + fallback original | Race contra timeout |
| `<img>` chat thread | Sin optimización | Next `<Image>` (CDN + WebP) | Issue #118 |

---

## Reglas operativas para evitar N+1

### ❌ NO hacer

```typescript
// 1 query inicial + N queries dentro del map
const items = await listItems();
const enriched = await Promise.all(
  items.map(async (i) => {
    const detail = await getDetailById(i.id);  // ← N queries
    return { ...i, detail };
  }),
);
```

### ✅ SÍ hacer

```typescript
const items = await listItems();
const ids = items.map((i) => i.id);

// 1 query batch con .in()
const detailsById = await getDetailsByIds(ids); // → Map<id, Detail>

const enriched = items.map((i) => ({
  ...i,
  detail: detailsById.get(i.id) ?? null,
}));
```

### Helpers batch disponibles hoy

| Helper | Devuelve | Uso |
|---|---|---|
| `listStopsForRoutes(ids[])` | `Map<routeId, Stop[]>` | Tiro detail, multi-route map, /map live |
| `getStoresByIds(ids[])` | `Store[]` | Resolver tiendas masivamente |
| `getVehiclesByIds(ids[])` | `Vehicle[]` | Idem para vehículos |
| `getDriversByIds(ids[])` | `Driver[]` | Idem para choferes |
| `getUserProfilesByIds(ids[])` | `Map<userId, UserProfile>` | Resolver perfiles de drivers en bulk |
| `getLastBreadcrumbsByRouteIds(ids[])` | `Map<routeId, LastBreadcrumb>` | Live map — última posición GPS |
| `countStopsForRoutes(ids[])` | `Map<routeId, {total, completed, ...}>` | Counts agregados sin traer stops |
| `listDepots()` / `listZones()` | `Depot[]` / `Zone[]` | Carga global (cardinalidad baja) |

### Cuándo NO importa optimizar

- **N ≤ 3 garantizado.** Ej. cards de detalle con 1-2 sub-recursos. La diferencia de RTT no se nota.
- **Helper aún no existe** y el caso es raro. Documentar TODO y migrar cuando el helper aparezca por otro motivo.
- **El query interno es a cache local (Map, etc.).** No hay RTT.

---

## Rate limiting distribuido

### Cómo funciona

1. Cada hit llama `consume(userId, action, cfg)` → RPC Postgres `tripdrive_rate_limit_check`.
2. La RPC cuenta hits del bucket en la ventana sliding y devuelve `true` si pasa, `false` si excedió.
3. Si la BD está caída, fallback in-memory por instancia (mejor que tumbar el endpoint).

### Configs nombrados

```typescript
LIMITS.shareDispatch        // 30 hits/min por IP — vista pública
LIMITS.chatManagerMessage   // 60 hits/min por user — chat dispatcher
LIMITS.chatDriverMessage    // 30 hits/min por user — chat driver
LIMITS.ocr                  //  6 hits/min por user — OCR tickets
```

### Cron de limpieza

La tabla `rate_limit_buckets` crece con cada hit. Necesita un cron diario que llame `tripdrive_rate_limit_cleanup()` para borrar rows expirados.

**Endpoint a crear:** `POST /api/cron/rate-limit-cleanup` (TODO próximo sprint).
**Schedule n8n:** `0 4 * * *` (4 AM, mismo slot que reconcile-orphans).

---

## Imágenes

### Reglas

- **Siempre `<Image>` de Next.js** en lugar de `<img>` — CDN automático, WebP/AVIF, lazy loading.
- Host del image debe estar en `next.config.images.remotePatterns` (ya configurado `*.supabase.co`).
- Para imágenes de relación arbitraria, usar `fill` con `sizes` realista.

### Compresión cliente

- `compressImage(file, options)` se usa para uploads grandes (>2MB default).
- iOS Low Power Mode → timeout 5s con fallback al original.
- Logueamos a Sentry si el timeout dispara seguido (potencial issue de dispositivos viejos).

---

## Lighthouse / driver PWA

Pendiente (H4 partial — se ataca en próximo sprint):

- Audit Lighthouse del driver PWA en 3G simulado.
- Identificar bundles innecesarios (revisar exceljs, dnd-kit fuera de la driver).
- Service Worker cache strategy verificada (Serwist).

---

## Reglas para nuevos endpoints

1. **Auth primero.** Todo endpoint que toca BD debe llamar `requireRole`/`requireProfile`/`requireDriverProfile` antes que nada.
2. **Rate limit en públicos.** Cualquier endpoint sin auth (ej. `/share/*`, `/api/webhook/*`) usa `consume()` con un `LIMITS.*`.
3. **Sin N+1.** Antes de `Promise.all(items.map(query))`, busca si existe helper batch.
4. **`logger` en catch.** `console.error` solo en código de desarrollo; producción usa `logger.error` que va a Sentry.
5. **Source maps en build.** `withSentryConfig` en `next.config.ts` se encarga si `SENTRY_AUTH_TOKEN` está set.
6. **Imágenes con `<Image>`.** Solo `<img>` si hay razón clara (ej. data URL).
7. **`nowUtcIso()` para timestamps de BD.** No `new Date().toISOString()` directo.

---

## Métricas a vigilar (cuando Sentry esté activo)

- **P95 de queries server actions** — Sentry Performance → transaction.op = "function.nextjs".
- **Tasa de fallback in-memory del rate limiter** — logger.warn "rate-limit: RPC falló".
- **Tasa de fallback haversine en optimizer** — logger.warn / logger.error "optimizer: Mapbox Matrix falló".
- **Tasa de timeout en compressImage** — agregar `logger.warn('compressImage timeout')` (issue #142 pendiente).
- **Errores no manejados client-side** — Sentry Issues por release.

Cuando alguna de estas cruce un umbral, el operador debe abrir un sub-task en el sprint actual.
