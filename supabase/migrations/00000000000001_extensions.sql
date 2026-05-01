-- Extensiones requeridas por el schema.
-- Se ejecuta una sola vez al provisionar el proyecto.

-- UUID generation (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Coordenadas geográficas e índices espaciales (búsquedas por proximidad).
-- Si Supabase no tiene postgis habilitado por defecto, hay que activarlo en el dashboard.
CREATE EXTENSION IF NOT EXISTS postgis;
