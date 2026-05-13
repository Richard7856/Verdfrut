-- ADR-087 / Stream A — Migration 039: RLS rewrite multi-customer.
--
-- Cierra el loop del modelo multi-tenant: cada policy de las 8 tablas
-- operativas filtra por `customer_id = current_customer_id()` AND la
-- lógica role/zone original. Previo a esta migration (post-037), la
-- columna `customer_id` existía pero las policies seguían dando acceso
-- cross-customer a cualquier admin.
--
-- Bonus crítico: el trigger `auto_set_customer_id` (mig 037) NO valida
-- que un INSERT con `customer_id` explícito sea del caller — un admin
-- malicioso de customer A podía insertar con `customer_id = B`. Las
-- nuevas policies con WITH CHECK lo cierran (RLS valida la fila
-- post-trigger).
--
-- Estrategia 0-downtime:
--   - DROP POLICY IF EXISTS + CREATE POLICY en una transacción.
--   - Solo hay 1 customer (verdfrut), entonces el filter no cambia
--     comportamiento observable — todos los users actuales ya pertenecen
--     a verdfrut y `current_customer_id()` retorna verdfrut.id.
--   - Si algo rompe el acceso a data del operador, rollback es trivial:
--     re-aplicar las definiciones de mig 007 + mig 013.
--
-- Cobertura:
--   8 tablas operativas, 31 policies reescritas.
--   Tablas dependientes (stops, route_versions, route_breadcrumbs,
--   delivery_reports, messages, push_subscriptions, route_transfers,
--   route_gap_events) NO se tocan — heredan filter via FK a routes /
--   user_profiles que ya filtran post-rewrite.
--   Tabla customers tiene `customers_select` (mig 037) — se mantiene.

BEGIN;

-- ============================================================================
-- zones
-- ============================================================================
DROP POLICY IF EXISTS zones_read_all      ON zones;
DROP POLICY IF EXISTS zones_insert_admin  ON zones;
DROP POLICY IF EXISTS zones_update_admin  ON zones;
DROP POLICY IF EXISTS zones_delete_admin  ON zones;

CREATE POLICY zones_read_all ON zones FOR SELECT TO authenticated
  USING (customer_id = current_customer_id());

CREATE POLICY zones_insert_admin ON zones FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT current_user_role()) = 'admin'::user_role
  );

CREATE POLICY zones_update_admin ON zones FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT current_user_role()) = 'admin'::user_role
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT current_user_role()) = 'admin'::user_role
  );

CREATE POLICY zones_delete_admin ON zones FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT current_user_role()) = 'admin'::user_role
  );

-- ============================================================================
-- user_profiles
-- Nota: la cláusula `id = auth.uid()` queda permitida sin customer_id check
-- porque el propio profile del caller siempre comparte el mismo customer
-- (current_customer_id() se deriva de user_profiles WHERE id = auth.uid()).
-- Aún así forzamos customer_id match en el resto.
-- ============================================================================
DROP POLICY IF EXISTS profiles_select         ON user_profiles;
DROP POLICY IF EXISTS profiles_admin_insert   ON user_profiles;
DROP POLICY IF EXISTS profiles_update         ON user_profiles;
DROP POLICY IF EXISTS profiles_admin_delete   ON user_profiles;

CREATE POLICY profiles_select ON user_profiles FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      id = (SELECT auth.uid())
      OR (SELECT is_admin_or_dispatcher())
    )
  );

CREATE POLICY profiles_admin_insert ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT current_user_role()) = 'admin'::user_role
  );

CREATE POLICY profiles_update ON user_profiles FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      id = (SELECT auth.uid())
      OR (SELECT current_user_role()) = 'admin'::user_role
    )
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (
      id = (SELECT auth.uid())
      OR (SELECT current_user_role()) = 'admin'::user_role
    )
  );

CREATE POLICY profiles_admin_delete ON user_profiles FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT current_user_role()) = 'admin'::user_role
  );

-- ============================================================================
-- stores
-- ============================================================================
DROP POLICY IF EXISTS stores_select  ON stores;
DROP POLICY IF EXISTS stores_insert  ON stores;
DROP POLICY IF EXISTS stores_update  ON stores;
DROP POLICY IF EXISTS stores_delete  ON stores;

CREATE POLICY stores_select ON stores FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      (SELECT is_admin_or_dispatcher())
      OR zone_id = (SELECT current_user_zone())
    )
  );

CREATE POLICY stores_insert ON stores FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY stores_update ON stores FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY stores_delete ON stores FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

-- ============================================================================
-- vehicles
-- ============================================================================
DROP POLICY IF EXISTS vehicles_select  ON vehicles;
DROP POLICY IF EXISTS vehicles_insert  ON vehicles;
DROP POLICY IF EXISTS vehicles_update  ON vehicles;
DROP POLICY IF EXISTS vehicles_delete  ON vehicles;

CREATE POLICY vehicles_select ON vehicles FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      (SELECT is_admin_or_dispatcher())
      OR zone_id = (SELECT current_user_zone())
    )
  );

CREATE POLICY vehicles_insert ON vehicles FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY vehicles_update ON vehicles FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY vehicles_delete ON vehicles FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

-- ============================================================================
-- drivers
-- El driver puede leer su propia fila (user_id = auth.uid()) — mismo razón
-- que profiles_select: la fila del propio driver comparte customer_id.
-- ============================================================================
DROP POLICY IF EXISTS drivers_select  ON drivers;
DROP POLICY IF EXISTS drivers_insert  ON drivers;
DROP POLICY IF EXISTS drivers_update  ON drivers;
DROP POLICY IF EXISTS drivers_delete  ON drivers;

CREATE POLICY drivers_select ON drivers FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      (SELECT is_admin_or_dispatcher())
      OR (
        (SELECT current_user_role()) = 'zone_manager'::user_role
        AND zone_id = (SELECT current_user_zone())
      )
      OR user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY drivers_insert ON drivers FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY drivers_update ON drivers FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY drivers_delete ON drivers FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

-- ============================================================================
-- depots
-- ============================================================================
DROP POLICY IF EXISTS depots_select        ON depots;
DROP POLICY IF EXISTS depots_admin_insert  ON depots;
DROP POLICY IF EXISTS depots_admin_update  ON depots;
DROP POLICY IF EXISTS depots_admin_delete  ON depots;

CREATE POLICY depots_select ON depots FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      (SELECT is_admin_or_dispatcher())
      OR zone_id = (SELECT current_user_zone())
    )
  );

CREATE POLICY depots_admin_insert ON depots FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY depots_admin_update ON depots FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY depots_admin_delete ON depots FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

-- ============================================================================
-- routes
-- ============================================================================
DROP POLICY IF EXISTS routes_select  ON routes;
DROP POLICY IF EXISTS routes_insert  ON routes;
DROP POLICY IF EXISTS routes_update  ON routes;
DROP POLICY IF EXISTS routes_delete  ON routes;

CREATE POLICY routes_select ON routes FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      (SELECT is_admin_or_dispatcher())
      OR (
        (SELECT current_user_role()) = 'zone_manager'::user_role
        AND zone_id = (SELECT current_user_zone())
      )
      OR (
        (SELECT current_user_role()) = 'driver'::user_role
        AND status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED')
        AND driver_id IN (
          SELECT id FROM drivers WHERE user_id = (SELECT auth.uid())
        )
      )
    )
  );

CREATE POLICY routes_insert ON routes FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY routes_update ON routes FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

CREATE POLICY routes_delete ON routes FOR DELETE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (SELECT is_admin_or_dispatcher())
  );

-- ============================================================================
-- dispatches
-- Antes: una sola policy `dispatches_write FOR ALL` + `dispatches_read`.
-- Mantenemos esa estructura, solo agregamos customer_id.
-- ============================================================================
DROP POLICY IF EXISTS dispatches_read   ON dispatches;
DROP POLICY IF EXISTS dispatches_write  ON dispatches;

CREATE POLICY dispatches_read ON dispatches FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      is_admin_or_dispatcher()
      OR (
        current_user_role() = 'zone_manager'::user_role
        AND zone_id = current_user_zone()
      )
    )
  );

CREATE POLICY dispatches_write ON dispatches FOR ALL TO authenticated
  USING (
    customer_id = current_customer_id()
    AND is_admin_or_dispatcher()
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND is_admin_or_dispatcher()
  );

COMMIT;
