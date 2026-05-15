# TripDrive — Deploy Checklist

> Verificación operativa: lo que el cliente debe tener configurado para que la plataforma funcione "como production-grade" (no demo). ADR-052.

---

## 🟢 Vercel — Environment Variables

Las 3 apps (`tripdrive-platform`, `tripdrive-driver`, `tripdrive-control-plane`) en Vercel necesitan estas variables. Acceso: Vercel → Project → Settings → Environment Variables.

### Compartidas (las 3 apps)

| Variable | Valor | Marcar | Bloquea si falta |
|---|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://d178b4d4...@o4511368225488896.ingest.us.sentry.io/4511368230797312` | Prod + Preview + Dev | No (degrada silente: sin telemetría) |
| `SENTRY_AUTH_TOKEN` | (crear en Sentry → Settings → Auth Tokens, scopes `project:releases`, `project:write`) | Solo Prod | No (build pasa, stack traces minificados) |
| `SENTRY_ORG` | `tripdrive` (slug del org) | Prod + Preview | Default OK |
| `SENTRY_PROJECT` | `tripdrive` (slug del project) | Prod + Preview | Default OK |

### Platform (`tripdrive-platform`)

| Variable | Valor / Origen | Bloquea si falta |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase del tenant | **Sí** — la app no arranca |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key del proyecto Supabase | **Sí** |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **Sí** — server actions fallan |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.*` — mapa público en browser | Sí para mapa |
| **`MAPBOX_DIRECTIONS_TOKEN`** | `pk.*` o `sk.*` — Directions API matrix | ⚠ **Sí para ETAs reales.** Sin esto cae a haversine y el banner ETA modo demo aparece en toda la app. |
| `OPTIMIZER_URL` | URL del optimizer Railway (`https://verdfrut-production.up.railway.app`) | Sí |
| `OPTIMIZER_API_KEY` | shared key con Railway | Sí |
| `CRON_SECRET` | random 32-byte hex (mismo que en n8n) | Sí para crons |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | de `npx web-push generate-vapid-keys` | Sí para push notif |
| `VAPID_PRIVATE_KEY` | idem | Sí |
| `VAPID_SUBJECT` | `mailto:soporte@tripdrive.xyz` | Sí |
| `NEXT_PUBLIC_TENANT_TIMEZONE` | `America/Mexico_City` | Sí (default funciona) |
| `TENANT_REGION_NAME` | `México` (default) | No — solo si tenant no-MX |
| `TENANT_BBOX_LAT_MIN` | `14.3` (default) | No — para validación coords no-MX |
| `TENANT_BBOX_LAT_MAX` | `32.8` (default) | No |
| `TENANT_BBOX_LNG_MIN` | `-118.7` (default) | No |
| `TENANT_BBOX_LNG_MAX` | `-86.5` (default) | No |
| **`STRIPE_SECRET_KEY`** | `sk_test_...` o `sk_live_...` desde Stripe Dashboard → Developers → API keys | ⚠ **Sí para billing.** Sin esto, /settings/billing muestra warning y syncSeats es no-op silencioso. Resto del sistema sigue funcionando. |
| **`STRIPE_WEBHOOK_SECRET`** | `whsec_...` desde el endpoint del webhook en Stripe Dashboard | ⚠ **Sí para procesar eventos** (confirmación de pago, renovaciones). Si falta, el webhook rechaza con 503 y Stripe reintenta hasta darse por vencido. |
| **`STRIPE_PRICE_ID_ADMIN`** | `price_...` del Product "TripDrive - Admin seat" (recurring monthly MXN) | ⚠ Sí — checkout falla con 500 si no está |
| **`STRIPE_PRICE_ID_DRIVER`** | `price_...` del Product "TripDrive - Driver seat" (recurring monthly MXN) | ⚠ Sí — checkout falla con 500 si no está |
| `NEXT_PUBLIC_BILLING_RETURN_URL` | Base URL para retorno desde Stripe checkout (ej. `https://tripdrive.xyz`). Si falta, cae a `NEXT_PUBLIC_PLATFORM_URL` o localhost | No (default funciona en prod si hay PLATFORM_URL) |

### Driver (`tripdrive-driver`)

| Variable | Valor | Bloquea si falta |
|---|---|---|
| Las mismas 3 de Supabase | (mismo proyecto que platform del tenant) | Sí |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | mismo `pk.*` | Sí para mapa del chofer |
| **`ANTHROPIC_API_KEY`** | desde console.anthropic.com | ⚠ **Sí para AI mediator del chat.** Sin esto, cada mensaje escala al zone_manager (más ruido). |
| `OCR_VISION_PROVIDER` | `claude` (default) o `gemini` | Default OK |
| Las VAPID keys | (mismas que platform) | Sí para push notif |
| `NEXT_PUBLIC_TENANT_TIMEZONE` | `America/Mexico_City` | Sí |

### Control Plane (`tripdrive-control-plane`)

| Variable | Valor | Bloquea si falta |
|---|---|---|
| `CONTROL_PLANE_SUPABASE_URL` | proyecto Supabase del CP (separado del tenant) | Sí |
| `CONTROL_PLANE_SUPABASE_ANON_KEY` | idem | Sí |
| `CONTROL_PLANE_SERVICE_ROLE_KEY` | idem | Sí |
| `CP_SHARED_PASSWORD` | password compartida del staff (ver ADR del CP) | Sí — sin esto no logueas |
| `CP_COOKIE_SECRET` | HMAC secret para firmar cookies | Sí |
| `TENANT_REGISTRY_PATH` | `/etc/tripdrive/tenants.json` | Sí en self-hosted; opcional en Vercel |

---

## 💳 Stripe Dashboard — setup inicial (~15 min)

Antes de cobrar al primer cliente, configurar en https://dashboard.stripe.com:

### 1. Crear los 2 Products (uno por tipo de seat)

**Product 1: "TripDrive Pro — Admin seat"**
- Tipo: Recurring
- Billing period: Monthly
- Currency: MXN
- Precio: el que decidas (ej. $499/mes/admin)
- Después de crear: copia el `price_id` (`price_...`) → eso va en `STRIPE_PRICE_ID_ADMIN`

**Product 2: "TripDrive Pro — Driver seat"**
- Mismo setup, currency MXN, monthly
- Precio: el que decidas (ej. $199/mes/chofer)
- Copia el `price_id` → `STRIPE_PRICE_ID_DRIVER`

### 2. Crear webhook endpoint

Developers → Webhooks → Add endpoint:
- URL: `https://<tu-platform-domain>/api/billing/webhook`
- Eventos a escuchar:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Después de crear: copia el **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

### 3. API key

Developers → API keys → Secret key (en test mode al principio, switch a live después).
Copia → `STRIPE_SECRET_KEY`.

### 4. Customer Portal (opcional pero recomendado)

Settings → Customer portal → Activar y configurar qué puede editar el cliente
(cancelar suscripción, actualizar payment method, ver invoices). Al activarlo,
el botón "Administrar suscripción" del platform abre el portal automáticamente.

### Verificación post-setup

1. En el platform: ir a `/settings/billing` como admin. Debe mostrar status "Sin suscripción" + botón "💳 Empezar Pro".
2. Click → redirect a Stripe Checkout → completar con tarjeta de prueba `4242 4242 4242 4242`.
3. Tras éxito, regresar a `/settings/billing` → status "Activa" + breakdown de seats.
4. En Stripe Dashboard: la subscription aparece con quantities = (admins activos, drivers activos).
5. Crear un nuevo chofer → en `customers.last_seats_synced_at` debe actualizarse + Stripe muestra quantity+1.

---

## 🕒 Schedules n8n

Los 3 endpoints existen en `apps/platform/src/app/api/cron/*` y requieren `x-cron-token` matching `CRON_SECRET`.

### 1. Mark Timed Out Chats — cada 1 minuto

- **Endpoint:** `POST https://verdfrut-platform.vercel.app/api/cron/mark-timed-out-chats`
- **Header:** `x-cron-token: <CRON_SECRET>`
- **Body:** vacío
- **Schedule:** `*/1 * * * *` (cada minuto)
- **Qué hace:** llama RPC `mark_timed_out_chats()` — chats sin respuesta del zone_manager pasan a `timed_out` después de N min.
- **Verificación:** debería responder `{ ok: true, affected: 0 }` la mayoría de veces; ocasionalmente `affected: N>0`.

### 2. Reconcile Orphan Users — 1× por día

- **Endpoint:** `POST https://verdfrut-platform.vercel.app/api/cron/reconcile-orphan-users`
- **Header:** `x-cron-token: <CRON_SECRET>`
- **Schedule:** `0 3 * * *` (3 AM local)
- **Qué hace:** elimina filas en `auth.users` que no tienen `user_profile` (invites canceladas, etc.)
- **Verificación:** `{ ok: true, deleted: N, orphans: [...] }`. `N=0` día normal.

### 3. Rate Limit Buckets Cleanup — 1× por día (ADR-054)

- **Endpoint:** `POST https://verdfrut-platform.vercel.app/api/cron/rate-limit-cleanup` *(endpoint pendiente — issue #142)*
- **Header:** `x-cron-token: <CRON_SECRET>`
- **Schedule:** `0 4 * * *` (4 AM)
- **Qué hace:** RPC `tripdrive_rate_limit_cleanup()` borra rows expirados de `rate_limit_buckets`.
- **Verificación:** `{ ok: true, deleted: N }`.

### 4. Archive Old Breadcrumbs — 1× por mes

- **Endpoint:** `POST https://verdfrut-platform.vercel.app/api/cron/archive-breadcrumbs?days=90`
- **Header:** `x-cron-token: <CRON_SECRET>`
- **Schedule:** `0 4 1 * *` (4 AM del día 1 de cada mes)
- **Qué hace:** borra breadcrumbs GPS más viejos que `?days=N` (default 90). Mantiene `route_breadcrumbs` tabla manejable.
- **Verificación:** `{ ok: true, deleted: N, retentionDays: 90 }`.

### Setup en n8n cloud

Para cada cron:

1. Workflow nuevo → trigger "Schedule" con expresión cron.
2. Node "HTTP Request":
   - Method: `POST`
   - URL: el endpoint
   - Headers: `x-cron-token` = `{{ $env.CRON_SECRET }}` (setear secreto en n8n credentials)
3. Activar workflow.

Si prefieres GitHub Actions, usar `.github/workflows/crons.yml` con `schedule` + `curl` (ya hay templates en `scripts/` del repo).

---

## 📱 APK driver — full TWA

Para que la APK se abra **sin barra Chrome** (modo standalone real), Android valida `https://{host}/.well-known/assetlinks.json` con la SHA-256 del keystore que firmó el APK.

### Cómo verificar que está funcionando

```bash
curl -s https://verdfrut-driver.vercel.app/.well-known/assetlinks.json | head -1
# Debe imprimir: [
#   {
#     "relation": ...
# y el response header debe ser:
#   Content-Type: application/json
```

Si responde 404 o `Content-Type: text/html`, el archivo no está deployando. Revisar:
1. `apps/driver/public/.well-known/assetlinks.json` existe.
2. `next.config.ts` tiene el header config (ya está en este commit).
3. Re-deploy el driver app a Vercel para que aplique los headers.

### SHA-256 actual (demo keystore)

```
0F:FB:14:C4:65:5F:76:0A:BD:89:DB:E3:0E:4D:AA:77:2E:CB:BD:39:18:94:1B:1E:94:F1:A2:CD:F2:F9:FC:78
```

El APK demo (`~/Downloads/verdfrut-conductor-demo.apk`) está firmado con este keystore. El package_id es `com.verdfrut.driver` — se queda así para no invalidar la app ya instalada en celulares de prueba.

### Si necesitas regenerar el APK

```bash
cd mobile/driver-apk
node scripts/init-twa.mjs    # regenera Android project desde twa-manifest.json
node scripts/build-apk.mjs   # compila
# Firmar:
$HOME/.bubblewrap/android_sdk/build-tools/35.0.0/apksigner sign \
  --ks .keystore/verdfrut-driver-demo.jks \
  --ks-key-alias verdfrut-driver \
  --ks-pass pass:VerdFrutDemo2026 \
  --key-pass pass:VerdFrutDemo2026 \
  --out app-release-signed.apk \
  app/build/outputs/apk/release/app-release-unsigned.apk
```

> ⚠ Para producción real (Play Store): rotar a custom domain `driver.tripdrive.xyz` + nuevo keystore con passwords fuertes + AAB en vez de APK. Documentado en `mobile/driver-apk/README.md`.

---

## 🔬 Verificación post-deploy

Después de setear todo:

```bash
# 1. Sentry — disparar un error a propósito
# (en una server action temporalmente: throw new Error('sentry-test'))
# Verificar en dashboard Sentry → Issues, tag app=platform

# 2. Mapbox real — crear un tiro y ver km
# Sin MAPBOX_DIRECTIONS_TOKEN, banner amarillo "ETAs aproximados" aparece.
# Con token set, banner desaparece y km son reales.

# 3. Crons — disparar manual desde n8n con "Execute Workflow"
curl -X POST https://verdfrut-platform.vercel.app/api/cron/mark-timed-out-chats \
  -H "x-cron-token: $CRON_SECRET"

# 4. APK TWA — abrir APK demo en Android sin barra Chrome
# Si aparece barra Chrome con URL: assetlinks no validó. Revisar curl arriba.

# 5. Smoke endpoints
curl -s https://verdfrut-platform.vercel.app/api/health
curl -s https://verdfrut-driver.vercel.app/api/health
curl -s https://verdfrut-production.up.railway.app/health
```

---

## 🚨 Si algo falla en producción

1. **Sentry dashboard** primero — busca el error con tag de la app que falló.
2. **Vercel Runtime Logs** del deploy reciente — search por `[error]` o por el endpoint específico.
3. **Supabase Logs** → Dashboard → Logs → Postgres logs si es error de DB.
4. **Railway Logs** del optimizer si es timeout/error de VROOM.

---

## 📋 Estado del deploy hoy (referencia)

| Recurso | Estado |
|---|---|
| Sentry DSN | ⚠ Pendiente setear en Vercel (commit `01383c2` deja el código listo) |
| MAPBOX_DIRECTIONS_TOKEN | ⚠ Pendiente — sin esto banner ETA demo visible |
| ANTHROPIC_API_KEY (driver) | ⚠ Pendiente — sin esto AI mediator no clasifica |
| Crons n8n | ⚠ Pendiente schedules (los 3 endpoints existen) |
| assetlinks.json header | ✅ Configurado en next.config (deploy nuevo lo aplica) |
| APK keystore | ✅ Demo válido (SHA-256 arriba) |
| Custom domains tripdrive.xyz | ⚠ Pendiente compra dominio + DNS |
