-- Migración 032 (ADR-053): RPC atómica para redistribuir un tiro.
--
-- Razón: hoy `restructureDispatchInternal` (TS) hace 4 pasos secuenciales sin
-- atomicidad:
--   1. Cancela rutas viejas.
--   2. Borra sus stops.
--   3. Llama optimizer Railway.
--   4. Crea rutas nuevas + stops.
--
-- Si el paso 3 falla, las rutas viejas ya están canceladas → tiro queda vacío.
-- Si el paso 4 falla a la mitad, hay rutas creadas con stops parciales.
--
-- Solución two-phase: el TS-side hace el optimizer ANTES de tocar la BD,
-- recibe el plan, y luego llama esta RPC que en UNA transacción Postgres:
--   - Cancela las rutas viejas.
--   - Borra sus stops.
--   - Inserta las rutas nuevas + stops + estatus OPTIMIZED.
--   - Si algo falla, rollback automático → el tiro queda exactamente como
--     estaba antes de invocar la RPC.
--
-- La RPC NO llama al optimizer — el caller le pasa el plan ya calculado.
-- Esto respeta la regla "no I/O externo dentro de transacción Postgres".
--
-- Estructura del payload `p_routes_json`:
--   [
--     {
--       "vehicle_id": uuid,
--       "driver_id": uuid | null,
--       "depot_override_id": uuid | null,
--       "name": "Tiro X — Kangoo 1",
--       "total_distance_meters": int,
--       "total_duration_seconds": int,
--       "estimated_start_at": timestamptz,
--       "estimated_end_at": timestamptz,
--       "stops": [
--         { "store_id": uuid, "sequence": int, "planned_arrival_at": timestamptz, "planned_departure_at": timestamptz, "load": int[] },
--         ...
--       ]
--     },
--     ...
--   ]

BEGIN;

CREATE OR REPLACE FUNCTION tripdrive_restructure_dispatch(
  p_dispatch_id UUID,
  p_old_route_ids UUID[],
  p_routes_json JSONB,
  p_created_by UUID
) RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch_record RECORD;
  v_route_payload JSONB;
  v_new_route_id UUID;
  v_new_route_ids UUID[] := ARRAY[]::UUID[];
  v_stop_payload JSONB;
  v_blocking_status TEXT;
BEGIN
  -- 1. Validar dispatch existe y obtener zona/fecha.
  SELECT id, date, zone_id INTO v_dispatch_record
  FROM dispatches
  WHERE id = p_dispatch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tiro % no encontrado', p_dispatch_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Validar que NINGUNA ruta del set old está en post-publicación.
  -- Si alguna pasó a PUBLISHED entre el momento que el caller leyó y este
  -- punto, abortar — el chofer ya recibió el push.
  SELECT status::text INTO v_blocking_status
  FROM routes
  WHERE id = ANY(p_old_route_ids)
    AND status IN ('PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED')
  LIMIT 1;

  IF v_blocking_status IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede redistribuir: alguna ruta está en %', v_blocking_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Borrar stops de las rutas viejas. Importante: FK route_id → routes
  -- (sin ON DELETE CASCADE) requiere que las stops se borren primero.
  DELETE FROM stops WHERE route_id = ANY(p_old_route_ids);

  -- 4. Cancelar rutas viejas.
  UPDATE routes
  SET status = 'CANCELLED',
      updated_at = now()
  WHERE id = ANY(p_old_route_ids);

  -- 5. Insertar rutas nuevas con sus stops.
  FOR v_route_payload IN SELECT * FROM jsonb_array_elements(p_routes_json) LOOP
    INSERT INTO routes (
      name,
      date,
      vehicle_id,
      driver_id,
      zone_id,
      status,
      created_by,
      dispatch_id,
      depot_override_id,
      total_distance_meters,
      total_duration_seconds,
      estimated_start_at,
      estimated_end_at
    ) VALUES (
      (v_route_payload->>'name')::text,
      v_dispatch_record.date,
      (v_route_payload->>'vehicle_id')::uuid,
      NULLIF(v_route_payload->>'driver_id', '')::uuid,
      v_dispatch_record.zone_id,
      'OPTIMIZED',
      p_created_by,
      p_dispatch_id,
      NULLIF(v_route_payload->>'depot_override_id', '')::uuid,
      (v_route_payload->>'total_distance_meters')::int,
      (v_route_payload->>'total_duration_seconds')::int,
      (v_route_payload->>'estimated_start_at')::timestamptz,
      (v_route_payload->>'estimated_end_at')::timestamptz
    ) RETURNING id INTO v_new_route_id;

    v_new_route_ids := array_append(v_new_route_ids, v_new_route_id);

    -- Insertar stops de esta ruta.
    FOR v_stop_payload IN SELECT * FROM jsonb_array_elements(v_route_payload->'stops') LOOP
      INSERT INTO stops (
        route_id,
        store_id,
        sequence,
        status,
        planned_arrival_at,
        planned_departure_at,
        load
      ) VALUES (
        v_new_route_id,
        (v_stop_payload->>'store_id')::uuid,
        (v_stop_payload->>'sequence')::int,
        'pending',
        NULLIF(v_stop_payload->>'planned_arrival_at', '')::timestamptz,
        NULLIF(v_stop_payload->>'planned_departure_at', '')::timestamptz,
        COALESCE(
          (SELECT array_agg(value::int) FROM jsonb_array_elements_text(v_stop_payload->'load')),
          ARRAY[]::int[]
        )
      );
    END LOOP;
  END LOOP;

  RETURN v_new_route_ids;
END;
$$;

COMMENT ON FUNCTION tripdrive_restructure_dispatch IS
  'ADR-053: redistribuye un tiro atómicamente. El caller pasa el plan ya calculado (post-optimizer). En una sola transacción cancela rutas viejas, borra sus stops e inserta las nuevas. Rollback automático si algo falla.';

-- Grant ejecución a service_role solamente — la operación es destructiva y
-- requiere bypass de RLS. Los server actions ya validan auth antes de llamar.
REVOKE EXECUTE ON FUNCTION tripdrive_restructure_dispatch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tripdrive_restructure_dispatch TO service_role;

COMMIT;
