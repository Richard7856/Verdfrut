-- ADR-086 / Stream A / Fase A1 — Schema multi-customer SIN breaking.
--
-- Por qué ahora: la fase A1 del plan MULTI_CUSTOMER.md introduce la tabla
-- `customers` y la FK `customer_id` en las 8 tablas operativas, sin tocar
-- las policies de RLS existentes. Eso permite a las apps seguir funcionando
-- idénticas (queries no cambian) mientras la BD ya tiene el shape que
-- necesita Stream A. La migration de RLS (rewrite de policies con
-- `customer_id = current_customer_id()`) va en una migration aparte (038)
-- después de validación en branch Supabase — separar reduce blast radius.
--
-- Estrategia 0-downtime:
--   1. AGREGAR columna como NULLABLE.
--   2. BACKFILL con el customer único existente (verdfrut).
--   3. SET NOT NULL.
--   4. CREATE INDEX en customer_id.
--
-- En una BD chica (~25 stores, decenas de routes/stops) el lock de
-- ALTER TABLE es <1s. No requiere ventana de mantenimiento.
--
-- Alternativas consideradas:
--   - Crear las tablas customer_flow_steps + customer_store_fields aquí:
--     prematuro — son A3 y A5 del plan. YAGNI.
--   - Reescribir RLS en esta misma migration: alto riesgo (24+ policies).
--     Separamos a migration 038 para poder testear en branch primero.
--   - Hacer customer_id NULLABLE permanente: rompe el invariante de
--     multi-tenancy (filas huérfanas vivirían visibles cross-customer).

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ENUMs
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE customer_status AS ENUM ('active', 'paused', 'churned', 'demo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_tier AS ENUM ('starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Tabla customers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  rfc TEXT,
  status customer_status NOT NULL DEFAULT 'demo',
  tier customer_tier NOT NULL DEFAULT 'starter',
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  bbox_lat_min FLOAT,
  bbox_lat_max FLOAT,
  bbox_lng_min FLOAT,
  bbox_lng_max FLOAT,
  brand_color_primary TEXT DEFAULT '#34c97c',
  brand_logo_url TEXT,
  flow_engine_overrides JSONB,
  monthly_fee_mxn INT,
  per_driver_fee_mxn INT,
  contract_started_at DATE,
  contract_ends_at DATE,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
-- slug ya tiene unique index implícito por UNIQUE constraint.

COMMENT ON TABLE customers IS
  'ADR-086 / Stream A. Cada cliente operacional (VerdFrut/NETO, OXXO futuro). slug es el subdomain (verdfrut.tripdrive.xyz). brand_* se renderiza en apps web + native cuando el user es de ese customer.';

-- ----------------------------------------------------------------------------
-- 3. Seed: VerdFrut como customer único existente.
--
-- Razón: toda la data actual pertenece a NETO operado por VerdFrut.
-- El slug es 'verdfrut' (no 'neto') porque el cliente legal/comercial es
-- VerdFrut como agregador de la operación NETO. Future state: si entra
-- NETO directo como cliente sin VerdFrut intermediario, se crea un nuevo
-- customer.
-- ----------------------------------------------------------------------------
INSERT INTO customers (
  slug, name, legal_name, status, tier, timezone, brand_color_primary,
  contract_started_at
) VALUES (
  'verdfrut',
  'VerdFrut',
  'VerdFrut S.A. de C.V.',
  'active',
  'pro',
  'America/Mexico_City',
  '#34c97c',
  '2026-01-01'
) ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. FK customer_id en 8 tablas operativas — NULLABLE → BACKFILL → NOT NULL.
--
-- Orden: tablas raíz primero (zones, user_profiles, stores, vehicles, drivers,
-- depots), luego tablas dependientes (routes, dispatches). El backfill global
-- usa el id del único customer existente.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_customer_id UUID;
  v_tables      TEXT[] := ARRAY[
    'zones', 'user_profiles', 'stores', 'vehicles',
    'drivers', 'depots', 'routes', 'dispatches'
  ];
  v_table TEXT;
BEGIN
  SELECT id INTO v_customer_id FROM customers WHERE slug = 'verdfrut';
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer verdfrut no existe — el seed falló';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    -- ADD COLUMN si no existe (idempotente — la migration puede re-correrse).
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT',
      v_table
    );

    -- Backfill: cualquier fila con customer_id NULL queda asociada a verdfrut.
    EXECUTE format(
      'UPDATE %I SET customer_id = $1 WHERE customer_id IS NULL',
      v_table
    ) USING v_customer_id;

    -- SET NOT NULL — la columna queda obligatoria de aquí en adelante.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN customer_id SET NOT NULL',
      v_table
    );

    -- Index en customer_id — todas las queries futuras filtran por aquí.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%I_customer ON %I(customer_id)',
      v_table, v_table
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Trigger auto-set customer_id en INSERTs.
--
-- Por qué: queremos NOT NULL para garantizar multi-tenancy consistency, pero
-- las apps actuales NO pasan customer_id en sus INSERTs (las queries son
-- pre-Stream A). Sin trigger, todos los INSERTs romperían tras esta
-- migration. El trigger llena customer_id desde la sesión del caller cuando
-- el INSERT no lo provee — apps siguen idénticas, BD ya está multi-tenant.
--
-- Casos:
--   - sesión authenticated normal: usa current_customer_id() del JWT.
--   - service_role / cron sin sesión: NEW.customer_id debe venir explícito,
--     trigger no lo puede inferir → INSERT falla (correcto: el cron debe
--     filtrar por customer_id, no escribir agnóstico).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_set_customer_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT customer_id INTO v_customer_id
    FROM user_profiles
    WHERE id = auth.uid();

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION
      'INSERT en % requiere customer_id (sesión sin user_profiles.customer_id o sin auth.uid)',
      TG_TABLE_NAME
      USING ERRCODE = '23502';
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_set_customer_id() IS
  'ADR-086: trigger BEFORE INSERT que llena customer_id desde la sesión del caller si no fue provisto. Mantiene apps pre-Stream A compatibles sin tocar sus queries.';

DO $$
DECLARE
  v_tables TEXT[] := ARRAY[
    'zones', 'user_profiles', 'stores', 'vehicles',
    'drivers', 'depots', 'routes', 'dispatches'
  ];
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auto_customer_id ON %I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_auto_customer_id
         BEFORE INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION auto_set_customer_id()',
      v_table
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Helper function: current_customer_id()
--
-- Resuelve el customer_id del usuario logueado desde user_profiles. Usado
-- por las policies de la migration 038 (RLS rewrite). Aquí ya se define
-- para que la migration 038 sea solo CREATE POLICY sin definir helpers.
-- STABLE: Postgres puede cachear el resultado dentro de un statement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_customer_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT customer_id FROM user_profiles WHERE id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION current_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_customer_id() TO authenticated;

COMMENT ON FUNCTION current_customer_id() IS
  'ADR-086: retorna el customer_id del usuario logueado. Usado por policies multi-customer (migration 038+). SECURITY DEFINER porque la fila de user_profiles del caller puede estar bloqueada por su propia policy en otros contextos.';

-- ----------------------------------------------------------------------------
-- 7. RLS policies para tabla customers
--
-- Lectura: cualquier authenticated lee SU customer (uno solo). Útil para que
-- las apps lean branding sin necesidad de service role. Es muy poca data.
-- Escritura: solo super-admin via service role (Control Plane). No hay
-- policy de INSERT/UPDATE/DELETE para authenticated.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS customers_select ON customers;
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated
  USING (id = current_customer_id());

COMMENT ON POLICY customers_select ON customers IS
  'Authenticated user lee SOLO su propio customer (para branding, name, tier). Las mutaciones son via service_role desde Control Plane.';

COMMIT;
