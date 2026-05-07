-- S18.6: TTL para route_breadcrumbs (issue #33) + actual_distance_meters en routes.

CREATE OR REPLACE FUNCTION public.archive_old_breadcrumbs(
  retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  DELETE FROM public.route_breadcrumbs
  WHERE recorded_at < NOW() - make_interval(days => retention_days);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_old_breadcrumbs(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_old_breadcrumbs(INTEGER) TO service_role;

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS actual_distance_meters INTEGER;

CREATE OR REPLACE FUNCTION public.calc_route_actual_distance(target_route_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  total_meters NUMERIC := 0;
  prev_lat NUMERIC;
  prev_lng NUMERIC;
  curr_lat NUMERIC;
  curr_lng NUMERIC;
  R NUMERIC := 6371000;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT lat, lng FROM public.route_breadcrumbs
    WHERE route_id = target_route_id
    ORDER BY recorded_at ASC
  LOOP
    curr_lat := rec.lat;
    curr_lng := rec.lng;
    IF prev_lat IS NOT NULL THEN
      total_meters := total_meters + 2 * R * ASIN(
        SQRT(
          POWER(SIN(RADIANS((curr_lat - prev_lat) / 2)), 2) +
          COS(RADIANS(prev_lat)) * COS(RADIANS(curr_lat)) *
          POWER(SIN(RADIANS((curr_lng - prev_lng) / 2)), 2)
        )
      );
    END IF;
    prev_lat := curr_lat;
    prev_lng := curr_lng;
  END LOOP;
  RETURN ROUND(total_meters)::INTEGER;
END;
$$;

REVOKE ALL ON FUNCTION public.calc_route_actual_distance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calc_route_actual_distance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_calc_actual_distance_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' THEN
    BEGIN
      NEW.actual_distance_meters := public.calc_route_actual_distance(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      NEW.actual_distance_meters := NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS routes_actual_distance ON public.routes;
CREATE TRIGGER routes_actual_distance
  BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_calc_actual_distance_on_complete();
