-- ADR-086 follow-up: tripdrive_restructure_dispatch debe poblar
-- customer_id en el INSERT INTO routes, porque la RPC se invoca via
-- service_role (sin auth.uid()) y el trigger auto_set_customer_id no
-- puede inferirlo desde sesión.
--
-- Bug: post-migration 037, cualquier llamada a restructureDispatch
-- (re-optimizar tiro / agregar camioneta a tiro existente) fallaría
-- en el INSERT INTO routes con "INSERT en routes requiere customer_id".
-- La RPC ya lee v_dispatch_record de dispatches → tiene customer_id
-- disponible — solo hay que pasarlo al INSERT.
--
-- Fix: reemplazar la función completa, único cambio sustantivo es
-- agregar `customer_id` al INSERT INTO routes con el valor de
-- v_dispatch_record.customer_id (que dispatches ya tiene NOT NULL).
--
-- Alternativas consideradas:
--   - Pasar p_customer_id como parámetro nuevo: rompe el contrato
--     existente con apps/platform que llama la RPC. Innecesario porque
--     el dispatch ya tiene el customer.
--   - Hacer la RPC INVOKER en lugar de DEFINER: pierde el bypass de
--     RLS que actualmente protege la atomicidad cross-table.

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
  v_dispatch_record  dispatches%ROWTYPE;
  v_route_payload    JSONB;
  v_stop_payload     JSONB;
  v_new_route_id     UUID;
  v_new_route_ids    UUID[] := ARRAY[]::UUID[];
BEGIN
  -- 1. Validar dispatch.
  SELECT * INTO v_dispatch_record FROM dispatches WHERE id = p_dispatch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch % no encontrado', p_dispatch_id USING ERRCODE = '42704';
  END IF;

  -- 2. Validar que las rutas viejas pertenecen al dispatch.
  IF EXISTS (
    SELECT 1 FROM routes
    WHERE id = ANY(p_old_route_ids)
      AND (dispatch_id IS DISTINCT FROM p_dispatch_id)
  ) THEN
    RAISE EXCEPTION 'Alguna ruta vieja no pertenece al dispatch %', p_dispatch_id
      USING ERRCODE = '22023';
  END IF;

  -- 3. Borrar stops de las rutas viejas.
  DELETE FROM stops WHERE route_id = ANY(p_old_route_ids);

  -- 4. Cancelar rutas viejas.
  UPDATE routes
  SET status = 'CANCELLED',
      updated_at = now()
  WHERE id = ANY(p_old_route_ids);

  -- 5. Insertar rutas nuevas con sus stops. customer_id heredado del
  -- dispatch (ADR-086).
  FOR v_route_payload IN SELECT * FROM jsonb_array_elements(p_routes_json) LOOP
    INSERT INTO routes (
      name,
      date,
      vehicle_id,
      driver_id,
      zone_id,
      customer_id,
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
      v_dispatch_record.customer_id,
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
  'ADR-053 + ADR-086 fix: redistribuye un tiro atómicamente. Hereda customer_id del dispatch al insertar rutas nuevas (compatibilidad con multi-customer schema migration 037).';

-- Grants no cambian — ya estaban: REVOKE FROM PUBLIC/anon/authenticated,
-- GRANT TO service_role (mig 032 sigue válido).
