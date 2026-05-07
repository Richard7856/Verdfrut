-- S18.8: tabla audit de decisiones del AI mediator del chat.

CREATE TABLE IF NOT EXISTS public.chat_ai_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.delivery_reports(id) ON DELETE CASCADE,
  driver_message_text TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('trivial', 'real_problem', 'unknown')),
  auto_reply TEXT,
  confidence NUMERIC(3,2),
  rationale TEXT,
  auto_reply_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_ai_decisions_report
  ON public.chat_ai_decisions(report_id, classified_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_ai_decisions_category
  ON public.chat_ai_decisions(category, classified_at DESC);

ALTER TABLE public.chat_ai_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_ai_decisions_admin_read ON public.chat_ai_decisions;
CREATE POLICY chat_ai_decisions_admin_read ON public.chat_ai_decisions
  FOR SELECT
  USING (public.is_admin_or_dispatcher());

COMMENT ON TABLE public.chat_ai_decisions IS
  'Audit del AI mediator del chat (S18.8). Guarda cada clasificación para calibrar el prompt y auditar decisiones.';
