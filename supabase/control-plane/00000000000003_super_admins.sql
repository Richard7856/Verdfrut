-- Usuarios super admin de VerdFrut. Acceso al control plane (todos los clientes).
-- Para acceso a un proyecto cliente específico, el super admin necesita un usuario
-- separado en ese proyecto (no compartimos JWTs entre proyectos).

DO $$ BEGIN
  CREATE TYPE super_admin_role AS ENUM ('owner', 'staff', 'support');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS super_admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role super_admin_role NOT NULL DEFAULT 'staff',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- Helper: ¿el usuario actual es super admin activo?
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM super_admins WHERE id = auth.uid() AND is_active = TRUE
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS — solo super admins pueden ver/escribir el control plane.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS super_admins_self ON super_admins;
CREATE POLICY super_admins_self ON super_admins FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS super_admins_owner_write ON super_admins;
CREATE POLICY super_admins_owner_write ON super_admins FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM super_admins WHERE id = auth.uid() AND role = 'owner' AND is_active
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM super_admins WHERE id = auth.uid() AND role = 'owner' AND is_active
    )
  );

DROP POLICY IF EXISTS tenants_admin_all ON tenants;
CREATE POLICY tenants_admin_all ON tenants FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS kpis_admin_all ON tenant_zone_kpis;
CREATE POLICY kpis_admin_all ON tenant_zone_kpis FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
