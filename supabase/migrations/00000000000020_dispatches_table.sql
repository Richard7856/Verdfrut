-- ADR-024: Tiros (dispatches) como agrupador operativo de rutas.

CREATE TABLE IF NOT EXISTS public.dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  zone_id UUID NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'dispatched', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (zone_id, date, name)
);

CREATE INDEX IF NOT EXISTS idx_dispatches_zone_date
  ON public.dispatches(zone_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_status
  ON public.dispatches(status) WHERE status IN ('planning', 'dispatched');

ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatches_read ON public.dispatches;
CREATE POLICY dispatches_read ON public.dispatches FOR SELECT TO authenticated
  USING (
    is_admin_or_dispatcher()
    OR (current_user_role() = 'zone_manager' AND zone_id = current_user_zone())
  );

DROP POLICY IF EXISTS dispatches_write ON public.dispatches;
CREATE POLICY dispatches_write ON public.dispatches FOR ALL TO authenticated
  USING (is_admin_or_dispatcher())
  WITH CHECK (is_admin_or_dispatcher());

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS dispatch_id UUID
    REFERENCES public.dispatches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_routes_dispatch
  ON public.routes(dispatch_id) WHERE dispatch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_recalc_dispatch_status() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d_id UUID;
  total INTEGER;
  done INTEGER;
  cancelled INTEGER;
  active INTEGER;
  new_status TEXT;
BEGIN
  d_id := COALESCE(
    CASE TG_OP WHEN 'DELETE' THEN OLD.dispatch_id ELSE NEW.dispatch_id END,
    CASE TG_OP WHEN 'UPDATE' THEN OLD.dispatch_id ELSE NULL END
  );
  IF d_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('COMPLETED')),
         COUNT(*) FILTER (WHERE status = 'CANCELLED'),
         COUNT(*) FILTER (WHERE status IN ('PUBLISHED', 'IN_PROGRESS'))
  INTO total, done, cancelled, active
  FROM public.routes WHERE dispatch_id = d_id;

  IF total = 0 THEN new_status := 'planning';
  ELSIF cancelled = total THEN new_status := 'cancelled';
  ELSIF (done + cancelled) = total THEN new_status := 'completed';
  ELSIF active > 0 THEN new_status := 'dispatched';
  ELSE new_status := 'planning';
  END IF;

  UPDATE public.dispatches
  SET status = new_status, updated_at = NOW()
  WHERE id = d_id AND status <> new_status;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_routes_recalc_dispatch ON public.routes;
CREATE TRIGGER tg_routes_recalc_dispatch
  AFTER INSERT OR UPDATE OF status, dispatch_id OR DELETE ON public.routes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_recalc_dispatch_status();

GRANT EXECUTE ON FUNCTION public.tg_recalc_dispatch_status() TO authenticated;
