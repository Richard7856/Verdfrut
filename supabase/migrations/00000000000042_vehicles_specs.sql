-- Campos extra del vehículo: marca, modelo, año, motor, consumo, notas.
-- Todos nullables — los existentes quedan con NULL hasta que el operador
-- los complete (con AI enrichment o manual).
--
-- Por qué: la operación crece y el dispatcher quiere ver más que solo
-- "placa + capacidad" — necesita identificar visualmente cada unidad
-- (marca/modelo/año), planear mantenimiento (consumo, motor) y dejar
-- comentarios libres (notas).

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS make TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS year INTEGER,
  ADD COLUMN IF NOT EXISTS engine_size_l NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS fuel_consumption_l_per_100km NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN vehicles.make IS 'Marca (Nissan, Hyundai, Mitsubishi...). NULL si no se ha enriquecido.';
COMMENT ON COLUMN vehicles.model IS 'Modelo (NV200, H100, L200...). Texto libre.';
COMMENT ON COLUMN vehicles.year IS 'Año del modelo (ej. 2020). 1990-actual+1.';
COMMENT ON COLUMN vehicles.engine_size_l IS 'Cilindrada en litros (ej. 1.6).';
COMMENT ON COLUMN vehicles.fuel_consumption_l_per_100km IS 'Consumo promedio L/100km (ciudad + carretera mixto).';
COMMENT ON COLUMN vehicles.notes IS 'Comentarios libres del operador.';
