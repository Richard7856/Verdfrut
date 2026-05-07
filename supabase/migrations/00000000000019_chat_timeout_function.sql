-- ADR-023 / #40: función que marca chats como timed_out cuando timeout_at < now().
-- Idempotente — solo afecta rows con chat_status='open'.
--
-- Programación:
--   1. Si pg_cron está disponible, schedule cada 1 minuto.
--   2. Fallback: endpoint /api/cron/mark-timed-out-chats invocado por n8n schedule.

CREATE OR REPLACE FUNCTION public.mark_timed_out_chats() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.delivery_reports
  SET
    chat_status = 'timed_out',
    resolved_at = COALESCE(resolved_at, NOW())
  WHERE chat_status = 'open'
    AND timeout_at IS NOT NULL
    AND timeout_at < NOW();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_timed_out_chats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_timed_out_chats() TO service_role;
