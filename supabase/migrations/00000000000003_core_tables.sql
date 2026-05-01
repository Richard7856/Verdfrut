-- Tablas centrales del proyecto del cliente.
-- Todas tienen RLS activado (las policies se crean en 00000000000007_rls_policies.sql).

-- Zonas geográficas dentro del cliente (CDMX, Monterrey, etc.).
-- Las RLS de las demás tablas filtran por zone_id.
CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;

-- Perfil extendido del usuario. Linkeado 1:1 con auth.users via user_id.
-- Cada usuario tiene exactamente UNA zona (excepto admin/dispatcher que pueden tener zone_id NULL).
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL,
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_user_profiles_zone ON user_profiles(zone_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Tiendas destino. Cada tienda pertenece a una zona.
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  -- Ventana horaria preferida (hora local del tenant). NULL = cualquier hora.
  receiving_window_start TIME,
  receiving_window_end TIME,
  -- Tiempo estimado de servicio en la tienda. Default 15 min.
  service_time_seconds INTEGER NOT NULL DEFAULT 900,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_stores_zone ON stores(zone_id);

-- Camiones. Capacity es un array para soportar múltiples dimensiones (peso, volumen, cajas).
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate TEXT NOT NULL UNIQUE,
  alias TEXT,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  capacity INTEGER[] NOT NULL DEFAULT ARRAY[1000, 10, 50],
  depot_lat DOUBLE PRECISION,
  depot_lng DOUBLE PRECISION,
  status vehicle_status NOT NULL DEFAULT 'available',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vehicles_zone ON vehicles(zone_id);

-- Choferes (datos operativos extra del UserProfile con role='driver').
-- user_id es UNIQUE: un user solo puede ser un driver.
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  license_number TEXT,
  license_expires_at DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_drivers_zone ON drivers(zone_id);
