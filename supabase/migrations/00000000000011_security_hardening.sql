-- Migración 011 — hardening de seguridad post-aplicación inicial.
-- Resuelve advisors detectados al aplicar 001–010.

-- ============================================================================
-- NOTA SOBRE POSTGIS:
-- PostGIS no soporta `ALTER EXTENSION ... SET SCHEMA`. Para moverlo de public
-- a `extensions` habría que DROP CASCADE + CREATE en el schema nuevo, lo cual
-- es destructivo si hay tablas con tipos GEOMETRY/GEOGRAPHY.
-- Por ahora aceptamos los warnings:
--   - rls_disabled_in_public en spatial_ref_sys
--   - extension_in_public para postgis
--   - WARN sobre st_estimatedextent (heredado de PostGIS)
-- Documentado en KNOWN_ISSUES como deuda técnica menor (sin impacto operativo).
-- ============================================================================

-- ============================================================================
-- 1. v_active_routes a SECURITY INVOKER (resuelve ERROR security_definer_view)
--    Sin esto, la vista bypassea las RLS del usuario que la consulta.
-- ============================================================================

DROP VIEW IF EXISTS v_active_routes;
CREATE VIEW v_active_routes
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.name,
  r.date,
  r.zone_id,
  r.driver_id,
  r.vehicle_id,
  r.status,
  r.actual_start_at,
  COUNT(s.id) FILTER (WHERE s.status = 'pending') AS pending_stops,
  COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed_stops,
  COUNT(s.id) AS total_stops
FROM routes r
LEFT JOIN stops s ON s.route_id = r.id
WHERE r.status IN ('PUBLISHED', 'IN_PROGRESS')
GROUP BY r.id;

-- ============================================================================
-- 2. Funciones con search_path explícito (resuelve WARN function_search_path_mutable)
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION is_admin_or_dispatcher() RETURNS BOOLEAN
LANGUAGE SQL STABLE
SET search_path = public
AS $$
  SELECT current_user_role() IN ('admin', 'dispatcher');
$$;

CREATE OR REPLACE FUNCTION daily_zone_kpis(target_date DATE)
RETURNS TABLE (
  zone_id UUID,
  zone_code TEXT,
  total_routes BIGINT,
  completed_routes BIGINT,
  total_stops BIGINT,
  completed_stops BIGINT,
  reports_with_incidents BIGINT,
  reports_with_merma BIGINT,
  total_distance_meters BIGINT
)
LANGUAGE SQL STABLE
SET search_path = public
AS $$
  SELECT
    z.id AS zone_id,
    z.code AS zone_code,
    COUNT(DISTINCT r.id) AS total_routes,
    COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'COMPLETED') AS completed_routes,
    COUNT(s.id) AS total_stops,
    COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed_stops,
    COUNT(dr.id) FILTER (WHERE jsonb_array_length(dr.incident_details) > 0) AS reports_with_incidents,
    COUNT(dr.id) FILTER (WHERE dr.has_merma) AS reports_with_merma,
    COALESCE(SUM(r.total_distance_meters), 0)::BIGINT AS total_distance_meters
  FROM zones z
  LEFT JOIN routes r ON r.zone_id = z.id AND r.date = target_date
  LEFT JOIN stops s ON s.route_id = r.id
  LEFT JOIN delivery_reports dr ON dr.stop_id = s.id
  GROUP BY z.id, z.code;
$$;

-- ============================================================================
-- 3. Revocar EXECUTE de las helper functions SECURITY DEFINER
--    (resuelve WARN anon/authenticated_security_definer_function_executable)
--
--    current_user_role() y current_user_zone() solo se usan dentro de RLS policies,
--    no como RPC. Las policies las invocan internamente como propietario.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION current_user_role() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION current_user_zone() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION is_admin_or_dispatcher() FROM anon, authenticated, public;

-- ============================================================================
-- 4. Bucket `evidence`: eliminar policy SELECT amplia (resuelve WARN public_bucket_allows_listing)
--
--    El bucket sigue público — las URLs directas con UUID funcionan sin necesidad
--    de policy SELECT. Solo se bloquea el listing del bucket completo.
-- ============================================================================

DROP POLICY IF EXISTS "evidence read public" ON storage.objects;
