-- 012_postgis_to_extensions_schema
--
-- Mover PostGIS de public a extensions (resuelve los advisors PostGIS-related).
-- Verificado: ninguna tabla nuestra usa tipos GEOMETRY/GEOGRAPHY actualmente.
-- Si en el futuro se usan, hay que cualificar con extensions.GEOMETRY o agregar
-- extensions al search_path.

DROP EXTENSION IF EXISTS postgis CASCADE;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
