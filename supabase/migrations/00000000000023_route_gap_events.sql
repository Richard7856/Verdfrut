-- S18.4 / ADR-031+: registro de gaps de GPS del chofer.
--
-- Caso de uso: el chofer abre Waze para navegar — la PWA de VerdFrut va a
-- background y `watchPosition` deja de emitir. Sin esto, el supervisor ve al
-- chofer "congelado" sin saber si hay problema o solo está en otra app.
--
-- El cliente reporta cada gap:
--   - gap_start cuando el documento va a hidden (visibilitychange)
--   - gap_end cuando vuelve visible
-- El admin ve el chofer en GRIS durante el gap, vuelve a verde al cierre.
--
-- Para audit, los gaps quedan persistidos: cuántos minutos del día estuvo el
-- chofer "fuera de la app", cuántas veces salió, etc.

CREATE TABLE IF NOT EXISTS public.route_gap_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  -- Última posición conocida ANTES de que el documento se ocultara (admin la
  -- usa para mostrar "última señal aquí, hace X min").
  last_known_lat NUMERIC(10, 7),
  last_known_lng NUMERIC(10, 7),
  -- Cómo terminó el gap (back_to_app es el caso normal; los demás detectan
  -- abandons y se marcan via cron para reportes futuros).
  end_reason TEXT
    CHECK (end_reason IN ('back_to_app', 'timeout', 'closed', 'route_completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index para queries de "gaps activos" (rendered en /map para mostrar quién
-- está sin señal AHORA).
CREATE INDEX IF NOT EXISTS idx_gap_events_active
  ON public.route_gap_events(route_id, ended_at)
  WHERE ended_at IS NULL;

-- Index para reportes históricos por chofer.
CREATE INDEX IF NOT EXISTS idx_gap_events_driver_date
  ON public.route_gap_events(driver_id, started_at DESC);

-- RLS — el chofer escribe los suyos; admin/dispatcher lee de su zona via JOIN
-- con routes.
ALTER TABLE public.route_gap_events ENABLE ROW LEVEL SECURITY;

-- Driver inserta gaps de sus propias rutas (FK driver_id matches su record).
DROP POLICY IF EXISTS gap_events_driver_insert ON public.route_gap_events;
CREATE POLICY gap_events_driver_insert ON public.route_gap_events
  FOR INSERT
  WITH CHECK (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- Driver actualiza gaps suyos (cerrar el gap con ended_at).
DROP POLICY IF EXISTS gap_events_driver_update ON public.route_gap_events;
CREATE POLICY gap_events_driver_update ON public.route_gap_events
  FOR UPDATE
  USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  )
  WITH CHECK (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- Admin/dispatcher leen todos. zone_manager lee de SU zona via routes.zone_id.
DROP POLICY IF EXISTS gap_events_supervision_read ON public.route_gap_events;
CREATE POLICY gap_events_supervision_read ON public.route_gap_events
  FOR SELECT
  USING (
    public.is_admin_or_dispatcher()
    OR (
      public.current_user_role() = 'zone_manager'
      AND route_id IN (
        SELECT id FROM public.routes WHERE zone_id = public.current_user_zone()
      )
    )
  );

-- Driver lee los suyos para verificarlos en su propia app si es necesario.
DROP POLICY IF EXISTS gap_events_driver_read ON public.route_gap_events;
CREATE POLICY gap_events_driver_read ON public.route_gap_events
  FOR SELECT
  USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- Comentarios para schema introspection
COMMENT ON TABLE public.route_gap_events IS
  'Registro de periodos en que el GPS del chofer dejó de reportar (PWA backgrounded). S18.4.';
COMMENT ON COLUMN public.route_gap_events.end_reason IS
  'back_to_app: chofer volvió a la PWA. timeout: cron detectó >X min sin gap_end. closed: chofer cerró sesión. route_completed: ruta terminó con gap abierto.';
