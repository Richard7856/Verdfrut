-- ADR-085: RPC para que el chofer haga bump de routes.version + audit
-- atómico SIN usar service_role desde TypeScript.
--
-- Por qué: `apps/driver/src/app/route/actions.ts:reorderStopsByDriverAction`
-- venía haciendo el bump con `createServiceRoleClient()` porque las policies
-- `routes_update` y `route_versions_insert` exigen `is_admin_or_dispatcher()`.
-- Eso es un bypass de RLS desde código cliente — AV-#2 / issue #63 — y
-- bloquea Stream A (multi-customer) porque cualquier sesión driver podía
-- escribir cualquier ruta vía la action.
--
-- Solución: SECURITY DEFINER que valida ownership con auth.uid() y solo
-- acepta routes en PUBLISHED/IN_PROGRESS del chofer logueado. La función
-- corre con privilegios del owner pero los chequeos internos cierran el
-- vector de ataque.
--
-- Alternativas consideradas:
--   - Expandir policy `routes_update` con OR para driver: rechazado porque
--     la policy aplicaría a TODOS los UPDATE, no solo bump de version. Un
--     chofer malicioso podría tocar `status`, `vehicle_id`, etc.
--   - Edge Function: viable pero overkill — un RPC SECURITY DEFINER cubre
--     el mismo perímetro sin agregar superficie de red.

CREATE OR REPLACE FUNCTION bump_route_version_by_driver(
  p_route_id UUID,
  p_reason TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_driver_id      UUID;
  v_route_driver   UUID;
  v_route_status   route_status;
  v_new_version    INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  -- Ownership: el caller debe ser un chofer registrado.
  SELECT id INTO v_driver_id
    FROM drivers
    WHERE user_id = v_user_id;
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no es chofer' USING ERRCODE = '42501';
  END IF;

  -- Validación de input (defense in depth — el caller también valida).
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 OR length(p_reason) > 200 THEN
    RAISE EXCEPTION 'Razón inválida (1-200 chars)' USING ERRCODE = '22023';
  END IF;

  -- Lock optimista de la fila para evitar race conditions del bump.
  SELECT driver_id, status INTO v_route_driver, v_route_status
    FROM routes
    WHERE id = p_route_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ruta no encontrada' USING ERRCODE = '42704';
  END IF;

  IF v_route_driver IS DISTINCT FROM v_driver_id THEN
    RAISE EXCEPTION 'Ruta no pertenece al chofer' USING ERRCODE = '42501';
  END IF;

  IF v_route_status NOT IN ('PUBLISHED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Ruta no está en estado modificable (status=%)' , v_route_status
      USING ERRCODE = '22023';
  END IF;

  -- Bump atómico + audit en la misma transacción del caller.
  UPDATE routes
    SET version = version + 1,
        updated_at = NOW()
    WHERE id = p_route_id
    RETURNING version INTO v_new_version;

  INSERT INTO route_versions (route_id, version, reason, created_by)
    VALUES (p_route_id, v_new_version, p_reason, v_user_id);

  RETURN v_new_version;
END;
$$;

REVOKE EXECUTE ON FUNCTION bump_route_version_by_driver(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bump_route_version_by_driver(UUID, TEXT)
  TO authenticated;

COMMENT ON FUNCTION bump_route_version_by_driver(UUID, TEXT) IS
  'ADR-085: encapsula bump de routes.version + insert route_versions cuando el chofer reordena paradas pendientes. SECURITY DEFINER valida auth.uid() como chofer dueño de la ruta y estado PUBLISHED/IN_PROGRESS antes de escribir. Reemplaza el uso de service_role en driver/route/actions.ts y cierra AV-#2 / issue #63 — pre-condición técnica de Stream A multi-customer.';
