# VerdFrut — Guía de Deployment a Producción (Vercel + Render)

> Camino más rápido para sacar a producción. Versión V1, sin custom domain
> (usamos `*.vercel.app`). Custom domain queda para una segunda iteración.

## Stack de deploy

| Componente | Plataforma | Costo mes 1 |
|------------|-----------|-------------|
| Optimizer (FastAPI + VROOM) | Render (Docker) | $7 (Starter) |
| Platform (admin) | Vercel | $0 (Hobby) |
| Driver PWA | Vercel | $0 (Hobby) |
| Control Plane | Vercel | $0 (Hobby) |
| Supabase | (ya pagado) | — |
| **Total** | | **$7/mes** |

> **Vercel Hobby es OK para field test mañana.** Si el cliente firma y son
> 5+ usuarios concurrentes, migrar a Pro ($20/mes/team).

---

## ORDEN de deploy (importante)

Sigue este orden estricto — algunos pasos dependen de outputs de pasos previos:

1. **Optimizer en Render** primero → obtienes `OPTIMIZER_URL` y `OPTIMIZER_API_KEY`
2. **Platform en Vercel** → necesita `OPTIMIZER_URL` del paso 1
3. **Driver en Vercel** → necesita `DRIVER_APP_URL` (sale del paso 3 mismo, lo seteás tras el primer deploy)
4. **Control Plane en Vercel** → independiente, puede ir al final
5. **Supabase Auth allow-list** → agregar las 3 URLs `*.vercel.app` que salieron de pasos 2, 3, 4

---

## PASO 1 — Optimizer en Render (~20 min)

### 1.1. Crear cuenta Render

- Ve a https://render.com
- "Sign in with GitHub" (autoriza acceso al repo `Richard7856/Verdfrut`)

### 1.2. Crear el servicio

**Opción A — Vía Blueprint (recomendado, automatizado):**

1. Dashboard → **"New"** → **"Blueprint"**
2. Connect repository: `Richard7856/Verdfrut`
3. Blueprint file path: `services/optimizer/render.yaml`
4. Branch: `main`
5. **"Apply"**

**Opción B — Manual (si Blueprint da error):**

1. Dashboard → **"New"** → **"Web Service"**
2. Connect repository: `Richard7856/Verdfrut`
3. Configura:
   - **Name:** `verdfrut-optimizer`
   - **Region:** Oregon
   - **Branch:** `main`
   - **Root Directory:** `services/optimizer`
   - **Runtime:** `Docker`
   - **Plan:** `Starter ($7/mo)`
   - **Health check path:** `/health`
4. Variables de entorno (Environment):
   - `OPTIMIZER_API_KEY` = (genera una con `openssl rand -hex 32`, **GUÁRDALA**)
   - `PORT` = `8000`
   - `VROOM_BIN_PATH` = `/usr/local/bin/vroom`
   - `LOG_LEVEL` = `info`
5. **"Create Web Service"**

### 1.3. Verificar

Espera ~5 min que termine el build (primer build es lento porque baja la imagen base de VROOM).

Cuando esté en `Live`, copia la URL pública. Algo tipo:
```
https://verdfrut-optimizer.onrender.com
```

Test:
```bash
curl https://verdfrut-optimizer.onrender.com/health
# Esperado: {"status":"ok","vroom_available":true}
```

**Apunta** las 2 cosas que necesitas para los pasos siguientes:
- `OPTIMIZER_URL` = `https://verdfrut-optimizer.onrender.com`
- `OPTIMIZER_API_KEY` = `<la que generaste arriba>`

---

## PASO 2 — Platform en Vercel (~25 min)

### 2.1. Crear el proyecto

1. https://vercel.com → **"Add New"** → **"Project"**
2. Import Git Repository → `Richard7856/Verdfrut`
3. Configure project:
   - **Project Name:** `verdfrut-platform`
   - **Framework Preset:** Next.js (debería autodetectarse)
   - **Root Directory:** `apps/platform`
   - **Build Command:** dejar el default — el `vercel.json` ya lo configura
   - **Install Command:** dejar el default
4. **NO hagas click en Deploy todavía** — primero env vars.

### 2.2. Environment Variables

Click en **"Environment Variables"** y pega TODAS estas (una por una, asegurando que están en `Production`, `Preview` y `Development`):

| Key | Value | Dónde sacarla |
|-----|-------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://hidlxgajcjbtlwyxerhy.supabase.co` | de tu `.env.local` actual |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...` | de tu `.env.local` actual |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | de tu `.env.local` actual |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.eyJ...` | de tu `.env.local` actual |
| `MAPBOX_DIRECTIONS_TOKEN` | `sk.eyJ...` | de tu `.env.local` actual |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `BIdmf...` | de tu `.env.local` actual |
| `VAPID_PRIVATE_KEY` | `gJ3tn...` | de tu `.env.local` actual |
| `VAPID_SUBJECT` | `mailto:rifigue97@gmail.com` | tuyo |
| `OPTIMIZER_URL` | `https://verdfrut-optimizer.onrender.com` | del PASO 1 |
| `OPTIMIZER_API_KEY` | `<el secret que generaste>` | del PASO 1 |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | de tu `.env.local` actual |
| `CRON_SECRET` | `<openssl rand -hex 32>` | genera nuevo, lo necesitas para n8n después |
| `NEXT_PUBLIC_TENANT_TIMEZONE` | `America/Mexico_City` | fijo |
| `NEXT_PUBLIC_ENV_LABEL` | `PROD` | fijo |
| `DRIVER_APP_URL` | _(deja vacío por ahora, lo llenas tras el PASO 3)_ | placeholder |

### 2.3. Deploy

**"Deploy"**. Espera ~3-4 min.

Cuando termine, anota la URL. Algo tipo:
```
https://verdfrut-platform.vercel.app
```

Test:
```bash
curl https://verdfrut-platform.vercel.app/api/health
# Esperado: {"ok":true}
```

---

## PASO 3 — Driver PWA en Vercel (~20 min)

### 3.1. Crear el proyecto

Similar al paso 2 pero con `apps/driver`:

1. **"Add New"** → **"Project"** → import same repo
2. Project Name: `verdfrut-driver`
3. Root Directory: `apps/driver`

### 3.2. Environment Variables

Misma lista que platform PERO **sin** estas (el driver NO las necesita):
- `OPTIMIZER_URL`, `OPTIMIZER_API_KEY` (no llama al optimizer)
- `MAPBOX_DIRECTIONS_TOKEN` (no genera polylines, solo las consume del platform)
- `ANTHROPIC_API_KEY` (sí lo necesita para OCR de tickets)
- `DRIVER_APP_URL` (no aplica)

Sí incluye:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_TENANT_TIMEZONE`
- `NEXT_PUBLIC_ENV_LABEL`
- `PLATFORM_API_URL` = `https://verdfrut-platform.vercel.app` (del paso 2)

### 3.3. Deploy y URL

**"Deploy"** → anota URL: `https://verdfrut-driver.vercel.app`

### 3.4. Backfill — actualizar platform con DRIVER_APP_URL

Vuelve al proyecto `verdfrut-platform`:
- Settings → Environment Variables
- Edita `DRIVER_APP_URL` → pon `https://verdfrut-driver.vercel.app`
- Deployments → tres puntitos del último deploy → **"Redeploy"**

Esto es necesario porque la función `inviteRedirectFor` del platform genera links al driver app, y si el URL es vacío los invites fallan.

---

## PASO 4 — Control Plane en Vercel (~10 min)

1. Mismo flujo, root `apps/control-plane`
2. Environment vars (solo las que aplican al CP):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `CP_SHARED_PASSWORD` = (nueva, fuerte. **NO** uses la de tu .env.local que decía "Test2026")
   - `CP_COOKIE_SECRET` = `<openssl rand -hex 32>` (NUEVA, distinta del local)
   - `NEXT_PUBLIC_ENV_LABEL` = `PROD`
3. Deploy → URL: `https://verdfrut-control-plane.vercel.app`

---

## PASO 5 — Configurar Auth en Supabase (~10 min)

Cada vez que creas un usuario via invite, Supabase verifica que el redirect URL esté en su allow-list. Hoy solo tiene `http://localhost:3001/auth/callback` y similares. Hay que agregar las URLs de prod.

### Vía Dashboard (manual, 2 min)

1. https://supabase.com/dashboard/project/hidlxgajcjbtlwyxerhy/auth/url-configuration
2. **Site URL:** `https://verdfrut-platform.vercel.app`
3. **Additional Redirect URLs** (uno por línea):
   ```
   https://verdfrut-driver.vercel.app/auth/callback
   https://verdfrut-driver.vercel.app/auth/invite
   https://verdfrut-platform.vercel.app/login
   http://localhost:3001/auth/callback
   http://localhost:3001/auth/invite
   http://localhost:3000/login
   ```
4. **Save**

### Vía SQL (alternativa, no recomendada — usa Dashboard)

No hay forma de modificar esto vía SQL puro. Solo Management API o Dashboard.

---

## PASO 6 — Smoke test post-deploy (~15 min)

Sigue este orden, anota cualquier error:

### 6.1. Optimizer

```bash
curl https://verdfrut-optimizer.onrender.com/health
# {"status":"ok","vroom_available":true}
```

### 6.2. Platform login + crear ruta

1. Abre `https://verdfrut-platform.vercel.app/login`
2. Login: `rifigue97@gmail.com` / tu password
3. Ve a `/dispatches` → "Crear tiro" → llena form
4. Dentro del tiro, "Crear ruta nueva" → selecciona vehículo + 3-5 tiendas
5. **"Optimizar"** → debe responder en <2s con secuencia
6. Si esto falla, revisa Logs en Vercel del proyecto platform para ver si pegó al optimizer

### 6.3. Driver login + ver ruta

1. Aprueba + Publica la ruta del paso anterior, asignala a `villafrtty@gmail.com`
2. Abre `https://verdfrut-driver.vercel.app/login` (idealmente desde tu celular real, sino chrome desktop modo móvil)
3. Login: `villafrtty@gmail.com` / tu password
4. Debe ver la ruta del día con las paradas
5. Click "🧭 Iniciar navegación" → debe pintar polyline + dar instrucciones turn-by-turn

### 6.4. Push notifications (CRÍTICO para field test)

1. En el driver desde móvil real, acepta el opt-in de push
2. Verifica en Supabase que se insertó row en `push_subscriptions`
3. Desde el platform, publica una ruta nueva al chofer
4. Debe llegar push al teléfono en <5s

### 6.5. Control Plane

1. Abre `https://verdfrut-control-plane.vercel.app`
2. Login con la `CP_SHARED_PASSWORD` que pusiste en Vercel
3. Overview debe cargar con KPIs
4. `/tenants` debe listar `verdfrut-primary`

---

## Si algo falla durante deploy

### Build de Vercel falla
- Logs → busca el error específico
- Casi siempre es env var faltante (revisa que las 14-15 estén ahí)
- O dependencia no transpilada (revisa `transpilePackages` en `next.config.ts`)

### Optimizer 502
- Render logs → revisa si VROOM arrancó
- El primer build tarda ~5 min, ten paciencia

### "Invalid schema: control_plane"
- Ya aplicado el fix en runtime, pero si después haces un proyecto Supabase NUEVO,
  necesitas correr `ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, control_plane'; NOTIFY pgrst, 'reload config';`

### Auth redirect inválido
- Olvidaste agregar la URL de Vercel a la allow-list de Supabase (PASO 5)

---

## Para producción real (post-field test)

Cuando el cliente firme y la operación crezca, considerar:

- [ ] Custom domain (`driver.verdfrut.com` etc) — 30 min de DNS + SSL automático en Vercel
- [ ] Vercel Pro plan ($20/team/mes) — analytics, mejor build perf
- [ ] Mapbox plan paid — para Matrix con >25 coords (issue #29)
- [ ] Sentry o LogTail — error monitoring
- [ ] n8n con `CRON_SECRET` configurado:
  - `POST /api/cron/mark-timed-out-chats` cada 1 min
  - `POST /api/cron/reconcile-orphan-users` 1× día
- [ ] Backup automático de Supabase (incluido en Pro)
- [ ] Migrar `control_plane` a proyecto Supabase separado (cuando llegue el 2º cliente real)

---

## Resumen de URLs finales

```
Platform:      https://verdfrut-platform.vercel.app
Driver PWA:    https://verdfrut-driver.vercel.app
Control Plane: https://verdfrut-control-plane.vercel.app
Optimizer:     https://verdfrut-optimizer.onrender.com
Supabase:      https://hidlxgajcjbtlwyxerhy.supabase.co
```
