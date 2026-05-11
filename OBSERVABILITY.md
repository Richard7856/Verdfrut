# Observabilidad — TripDrive

> Setup: ADR-051 (2026-05-10). Package: `@tripdrive/observability`.

Esta guía explica cómo está montada la telemetría de errores en TripDrive, cómo usarla en código nuevo, y cómo operar el dashboard de Sentry.

---

## Qué es Sentry y qué hace por nosotros

**Sentry** es la plataforma de monitoreo de errores que usamos. Cuando algo falla en cualquiera de las 3 apps (platform, driver, control-plane), el SDK captura el evento y lo envía vía HTTPS al proyecto Sentry. Ahí lo vemos agrupado por tipo de error con:

- **Stack trace legible** mapeado al código TS original (gracias a *source maps*).
- **Contexto:** quién, qué URL, qué browser, qué versión del código (release).
- **Frecuencia:** cuántas veces pasó, cuándo empezó.
- **Tags / filtros:** `app=platform|driver|control-plane`, `environment=production|preview`, `tenant=verdfrut`.
- **Alertas:** email cuando un error es nuevo o supera umbral.

### Free tier — único proyecto

Sentry Free permite **1 proyecto** y **5 000 eventos/mes**. Como tenemos 3 apps:

- Las **3 apuntan al mismo DSN** (`NEXT_PUBLIC_SENTRY_DSN`).
- Cada evento incluye automáticamente `app: platform | driver | control-plane`.
- Filtros del dashboard se hacen por ese tag.

Si la cuota se quema en producción real, los próximos pasos son:
- Reducir `tracesSampleRate` (actualmente 5% en prod, ver `packages/observability/src/sentry-init.ts`).
- Agregar `ignoreErrors` para reducir ruido (ya hay lista base — agregar lo que aparezca).
- Migrar a plan pago (Team $26/mes, 50k eventos).

---

## Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Las 3 apps en Vercel | DSN público (browser + server). Sin esto el SDK no se inicializa. |
| `SENTRY_AUTH_TOKEN` | Vercel build env (NO `NEXT_PUBLIC_`) | Para que el build suba *source maps*. Sin esto el build pasa pero los stack traces apuntan al bundle minificado. |
| `SENTRY_ORG` | Vercel build env | Slug de la org. Default `tripdrive`. |
| `SENTRY_PROJECT` | Vercel build env | Slug del proyecto. Default `tripdrive`. |
| `SENTRY_ENVIRONMENT` | opcional | Override del tag environment. Default: `VERCEL_ENV` o `NODE_ENV`. |
| `SENTRY_RELEASE` | auto (Vercel) | Identificador de versión. Vercel pasa `VERCEL_GIT_COMMIT_SHA` automáticamente. |
| `SENTRY_FORCE_LOCAL` | dev local | Setear a `1` para que Sentry envíe desde tu máquina (útil para verificar setup). |

### Cómo seteo el DSN en Vercel

1. En el dashboard Vercel → cada proyecto (platform, driver, control-plane) → Settings → Environment Variables.
2. Agregar `NEXT_PUBLIC_SENTRY_DSN` con el valor del DSN. Marcar `Production`, `Preview` y `Development` (los 3) — la `enabled` lógica de Sentry decide si envía según `NODE_ENV`.
3. (Opcional) `SENTRY_AUTH_TOKEN` solo `Production` para que solo el deploy productivo suba source maps.

DSN actual del proyecto TripDrive:
```
https://d178b4d401566100a7e516135966550b@o4511368225488896.ingest.us.sentry.io/4511368230797312
```

> ⚠ El DSN es público — va en el cliente. **Solo permite escribir eventos**, no leer ni borrar. No es secreto. El `SENTRY_AUTH_TOKEN` sí es privado y solo va a build env.

---

## Cómo usar el logger en código nuevo

Reemplazo de `console.error`:

```ts
// ❌ Antes
console.error('[chat.push] error:', err);

// ✅ Ahora
import { logger } from '@tripdrive/observability';
await logger.error('chat.push falló', { reportId, zoneId, err });
```

API completa:

```ts
import { logger } from '@tripdrive/observability';

// Error: bug o falla operativa. Va a Sentry + stdout.
await logger.error('descripción corta', { ...context, err });

// Warning: condición anómala no fatal. Va a Sentry como level=warning.
await logger.warn('rate limit excedido', { ip });

// Info: evento operativo importante. Solo stdout (no Sentry).
logger.info('ruta optimizada', { routeId, vehicles: 3 });

// Debug: traza de desarrollo. Suprimido si NODE_ENV=production.
logger.debug('matrix calculada', { points: 25 });
```

### Reglas operativas

1. **Siempre pasa el `err` original como context.** Sentry agrupa por stack trace — si pierdes el `err`, todos los errores parecen distintos.
2. **`logger.error` es async** — usa `await` cuando estés en un async fn. En catch blocks, `void logger.error(...)` también funciona pero pierdes el orden.
3. **Nunca pongas info sensible en el msg o context** (passwords, tokens, números de tarjeta). Sentry guarda todo y solo lo ven los administradores.
4. **IDs sí pueden ir** (userId, routeId, reportId) — ayudan a debuggear sin filtrar info personal.

---

## Arquitectura del setup

```
packages/observability/
├── src/
│   ├── logger.ts        ← API pública (logger.error/warn/info/debug)
│   ├── sentry-init.ts   ← Factory de configuración compartido
│   └── index.ts         ← Barrel
└── package.json

apps/{platform,driver,control-plane}/
├── sentry.client.config.ts   ← Browser runtime
├── sentry.server.config.ts   ← Node.js (server actions, RSC, API)
├── sentry.edge.config.ts     ← Edge runtime (middleware)
├── instrumentation.ts        ← Hook que Next llama al arrancar
└── next.config.ts            ← withSentryConfig() para source maps
```

### Por qué 3 archivos `sentry.*.config.ts`

Next.js corre código en 3 ambientes distintos:

| Runtime | Cuándo | Qué hay diferente |
|---|---|---|
| **client** | Browser del usuario | Tiene window/DOM, Session Replay sí aplica |
| **server** | Node.js (server actions, RSC, API routes) | Tiene fs/network nativo, no DOM |
| **edge** | Edge runtime (middleware, edge funcs) | Subset de Node, sin filesystem |

Cada uno necesita su propio `Sentry.init()` con integraciones específicas. El package `@tripdrive/observability` los unifica con `initSentry(Sentry, { context })`.

---

## Workflow operativo

### Cuando llega un error nuevo

1. Sentry envía email al primer `@tripdrive` user con un error nuevo (no agrupado).
2. Click en el evento → ves stack trace, contexto, request info, release (git SHA).
3. Decisión rápida:
   - **Bug real:** crear issue en GitHub, asignar.
   - **Falso positivo:** marcar resolved o agregar a `ignoreErrors` en `sentry-init.ts`.
   - **Esperado/conocido:** marcar resolved con nota.

### Releases

Sentry asocia errores a una `release` (el git SHA del commit deployado). Cuando deployas una versión nueva:

1. Vercel pasa `VERCEL_GIT_COMMIT_SHA` automáticamente como release.
2. El build sube source maps a Sentry indexados por ese SHA.
3. En el dashboard puedes filtrar "errores aparecidos después del release X" — útil para detectar regresiones.

### Performance / tracing

Hoy mandamos 5% de transacciones a tracing en producción (vs 100% en dev). Para ver:
- Sentry dashboard → Performance → filtros por `app:platform`, `transaction.op:http.server`.
- Identifica endpoints lentos, queries N+1, latencia P95.

Si la cuota Free se queme rápido por traces, bajar a 1% en `sentry-init.ts`.

---

## Lo que NO está cubierto (deferred)

- ❌ **Session Replay** — desactivado por consumir cuota. Habilitar selectivo si necesitamos debugear bug visual específico.
- ❌ **Profiling** — feature beta, no habilitado.
- ❌ **Crons / scheduled tasks** — los schedules n8n no reportan a Sentry todavía.
- ❌ **`console.error` legacy** — quedan ~25 en el código (puntos no críticos). Migración gradual; cada PR que toca un archivo migra los suyos.

---

## Test inicial — verificar que funciona

Después de setear `NEXT_PUBLIC_SENTRY_DSN` en Vercel:

1. Trigger un error a propósito en cualquier app (ej. agregar en una server action: `throw new Error('Sentry test ' + Date.now())`).
2. Deploy o accede al endpoint.
3. En el dashboard de Sentry deberías ver el evento aparecer en <60s.
4. Si NO aparece:
   - Verifica que el DSN esté seteado en Vercel para ese deploy.
   - Verifica que `enabled` no esté en `false` (revisa `sentry-init.ts`).
   - En el browser, Network tab → busca request a `*.ingest.us.sentry.io`.

---

## Roadmap de observabilidad

| Cuándo | Qué |
|---|---|
| Hoy (ADR-051) | Setup base + 5 puntos críticos migrados |
| Próximo sprint | Migrar 20+ `console.error` restantes |
| Sprint H4 (performance) | Habilitar Performance tracing en endpoints clave + alertas P95 |
| Sprint H5 (reportería) | Pantalla `/audit/sentry-summary` con KPIs propios + integración Slack |
| Futuro | Migrar a plan pago si cuota se quema |
