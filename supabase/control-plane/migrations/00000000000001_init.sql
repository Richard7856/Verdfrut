-- Sprint 17 / ADR-030: schema del Control Plane VerdFrut.
--
-- Convive con el schema `public` del tenant en el MISMO proyecto Supabase
-- (Escenario 2, ver ADR-030). El aislamiento se garantiza vía:
--   1. Schema PostgreSQL separado (`control_plane.*`)
--   2. RLS habilitado SIN policies → nadie con anon/authenticated lee
--   3. REVOKE de USAGE en el schema para anon/authenticated
--   4. service_role es el único que puede tocar estas tablas
--
-- Cuando VerdFrut crezca a 2+ clientes competidores reales, este schema se
-- migra a un proyecto Supabase separado con `pg_dump --schema=control_plane`.

CREATE SCHEMA IF NOT EXISTS control_plane;

-- =============================================================================
-- 1. tenants — registro de clientes (proyectos Supabase) gestionados por VerdFrut
-- =============================================================================

CREATE TABLE IF NOT EXISTS control_plane.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Slug usado en subdominios y URLs (ej. 'neto', 'oxxo')
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- Estado operacional
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'pro', 'enterprise')),
  -- Identificadores del proyecto Supabase del tenant. La service-role-key NO se
  -- almacena aquí; va en env vars del CP (`TENANT_<SLUG>_SERVICE_KEY`) por seguridad.
  supabase_project_ref TEXT,
  supabase_url TEXT,
  -- TZ del cliente (afecta agrupamiento de KPIs)
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  -- Metadata comercial
  contact_email TEXT,
  contact_phone TEXT,
  contracted_at DATE,
  monthly_fee NUMERIC(10,2),
  -- Estado del último sync (lo escribe el endpoint /api/sync)
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  -- Cache de números clave (actualizados por el sync). Permite mostrar la lista
  -- de tenants sin query agregada por cada uno.
  cached_zone_count INTEGER NOT NULL DEFAULT 0,
  cached_driver_count INTEGER NOT NULL DEFAULT 0,
  cached_active_route_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_tenants_status ON control_plane.tenants(status);
CREATE INDEX IF NOT EXISTS idx_cp_tenants_plan ON control_plane.tenants(plan);

-- =============================================================================
-- 2. tenant_kpi_snapshots — snapshot diario de KPIs por tenant
-- =============================================================================
-- Sprint 18 lo llenará con el endpoint /api/sync. Permite gráficas históricas
-- y agregaciones cross-tenant sin requerir hits a cada Supabase del tenant.

CREATE TABLE IF NOT EXISTS control_plane.tenant_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES control_plane.tenants(id) ON DELETE CASCADE,
  -- Día calendario del KPI (en TZ del tenant)
  snapshot_date DATE NOT NULL,
  -- Operativos
  routes_completed INTEGER NOT NULL DEFAULT 0,
  stores_visited INTEGER NOT NULL DEFAULT 0,
  stops_total INTEGER NOT NULL DEFAULT 0,
  stops_completed INTEGER NOT NULL DEFAULT 0,
  total_distance_meters BIGINT NOT NULL DEFAULT 0,
  -- Comerciales
  num_tickets INTEGER NOT NULL DEFAULT 0,
  total_billed NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_returned NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Calidad
  total_incidents INTEGER NOT NULL DEFAULT 0,
  num_closed_stores INTEGER NOT NULL DEFAULT 0,
  num_scale_issues INTEGER NOT NULL DEFAULT 0,
  num_escalations INTEGER NOT NULL DEFAULT 0,
  -- Payload crudo del RPC del tenant (para auditoría / debug del sync)
  raw_payload JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un snapshot por (tenant, día). Re-sync hace UPSERT.
  UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_cp_kpi_tenant_date
  ON control_plane.tenant_kpi_snapshots(tenant_id, snapshot_date DESC);

-- =============================================================================
-- 3. admin_users — staff VerdFrut con acceso al control plane
-- =============================================================================
-- Para Sprint 17 el auth es por shared password (env var). Esta tabla queda
-- preparada para Sprint 18+ donde se migra a auth completo (un email = un row).

CREATE TABLE IF NOT EXISTS control_plane.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  -- 'admin' = puede hacer todo (provisioning, suspender tenants)
  -- 'support' = solo lectura + responder issues
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'support')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 4. audit_log — bitácora de acciones del control plane
-- =============================================================================
-- Toda acción que mute datos (provisioning, suspensión, cambio de plan) escribe
-- aquí. Útil para debugging y para auditorías de compliance.

CREATE TABLE IF NOT EXISTS control_plane.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email TEXT,
  -- Verbo punteado: 'tenant.provision', 'tenant.suspend', 'admin.invite', etc.
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_audit_target
  ON control_plane.audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_audit_action_time
  ON control_plane.audit_log(action, created_at DESC);

-- =============================================================================
-- 5. SEGURIDAD: RLS bloquea acceso de anon/authenticated, schema expuesto a PostgREST
-- =============================================================================
--
-- Modelo de seguridad para Sprint 17 (V1):
--   - RLS habilitado SIN policies en todas las tablas → anon/authenticated obtienen
--     0 filas en SELECT y fallan en INSERT/UPDATE/DELETE.
--   - service_role bypassea RLS por diseño → el control plane usa service_role
--     (ver apps/control-plane/src/lib/cp-client.ts).
--   - PostgREST necesita exponer el schema (vía pgrst.db_schemas) para que el
--     cliente Supabase pueda hacer .schema('control_plane'). Sin esto, error
--     "Invalid schema" / PGRST106.
--   - GRANT USAGE/ALL a anon/authenticated es REQUERIDO por PostgREST para exponer
--     el schema. La protección de DATOS la da exclusivamente RLS (sin policies).
--
-- Trade-off documentado en ADR-030: anon/authenticated pueden DESCUBRIR los nombres
-- de tablas/columnas vía PostgREST OpenAPI (metadata leak menor) pero no leer NADA.
-- Para esconder también la metadata, migrar queries a SECURITY DEFINER RPCs en
-- public.cp_*. V1 acepta el leak menor por simplicidad.

ALTER TABLE control_plane.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.tenant_kpi_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.audit_log ENABLE ROW LEVEL SECURITY;

-- GRANTs requeridos por PostgREST. Anon/authenticated NO pueden leer datos por RLS,
-- pero necesitan USAGE+SELECT formal para que PostgREST acepte exponer el schema.
GRANT USAGE ON SCHEMA control_plane TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA control_plane TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA control_plane TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA control_plane TO anon, authenticated, service_role;

-- Default privileges → tablas/rutinas/secuencias futuras heredan los GRANTs sin
-- repetirlos en cada migration nueva.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA control_plane
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA control_plane
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA control_plane
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Exponer el schema a PostgREST (requisito para .schema('control_plane') en JS client)
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, control_plane';

-- Recargar config de PostgREST sin reiniciar el contenedor
NOTIFY pgrst, 'reload config';

-- =============================================================================
-- 6. Trigger de updated_at en tenants
-- =============================================================================

CREATE OR REPLACE FUNCTION control_plane.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_cp_tenants_updated_at ON control_plane.tenants;
CREATE TRIGGER tg_cp_tenants_updated_at
  BEFORE UPDATE ON control_plane.tenants
  FOR EACH ROW EXECUTE FUNCTION control_plane.set_updated_at();
