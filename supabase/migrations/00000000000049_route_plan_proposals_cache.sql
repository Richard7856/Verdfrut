-- ADR-106 / OE-3.1: cache de propuestas de rutas para apply instantáneo.
--
-- Cuando `proposePlans` computa 2-3 alternativas (cheapest/balanced/fastest),
-- el cálculo cuesta 30-60s (N llamadas a VROOM en paralelo + matriz Google
-- Routes). Sin cache, aplicar la opción elegida vuelve a correr VROOM:
-- el user paga 60s extra esperando el "Aplicar →".
--
-- Esta tabla guarda el plan rico (stops + sequences + ETAs) por TTL 30min.
-- Apply lee del cache y va directo al RPC atómico — de 30-60s → ~500ms.
--
-- TTL: 30 minutos. Suficiente para que el dispatcher revise las 3 cards,
-- compare, decida. Si tarda más, el cache expira y propose-routes hay
-- que correrlo de nuevo — feature, no bug: condiciones de mercado
-- (tráfico, capacidad) cambian, recomputar es honesto.
--
-- Idempotencia: la PK es UUID generada al insertar; el caller recibe el
-- proposal_id y lo pasa a apply. NO hay constraint de unicidad por
-- (dispatch_id, user) — el dispatcher puede pedir 3 propuestas en sucesión
-- y aplicar la que prefiera.

BEGIN;

CREATE TABLE IF NOT EXISTS route_plan_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  dispatch_id UUID REFERENCES dispatches(id) ON DELETE CASCADE,
  /**
   * El plan completo serializado. Estructura:
   *   {
   *     alternatives: [
   *       {
   *         id, labels[], vehicle_count, feasible,
   *         metrics: { total_km, total_driver_hours, max_driver_hours },
   *         cost: { total_mxn, fuel_mxn, wear_mxn, labor_mxn, overhead_mxn },
   *         routes: [
   *           {
   *             vehicle_id, driver_id, depot_override_id, name,
   *             total_distance_meters, total_duration_seconds,
   *             estimated_start_at, estimated_end_at,
   *             stops: [
   *               { store_id, sequence, planned_arrival_at,
   *                 planned_departure_at, load[] }
   *             ]
   *           }
   *         ]
   *       }
   *     ],
   *     k_explored: { minK, maxK },
   *     always_unassigned_store_ids: [...]
   *   }
   * Apply lee de aquí el alternative.id elegido y pasa routes directo al
   * RPC sin recomputar VROOM.
   */
  payload JSONB NOT NULL,
  /** TTL — expira 30 min después de generar. Apply rechaza si > expires_at. */
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Audit del usuario que generó la propuesta. */
  created_by UUID REFERENCES user_profiles(id)
);

-- Índices: lookup por id (PK ya) + cleanup por expires_at.
CREATE INDEX IF NOT EXISTS idx_route_plan_proposals_expires
  ON route_plan_proposals (expires_at);

CREATE INDEX IF NOT EXISTS idx_route_plan_proposals_dispatch
  ON route_plan_proposals (dispatch_id, generated_at DESC)
  WHERE dispatch_id IS NOT NULL;

ALTER TABLE route_plan_proposals ENABLE ROW LEVEL SECURITY;

-- RLS: cada user solo ve propuestas de su customer. Same patrón que el resto.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'route_plan_proposals'
      AND policyname = 'route_plan_proposals_select_same_customer'
  ) THEN
    CREATE POLICY route_plan_proposals_select_same_customer
      ON route_plan_proposals FOR SELECT
      USING (
        customer_id = (
          SELECT customer_id FROM user_profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

-- Cleanup function — corre periódico (n8n / cron) para eliminar expiradas.
-- Sin cleanup la tabla crecería ~50KB por propuesta × N propuestas/día.
-- Manejable, pero el cleanup mantiene la tabla pequeña para queries veloces.
CREATE OR REPLACE FUNCTION tripdrive_route_plan_proposals_cleanup()
RETURNS TABLE (deleted_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM route_plan_proposals
  WHERE expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END $$;

COMMIT;
