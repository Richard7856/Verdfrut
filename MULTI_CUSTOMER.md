# Stream A — Multi-Customer real

> Plan detallado para convertir TripDrive de un sistema single-customer
> (VerdFrut/NETO) en una plataforma SaaS multi-tenant donde cada cliente
> opera con su propia configuración bajo un mismo deploy.
>
> **Estado**: 🔴 Plan — no arranca hasta cierre de Stream B (native app pilot
> con NETO validado por al menos 1 mes en operación estable).
>
> **Owner**: Richard.
>
> **Última actualización**: 2026-05-13.

---

## 0. Decisión fundamental: arquitectura del multi-tenancy

Hay 3 modelos de multi-tenancy en SaaS. Cada uno tiene trade-offs:

| Modelo | Aislamiento | Costo infra | Complejidad código | Migración |
|---|---|---|---|---|
| **1. Schema-per-tenant** (1 BD, N schemas) | Alto | Bajo | Medio | Compleja |
| **2. Row-level (RLS por tenant_id)** | Medio | Muy bajo | Bajo | Fácil |
| **3. Project-per-tenant** (1 Supabase project por cliente) | Máximo | Alto ($25/mes c/u) | Alto (deploy + migrate por cliente) | Por cliente |

**Hoy estamos en modelo #3** (project-per-tenant): cada cliente tiene su
propio proyecto Supabase. Esto fue decisión correcta para V1 (NETO solo) pero
limita el crecimiento — cada cliente nuevo requiere:
- Crear proyecto Supabase ($25/mes mínimo).
- Correr todas las migraciones.
- Configurar env vars para cada app del cliente.
- 2-4 horas operativas por cliente nuevo.

### Decisión recomendada para Stream A: **Modelo híbrido #2 + #3**

- **Multi-tenancy INTERNA dentro de cada proyecto Supabase**: agregar
  `customer_id` a las tablas operativas + RLS escalada por customer + zonas
  agrupadas en customers.
- **Project-per-tier mayor** seguir existiendo: si entra cliente Enterprise
  que pide BD aislada, sigue siendo posible (mismo schema, distinto deploy).
- Para clientes Pro/Starter compartirán proyecto Supabase de "TripDrive
  Standard" con RLS aislando data.

**Por qué híbrido:**
- Clientes con compliance requirements (banca, gobierno) van a #3.
- Clientes SMB pueden ir a #2 compartido (menor costo, igual aislamiento via RLS).
- Modelo de pricing soporta esta diferenciación natural.

---

## 1. Schema changes

### 1.1. Nueva tabla `customers`

```sql
CREATE TYPE customer_status AS ENUM (
  'active',     -- operando normalmente
  'paused',     -- contrato congelado, sin operación
  'churned',    -- cancelado, en período de retención de datos (30d)
  'demo'        -- cuenta demo, sin facturación
);

CREATE TYPE customer_tier AS ENUM (
  'starter',    -- 1-10 choferes, features básicas
  'pro',        -- 11-50 choferes, todas features + analytics
  'enterprise'  -- 50+, custom integrations, dedicated support
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,    -- 'neto', 'oxxo', 'bimbo' — para subdomain
  name TEXT NOT NULL,
  legal_name TEXT,              -- razón social CFDI
  rfc TEXT,                     -- mx tax id
  status customer_status NOT NULL DEFAULT 'demo',
  tier customer_tier NOT NULL DEFAULT 'starter',
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  bbox_lat_min FLOAT,           -- operational area
  bbox_lat_max FLOAT,
  bbox_lng_min FLOAT,
  bbox_lng_max FLOAT,
  -- Branding visible a sus choferes/usuarios (UI overrides en app native + web)
  brand_color_primary TEXT DEFAULT '#34c97c',
  brand_logo_url TEXT,
  -- Flow del chofer override (NULL = flow estándar TripDrive)
  flow_engine_overrides JSONB,
  -- Pricing snapshot al momento del contrato (audit)
  monthly_fee_mxn INT,
  per_driver_fee_mxn INT,
  contract_started_at DATE,
  contract_ends_at DATE,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_slug ON customers(slug);
```

### 1.2. FK `customer_id` en tablas operativas

Tablas que se "agrupan" por customer (NO copia, FK):

```sql
ALTER TABLE zones        ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE depots       ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE stores       ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE vehicles     ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE drivers      ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE user_profiles ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE dispatches   ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE routes       ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
-- stops, delivery_reports, messages, breadcrumbs etc heredan customer_id via route
```

NULL temporal durante migración (Sec. 4). Después de backfill, NOT NULL.

### 1.3. RLS escalada por customer

Todas las policies existentes se reescriben para filtrar por
`user.customer_id = row.customer_id`:

```sql
-- Antes (V1):
CREATE POLICY zones_select ON zones FOR SELECT TO authenticated
  USING (true);

-- Después (V2):
CREATE POLICY zones_select ON zones FOR SELECT TO authenticated
  USING (customer_id = (SELECT customer_id FROM user_profiles WHERE id = auth.uid()));
```

Helper function nueva:
```sql
CREATE FUNCTION current_customer_id() RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT customer_id FROM user_profiles WHERE id = auth.uid()
$$;
```

Y cada policy: `USING (customer_id = current_customer_id())`.

### 1.4. Nuevas tablas para customización per-customer

```sql
-- Flow steps custom por customer (override del flow_engine hardcoded)
CREATE TABLE customer_flow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  report_type report_type NOT NULL,   -- entrega | tienda_cerrada | bascula
  step_name TEXT NOT NULL,             -- 'arrival_exhibit', custom names
  step_order INT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}',  -- field types, validation rules, etc
  next_step_logic JSONB,               -- conditional branching rules
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, report_type, step_name)
);

-- Custom fields que el customer quiere en stores (cliente NETO requiere
-- 'sucursal_id', cliente OXXO requiere 'manager_zona', etc.)
CREATE TABLE customer_store_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL,            -- text | number | boolean | enum
  enum_values TEXT[],
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, field_key)
);

-- Y stores.custom_fields JSONB para almacenar los valores
ALTER TABLE stores ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}';
```

---

## 2. Flow engine data-driven

Actualmente `@tripdrive/flow-engine` tiene la máquina de estados hardcoded
en TS (`transitions.ts`, ver Sec. 9 de PLATFORM_STATUS). Para soportar
flujos custom per customer, hay que convertirlo en data-driven.

### 2.1. Estructura del nuevo flow-engine

```ts
// @tripdrive/flow-engine v2
export interface FlowStepDefinition {
  name: string;
  order: number;
  type: 'photo' | 'form' | 'choice' | 'finish';
  required: boolean;
  fields?: FlowField[];          // si type=form
  nextStep?: string;             // próximo step lineal
  branches?: FlowBranch[];       // si choice: opciones
}

export interface FlowBranch {
  condition: { field: string; equals: unknown };
  nextStep: string;
}

export class FlowEngine {
  constructor(private definition: FlowStepDefinition[]) {}

  getInitialStep(): string { /* devuelve order=0 */ }
  getNextStep(currentStep: string, context: Record<string, unknown>): string | null { /* evalúa branches */ }
}

// Factory function
export async function loadFlowForCustomer(
  customerId: string,
  reportType: ReportType,
  supabase: SupabaseClient,
): Promise<FlowEngine> { /* fetch desde customer_flow_steps */ }
```

### 2.2. Renderizado dinámico de pantallas

Hoy `apps/driver/src/app/route/stop/[id]/page.tsx` renderiza UI hardcoded
por step (ej. `<TicketCapture />`, `<MermaForm />`, etc.). En V2 entra
`<FlowStepRenderer step={step} />` que dispatcha al componente correcto
basándose en `step.type`.

Native (`apps/driver-native/`): mismo patrón. La pantalla `/evidence` hoy
es single-screen — en V2 puede ser wizard si el customer lo requiere.

### 2.3. Migración del flow actual a data-driven

Seed de `customer_flow_steps` con los flows actuales hardcoded como
"TripDrive Standard" (customer_id NULL = template global). Cuando un
customer se onboarda, se copian estos steps a su customer_id; admin puede
editarlos.

---

## 3. UI del Control Plane: gestión de customers

`apps/control-plane/` (super-admin TripDrive interno) gana nuevas pantallas:

```
/customers              — lista con filtros tier/status
/customers/[id]         — detalle: contrato, branding, KPIs
/customers/[id]/flow    — visual editor del flow_engine
/customers/[id]/billing — pricing snapshot, facturas Stripe
/customers/[id]/users   — invitar usuarios al customer
/customers/new          — wizard onboarding
```

El **onboarding wizard** crea:
1. Row en `customers`.
2. Zone(s), depot(s), vehicle(s) iniciales del customer.
3. Usuario admin del customer (recibe email con link de activación).
4. Seed del flow_engine standard.
5. Branding inicial (color + logo upload).

---

## 4. Estrategia de migración (data existente)

### 4.1. Schema migration (0-downtime)

```sql
-- Migration #035: agregar customer_id como NULLABLE
BEGIN;
ALTER TABLE customers ADD COLUMN ...;
INSERT INTO customers (slug, name, status, tier) VALUES
  ('verdfrut', 'VerdFrut', 'active', 'pro');
-- Asumimos un solo customer existente (datos actuales pertenecen todos a VerdFrut)

ALTER TABLE zones ADD COLUMN customer_id UUID REFERENCES customers(id);
UPDATE zones SET customer_id = (SELECT id FROM customers WHERE slug = 'verdfrut');
ALTER TABLE zones ALTER COLUMN customer_id SET NOT NULL;
-- Repetir para depots, stores, vehicles, drivers, dispatches, routes, user_profiles
COMMIT;
```

### 4.2. RLS migration

```sql
-- Migration #036: rewrite policies con customer_id check
DROP POLICY zones_select ON zones;
CREATE POLICY zones_select ON zones FOR SELECT TO authenticated
  USING (customer_id = current_customer_id());
-- Repetir para CADA tabla
```

Riesgo: si una policy queda mal, los usuarios pierden acceso a su data.
**Mitigación:**
1. Hacer la migración en un branch Supabase (no main).
2. Test con cuenta real de admin VerdFrut.
3. Validar lectura de routes/stops/dispatches.
4. Solo después merge a main.

### 4.3. App code migration

Order de release para zero-downtime:

1. **Migration SQL** (NULLABLE + backfill) — sin breaking changes.
2. **App code lee y escribe `customer_id`** — usa default si NULL (compat).
3. **NOT NULL constraint + RLS por customer_id** — apps ya lo usan.
4. **Control Plane UI** — gestión visible.
5. **Onboarding 2do customer** real.

---

## 5. Pricing y monetización

| Tier | Precio mensual | Choferes incluidos | Características |
|---|---|---|---|
| Starter | $3,500 MXN | 5 | Optimizer + tracking + push básicos |
| Pro | $9,000 MXN | 25 | + Multi-customer dashboards, AI mediator, export XLSX |
| Enterprise | Cotización | 50+ | + BD aislada, integraciones (SAP/CFDI/WhatsApp), SLA |

**Add-ons** (todos los tiers):
- Setup fee único: $15,000 MXN (onboarding + capacitación).
- Choferes adicionales sobre el incluido: $400 MXN/chofer/mes.
- WhatsApp Business API integration: $2,500 MXN/mes.
- CFDI billing automation: $5,000 MXN/mes (entra cuando llegue compliance dev).

### 5.1. Tracking en BD

`customers` ya tiene `monthly_fee_mxn` + `per_driver_fee_mxn` como snapshot al
contrato. Para billing real:

```sql
CREATE TABLE customer_invoices (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_fee_mxn INT NOT NULL,
  driver_count INT NOT NULL,
  driver_overage_fee_mxn INT NOT NULL DEFAULT 0,
  addons_fee_mxn INT NOT NULL DEFAULT 0,
  total_mxn INT NOT NULL,
  status TEXT NOT NULL,  -- pending | paid | overdue
  stripe_invoice_id TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Cron mensual genera invoices automáticamente. Stripe integration entra como
add-on cuando el 3er customer lo pida (manual hasta entonces).

---

## 6. Permisos / scoping a nivel customer

### 6.1. Nuevo role: `customer_admin`

Un user del customer puede:
- Ver sus propios zones/depots/stores/vehicles/drivers/dispatches/routes.
- NO ver data de otros customers.
- NO crear/eliminar customers (eso es del super-admin TripDrive).
- Asignar roles internos (admin, dispatcher, zone_manager, driver) a usuarios del mismo customer.

```sql
-- Update enum user_role:
ALTER TYPE user_role ADD VALUE 'customer_admin' BEFORE 'admin';
```

### 6.2. Super-admin (TripDrive staff)

Vive en `apps/control-plane/` (proyecto Supabase separado existente).
Puede ver TODOS los customers vía un service role + queries por
`customer_id`. NO está sujeto a la RLS customer-scoped.

---

## 7. Rollout plan por fases

### Fase A1 — Schema + Migration sin breaking (1 sprint) — ✅ schema landed 2026-05-14

- Migration SQL **037** (renumerada del 035+036 original). Hace todo en
  una transacción: tabla `customers` + ENUMs + seed VerdFrut +
  `customer_id` NOT NULL en 8 tablas operativas + trigger
  `auto_set_customer_id` (compat con queries pre-Stream A) + helper
  `current_customer_id()` SECURITY DEFINER.
- Apps siguen funcionando idénticas — no cambian queries (el trigger
  llena `customer_id` desde la sesión del caller en cada INSERT).
- **Pendiente**: aplicar migration 037 en prod + migration 038 (RLS
  rewrite) en branch Supabase para test antes de merge.

### Fase A2 — Control Plane UI (2 sprints) — ✅ CRUD landed 2026-05-14

- ✅ Lista de customers en `/customers` con KPIs (commit `5b6269e`).
- ✅ Detail page `/customers/[slug]` con KPIs operativos del customer
  (commit `1038fd8`).
- ✅ Forms crear/editar con validación slug + status changes (commit
  `c535b7e`).
- ⏳ Onboarding wizard end-to-end — diferido a Fase A7 (también crea
  zone inicial + admin user del customer en un mismo flow).
- ⏳ Test con cuenta de demo customer — esperable cuando salga la
  migration 038 de RLS rewrite.

### Fase A3 — Flow engine data-driven (2 sprints)
- Library v2 + factory.
- Web driver refactor a `<FlowStepRenderer />`.
- Native driver: si entra wizard custom, agregar `/evidence/wizard` que renderee dinámico.
- Seed flow standard para VerdFrut.

### Fase A4 — Branding customizable (1 sprint)
- Color primario + logo aplicado en native + web.
- CSS vars dinámicas leídas de `customer.brand_color_primary`.

### Fase A5 — Per-customer custom fields (2 sprints)
- UI para definir custom fields en stores.
- Renderizado dinámico en formularios.
- Export incluye custom fields.

### Fase A6 — Billing + Stripe integration (3 sprints)
- Genera invoices automáticas.
- Stripe Checkout para Pro/Starter.
- Cobro manual sigue para Enterprise.

### Fase A7 — Onboarding cliente 2 real
- Marketing first customer (post-NETO).
- Onboarding completo en <2 horas.
- Validar end-to-end con cliente real.

**Timeline estimado:** A1-A4 en 2 meses, A5-A6 en 1 mes, A7 cuando aparezca demanda.

---

## 8. Migraciones SQL planeadas

**Renumerado 2026-05-14**: las migrations 035 y 036 ya fueron usadas para
`stops_arrival_audit` y `bump_route_version_rpc` (ADR-084 y ADR-085).
Stream A arranca en 037:

```
037_multi_customer_schema.sql            # ✅ ADR-086 — customers + FK NOT NULL + trigger auto-set + helper
038_restructure_dispatch_customer_fix.sql # ✅ ADR-086 follow-up — RPC pasa customer_id
039_rls_customer_scoped.sql              # ✅ ADR-087 — 31 policies reescritas + cierre hueco WITH CHECK
040_customer_flow_steps.sql              # ⏳ customer_flow_steps + customer_store_fields (A3 + A5)
041_customer_invoices.sql                # ⏳ billing (A6)
042_user_role_customer_admin.sql         # ⏳ enum extension (A2)
```

**Decisión de packaging para A1**: schema + backfill + NOT NULL + trigger +
helper en UNA sola migration (037) en lugar de dos (035 + 036 del plan
original). Razón: la migration corre en una transacción atómica
(`BEGIN/COMMIT`); si falla cualquier paso, rollback completo deja el
schema intacto. Separar en dos no añade seguridad y duplica risk windows.

La migration de RLS rewrite se mantiene aparte (038) porque ese sí es
high-blast-radius — testear en branch Supabase con cuenta real antes de
merge.

---

## 9. Riesgos y mitigaciones

### Técnicos

- **RLS migration rompe acceso** a data existente.
  Mitigación: branch Supabase de prueba antes de merge.
- **Performance: RLS con `current_customer_id()` agrega un JOIN implícito en cada query.**
  Mitigación: function STABLE + index en `user_profiles(id, customer_id)`. Benchmark con datos reales.
- **Cliente solicita BD aislada (Enterprise compliance):**
  Mitigación: project-per-tenant modelo #3 sigue disponible. Documentar criterio de cuándo aplica.

### Comerciales

- **NETO bloquea progress de Stream A:** mientras Stream B (native app) no esté
  estable en piloto, NO comenzamos A. Validamos con NETO al menos 1 mes en operación.
- **Multi-customer es vender una promesa antes de tenerla:** se evita siempre
  hablar de "atendemos a varios clientes" hasta tener el 2do real onboardeado.
  Story arc: "TripDrive nació con NETO, ahora puede atender N clientes" — no
  "TripDrive es multi-customer day-1".

### Producto

- **Customers pueden pedir features muy custom** (ej. branding muy específico,
  integraciones SAP particulares). Mitigación: clear tier matrix con qué
  customización aplica por tier. Lo demás es add-on paid o NO se hace.
- **Onboarding lento:** el wizard tarda 2-4 horas si tiene muchos asks. Tier
  Enterprise paga por onboarding-on-call con el equipo.

---

## 10. Métricas de éxito Stream A

| Métrica | Target | Cuándo medir |
|---|---|---|
| Customers activos | 5 | 12 meses post-Stream A done |
| MRR | $50K MXN | 12 meses |
| Tiempo de onboarding | <2 hrs | Por cliente onboardeado |
| Churn rate mensual | <5% | Anual |
| % errores cross-customer leak | 0 | Continuo (debe ser 0) |

---

## 11. Apéndice — Decisiones técnicas tomadas y abiertas

### Cerradas

- ✅ Multi-tenancy hibrido: RLS por `customer_id` + project-per-tenant opcional.
- ✅ Flow engine data-driven con `customer_flow_steps` table.
- ✅ Branding configurable (color + logo).
- ✅ Tier matrix: Starter / Pro / Enterprise.
- ✅ Stream A arranca SOLO post-piloto NETO estable (Stream B done).

### Abiertas

- [ ] ¿Stripe Checkout vs PayPal vs Conekta para MX?
- [ ] ¿Onboarding self-service o solo asistido en Pro?
- [ ] ¿Cuándo migrar a project-per-tenant un cliente Pro que escala a Enterprise?
- [ ] ¿Custom domain por customer (ej. `neto.tripdrive.xyz`) o subdomain único?
- [ ] ¿Multi-language UI (es-MX → en-US/pt-BR para expansión LATAM)?

---

## Apéndice — Diferencia con el shell UI actual

El `apps/platform/src/app/(app)/customers/` actual (sin BD, preview) implementa
la UX visual del listado de customers, pero **NO escribe a BD**. Es un mock
para validar la jerarquía visual con clientes potenciales antes de comprometer
schema/BD.

Cuando Stream A arranque, esa carpeta se rehace conectada a la nueva tabla
`customers` (Sec. 1). El shell actual sirve como prototipo de la UI final.
