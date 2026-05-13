# Service Role Audit — pre-Stream A

> Inventario de uses de `createServiceRoleClient()` en el monorepo, con
> categorización por legitimidad y plan de eliminación para Stream A.
>
> **Por qué este audit:** Stream A introduce RLS escalada por `customer_id`.
> Si todos los endpoints siguen usando service role (que bypassea RLS),
> la seguridad multi-customer NO funciona. Cada uso del service role debe
> justificarse contra una de 3 razones:
> 1. **Cross-tenant operations** que son por diseño (Control Plane).
> 2. **Operaciones que requieren auth.users** (Supabase Auth admin).
> 3. **Crons / background workers** sin user session.
>
> Cualquier otro uso es deuda técnica a eliminar antes/durante Stream A.
>
> **Total call-sites al 2026-05-13**: 24.
> **Actualización 2026-05-14 (pre-Stream A)**: AV-#2 / issue #63 cerrado vía
> migration 036 + RPC `bump_route_version_by_driver` (ADR-085). Issue #218
> revisado y resuelto: ambas líneas son legítimas. Lint rule #221 implementada
> con `no-restricted-imports`. **Call-sites netos: 23** (driver baja a 0
> bypasses).

---

## Catalogación por legitimidad

### ✅ Legítimo: crons (8 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/app/api/cron/rate-limit-cleanup/route.ts:27` | Limpia rate_limit_buckets — sin user session. |
| `apps/platform/src/app/api/cron/archive-breadcrumbs/route.ts:35` | Archiva breadcrumbs viejos — sin user. |
| `apps/platform/src/app/api/cron/mark-timed-out-chats/route.ts:28` | Cierra chats con timeout — sin user. |
| `apps/platform/src/app/api/cron/reconcile-orphan-users/route.ts:36` | Borra auth.users huérfanos — requiere admin. |
| `apps/platform/src/app/api/cron/chat-decisions-cleanup/route.ts:32` | (nuevo, este commit) limpia chat_ai_decisions viejos. |
| `apps/platform/src/app/api/cron/push-subs-cleanup/route.ts:35` | (nuevo, este commit) limpia push subs inactivas. |

**Stream A impact (issue #215 — 2026-05-14):** Revisión confirma que los 6
crons NO requieren filter por customer_id. Cada uno hace cleanup global por
threshold de tiempo:
- `rate-limit-cleanup` → tabla `rate_limit_buckets` global, sin customer_id.
- `archive-breadcrumbs` → RPC `archive_old_breadcrumbs(retention_days)`
  borra breadcrumbs por fecha; un breadcrumb viejo es viejo independiente
  del customer.
- `mark-timed-out-chats` → RPC `mark_timed_out_chats()` cierra chats por
  `timeout_at < NOW()`; threshold idéntico cross-customer.
- `reconcile-orphan-users` → borra auth.users sin user_profile; operación
  cross-customer correcta (un user huérfano lo es absolutamente).
- `chat-decisions-cleanup` → `DELETE FROM chat_ai_decisions` por fecha;
  tabla sin customer_id, scoped por report_id (UUID único).
- `push-subs-cleanup` → `DELETE FROM push_subscriptions` por last_seen;
  cleanup técnico, scoped por user_id (UUID único).

Excepción futura: si un customer Enterprise pide retention distinta
(ej. 365d vs 90d), se introduce per-customer config en Fase A6 (billing
tiers).

### ✅ Legítimo: push fanout (5 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/driver/src/lib/push-fanout.ts:63, 119, 154` | Lee push_subscriptions de TODOS los zone_managers de una zona, NO solo del chofer que envía. Requiere cross-user read. |
| `apps/platform/src/lib/push.ts:57, 124, 171` | Push fanout del platform (cuando admin/dispatcher envía push al chofer). |

**Stream A impact (issue #216 — ADR-088 / 2026-05-14):**
- **`driver/lib/push-fanout.ts`** — FIXEADO. `sendChatPushToZoneManagers`
  ahora deriva `customer_id` de la zone (`SELECT customer_id FROM zones`),
  resuelve user_ids dentro del customer (admins, dispatchers, zone_managers
  matching), y filtra subs por `user_id IN (...)`. Sin esto, un push de
  customer A llegaba a admins de customer B porque `role = 'admin'` no
  contemplaba multi-tenancy.
- **`platform/lib/push.ts`** — NO requiere cambios. Sus 3 funciones operan
  por UUIDs únicos cross-customer:
  - `sendPushToUser(userId, ...)` → user_id es PK de auth.users.
  - `notifyDriverOfPublishedRoute(routeId)` → resuelve user_id desde
    routes.driver_id.user_id internamente.
  - `notifyDriverOfRouteChange(routeId)` → idem.
  El service_role bypassea RLS solo para leer subs específicas ya
  resueltas por ID; sin riesgo de fanout cross-customer.

### ✅ Legítimo: Orquestador AI endpoints (2 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/app/api/orchestrator/chat/route.ts` | ADR-090 / Ola 2. El endpoint usa la sesión del caller (`createServerClient`) para validar ownership de la session y crear nuevas. Luego usa `createServiceRoleClient` para: (a) leer historial de `orchestrator_messages` cross-session si el caller es admin del customer (audit), (b) pasar el cliente service_role al `ToolContext` que cada tool handler usa para reads/writes con bypass de RLS controlado por customer_id explícito + ownership check en cada tool, (c) escribir mensajes nuevos del turno con shape JSONB sin tener que pasar por la columna `customer_id` (lo llena el trigger). La auth real ya pasó por `requireAdminOrDispatcher` antes; el service_role solo se usa una vez la action ya está autorizada. |
| `apps/platform/src/app/api/orchestrator/upload/route.ts` | ADR-092 / Ola 2 / 2.8. Endpoint multipart para adjuntar XLSX/CSV/imágenes a una sesión del orquestador. Tras `requireAdminOrDispatcher` valida ownership de la session via `createServerClient` (sesión normal); usa `service_role` solo para INSERT en `orchestrator_attachments` con `customer_id` resuelto explícito desde `user_profiles` del caller. content_base64 + parsed_data se persisten para que tools posteriores no requieran re-parsing. |
| `apps/platform/src/app/api/orchestrator/_internal/optimize/route.ts` | ADR-094 / Ola 2 / 2.4. Endpoint **interno** invocado SOLO por el tool `optimize_dispatch` del orquestador (no por usuarios finales). Protegido con header `x-internal-agent-token` validado contra `INTERNAL_AGENT_TOKEN` env. Usa `service_role` para leer/modificar tiros + invocar RPC `tripdrive_restructure_dispatch`. La auth del usuario humano ya pasó por `requireAdminOrDispatcher` en el endpoint `/chat` antes de invocar el tool; el endpoint interno valida `caller_user_id + caller_customer_id` para defensa en profundidad. |

### ✅ Legítimo: AI mediator inserta como sender='system' (2 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/driver/src/app/route/stop/[id]/chat/actions.ts:156` | Persiste audit en `chat_ai_decisions` (RLS no permite a chofer insert ahí). |
| `apps/driver/src/app/route/stop/[id]/chat/actions.ts:192` | Inserta `messages` con `sender='system'` (RLS solo permite driver/zone_manager). |

**Stream A impact (issue #217 — 2026-05-14):** Revisión confirma que NO
requiere customer_id check. Los 2 inserts son scoped por `report_id`
(UUID único cross-customer) y `message_id` (también único). El caller
`mediateChatMessage` ya pasa report_id resuelto por la action chat del
driver con sesión authenticated; el report_id no es manipulable
arbitrariamente. Tabla `chat_ai_decisions` y `messages` no tienen
`customer_id` direct — heredan via FK report_id → delivery_reports →
routes → customer_id.

Excepción futura: si el AI mediator empieza a leer prompt/contexto
custom-per-customer (Fase A3 flow data-driven), entonces sí necesitará
resolver customer_id desde el report_id antes de invocar al modelo.
Issue separado #237 si llega ese requerimiento.

### ✅ Legítimo: user management (auth.users admin API) (3 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/lib/queries/users.ts:182` | `supabase.auth.admin.createUser(...)` — invitar usuarios. |
| `apps/platform/src/lib/queries/users.ts:253` | `supabase.auth.admin.updateUserById(...)` — reset password. |
| `apps/platform/src/lib/queries/users.ts:292` | `supabase.auth.admin.deleteUser(...)` — eliminar user. |

**Stream A impact:** Supabase Auth admin API requiere service role
obligatoriamente. Sin cambios.

### ✅ Legítimo: lectura pública sin sesión (1 call-site)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/lib/queries/dispatches.ts:145` | `getDispatchByPublicToken(token)` para `/share/dispatch/[token]` — visitante anónimo SIN sesión. RLS bloquearía la lectura. |

**Issue #218 resolución 2026-05-14:** Inicialmente clasificado como
sospechoso. Revisión confirma legítimo: el endpoint expone solo dispatches
con `public_share_token` set (revocable), valida UUID antes de la query, y
la lógica del token sustituye el chequeo de sesión. **Stream A impact**:
agregar filter implícito por `customer_id` no aplica — el token mismo es
único por customer; pero al introducir `customer_id` en dispatches debemos
incluirlo en el SELECT para que la share page renderice branding del
customer correcto. Issue #225 para esa adaptación.

### ✅ Legítimo: Control Plane (2 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/control-plane/src/lib/cp-client.ts:14` | CP usa schema `control_plane` cross-customer — sin user normal. |
| `apps/control-plane/src/lib/queries/customers.ts` | Fase A2 / ADR-086: CP lista y administra customers del tenant compartido (schema public) cross-customer. La RLS `customers_select` restringe a "tu propio customer"; super-admin necesita bypass. |

**Stream A impact:** Sin cambios. CP es super-admin TripDrive.

### ✅ Legítimo: rate-limit helper compartido (2 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/lib/rate-limit.ts:59` | Llama RPC `tripdrive_rate_limit_check` (que es SECURITY DEFINER). |
| `apps/driver/src/lib/rate-limit.ts:47` | Idem. |

**Stream A impact:** El RPC ya es SECURITY DEFINER — podría usar sesión normal.
Pero el costo de refactor es mínimo. Issue #219 (P3).

### ✅ Legítimo: audit dashboard (1 call-site)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/app/(app)/audit/chat-failures/page.tsx:38` | Admin lee chat_ai_decisions cross-user (audit). |

**Stream A impact:** Filtrar por customer_id en el query. Issue #220.

---

## ⚠️ Sospechosos — requieren refactor

### S-1 — `platform/.../dispatches/actions.ts:549` — ✅ CONFIRMADO LEGÍTIMO (2026-05-14)

Llama a RPC `tripdrive_restructure_dispatch` (migration 032). La RPC fue
declarada `SECURITY DEFINER` con `GRANT EXECUTE` SOLO a `service_role` —
deliberadamente bloqueada para sesión normal. Razón: la RPC borra rutas
viejas + inserta nuevas en una sola transacción, y la decisión fue
tunelizar TODO ese flujo crítico a través de service_role para tener un
único punto de control / auditoría. La action ya hace
`requireRole('admin', 'dispatcher')` antes del call.

**Stream A impact**: evaluar si la RPC debe reabrirse a `authenticated`
con validación interna de role + customer_id, eliminando service_role del
client-side. Si se reabre, recordar agregar check
`current_user_customer() = dispatch.customer_id`. Issue #226 (P2).

### S-2 — `driver/.../route/actions.ts:159` (AV-#2) — ✅ RESUELTO 2026-05-14

Cerrado por ADR-085 + migration 036. La action ahora usa
`supabase.rpc('bump_route_version_by_driver', ...)`. La RPC es
SECURITY DEFINER + valida `auth.uid()` como chofer dueño de la ruta + estado
PUBLISHED/IN_PROGRESS antes de bump. Issue #63 cerrado.

---

## Plan de eliminación pre-Stream A

| Prioridad | Issue | Acción | Effort | Status |
|---|---|---|---|---|
| P1 | #63 / AV-#2 | Refactor `route/actions.ts` con RPC SECURITY DEFINER | M | ✅ ADR-085 |
| P1 | #218 | Investigar `dispatches.ts:145` / `actions.ts:549` | S | ✅ ambos legítimos |
| P1 | #221 | ESLint rule contra `createServiceRoleClient` fuera del allow-list | S | ✅ implementada |
| P2 | #215 | Agregar `customer_id` filter en queries de crons | S | ✅ no-change (cleanup global por threshold de tiempo) |
| P2 | #216 | Agregar `customer_id` filter en push fanout | S | ✅ ADR-088 — driver/lib/push-fanout.ts deriva customer_id de zone |
| P2 | #217 | Mover AI mediator a Edge Function con customer_id check | M | ✅ no-change (inserts scoped por report_id UUID único) |
| P2 | #226 | Reabrir `tripdrive_restructure_dispatch` a authenticated (eval) | M | abierto |
| P3 | #220 | Filtrar audit page por customer_id | XS | abierto |
| P3 | #219 | Refactor rate-limit a sesión normal (SECURITY DEFINER ya cubre) | S | abierto |
| P3 | #225 | Adaptar `getDispatchByPublicToken` a customer_id | XS | abierto |

**Total effort estimado:** ~1 sprint (2 semanas) para hacer todo P1+P2 + ~3 días
para P3. Hacer ANTES del primer cliente real multi-customer.

---

## Métrica de éxito post-Stream A

Una vez completado el plan:
- **0 calls** de `createServiceRoleClient()` que pueda servirse con sesión + RLS.
- **N calls legítimos restantes** documentados en este archivo con justificación.
- **CI lint rule:** ESLint regla que prohíbe `createServiceRoleClient()` excepto
  en archivos del allow-list (definidos aquí).

Issue #221 para implementar la regla de ESLint.

---

## Apéndice — Comando para re-correr el audit

```bash
grep -rn "createServiceRoleClient()" \
  apps/platform/src \
  apps/driver/src \
  apps/control-plane/src \
  2>/dev/null | sed 's|.*/VerdFrut/||'
```
