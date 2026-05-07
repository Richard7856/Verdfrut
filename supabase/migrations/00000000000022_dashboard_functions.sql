-- Sprint 14 / ADR-028: funciones SQL de agregación para el dashboard cliente.
--
-- Por qué SQL functions y no queries en TS:
--   1. Sumas sobre campos JSONB (ticket_data->>'total') requieren cast a numeric
--      y agregaciones que el cliente Supabase JS no soporta directamente sin SQL.
--   2. Una sola RPC devuelve los 12 KPIs de una pasada — más rápido y menos red.
--   3. Las funciones son STABLE (deterministas en el mismo snapshot) y sólo leen,
--      el query planner puede paralelizar.
--
-- SECURITY: las funciones son SECURITY INVOKER (default) — respetan las RLS policies
-- existentes. Un zone_manager sólo ve sus zonas; un admin/dispatcher ve todo.
-- El parámetro zone_id_filter permite al admin filtrar opcionalmente por zona.
--
-- Rangos: from_date y to_date son inclusivos. Se filtran sobre routes.date
-- (fecha operativa local del tenant) y delivery_reports.created_at (UTC,
-- pero comparado con el rango ya extendido al fin de día).

-- ============================================================
-- 1. Overview — los 12 KPIs principales en una sola llamada
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_overview(
  from_date DATE,
  to_date DATE,
  zone_id_filter UUID DEFAULT NULL
)
RETURNS TABLE (
  -- Operativos
  routes_completed BIGINT,
  stores_visited BIGINT,
  stops_total BIGINT,
  stops_completed BIGINT,
  total_distance_meters BIGINT,
  -- Comerciales
  num_tickets BIGINT,
  total_billed NUMERIC,
  total_returned NUMERIC,
  -- Calidad
  total_incidents BIGINT,
  num_closed_stores BIGINT,
  num_scale_issues BIGINT,
  num_escalations BIGINT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  -- IMPORTANTE: en plpgsql, los nombres de columna del CTE pueden chocar con los
  -- OUT parameters del RETURNS TABLE (ej. total_distance_meters). Postgres lanza
  -- "column reference is ambiguous" en runtime. Solución: cualificar SIEMPRE las
  -- columnas con el alias del CTE (rs./sx./dr.) en SELECT y WHERE de los subqueries.
  RETURN QUERY
  WITH
    -- Routes y stops del rango
    rs AS (
      SELECT r.id AS route_id, r.zone_id, r.status AS route_status, r.total_distance_meters
      FROM public.routes r
      WHERE r.date BETWEEN from_date AND to_date
        AND (zone_id_filter IS NULL OR r.zone_id = zone_id_filter)
    ),
    sx AS (
      SELECT s.id, s.status, s.store_id, rs.route_id
      FROM public.stops s
      JOIN rs ON rs.route_id = s.route_id
    ),
    -- Reports del rango (created_at en zona, comparado al día completo)
    dr AS (
      SELECT
        d.id, d.type, d.status AS report_status, d.has_merma,
        d.ticket_data, d.return_ticket_data, d.incident_details,
        d.chat_status
      FROM public.delivery_reports d
      WHERE d.created_at >= from_date::TIMESTAMPTZ
        AND d.created_at < (to_date + 1)::TIMESTAMPTZ
        AND (zone_id_filter IS NULL OR d.zone_id = zone_id_filter)
    )
  SELECT
    -- Operativos
    (SELECT COUNT(*) FROM rs WHERE rs.route_status = 'COMPLETED')::BIGINT,
    (SELECT COUNT(DISTINCT sx.store_id) FROM sx WHERE sx.status = 'completed')::BIGINT,
    (SELECT COUNT(*) FROM sx)::BIGINT,
    (SELECT COUNT(*) FROM sx WHERE sx.status = 'completed')::BIGINT,
    (SELECT COALESCE(SUM(rs.total_distance_meters), 0) FROM rs WHERE rs.route_status = 'COMPLETED')::BIGINT,
    -- Comerciales
    (SELECT COUNT(*) FROM dr WHERE dr.ticket_data IS NOT NULL)::BIGINT,
    (SELECT COALESCE(SUM((dr.ticket_data->>'total')::NUMERIC), 0)
       FROM dr WHERE dr.ticket_data IS NOT NULL AND dr.ticket_data ? 'total'),
    (SELECT COALESCE(SUM((dr.return_ticket_data->>'total')::NUMERIC), 0)
       FROM dr WHERE dr.return_ticket_data IS NOT NULL AND dr.return_ticket_data ? 'total'),
    -- Calidad
    (SELECT COALESCE(SUM(jsonb_array_length(COALESCE(dr.incident_details, '[]'::JSONB))), 0)
       FROM dr)::BIGINT,
    (SELECT COUNT(*) FROM dr WHERE dr.type = 'tienda_cerrada')::BIGINT,
    (SELECT COUNT(*) FROM dr WHERE dr.type = 'bascula')::BIGINT,
    (SELECT COUNT(*) FROM dr WHERE dr.chat_status IS NOT NULL AND dr.chat_status <> 'closed')::BIGINT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_overview(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- 2. Daily series — entregas y facturación por día (chart)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_daily_series(
  from_date DATE,
  to_date DATE,
  zone_id_filter UUID DEFAULT NULL
)
RETURNS TABLE (
  day DATE,
  deliveries BIGINT,
  billed NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(from_date, to_date, INTERVAL '1 day')::DATE AS day
  ),
  deliveries_per_day AS (
    SELECT r.date AS day, COUNT(s.id)::BIGINT AS n
    FROM public.routes r
    JOIN public.stops s ON s.route_id = r.id
    WHERE r.date BETWEEN from_date AND to_date
      AND (zone_id_filter IS NULL OR r.zone_id = zone_id_filter)
      AND s.status = 'completed'
    GROUP BY r.date
  ),
  billed_per_day AS (
    SELECT (d.created_at AT TIME ZONE 'UTC')::DATE AS day,
           SUM((d.ticket_data->>'total')::NUMERIC) AS total
    FROM public.delivery_reports d
    WHERE d.created_at >= from_date::TIMESTAMPTZ
      AND d.created_at < (to_date + 1)::TIMESTAMPTZ
      AND (zone_id_filter IS NULL OR d.zone_id = zone_id_filter)
      AND d.ticket_data IS NOT NULL
      AND d.ticket_data ? 'total'
    GROUP BY (d.created_at AT TIME ZONE 'UTC')::DATE
  )
  SELECT
    days.day,
    COALESCE(deliveries_per_day.n, 0)::BIGINT,
    COALESCE(billed_per_day.total, 0)::NUMERIC
  FROM days
  LEFT JOIN deliveries_per_day ON deliveries_per_day.day = days.day
  LEFT JOIN billed_per_day ON billed_per_day.day = days.day
  ORDER BY days.day;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_daily_series(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_daily_series(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- 3. Top stores por # entregas / facturación / incidencias
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_top_stores(
  from_date DATE,
  to_date DATE,
  zone_id_filter UUID DEFAULT NULL,
  row_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  store_id UUID,
  store_code TEXT,
  store_name TEXT,
  visits BIGINT,
  total_billed NUMERIC,
  incidents BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    s.id AS store_id,
    s.code AS store_code,
    s.name AS store_name,
    COUNT(d.id)::BIGINT AS visits,
    COALESCE(SUM(
      CASE WHEN d.ticket_data ? 'total' THEN (d.ticket_data->>'total')::NUMERIC ELSE 0 END
    ), 0) AS total_billed,
    COALESCE(SUM(jsonb_array_length(COALESCE(d.incident_details, '[]'::JSONB))), 0)::BIGINT AS incidents
  FROM public.stores s
  LEFT JOIN public.delivery_reports d ON d.store_id = s.id
    AND d.created_at >= from_date::TIMESTAMPTZ
    AND d.created_at < (to_date + 1)::TIMESTAMPTZ
  WHERE (zone_id_filter IS NULL OR s.zone_id = zone_id_filter)
  GROUP BY s.id, s.code, s.name
  HAVING COUNT(d.id) > 0
  ORDER BY visits DESC, total_billed DESC
  LIMIT GREATEST(row_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_top_stores(DATE, DATE, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_top_stores(DATE, DATE, UUID, INTEGER) TO authenticated;

-- ============================================================
-- 4. Top drivers por # rutas / paradas / facturación
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_top_drivers(
  from_date DATE,
  to_date DATE,
  zone_id_filter UUID DEFAULT NULL,
  row_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  driver_id UUID,
  driver_name TEXT,
  routes_count BIGINT,
  stops_completed BIGINT,
  total_distance_meters BIGINT,
  total_billed NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH driver_routes AS (
    SELECT
      r.driver_id,
      COUNT(DISTINCT r.id)::BIGINT AS routes_n,
      COALESCE(SUM(r.total_distance_meters), 0)::BIGINT AS distance_m
    FROM public.routes r
    WHERE r.date BETWEEN from_date AND to_date
      AND r.driver_id IS NOT NULL
      AND r.status = 'COMPLETED'
      AND (zone_id_filter IS NULL OR r.zone_id = zone_id_filter)
    GROUP BY r.driver_id
  ),
  driver_stops AS (
    SELECT r.driver_id, COUNT(s.id)::BIGINT AS stops_n
    FROM public.routes r
    JOIN public.stops s ON s.route_id = r.id
    WHERE r.date BETWEEN from_date AND to_date
      AND r.driver_id IS NOT NULL
      AND s.status = 'completed'
      AND (zone_id_filter IS NULL OR r.zone_id = zone_id_filter)
    GROUP BY r.driver_id
  ),
  driver_billed AS (
    SELECT d.driver_id, SUM((d.ticket_data->>'total')::NUMERIC) AS billed
    FROM public.delivery_reports d
    WHERE d.created_at >= from_date::TIMESTAMPTZ
      AND d.created_at < (to_date + 1)::TIMESTAMPTZ
      AND d.ticket_data IS NOT NULL
      AND d.ticket_data ? 'total'
      AND (zone_id_filter IS NULL OR d.zone_id = zone_id_filter)
    GROUP BY d.driver_id
  )
  SELECT
    dr.driver_id,
    COALESCE(up.full_name, 'Sin nombre') AS driver_name,
    dr.routes_n,
    COALESCE(ds.stops_n, 0)::BIGINT,
    dr.distance_m,
    COALESCE(db.billed, 0)::NUMERIC
  FROM driver_routes dr
  LEFT JOIN driver_stops ds ON ds.driver_id = dr.driver_id
  LEFT JOIN driver_billed db ON db.driver_id = dr.driver_id
  LEFT JOIN public.drivers d ON d.id = dr.driver_id
  LEFT JOIN public.user_profiles up ON up.id = d.user_id
  ORDER BY dr.routes_n DESC, dr.distance_m DESC
  LIMIT GREATEST(row_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_top_drivers(DATE, DATE, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_top_drivers(DATE, DATE, UUID, INTEGER) TO authenticated;
