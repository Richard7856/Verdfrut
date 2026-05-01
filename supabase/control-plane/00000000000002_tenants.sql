-- Registro de tenants. Este es el "índice" para el super admin.
-- Las CREDENCIALES (anon_key, service_key) NO viven aquí — viven en
-- /etc/verdfrut/tenants.json en el VPS, leídas por @verdfrut/supabase/tenant-registry.

DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'onboarding', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tenant_plan AS ENUM ('starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- Identificador del proyecto Supabase del cliente (para vincular logs, billing).
  -- NO almacenamos URL ni keys aquí — el archivo tenants.json los tiene.
  supabase_project_id TEXT NOT NULL,
  status tenant_status NOT NULL DEFAULT 'onboarding',
  plan tenant_plan NOT NULL DEFAULT 'starter',
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  -- Datos comerciales (contacto, contrato, etc.).
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- Snapshot diario de KPIs por zona/cliente. Sin PII.
-- Lo escribe el job de sync nocturno (n8n / Edge Function).
CREATE TABLE IF NOT EXISTS tenant_zone_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Slug de la zona (no UUID, porque cross-proyecto los UUIDs no son útiles).
  zone_code TEXT NOT NULL,
  date DATE NOT NULL,
  total_routes INTEGER NOT NULL DEFAULT 0,
  completed_routes INTEGER NOT NULL DEFAULT 0,
  total_stops INTEGER NOT NULL DEFAULT 0,
  completed_stops INTEGER NOT NULL DEFAULT 0,
  reports_with_incidents INTEGER NOT NULL DEFAULT 0,
  reports_with_merma INTEGER NOT NULL DEFAULT 0,
  total_distance_meters BIGINT NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, zone_code, date)
);
ALTER TABLE tenant_zone_kpis ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_kpis_tenant_date ON tenant_zone_kpis(tenant_id, date DESC);

-- Vista agregada útil para el dashboard: KPIs por cliente por día.
CREATE OR REPLACE VIEW v_tenant_daily_kpis AS
SELECT
  t.id AS tenant_id,
  t.slug AS tenant_slug,
  t.name AS tenant_name,
  k.date,
  SUM(k.total_routes) AS total_routes,
  SUM(k.completed_routes) AS completed_routes,
  SUM(k.total_stops) AS total_stops,
  SUM(k.completed_stops) AS completed_stops,
  SUM(k.reports_with_incidents) AS reports_with_incidents,
  SUM(k.reports_with_merma) AS reports_with_merma,
  SUM(k.total_distance_meters) AS total_distance_meters
FROM tenants t
LEFT JOIN tenant_zone_kpis k ON k.tenant_id = t.id
GROUP BY t.id, k.date;

-- Trigger updated_at.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tenants_set_updated_at ON tenants;
CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
