-- ADR-107 / OE-4a: cache pair-by-pair de matriz de routing.
--
-- Mapbox Directions Matrix cuesta ~$0.002-0.005 USD por matrix call. En
-- el flow típico de proposePlans con K=[2,3,4] cada uno N=8-10 clusters,
-- son 30-50 matrix calls × $0.005 = $0.15-0.25 USD por propuesta. A 10
-- propuestas/día/customer = $2.50 USD/día. Acumulado: ~$75/mes/customer.
--
-- El usage pattern real tiene MUCHA redundancia:
--   - Mismo tiro reproposed varias veces el mismo día
--   - Mismas tiendas de mañana sirven al armar tiros de tarde
--   - Apply re-corre matrix sobre subsets que ya teníamos
--
-- Cache pair-by-pair: cada par (origin_lat,lng → dest_lat,lng) tiene su
-- propia entrada. Cuando se pide N×N matrix, query las N² pairs en bulk.
-- Si todas hitean → matrix sale del cache, ZERO calls a Mapbox. Si alguna
-- falla → call Mapbox completo (no podemos pedir solo los pairs faltantes,
-- Mapbox API trabaja con lista de coords), y se PERSISTEN todos los pairs
-- para hits futuros. ROI 5×+ por la asimetría hit/miss.
--
-- Precisión coords: NUMERIC(10,7) = 7 decimales = ~1cm. Mapbox devuelve
-- exactamente las coords que mandas — no hay drift. Round client-side
-- antes de query+insert para evitar diff por float jitter.
--
-- TTL: 7 días. Más allá la infraestructura vial puede haber cambiado
-- (calles cerradas, sentidos invertidos). El tráfico cambia minuto a
-- minuto pero `driving-traffic` no es la realidad live de hoy, es un
-- modelo estadístico — 7d es razonable. Para reoptimize-live con tráfico
-- real (post-publish), seguimos llamando Google Routes sin cache.

BEGIN;

CREATE TABLE IF NOT EXISTS routing_matrix_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  origin_lat NUMERIC(10, 7) NOT NULL,
  origin_lng NUMERIC(10, 7) NOT NULL,
  dest_lat NUMERIC(10, 7) NOT NULL,
  dest_lng NUMERIC(10, 7) NOT NULL,
  duration_seconds INTEGER NOT NULL,
  distance_meters INTEGER NOT NULL,
  /** 'mapbox' | 'google' | 'haversine'. Permite cachear de cada provider sin colisión. */
  provider TEXT NOT NULL,
  /** 'driving' | 'driving-traffic' | 'walking' | 'cycling'. Mapbox profile. */
  profile TEXT NOT NULL DEFAULT 'driving-traffic',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Última vez que se sirvió desde cache — métrica de utilidad por par. */
  last_hit_at TIMESTAMPTZ,
  hit_count INTEGER NOT NULL DEFAULT 0
);

-- Unique constraint: un par (origin,dest,provider,profile) por customer.
-- Si lo recalculas, UPDATE en lugar de INSERT duplicado (UPSERT pattern).
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_matrix_pair
  ON routing_matrix_pairs (
    customer_id,
    origin_lat,
    origin_lng,
    dest_lat,
    dest_lng,
    provider,
    profile
  );

-- Index plano sobre expires_at — para el cleanup function. Sin partial
-- predicate porque NOW() no es IMMUTABLE (postgres rechaza partial idx
-- con funciones volátiles).
CREATE INDEX IF NOT EXISTS idx_routing_matrix_pairs_expires
  ON routing_matrix_pairs (expires_at);

ALTER TABLE routing_matrix_pairs ENABLE ROW LEVEL SECURITY;

-- RLS: cada user ve solo pares de su customer. Service role bypass para
-- writes desde el server (no requiere user context).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'routing_matrix_pairs'
      AND policyname = 'routing_matrix_pairs_select_same_customer'
  ) THEN
    CREATE POLICY routing_matrix_pairs_select_same_customer
      ON routing_matrix_pairs FOR SELECT
      USING (
        customer_id = (
          SELECT customer_id FROM user_profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

-- Cleanup periódico — corre vía Vercel Cron 1×/día.
CREATE OR REPLACE FUNCTION tripdrive_routing_matrix_cache_cleanup()
RETURNS TABLE (deleted_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM routing_matrix_pairs
  WHERE expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END $$;

COMMIT;
