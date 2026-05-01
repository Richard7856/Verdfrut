-- Tablas de rutas y paradas. La máquina de estados se documenta en packages/types/src/domain/route.ts.

CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- Fecha operativa en hora LOCAL del tenant (no UTC). Permite query "rutas de hoy" trivial.
  date DATE NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  status route_status NOT NULL DEFAULT 'DRAFT',
  -- Versionado: cada modificación post-PUBLISHED incrementa este número.
  version INTEGER NOT NULL DEFAULT 1,
  total_distance_meters INTEGER,
  total_duration_seconds INTEGER,
  estimated_start_at TIMESTAMPTZ,
  estimated_end_at TIMESTAMPTZ,
  actual_start_at TIMESTAMPTZ,
  actual_end_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES user_profiles(id),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES user_profiles(id),
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_routes_zone_date ON routes(zone_id, date);
CREATE INDEX IF NOT EXISTS idx_routes_driver_status ON routes(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_routes_status ON routes(status) WHERE status IN ('PUBLISHED', 'IN_PROGRESS');

-- Audit trail de modificaciones post-PUBLISHED.
CREATE TABLE IF NOT EXISTS route_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE route_versions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_route_versions_route ON route_versions(route_id);

-- Paradas. El orden viene del optimizador (sequence), modificable por dispatcher.
CREATE TABLE IF NOT EXISTS stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL,
  status stop_status NOT NULL DEFAULT 'pending',
  planned_arrival_at TIMESTAMPTZ,
  planned_departure_at TIMESTAMPTZ,
  actual_arrival_at TIMESTAMPTZ,
  actual_departure_at TIMESTAMPTZ,
  load INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, sequence)
);
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_stops_route ON stops(route_id);
CREATE INDEX IF NOT EXISTS idx_stops_store ON stops(store_id);

-- Breadcrumbs GPS guardados en lote por el chofer (NO el stream realtime — ese va por Broadcast).
-- Sirve para análisis post-hoc de la ruta. Se purgan después de N días via cron.
CREATE TABLE IF NOT EXISTS route_breadcrumbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed REAL,
  heading REAL,
  recorded_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE route_breadcrumbs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_breadcrumbs_route_time ON route_breadcrumbs(route_id, recorded_at);
