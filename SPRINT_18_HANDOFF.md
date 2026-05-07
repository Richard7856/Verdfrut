# Sprint 18 — Handoff doc

> Documento autocontenido para entrar a una **nueva sesión** sin contexto.
> Si abres una sesión nueva de Claude para seguir VerdFrut, lee primero
> `MEMORY.md` (auto-cargado), después este doc, después `ROADMAP.md`.

---

## Resumen ejecutivo de qué pasó

Sprint 18 implementó 9 sub-features que centralizan al **admin** como el único actor con visibilidad completa, mientras `zone_manager` queda restringido SOLO al chat. Implementa **GPS resilience** para el caso "chofer abre Waze", **detección automática de anomalías**, **notificaciones agresivas multi-modal** al admin, **transferir paradas** cuando se descompone un camión, y un **AI mediator** en el chat para filtrar trivialidades.

**No se migró a Expo** — se decidió que la PWA + estas mejoras cubre el caso real del cliente (alerta por anomalía vs tracking continuo).

---

## URLs de producción (live, sin cambio)

```
Platform        → https://verdfrut-platform.vercel.app
Driver PWA      → https://verdfrut-driver.vercel.app
Control Plane   → https://verdfrut-control-plane.vercel.app
Optimizer       → https://verdfrut-production.up.railway.app
Supabase        → https://hidlxgajcjbtlwyxerhy.supabase.co
GitHub          → https://github.com/Richard7856/Verdfrut.git (branch main)
```

---

## Cuentas de prueba

```
Admin:        rifigue97@gmail.com  (id: 03a6e456-d95e-4d71-8802-34d1f66818e4)
Chofer:       villafrtty@gmail.com  (driver_id: ddc6732a-3116-4e79-af28-17c87c47fdd2)
Zone manager: manager.cdmx@verdfrut.com / Manager2026!  (zona CDMX)
```

---

## Modelo de roles V2 (CAMBIO IMPORTANTE)

| Rol | Qué ve | Donde entra al login |
|-----|--------|----------------------|
| `admin` | TODO (mapa, dashboard, listas, anomalías, chat, etc.) | `/routes` |
| `dispatcher` | Igual que admin (excepto /settings/zones, /settings/users) | `/routes` |
| `zone_manager` | **SOLO** `/incidents/active-chat` (su único chat abierto) | `/incidents/active-chat` |
| `driver` | (no entra al platform, solo driver app) | `/login` driver |

Si un zone_manager intenta tipear `/map` u otra URL → redirect automático a `/incidents/active-chat`.

---

## Pendientes operacionales que NO se hicieron en Sprint 18 (HACER ANTES DE 1ER CLIENTE FACTURADO)

### 1. Variables de entorno faltantes en Vercel

#### `verdfrut-driver` (CRÍTICAS):
- `MAPBOX_DIRECTIONS_TOKEN` — sin esto el endpoint `/api/route/dynamic-polyline` retorna `mapbox_unavailable` y entra en loop "Recalculando ruta"
- `ANTHROPIC_API_KEY` — sin esto el AI mediator clasifica TODO como 'unknown' (escala todo, no filtra trivialidades)

#### `verdfrut-platform` (verificar):
- `OPTIMIZER_URL`, `OPTIMIZER_API_KEY`, `CRON_SECRET`, `DRIVER_APP_URL` — debían estar desde el deploy original

### 2. Schedules de cron en n8n (ninguno está corriendo)

```bash
# Cada 1 minuto
POST https://verdfrut-platform.vercel.app/api/cron/mark-timed-out-chats
Header: x-cron-token: <CRON_SECRET>

# 1 vez al día (medianoche CDMX)
POST https://verdfrut-platform.vercel.app/api/cron/reconcile-orphan-users
Header: x-cron-token: <CRON_SECRET>

# 1 vez al mes (día 1 medianoche CDMX)
POST https://verdfrut-platform.vercel.app/api/cron/archive-breadcrumbs
Header: x-cron-token: <CRON_SECRET>
```

### 3. Admin acepta push notifications

El admin debe entrar a `/dashboard` UNA vez y dar clic en "Activar" del banner azul. Si rechaza, push browser nunca llega.

### 4. Supabase Auth allow-list

Verificar que las URLs Vercel están en Auth → URL Configuration:
- `https://verdfrut-driver.vercel.app/auth/callback`
- `https://verdfrut-driver.vercel.app/auth/invite`
- `https://verdfrut-platform.vercel.app/login`

---

## Migraciones aplicadas (estado de Supabase tenant)

```
001-022   Originales (deploy + features pre-S18)
023       route_gap_events (S18.4)
024       get_active_anomalies() function (S18.5)
025       breadcrumbs_ttl + actual_distance + trigger (S18.6)
026       route_status INTERRUPTED + route_transfers (S18.7)
027       chat_ai_decisions audit (S18.8)
```

Si haces un `supabase reset` sobre un proyecto NUEVO, las 27 migraciones se aplican en orden y todo queda al día.

---

## Cosas asumidas (assumptions a vigilar)

### Modelo de roles
- **Asumimos:** un usuario VerdFrut staff actúa como `admin`, no como `zone_manager`.
- **Cuidado si:** alguien internal está como `zone_manager` en `user_profiles`. Perdió acceso al dashboard tras S18.1. Verificar con `SELECT email, role FROM user_profiles WHERE role = 'zone_manager'`.

### Push notifications
- **Asumimos:** VAPID keys configuradas (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
- **Cuidado si:** las keys cambian en algún proyecto Supabase. La key del platform DEBE ser la misma del driver — sino los clients se suscriben con una y el server envía con otra → 404 silencioso.

### AI mediator
- **Asumimos:** ANTHROPIC_API_KEY válido. Cada mensaje cuesta ~$0.001 (Haiku). Para 50 choferes × 5 mensajes/día = $7.50/mes en API.
- **Cuidado si:** el cliente del cliente tiene tono ambiguo. AI puede clasificar erróneo. Calibrar prompt quincenalmente con `chat_ai_decisions` audit.

### GPS gap detection
- **Asumimos:** el chofer SIEMPRE vuelve a la app eventualmente (cleanup cierra gap con `route_completed`).
- **Cuidado si:** chofer cierra app abruptamente y no vuelve hasta el día siguiente. Gap queda eterno hasta que llega el cron de timeout (issue #51).

### Route transfer
- **Asumimos:** vehicle/driver destino tienen capacity. NO validamos.
- **Cuidado si:** admin transfiere 10 paradas a un Kangoo (capacity 6). Aceptamos sin warning (issue #54).

### Service Worker del platform
- **Asumimos:** el SW de `/sw-push.js` se registra correctamente en el browser del admin.
- **Cuidado si:** el admin tiene browser muy viejo o restricciones de SW. Push browser falla silenciosamente. Toast in-app aún funciona.

### Mapa en panel dual
- **Asumimos:** la ruta del report sigue existiendo y tiene stops + depot.
- **Cuidado si:** ruta fue borrada o stops sin coords válidos. Mostramos placeholder pero no exception. Si falta `NEXT_PUBLIC_MAPBOX_TOKEN` → placeholder explícito.

---

## Posibles bugs / fallas vigilar (los que NO se han manifestado pero pueden)

### Bug latente #1 — Cookie HMAC del control plane invalida sesiones tras deploy
- **Cuándo:** si rotamos `CP_COOKIE_SECRET` en Vercel control-plane (intencional o por accidente).
- **Síntoma:** todos los staff con sesión activa son expulsados. Re-login con shared password resuelve.
- **Mitigación:** documentar que rotación de secret es expulsión global.

### Bug latente #2 — Trigger calc_route_actual_distance lento con muchas rutas
- **Cuándo:** si en algún momento ejecutamos UPDATE masivo de rutas (ej. cleanup script). El trigger BEFORE UPDATE corre 1 vez por row, cada vez calculando distance. 100 rutas × 5s = 500s.
- **Mitigación:** SET session_replication_role = replica antes del cleanup.

### Bug latente #3 — visibilitychange race condition con outbox
- **Cuándo:** si chofer está en background con outbox lleno + dispara gap_start. El insert puede ir en paralelo con flush del outbox.
- **Síntoma:** improbable race (insert duplicate). DB no tiene UNIQUE en route_id+started_at, así que no hay error pero podría haber gap duplicado.
- **Mitigación:** futuro UNIQUE constraint en route_gap_events (route_id, started_at).

### Bug latente #4 — Notification toast con Action no se cierra al click
- **Cuándo:** admin tiene 10+ toasts abiertos. Cada uno tiene click handler que navega.
- **Síntoma:** después del click, el toast cerrado pero los demás siguen visibles.
- **Mitigación:** Toaster lib actual tiene auto-dismiss 5s — manageable.

### Bug latente #5 — INTERRUPTED routes no se filtran del dashboard
- **Cuándo:** admin abre /dashboard, el conteo de "rutas completadas" puede o no incluir INTERRUPTED.
- **Verificar:** `get_dashboard_overview` SQL function — si solo cuenta `status = 'COMPLETED'`, OK. Si cuenta IN (...), revisar.
- **Lo que está:** revisé al implementar y solo cuenta COMPLETED. OK.

### Bug latente #6 — chofer destino de transfer NO recibe push
- **Cuándo:** transfer crea ruta nueva PUBLISHED pero NO llamamos a `sendPublishPush` o equivalente.
- **Síntoma:** chofer no se entera de la ruta hasta que entra al app y refresh.
- **Solución:** agregar push trigger en `transferRouteRemainderAction` paso 5. Tarea para Sprint 19.

---

## Medidas de seguridad implementadas

### RLS estricto
- `chat_ai_decisions` — solo admin/dispatcher leen audit.
- `route_gap_events` — driver inserta/update suyos, supervisión lee de zona.
- `route_transfers` — solo admin/dispatcher.
- `delivery_reports` (ya existía) — driver suyos, zone_manager de zona, admin/dispatcher todos.

### Defense in depth
- UI gates por rol (sidebar filter + page-level requireRole) NO son la seguridad real — RLS lo es.
- Si un atacante manipula el client y bypassa la UI, RLS sigue bloqueando.

### Secrets server-only
- `MAPBOX_DIRECTIONS_TOKEN` (sk.*) — solo server, nunca al cliente.
- `ANTHROPIC_API_KEY` — solo server.
- `VAPID_PRIVATE_KEY` — solo server (para enviar push).
- `SUPABASE_SERVICE_ROLE_KEY` — solo server (RLS bypass).
- `CP_SHARED_PASSWORD`, `CP_COOKIE_SECRET` — solo server.
- `OPTIMIZER_API_KEY` — solo server.

### Push fanout endpoint pruning
- Si Web Push API devuelve 404 o 410 (subscription muerta) → eliminamos automáticamente del DB.
- Evita acumular zombie subscriptions.

### Anti-fraude geo
- `arriveAtStop` rechaza con `too_far` si chofer está >300m de la tienda (entrega/báscula) o >1000m (tienda_cerrada).
- `DEMO_MODE_BYPASS_GEO` REMOVIDO permanentemente (S18.9) — ya no hay forma de saltar la validación geo desde código.
- Si se necesita demo en oficina: reintroducir en branch dedicada y revertir antes de mergear.

### Rate limiting
- `consume(userId, scope, limit)` en chat (driver y manager), OCR, etc.
- LIMITS.chatDriverMessage = 30/min, LIMITS.chatManagerMessage = 60/min.

---

## Cómo verificar que todo está OK (smoke test S18)

### 1. Roles V2
```bash
# Login como manager.cdmx@verdfrut.com
# Verificar:
- Sidebar solo muestra "Mi chat"
- Tipear /map en URL → redirect a /incidents/active-chat
- Tipear /dashboard → redirect a /incidents/active-chat
```

### 2. Panel dual mapa+chat
```bash
# Login como rifigue97@ (admin)
# Crear ruta nueva, asignar chofer, publicar
# Login chofer en otro device, abrir chat de cualquier parada (paso "tienda_cerrada")
# Como admin, abrir /incidents/[reportId]
# Verificar:
- Layout 2 columnas en desktop
- Mapa muestra paradas + marker chofer + polyline
- Chat funciona con composer
- Si chofer se mueve, marker se actualiza
```

### 3. Notificaciones admin (4 modalidades)
```bash
# Admin con tab abierta en /dashboard, sound toggle ON
# Chofer envía mensaje "necesito ayuda" desde otro device
# Verificar (en orden):
- Badge "Incidencias" en sidebar pasa de 0 a 1
- Toast aparece arriba derecha con CTA "Ver"
- Sonido beep suena (si toggle 🔊 prendido)
- Si admin cambia de tab, push del browser llega al SO
```

### 4. AI mediator
```bash
# Chofer envía "hay tráfico denso, voy retrasado"
# Verificar:
SELECT category, auto_reply, rationale FROM chat_ai_decisions ORDER BY classified_at DESC LIMIT 1;
# → category='trivial', auto_reply=algo empático, admin NO recibió push

# Chofer envía "se ponchó la llanta y no traigo refacción"
# Verificar:
SELECT category, rationale FROM chat_ai_decisions ORDER BY classified_at DESC LIMIT 1;
# → category='real_problem', admin SÍ recibió push
```

### 5. Anomalías
```bash
# Modificar manualmente para testing:
UPDATE routes SET estimated_end_at = NOW() - INTERVAL '20 minutes' WHERE id = '<ruta_in_progress>';
# Como admin, abrir /incidents/anomalies
# Verificar: aparece la ruta en sección "Ruta atrasada" con CTA "Ver ruta"
```

### 6. Gap detection
```bash
# Chofer en /route/navigate
# Tap el botón Maps externo → app va background
# Esperar 30 seg
# Volver a la app
# Verificar:
SELECT * FROM route_gap_events WHERE driver_id = '<driver>' ORDER BY started_at DESC LIMIT 1;
# → row con duration_seconds ≈ 30, end_reason='back_to_app'
```

### 7. Route transfer
```bash
# Ruta en IN_PROGRESS con 4/10 paradas completadas
# /routes/[id] como admin
# Click "⚠ Transferir paradas pendientes" → modal
# Seleccionar otro vehículo + otro chofer + razón "Llanta ponchada"
# Confirmar
# Verificar:
SELECT id, status FROM routes WHERE id = '<original>'; -- status='INTERRUPTED'
SELECT id, status FROM routes WHERE id = '<nueva>'; -- status='PUBLISHED'
SELECT count(*) FROM stops WHERE route_id = '<nueva>' AND status = 'pending'; -- 6
SELECT * FROM route_transfers WHERE source_route_id = '<original>'; -- 1 row con audit
```

---

## Sprint 19 — Lo que sigue (de ROADMAP.md)

**Tema:** Performance + observabilidad. ~1 semana de trabajo.

- **S19.1** — Sentry en producción (~1 día). Sin esto, errores que el admin/chofer ven se pierden.
- **S19.2** — Lighthouse audit del driver PWA (~1 día). Bundle size, TTI, SW cache.
- **S19.3** — N+1 queries audit (~1 día). `/routes`, `/dispatches`, `/dashboard/stores/[id]`.
- **S19.4** — Configurar n8n con los 3 schedules (~30 min).
- **S19.5** — Marker GPS con interpolación (issue #34) (~30 min).

Después: Sprint 20 polish + custom domains.

---

## Cómo arrancar dev local (cuando vuelvas a sesión nueva)

```bash
cd /Users/richardfigueroa/Downloads/VerdFrut

# Terminal 1 — Optimizer Docker
OPTIMIZER_API_KEY=dev-secret-change-in-prod docker compose up -d optimizer

# Terminal 2 — Platform (port 3000)
pnpm --filter @verdfrut/platform dev

# Terminal 3 — Driver (port 3001)
pnpm --filter @verdfrut/driver dev

# Terminal 4 — Control plane (port 3002)
pnpm --filter @verdfrut/control-plane dev
```

O todo en uno: `pnpm dev` (turbo, intercala logs).

---

## Quick reference de comandos útiles

### Validar tipos del monorepo entero
```bash
pnpm -r type-check
# Esperado: 10/10 packages limpio
```

### Ver últimos commits
```bash
git log --oneline -20
```

### Listar migraciones aplicadas
```bash
ls supabase/migrations/ | sort
```

### Smoke test de los 4 servicios prod
```bash
curl -s https://verdfrut-platform.vercel.app/api/health
curl -s https://verdfrut-driver.vercel.app/api/health
curl -s https://verdfrut-control-plane.vercel.app/api/health
curl -s https://verdfrut-production.up.railway.app/health
# Todos deben devolver {"status":"ok"} o similar
```

### Estadísticas del repo
```bash
git log --oneline | wc -l                          # Total commits
ls supabase/migrations/*.sql | wc -l               # Migraciones
grep -c "^## \[" DECISIONS.md                       # ADRs
find apps -name "*.tsx" -o -name "*.ts" | grep -v node_modules | grep -v ".next" | wc -l   # Source files
```

---

## Si te pasa algo durante la próxima sesión

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| Driver app loop "Recalculando" | `MAPBOX_DIRECTIONS_TOKEN` faltante en Vercel driver | Agregar env var + Redeploy |
| AI escala TODO mensaje (no filtra) | `ANTHROPIC_API_KEY` faltante en Vercel driver | Agregar env var + Redeploy |
| Admin no recibe push browser | `/sw-push.js` no se registró o admin no opted-in | Abrir /dashboard, click "Activar" en banner azul |
| Chofer aparece en gris para siempre | gap_event sin ended_at por crash de PWA | UPDATE manual + cron timeout (#51) |
| Chat en /incidents/[reportId] sin mapa | Ruta deleted o sin Mapbox token | Verificar route exists, NEXT_PUBLIC_MAPBOX_TOKEN |
| Build de Vercel falla | env var faltante o vercel.json mal | Logs Vercel → buscar error |
| Optimizer 502 | Railway dormido (no plan starter) o crash | Railway dashboard → restart |
| Type check rompe en NUEVA columna o status | enum desactualizado en `RouteStatus` o `Database` | Agregar al type union |

---

## Archivos clave para nueva sesión

```
SPRINT_18_HANDOFF.md          ← este archivo
ROADMAP.md                     ← qué sigue (Sprint 19+)
KNOWN_ISSUES.md                ← bugs/risks abiertos numerados
DECISIONS.md                    ← 32 ADRs cronológicos
DEPLOYMENT.md                   ← cómo deployar a Vercel/Railway
PRE_FIELD_TEST_CHECKLIST.md    ← runbook pre-field-test
PROJECT_BRIEF.md                ← visión + stack + roadmap original
.claude/projects/.../memory/project-state.md   ← auto-cargado al abrir sesión
```
