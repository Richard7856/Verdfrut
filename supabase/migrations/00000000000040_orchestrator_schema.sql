-- ADR-090 / Ola 2 / Sub-bloque 2.1.a — Schema del orquestador AI.
--
-- 3 tablas:
--   orchestrator_sessions  → conversaciones (1 por hilo de chat).
--   orchestrator_messages  → mensajes raw del API de Anthropic (user/assistant/tool).
--   orchestrator_actions   → audit log: cada tool_use ejecutado + tokens + costo.
--
-- Por qué `actions` separada de `messages`:
--   - `messages` guarda el contenido conversacional (texto, tool_use blocks).
--   - `actions` es el log operativo: qué se ejecutó, con qué args, qué pasó.
--     Permite queries fáciles de "cuántas acciones este mes" sin parsear JSONB.
--   - También deja audit independiente: si borramos messages por privacy,
--     las acciones (con args y result) quedan para compliance.
--
-- customer_id en las 3 tablas → multi-tenant. Trigger auto_set_customer_id
-- (mig 037) las cubre — agregar a la lista del trigger en esta migration.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Sessions
-- ----------------------------------------------------------------------------
CREATE TYPE orchestrator_session_state AS ENUM ('open', 'closed', 'archived');

CREATE TABLE IF NOT EXISTS orchestrator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  title TEXT,
  state orchestrator_session_state NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ,
  total_tokens_in INTEGER NOT NULL DEFAULT 0,
  total_tokens_out INTEGER NOT NULL DEFAULT 0,
  total_actions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orchestrator_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_orch_sessions_customer_user
  ON orchestrator_sessions(customer_id, user_id, updated_at DESC);

COMMENT ON TABLE orchestrator_sessions IS
  'ADR-090: una conversación con el agente AI. title es el resumen humano (autogenerado por el agente o set manual). total_* son agregados para mostrar uso sin scan de messages.';

-- ----------------------------------------------------------------------------
-- 2. Messages
-- ----------------------------------------------------------------------------
CREATE TYPE orchestrator_message_role AS ENUM ('user', 'assistant', 'tool_result', 'system_note');

CREATE TABLE IF NOT EXISTS orchestrator_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role orchestrator_message_role NOT NULL,
  content JSONB NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  stop_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, sequence)
);

ALTER TABLE orchestrator_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_orch_messages_session_seq
  ON orchestrator_messages(session_id, sequence);

COMMENT ON TABLE orchestrator_messages IS
  'ADR-090: mensajes raw para reconstruir el contexto al continuar conversación. content es el shape del Anthropic API (text blocks, tool_use blocks, tool_result blocks).';

-- ----------------------------------------------------------------------------
-- 3. Actions (audit + billing)
-- ----------------------------------------------------------------------------
CREATE TYPE orchestrator_action_status AS ENUM (
  'success',
  'error',
  'rejected_by_user',
  'pending_confirmation',
  'auto_rejected_quota'
);

CREATE TABLE IF NOT EXISTS orchestrator_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  tool_name TEXT NOT NULL,
  is_write BOOLEAN NOT NULL DEFAULT FALSE,
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  args JSONB NOT NULL,
  status orchestrator_action_status NOT NULL,
  result JSONB,
  error_message TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orchestrator_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_orch_actions_customer_created
  ON orchestrator_actions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orch_actions_session
  ON orchestrator_actions(session_id, created_at);
-- Quota mensual: query típica filtra customer_id + created_at >= month_start +
-- is_write=true. Index parcial reduce el scan.
CREATE INDEX IF NOT EXISTS idx_orch_actions_writes_month
  ON orchestrator_actions(customer_id, created_at)
  WHERE is_write = TRUE AND status = 'success';

COMMENT ON TABLE orchestrator_actions IS
  'ADR-090: audit + billing. is_write=true marca acciones que consumen quota mensual (creates/updates/deletes). Reads (is_write=false) van aquí también para telemetría pero no cuentan al cap.';

-- ----------------------------------------------------------------------------
-- 4. Trigger auto_set_customer_id en las 3 tablas nuevas
--
-- Las tablas heredan customer_id de la sesión authenticated. Crons / service_role
-- deben pasar customer_id explícito (no aplica trigger).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_customer_id ON orchestrator_sessions;
CREATE TRIGGER trg_auto_customer_id
  BEFORE INSERT ON orchestrator_sessions
  FOR EACH ROW EXECUTE FUNCTION auto_set_customer_id();

DROP TRIGGER IF EXISTS trg_auto_customer_id ON orchestrator_messages;
CREATE TRIGGER trg_auto_customer_id
  BEFORE INSERT ON orchestrator_messages
  FOR EACH ROW EXECUTE FUNCTION auto_set_customer_id();

DROP TRIGGER IF EXISTS trg_auto_customer_id ON orchestrator_actions;
CREATE TRIGGER trg_auto_customer_id
  BEFORE INSERT ON orchestrator_actions
  FOR EACH ROW EXECUTE FUNCTION auto_set_customer_id();

-- ----------------------------------------------------------------------------
-- 5. RLS policies — admin/dispatcher del customer ven sus propias sesiones.
--
-- El user solo ve y crea SUS sesiones. Admin del customer puede leer todas
-- las del customer (audit). No hay role 'super-admin' a nivel BD — CP usa
-- service_role para vista cross-customer.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS orch_sessions_select ON orchestrator_sessions;
CREATE POLICY orch_sessions_select ON orchestrator_sessions FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      user_id = (SELECT auth.uid())
      OR (SELECT current_user_role()) = 'admin'::user_role
    )
  );

DROP POLICY IF EXISTS orch_sessions_insert ON orchestrator_sessions;
CREATE POLICY orch_sessions_insert ON orchestrator_sessions FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = current_customer_id()
    AND user_id = (SELECT auth.uid())
    AND (SELECT current_user_role()) IN ('admin'::user_role, 'dispatcher'::user_role)
  );

DROP POLICY IF EXISTS orch_sessions_update ON orchestrator_sessions;
CREATE POLICY orch_sessions_update ON orchestrator_sessions FOR UPDATE TO authenticated
  USING (
    customer_id = current_customer_id()
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    customer_id = current_customer_id()
    AND user_id = (SELECT auth.uid())
  );

-- Messages: lectura por dueño de la sesión. Escritura SOLO via service_role
-- (server route handler). Por eso no hay policy INSERT para authenticated.
DROP POLICY IF EXISTS orch_messages_select ON orchestrator_messages;
CREATE POLICY orch_messages_select ON orchestrator_messages FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND session_id IN (
      SELECT id FROM orchestrator_sessions
      WHERE user_id = (SELECT auth.uid())
         OR (SELECT current_user_role()) = 'admin'::user_role
    )
  );

-- Actions: lectura por dueño + admin del customer (audit/billing visibility).
-- Escritura SOLO via service_role.
DROP POLICY IF EXISTS orch_actions_select ON orchestrator_actions;
CREATE POLICY orch_actions_select ON orchestrator_actions FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      user_id = (SELECT auth.uid())
      OR (SELECT current_user_role()) = 'admin'::user_role
    )
  );

COMMIT;
