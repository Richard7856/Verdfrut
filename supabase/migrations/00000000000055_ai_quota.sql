-- ADR-126 / 2026-05-16: cuota mensual de AI para el plan Pro.
--
-- La landing promete "300 sesiones/mes" en Pro (vs ilimitado en Enterprise).
-- Esta migración agrega los contadores para enforce real:
--
--   - ai_sessions_used_month: # sesiones AI iniciadas este mes (1 por chat
--     conversation única — abrir el chat con 1+ mensajes cuenta como 1).
--   - ai_writes_used_month: # tool_use de WRITE_TOOLS exitosos este mes.
--     Solo cuenta los mutantes (create_*, update_*, publish_*, etc.) — los
--     reads no cuentan, son baratos. Defiende margen del verdadero costo.
--   - ai_quota_period_starts_at: cuando arrancó el período actual. Resetea
--     vía cron mensual el día 1.
--   - ai_quota_overrides: jsonb {sessions?, writes?} para regalar cuota a
--     clientes puntuales sin tocar el contrato base (mismo patrón que
--     feature_overrides de ADR-095).
--
-- Defaults conservadores en customers existentes: 0 usados, período arranca
-- al primer del mes en curso.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ai_sessions_used_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_writes_used_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_quota_period_starts_at TIMESTAMPTZ
    NOT NULL DEFAULT date_trunc('month', now()),
  ADD COLUMN IF NOT EXISTS ai_quota_overrides JSONB;

COMMENT ON COLUMN customers.ai_sessions_used_month IS
  'ADR-126: # sesiones AI conversacionales iniciadas en el período actual. Resetea cada mes.';
COMMENT ON COLUMN customers.ai_writes_used_month IS
  'ADR-126: # tool_use exitosos de WRITE_TOOLS (mutantes) en el período actual. Resetea cada mes.';
COMMENT ON COLUMN customers.ai_quota_period_starts_at IS
  'ADR-126: timestamp de inicio del período de cuota actual. El cron mensual lo avanza.';
COMMENT ON COLUMN customers.ai_quota_overrides IS
  'ADR-126: regalos puntuales de cuota — {sessions?: number, writes?: number}. Sobrescriben el default del tier para ese customer. NULL = sin override.';

-- Backfill: arrancar período al primer del mes en curso para todos los customers
-- existentes (la columna ya tiene default pero documentar la intención por DDL).
UPDATE customers
SET ai_quota_period_starts_at = date_trunc('month', now())
WHERE ai_quota_period_starts_at IS NULL OR ai_quota_period_starts_at > now();

-- RPC para incrementar la cuota de forma atómica (anti-race condition entre
-- sesiones concurrentes). Usa UPDATE...RETURNING para evitar SELECT+UPDATE.
-- SECURITY DEFINER porque el customer del caller se resuelve internamente
-- vía auth.uid() (ya estandarizado en otros RPC de este schema).
CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_customer_id UUID,
  p_kind TEXT  -- 'sessions' o 'writes'
)
RETURNS TABLE(
  used INTEGER,
  period_starts_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_used INTEGER;
  v_period TIMESTAMPTZ;
BEGIN
  IF p_kind NOT IN ('sessions', 'writes') THEN
    RAISE EXCEPTION 'p_kind debe ser sessions o writes, recibido: %', p_kind;
  END IF;

  IF p_kind = 'sessions' THEN
    UPDATE customers
    SET ai_sessions_used_month = ai_sessions_used_month + 1
    WHERE id = p_customer_id
    RETURNING ai_sessions_used_month, ai_quota_period_starts_at
    INTO v_used, v_period;
  ELSE
    UPDATE customers
    SET ai_writes_used_month = ai_writes_used_month + 1
    WHERE id = p_customer_id
    RETURNING ai_writes_used_month, ai_quota_period_starts_at
    INTO v_used, v_period;
  END IF;

  IF v_used IS NULL THEN
    RAISE EXCEPTION 'customer % no existe', p_customer_id;
  END IF;

  RETURN QUERY SELECT v_used, v_period;
END;
$$;

COMMENT ON FUNCTION public.consume_ai_quota(UUID, TEXT) IS
  'ADR-126: incrementa atómicamente el contador de cuota AI (sessions o writes) y devuelve el nuevo valor. El caller (app) decide si bloquear o solo avisar según vs límites del tier.';

-- Revoke el default GRANT a PUBLIC — solo authenticated/service_role.
REVOKE EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT) TO authenticated, service_role;

-- RPC para reset mensual masivo (lo invoca el cron de Vercel el día 1).
-- Resetea ai_*_used_month=0 y avanza ai_quota_period_starts_at al primero del
-- mes en curso. SECURITY DEFINER para que el cron lo pueda llamar sin
-- service_role (vía endpoint protegido por x-cron-token).
CREATE OR REPLACE FUNCTION public.reset_ai_quotas_for_period()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE customers
  SET
    ai_sessions_used_month = 0,
    ai_writes_used_month = 0,
    ai_quota_period_starts_at = date_trunc('month', now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reset_ai_quotas_for_period() IS
  'ADR-126: resetea contadores AI de TODOS los customers y avanza el período al primer del mes en curso. Idempotente (correr 2 veces el mismo día no hace daño). Lo invoca el cron mensual Vercel /api/cron/reset-ai-quotas.';

-- Solo service_role (cron endpoint) — los usuarios normales NUNCA deberían
-- resetear cuotas. Revocamos PUBLIC y otorgamos solo a service_role.
REVOKE EXECUTE ON FUNCTION public.reset_ai_quotas_for_period() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_ai_quotas_for_period() TO service_role;
