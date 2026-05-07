-- Sprint 11: chat realtime conductor↔comercial.
-- Ver ADR-021 (DECISIONS.md) para el rationale.
--
-- Cambios:
--   1. Habilita realtime broadcasts on Postgres changes para `messages`.
--   2. Agrega `chat_opened_at` y `chat_status` a `delivery_reports`.
--   3. Endurece RLS de `messages` para que el sender no pueda mentir sobre su rol.
--   4. Trigger que setea chat_opened_at y timeout_at la primera vez
--      que se inserta un mensaje para un report (idempotente).

-- ----------------------------------------------------------------------------
-- 1. Realtime publication.
-- ----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ----------------------------------------------------------------------------
-- 2. Columnas de seguimiento del chat.
-- ----------------------------------------------------------------------------
ALTER TABLE public.delivery_reports
  ADD COLUMN IF NOT EXISTS chat_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chat_status TEXT
    CHECK (chat_status IN ('open', 'driver_resolved', 'manager_resolved', 'timed_out'));

CREATE INDEX IF NOT EXISTS idx_reports_chat_status
  ON public.delivery_reports(chat_status)
  WHERE chat_status = 'open';

-- ----------------------------------------------------------------------------
-- 3. RLS hardening en messages: sender debe matchear el rol real.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND report_id IN (SELECT id FROM public.delivery_reports)
    AND (
      (sender = 'driver' AND current_user_role() = 'driver')
      OR (sender = 'zone_manager' AND (
        current_user_role() = 'zone_manager' OR is_admin_or_dispatcher()
      ))
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Trigger que abre el chat (setea chat_opened_at, timeout_at, status='open')
-- al primer mensaje. Idempotente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_messages_open_chat() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.delivery_reports
  SET
    chat_opened_at = NOW(),
    timeout_at = NOW() + INTERVAL '20 minutes',
    chat_status = 'open'
  WHERE id = NEW.report_id
    AND chat_opened_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_messages_open_chat ON public.messages;
CREATE TRIGGER tg_messages_open_chat
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_messages_open_chat();

GRANT EXECUTE ON FUNCTION public.tg_messages_open_chat() TO authenticated;
