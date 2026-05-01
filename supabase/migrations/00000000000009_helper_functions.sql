-- Triggers y funciones auxiliares.

-- Trigger genérico para mantener updated_at actualizado.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Aplicar el trigger a tablas con updated_at.
DROP TRIGGER IF EXISTS routes_set_updated_at ON routes;
CREATE TRIGGER routes_set_updated_at
  BEFORE UPDATE ON routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cuando una ruta cambia a IN_PROGRESS, marca el primer stop como 'arrived'
-- solo si nadie lo modificó. Útil para el caso "el chofer empezó la ruta sin
-- marcar arrival manual". Por ahora dejamos esto OPCIONAL (sin trigger automático).

-- Vista útil: rutas activas con conteo de paradas pendientes.
-- Útil para el dashboard del encargado de zona.
CREATE OR REPLACE VIEW v_active_routes AS
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

-- Función helper para job nocturno: agrega KPIs del día por zona.
-- El control plane llama vía RPC y consume el resultado.
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
LANGUAGE SQL STABLE AS $$
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
