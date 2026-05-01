-- RLS Policies. Reglas:
--   admin → ve y modifica todo
--   dispatcher → ve y modifica todo (excepto users de otros roles)
--   zone_manager → ve solo su zona, no modifica datos maestros
--   driver → ve solo lo suyo (su perfil, su ruta del día, sus reportes)
--
-- Helper functions encapsulan la lógica de "qué rol soy" y "qué zona tengo".

-- ----------------------------------------------------------------------------
-- Helper functions (security definer para evitar recursión en policies).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_user_role() RETURNS user_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION current_user_zone() RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT zone_id FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin_or_dispatcher() RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT current_user_role() IN ('admin', 'dispatcher');
$$;

-- ----------------------------------------------------------------------------
-- zones — todos pueden leer las zonas de su cliente; solo admin escribe.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS zones_read_all ON zones;
CREATE POLICY zones_read_all ON zones FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS zones_write_admin ON zones;
CREATE POLICY zones_write_admin ON zones FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ----------------------------------------------------------------------------
-- user_profiles — cada uno ve el suyo; admin/dispatcher ven todos.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_read_self ON user_profiles;
CREATE POLICY profiles_read_self ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin_or_dispatcher());

DROP POLICY IF EXISTS profiles_update_self ON user_profiles;
CREATE POLICY profiles_update_self ON user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR current_user_role() = 'admin');

DROP POLICY IF EXISTS profiles_admin_all ON user_profiles;
CREATE POLICY profiles_admin_all ON user_profiles FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ----------------------------------------------------------------------------
-- stores — admin/dispatcher ven todas; zone_manager y driver solo su zona.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS stores_read ON stores;
CREATE POLICY stores_read ON stores FOR SELECT TO authenticated
  USING (is_admin_or_dispatcher() OR zone_id = current_user_zone());

DROP POLICY IF EXISTS stores_write ON stores;
CREATE POLICY stores_write ON stores FOR ALL TO authenticated
  USING (is_admin_or_dispatcher())
  WITH CHECK (is_admin_or_dispatcher());

-- ----------------------------------------------------------------------------
-- vehicles — mismo patrón que stores.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS vehicles_read ON vehicles;
CREATE POLICY vehicles_read ON vehicles FOR SELECT TO authenticated
  USING (is_admin_or_dispatcher() OR zone_id = current_user_zone());

DROP POLICY IF EXISTS vehicles_write ON vehicles;
CREATE POLICY vehicles_write ON vehicles FOR ALL TO authenticated
  USING (is_admin_or_dispatcher())
  WITH CHECK (is_admin_or_dispatcher());

-- ----------------------------------------------------------------------------
-- drivers — admin/dispatcher ven todos; zone_manager solo su zona; driver solo el suyo.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS drivers_read ON drivers;
CREATE POLICY drivers_read ON drivers FOR SELECT TO authenticated
  USING (
    is_admin_or_dispatcher()
    OR (current_user_role() = 'zone_manager' AND zone_id = current_user_zone())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS drivers_write ON drivers;
CREATE POLICY drivers_write ON drivers FOR ALL TO authenticated
  USING (is_admin_or_dispatcher())
  WITH CHECK (is_admin_or_dispatcher());

-- ----------------------------------------------------------------------------
-- routes — admin/dispatcher ven todas; zone_manager solo su zona;
-- driver solo las que le fueron asignadas y están publicadas o más allá.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS routes_read ON routes;
CREATE POLICY routes_read ON routes FOR SELECT TO authenticated
  USING (
    is_admin_or_dispatcher()
    OR (current_user_role() = 'zone_manager' AND zone_id = current_user_zone())
    OR (
      current_user_role() = 'driver'
      AND status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED')
      AND driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS routes_write ON routes;
CREATE POLICY routes_write ON routes FOR ALL TO authenticated
  USING (is_admin_or_dispatcher())
  WITH CHECK (is_admin_or_dispatcher());

-- ----------------------------------------------------------------------------
-- stops — heredan visibilidad de su route. RLS via subquery.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS stops_read ON stops;
CREATE POLICY stops_read ON stops FOR SELECT TO authenticated
  USING (route_id IN (SELECT id FROM routes));

DROP POLICY IF EXISTS stops_update_driver ON stops;
CREATE POLICY stops_update_driver ON stops FOR UPDATE TO authenticated
  USING (
    is_admin_or_dispatcher()
    OR route_id IN (
      SELECT r.id FROM routes r
      INNER JOIN drivers d ON d.id = r.driver_id
      WHERE d.user_id = auth.uid() AND r.status IN ('PUBLISHED', 'IN_PROGRESS')
    )
  );

DROP POLICY IF EXISTS stops_admin_write ON stops;
CREATE POLICY stops_admin_write ON stops FOR ALL TO authenticated
  USING (is_admin_or_dispatcher())
  WITH CHECK (is_admin_or_dispatcher());

-- ----------------------------------------------------------------------------
-- delivery_reports — driver ve los suyos; zone_manager los de su zona.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS reports_read ON delivery_reports;
CREATE POLICY reports_read ON delivery_reports FOR SELECT TO authenticated
  USING (
    is_admin_or_dispatcher()
    OR (current_user_role() = 'zone_manager' AND zone_id = current_user_zone())
    OR driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS reports_write_driver ON delivery_reports;
CREATE POLICY reports_write_driver ON delivery_reports FOR INSERT TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS reports_update_driver ON delivery_reports;
CREATE POLICY reports_update_driver ON delivery_reports FOR UPDATE TO authenticated
  USING (
    is_admin_or_dispatcher()
    OR (current_user_role() = 'zone_manager' AND zone_id = current_user_zone())
    OR driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- messages — herencia del report. Todos los participantes pueden insertar.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_read ON messages;
CREATE POLICY messages_read ON messages FOR SELECT TO authenticated
  USING (report_id IN (SELECT id FROM delivery_reports));

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT TO authenticated
  WITH CHECK (report_id IN (SELECT id FROM delivery_reports));

-- ----------------------------------------------------------------------------
-- push_subscriptions — cada uno ve y modifica solo las suyas.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS push_self ON push_subscriptions;
CREATE POLICY push_self ON push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- route_breadcrumbs — driver inserta los suyos; zone_manager/admin lee.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS breadcrumbs_read ON route_breadcrumbs;
CREATE POLICY breadcrumbs_read ON route_breadcrumbs FOR SELECT TO authenticated
  USING (route_id IN (SELECT id FROM routes));

DROP POLICY IF EXISTS breadcrumbs_insert ON route_breadcrumbs;
CREATE POLICY breadcrumbs_insert ON route_breadcrumbs FOR INSERT TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- route_versions — solo lectura para todos los autorizados a ver la route.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS route_versions_read ON route_versions;
CREATE POLICY route_versions_read ON route_versions FOR SELECT TO authenticated
  USING (route_id IN (SELECT id FROM routes));

DROP POLICY IF EXISTS route_versions_insert ON route_versions;
CREATE POLICY route_versions_insert ON route_versions FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_dispatcher());
