-- Migración 013 — performance hardening de RLS y FKs.
-- Resuelve advisors:
--   - auth_rls_initplan: envuelve auth.uid() y helpers en (SELECT ...) para evitar re-evaluación por fila
--   - multiple_permissive_policies: separa policies ALL en INSERT/UPDATE/DELETE específicas
--   - unindexed_foreign_keys: añade índices a FKs sin index

-- ============================================================================
-- 1. ÍNDICES en foreign keys faltantes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_reports_store ON delivery_reports(store_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_user ON messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_push_zone ON push_subscriptions(zone_id);
CREATE INDEX IF NOT EXISTS idx_breadcrumbs_driver ON route_breadcrumbs(driver_id);
CREATE INDEX IF NOT EXISTS idx_route_versions_creator ON route_versions(created_by);
CREATE INDEX IF NOT EXISTS idx_routes_approved_by ON routes(approved_by);
CREATE INDEX IF NOT EXISTS idx_routes_created_by ON routes(created_by);
CREATE INDEX IF NOT EXISTS idx_routes_published_by ON routes(published_by);

-- ============================================================================
-- 2. RLS policies optimizadas
--    - auth.uid() y helpers envueltos en (SELECT ...) → evaluación única por query, no por fila
--    - FOR ALL separado en FOR INSERT/UPDATE/DELETE específicos para no duplicar check de SELECT
-- ============================================================================

-- ----------------------------------------------------------------------------
-- zones
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS zones_read_all ON zones;
DROP POLICY IF EXISTS zones_write_admin ON zones;

CREATE POLICY zones_read_all ON zones FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY zones_insert_admin ON zones FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_user_role()) = 'admin');
CREATE POLICY zones_update_admin ON zones FOR UPDATE TO authenticated
  USING ((SELECT current_user_role()) = 'admin');
CREATE POLICY zones_delete_admin ON zones FOR DELETE TO authenticated
  USING ((SELECT current_user_role()) = 'admin');

-- ----------------------------------------------------------------------------
-- user_profiles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_read_self ON user_profiles;
DROP POLICY IF EXISTS profiles_update_self ON user_profiles;
DROP POLICY IF EXISTS profiles_admin_all ON user_profiles;

CREATE POLICY profiles_select ON user_profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT is_admin_or_dispatcher()));

CREATE POLICY profiles_update ON user_profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT current_user_role()) = 'admin');

CREATE POLICY profiles_admin_insert ON user_profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_user_role()) = 'admin');

CREATE POLICY profiles_admin_delete ON user_profiles FOR DELETE TO authenticated
  USING ((SELECT current_user_role()) = 'admin');

-- ----------------------------------------------------------------------------
-- stores
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS stores_read ON stores;
DROP POLICY IF EXISTS stores_write ON stores;

CREATE POLICY stores_select ON stores FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_dispatcher()) OR zone_id = (SELECT current_user_zone()));

CREATE POLICY stores_insert ON stores FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin_or_dispatcher()));
CREATE POLICY stores_update ON stores FOR UPDATE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));
CREATE POLICY stores_delete ON stores FOR DELETE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));

-- ----------------------------------------------------------------------------
-- vehicles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS vehicles_read ON vehicles;
DROP POLICY IF EXISTS vehicles_write ON vehicles;

CREATE POLICY vehicles_select ON vehicles FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_dispatcher()) OR zone_id = (SELECT current_user_zone()));

CREATE POLICY vehicles_insert ON vehicles FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin_or_dispatcher()));
CREATE POLICY vehicles_update ON vehicles FOR UPDATE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));
CREATE POLICY vehicles_delete ON vehicles FOR DELETE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));

-- ----------------------------------------------------------------------------
-- drivers
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS drivers_read ON drivers;
DROP POLICY IF EXISTS drivers_write ON drivers;

CREATE POLICY drivers_select ON drivers FOR SELECT TO authenticated
  USING (
    (SELECT is_admin_or_dispatcher())
    OR ((SELECT current_user_role()) = 'zone_manager' AND zone_id = (SELECT current_user_zone()))
    OR user_id = (SELECT auth.uid())
  );

CREATE POLICY drivers_insert ON drivers FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin_or_dispatcher()));
CREATE POLICY drivers_update ON drivers FOR UPDATE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));
CREATE POLICY drivers_delete ON drivers FOR DELETE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));

-- ----------------------------------------------------------------------------
-- routes
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS routes_read ON routes;
DROP POLICY IF EXISTS routes_write ON routes;

CREATE POLICY routes_select ON routes FOR SELECT TO authenticated
  USING (
    (SELECT is_admin_or_dispatcher())
    OR ((SELECT current_user_role()) = 'zone_manager' AND zone_id = (SELECT current_user_zone()))
    OR (
      (SELECT current_user_role()) = 'driver'
      AND status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED')
      AND driver_id IN (SELECT id FROM drivers WHERE user_id = (SELECT auth.uid()))
    )
  );

CREATE POLICY routes_insert ON routes FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin_or_dispatcher()));
CREATE POLICY routes_update ON routes FOR UPDATE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));
CREATE POLICY routes_delete ON routes FOR DELETE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));

-- ----------------------------------------------------------------------------
-- stops — separamos admin policy en escritura específica, mantenemos update_driver
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS stops_read ON stops;
DROP POLICY IF EXISTS stops_update_driver ON stops;
DROP POLICY IF EXISTS stops_admin_write ON stops;

CREATE POLICY stops_select ON stops FOR SELECT TO authenticated
  USING (route_id IN (SELECT id FROM routes));

CREATE POLICY stops_insert_admin ON stops FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin_or_dispatcher()));

CREATE POLICY stops_update ON stops FOR UPDATE TO authenticated
  USING (
    (SELECT is_admin_or_dispatcher())
    OR route_id IN (
      SELECT r.id FROM routes r
      INNER JOIN drivers d ON d.id = r.driver_id
      WHERE d.user_id = (SELECT auth.uid()) AND r.status IN ('PUBLISHED', 'IN_PROGRESS')
    )
  );

CREATE POLICY stops_delete_admin ON stops FOR DELETE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));

-- ----------------------------------------------------------------------------
-- delivery_reports
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS reports_read ON delivery_reports;
DROP POLICY IF EXISTS reports_write_driver ON delivery_reports;
DROP POLICY IF EXISTS reports_update_driver ON delivery_reports;

CREATE POLICY reports_select ON delivery_reports FOR SELECT TO authenticated
  USING (
    (SELECT is_admin_or_dispatcher())
    OR ((SELECT current_user_role()) = 'zone_manager' AND zone_id = (SELECT current_user_zone()))
    OR driver_id IN (SELECT id FROM drivers WHERE user_id = (SELECT auth.uid()))
  );

CREATE POLICY reports_insert ON delivery_reports FOR INSERT TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM drivers WHERE user_id = (SELECT auth.uid())));

CREATE POLICY reports_update ON delivery_reports FOR UPDATE TO authenticated
  USING (
    (SELECT is_admin_or_dispatcher())
    OR ((SELECT current_user_role()) = 'zone_manager' AND zone_id = (SELECT current_user_zone()))
    OR driver_id IN (SELECT id FROM drivers WHERE user_id = (SELECT auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- messages — sin cambios de auth (no usa auth.uid directo), ya estaba bien
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- push_subscriptions
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS push_self ON push_subscriptions;

CREATE POLICY push_select ON push_subscriptions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY push_insert ON push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY push_update ON push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY push_delete ON push_subscriptions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- route_breadcrumbs
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS breadcrumbs_insert ON route_breadcrumbs;

CREATE POLICY breadcrumbs_insert ON route_breadcrumbs FOR INSERT TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM drivers WHERE user_id = (SELECT auth.uid())));