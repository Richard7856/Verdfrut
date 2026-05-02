-- 017_depots_table
--
-- Tabla `depots` (CEDIS / Hubs): puntos físicos desde donde los vehículos
-- inician y terminan rutas. Antes el depot vivía como `depot_lat/lng` en
-- cada vehicle (ver migración 003), lo que duplicaba data y dificultaba
-- centralizar cambios cuando todos los vehículos comparten CEDIS.
--
-- Backward compat: vehicles.depot_lat/lng se mantienen como override por
-- vehículo. Si depot_id está set, esos valores se IGNORAN al optimizar.
-- El optimizer prefiere depot_id si existe; cae a depot_lat/lng si no.

CREATE TABLE IF NOT EXISTS public.depots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng NUMERIC(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone_id, code)
);

CREATE INDEX IF NOT EXISTS idx_depots_zone ON public.depots(zone_id) WHERE is_active = TRUE;

COMMENT ON TABLE public.depots IS
  'CEDIS / Hub. Punto físico desde donde los vehículos salen y regresan en una ruta.';
COMMENT ON COLUMN public.depots.code IS 'Código corto único en la zona, ej: VLLJ.';

-- FK opcional desde vehicles. Si está NULL, se usan vehicles.depot_lat/lng.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS depot_id UUID REFERENCES public.depots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_depot ON public.vehicles(depot_id) WHERE depot_id IS NOT NULL;

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;

CREATE POLICY depots_select ON public.depots
  FOR SELECT TO authenticated
  USING (
    (SELECT is_admin_or_dispatcher())
    OR zone_id = (SELECT current_user_zone())
  );

CREATE POLICY depots_admin_insert ON public.depots
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin_or_dispatcher()));

CREATE POLICY depots_admin_update ON public.depots
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()))
  WITH CHECK ((SELECT is_admin_or_dispatcher()));

CREATE POLICY depots_admin_delete ON public.depots
  FOR DELETE TO authenticated
  USING ((SELECT is_admin_or_dispatcher()));
