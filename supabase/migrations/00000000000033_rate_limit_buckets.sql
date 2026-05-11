-- Migración 033 (ADR-054 / H4.2 / issue #124): tabla `rate_limit_buckets`
-- para reemplazar el rate limiter in-memory.
--
-- Razón: hoy `apps/{driver,platform}/src/lib/rate-limit.ts` mantienen el state
-- en memoria de cada instancia Node. Eso falla en:
--   1. Vercel scaling — N instancias = N buckets independientes; un atacante
--      pega a distintas IPs/regiones y multiplica su tasa efectiva.
--   2. Restart de instancia — el bucket se vacía al deploy.
--   3. Multi-tenant futuro — cada tenant compite por la misma memoria.
--
-- Diseño: tabla simple key/value con `expires_at` para auto-limpieza vía cron.
-- Cada hit suma un timestamp; al consultar contamos los que están dentro
-- de la ventana. Un cron mensual borra rows con `expires_at < now()`.
--
-- Concurrencia: dos hits simultáneos del mismo bucket → uno se inserta antes
-- que el otro, ambos cuentan. La precisión de "exactamente N hits/min" se
-- aproxima al milisegundo. Aceptable para anti-abuso (no para billing).
--
-- Rendimiento: 2 queries por hit (SELECT count + INSERT). Si el endpoint
-- es high-traffic (sub-100ms p50), considerar Redis. Por ahora con tráfico
-- esperado (1 cliente, <1k hits/min) Postgres es suficiente.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index principal: lookup por bucket + ventana de tiempo. PostgreSQL usa
-- bitmap scan eficiente con el compuesto (bucket_key, hit_at).
CREATE INDEX IF NOT EXISTS rate_limit_buckets_key_hit_idx
  ON rate_limit_buckets (bucket_key, hit_at DESC);

-- Cleanup index — el cron mensual elimina rows expirados. No usamos WHERE
-- predicate con now() porque Postgres exige IMMUTABLE en partial indexes;
-- el seq scan ordenado en cleanup es suficiente.
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expires_idx
  ON rate_limit_buckets (expires_at);

COMMENT ON TABLE rate_limit_buckets IS
  'ADR-054: rate limiting distribuido por bucket key (ej. ip:1.2.3.4:share-dispatch). El TS-side llama tripdrive_rate_limit_check() RPC.';

-- ---------------------------------------------------------------------------
-- RPC para chequeo atómico: cuenta hits dentro de ventana + inserta nuevo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tripdrive_rate_limit_check(
  p_bucket_key TEXT,
  p_window_seconds INT,
  p_max_hits INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit_count INT;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := now() - make_interval(secs => p_window_seconds);

  -- Contar hits dentro de la ventana.
  SELECT COUNT(*) INTO v_hit_count
  FROM rate_limit_buckets
  WHERE bucket_key = p_bucket_key
    AND hit_at >= v_cutoff;

  -- Si excede, NO insertar (no consumimos slot) — el caller responde 429.
  IF v_hit_count >= p_max_hits THEN
    RETURN FALSE;
  END IF;

  -- Pasó: registrar el hit con expiry = ahora + ventana.
  INSERT INTO rate_limit_buckets (bucket_key, hit_at, expires_at)
  VALUES (p_bucket_key, now(), now() + make_interval(secs => p_window_seconds));

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION tripdrive_rate_limit_check IS
  'ADR-054: chequeo atómico de rate limit. Devuelve TRUE si pasó (y registra hit), FALSE si excedió. window_seconds es la ventana sliding; max_hits es el máximo permitido dentro de esa ventana.';

REVOKE EXECUTE ON FUNCTION tripdrive_rate_limit_check FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tripdrive_rate_limit_check TO service_role;

-- ---------------------------------------------------------------------------
-- RPC de limpieza — llamar desde cron mensual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tripdrive_rate_limit_cleanup()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH d AS (
    DELETE FROM rate_limit_buckets
    WHERE expires_at < now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION tripdrive_rate_limit_cleanup IS
  'ADR-054: borra rows expirados de rate_limit_buckets. Llamar 1×/día via cron.';

REVOKE EXECUTE ON FUNCTION tripdrive_rate_limit_cleanup FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tripdrive_rate_limit_cleanup TO service_role;

COMMIT;
