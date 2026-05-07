-- S18.5: detección de anomalías para el admin/dispatcher.
-- Devuelve choferes silenciosos (sin broadcast >5 min), rutas atrasadas
-- (delay > 15 min de ETA), y chats abiertos sin resolver >20 min.
--
-- Llamada típica: GET /api/anomalies (cada 60s polling) → admin.

CREATE OR REPLACE FUNCTION public.get_active_anomalies(
  zone_id_filter UUID DEFAULT NULL
)
RETURNS TABLE (
  kind TEXT,
  severity TEXT,
  route_id UUID,
  driver_id UUID,
  driver_name TEXT,
  store_name TEXT,
  zone_id UUID,
  detected_at TIMESTAMPTZ,
  details JSONB
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- 1) Choferes silenciosos
  SELECT
    'silent_driver'::TEXT AS kind,
    CASE
      WHEN EXTRACT(EPOCH FROM (NOW() - COALESCE(b.last_recorded, r.actual_start_at))) > 900 THEN 'high'::TEXT
      ELSE 'medium'::TEXT
    END AS severity,
    r.id AS route_id,
    r.driver_id,
    up.full_name AS driver_name,
    NULL::TEXT AS store_name,
    r.zone_id,
    COALESCE(b.last_recorded, r.actual_start_at) AS detected_at,
    jsonb_build_object(
      'minutes_silent', ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(b.last_recorded, r.actual_start_at))) / 60),
      'last_lat', b.last_lat,
      'last_lng', b.last_lng,
      'has_active_gap', EXISTS (
        SELECT 1 FROM route_gap_events ge
        WHERE ge.route_id = r.id AND ge.ended_at IS NULL
      )
    ) AS details
  FROM routes r
  LEFT JOIN drivers d ON d.id = r.driver_id
  LEFT JOIN user_profiles up ON up.id = d.user_id
  LEFT JOIN LATERAL (
    SELECT recorded_at AS last_recorded, lat AS last_lat, lng AS last_lng
    FROM route_breadcrumbs
    WHERE route_id = r.id
    ORDER BY recorded_at DESC
    LIMIT 1
  ) b ON TRUE
  WHERE r.status = 'IN_PROGRESS'
    AND (zone_id_filter IS NULL OR r.zone_id = zone_id_filter)
    AND EXTRACT(EPOCH FROM (NOW() - COALESCE(b.last_recorded, r.actual_start_at))) > 300

  UNION ALL

  -- 2) Rutas atrasadas
  SELECT
    'route_delayed'::TEXT,
    CASE
      WHEN EXTRACT(EPOCH FROM (NOW() - r.estimated_end_at)) > 1800 THEN 'high'::TEXT
      ELSE 'medium'::TEXT
    END,
    r.id,
    r.driver_id,
    up.full_name,
    NULL::TEXT,
    r.zone_id,
    r.estimated_end_at,
    jsonb_build_object(
      'minutes_late', ROUND(EXTRACT(EPOCH FROM (NOW() - r.estimated_end_at)) / 60),
      'estimated_end_at', r.estimated_end_at
    )
  FROM routes r
  LEFT JOIN drivers d ON d.id = r.driver_id
  LEFT JOIN user_profiles up ON up.id = d.user_id
  WHERE r.status IN ('PUBLISHED', 'IN_PROGRESS')
    AND r.estimated_end_at IS NOT NULL
    AND r.estimated_end_at < NOW() - INTERVAL '15 minutes'
    AND (zone_id_filter IS NULL OR r.zone_id = zone_id_filter)

  UNION ALL

  -- 3) Chats abiertos sin resolver >20 min
  SELECT
    'chat_open_long'::TEXT,
    CASE
      WHEN EXTRACT(EPOCH FROM (NOW() - dr.chat_opened_at)) > 1800 THEN 'high'::TEXT
      ELSE 'medium'::TEXT
    END,
    dr.route_id,
    dr.driver_id,
    up.full_name,
    dr.store_name,
    dr.zone_id,
    dr.chat_opened_at,
    jsonb_build_object(
      'minutes_open', ROUND(EXTRACT(EPOCH FROM (NOW() - dr.chat_opened_at)) / 60),
      'report_id', dr.id,
      'report_type', dr.type
    )
  FROM delivery_reports dr
  LEFT JOIN drivers d ON d.id = dr.driver_id
  LEFT JOIN user_profiles up ON up.id = d.user_id
  WHERE dr.chat_status = 'open'
    AND dr.chat_opened_at IS NOT NULL
    AND dr.chat_opened_at < NOW() - INTERVAL '20 minutes'
    AND (zone_id_filter IS NULL OR dr.zone_id = zone_id_filter)

  ORDER BY detected_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_active_anomalies(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_anomalies(UUID) TO authenticated;
