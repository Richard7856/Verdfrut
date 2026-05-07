-- S18.7: route status INTERRUPTED + tabla route_transfers para audit.
--
-- Caso: camión del chofer A se descompone después de completar paradas X,
-- las paradas pendientes se transfieren al chofer B (otro vehículo).

-- 1. Agregar INTERRUPTED al enum route_status (entre IN_PROGRESS y COMPLETED).
ALTER TYPE public.route_status ADD VALUE IF NOT EXISTS 'INTERRUPTED' BEFORE 'COMPLETED';

-- 2. Tabla auxiliar route_transfers: log de transferencias para audit.
--    No es FK requerido — el reporte de audit puede vivir aunque rutas se borren.
CREATE TABLE IF NOT EXISTS public.route_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  target_route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  transferred_stop_count INTEGER NOT NULL,
  performed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_transfers_source
  ON public.route_transfers(source_route_id);
CREATE INDEX IF NOT EXISTS idx_route_transfers_target
  ON public.route_transfers(target_route_id);

ALTER TABLE public.route_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS route_transfers_admin_read ON public.route_transfers;
CREATE POLICY route_transfers_admin_read ON public.route_transfers
  FOR SELECT
  USING (public.is_admin_or_dispatcher());

DROP POLICY IF EXISTS route_transfers_admin_insert ON public.route_transfers;
CREATE POLICY route_transfers_admin_insert ON public.route_transfers
  FOR INSERT
  WITH CHECK (public.is_admin_or_dispatcher());

COMMENT ON TABLE public.route_transfers IS
  'Audit de transferencias de paradas entre rutas (S18.7). Cuando un camión se descompone, las paradas pendientes se mueven a otra ruta + chofer.';
