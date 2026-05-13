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

**Stream A impact:** Crons siguen necesitando service role. Pero deben filtrar
por `customer_id` cuando aplica (ej. cleanup per-customer). Issue #215.

### ✅ Legítimo: push fanout (5 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/driver/src/lib/push-fanout.ts:63, 119, 154` | Lee push_subscriptions de TODOS los zone_managers de una zona, NO solo del chofer que envía. Requiere cross-user read. |
| `apps/platform/src/lib/push.ts:57, 124, 171` | Push fanout del platform (cuando admin/dispatcher envía push al chofer). |

**Stream A impact:** Push fanout debe filtrar por `customer_id` igualmente.
RLS post-Stream A bloquearía el cross-user read si fuera sesión normal — service
role sigue siendo apropiado pero el QUERY agrega `WHERE customer_id = ?`.
Issue #216.

### ✅ Legítimo: AI mediator inserta como sender='system' (2 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/driver/src/app/route/stop/[id]/chat/actions.ts:156` | Persiste audit en `chat_ai_decisions` (RLS no permite a chofer insert ahí). |
| `apps/driver/src/app/route/stop/[id]/chat/actions.ts:192` | Inserta `messages` con `sender='system'` (RLS solo permite driver/zone_manager). |

**Stream A impact:** Mover a Edge Function que valida customer_id antes
de insertar. Mientras tanto, agregar customer_id check en el código TS.
Issue #217.

### ✅ Legítimo: user management (auth.users admin API) (4 call-sites)

| Archivo | Justificación |
|---|---|
| `apps/platform/src/lib/queries/users.ts:182` | `supabase.auth.admin.createUser(...)` — invitar usuarios. |
| `apps/platform/src/lib/queries/users.ts:253` | `supabase.auth.admin.updateUserById(...)` — reset password. |
| `apps/platform/src/lib/queries/users.ts:292` | `supabase.auth.admin.deleteUser(...)` — eliminar user. |
| `apps/platform/src/lib/queries/dispatches.ts:145` | Lee user_profiles bypaseando RLS — POR QUÉ? Revisar. |

**Stream A impact:** Los 3 primeros son legítimos (Supabase Auth admin API
requiere service role obligatoriamente). El 4to (`dispatches.ts:145`) NO ES
OBVIO — investigar si puede usar sesión normal con RLS. Issue #218.

### ✅ Legítimo: Control Plane (1 call-site)

| Archivo | Justificación |
|---|---|
| `apps/control-plane/src/lib/cp-client.ts:14` | CP usa schema `control_plane` cross-customer — sin user normal. |

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

### S-1 — `platform/.../dispatches/actions.ts:549`

Necesita revisión manual: ¿qué hace exactamente con service role?

### S-2 — `driver/.../route/actions.ts:159` (AV-#2)

Driver action escribe `route_versions` con service role bypass. Ya documentado
en KNOWN_ISSUES #63 y AV-#2. **Mover a sesión + RLS** específica que permita
al chofer actualizar SOLO su propia ruta.

---

## Plan de eliminación pre-Stream A

| Prioridad | Issue | Acción | Effort |
|---|---|---|---|
| P1 | #63 / AV-#2 | Refactor `route/actions.ts` con sesión normal + RLS field-level | M |
| P1 | #218 | Investigar `dispatches.ts:145` y refactor si aplica | S |
| P2 | #215 | Agregar `customer_id` filter en queries de crons | S |
| P2 | #216 | Agregar `customer_id` filter en push fanout | S |
| P2 | #217 | Mover AI mediator a Edge Function con customer_id check | M |
| P3 | #220 | Filtrar audit page por customer_id | XS |
| P3 | #219 | Refactor rate-limit a sesión normal (SECURITY DEFINER ya cubre) | S |

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
