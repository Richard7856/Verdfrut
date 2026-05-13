-- ADR-092 / Ola 2 / Sub-bloque 2.8 — orchestrator_attachments
--
-- Permite al agente recibir archivos (xlsx, csv) del usuario en el chat,
-- procesarlos via tool parse_xlsx_attachment, y proponer acciones masivas
-- (ej. crear 40 tiendas desde un sheet de expansión).
--
-- Diseño:
--   - El cliente sube via POST /api/orchestrator/upload (multipart).
--   - Servidor guarda content_base64 (limit 5MB) + parsed_data JSONB ya
--     procesada por exceljs (para evitar re-parsear en cada turn del agente).
--   - El cliente recibe attachment_id y lo menciona en su mensaje al agente.
--   - El agente usa tool parse_xlsx_attachment(attachment_id) que lee
--     parsed_data y propone qué hacer.
--
-- Multi-tenant: customer_id NOT NULL + trigger auto_set_customer_id.

BEGIN;

CREATE TYPE orchestrator_attachment_kind AS ENUM ('xlsx', 'csv', 'image', 'other');

CREATE TABLE IF NOT EXISTS orchestrator_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  kind orchestrator_attachment_kind NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_base64 TEXT,             -- raw del file, max ~7MB en base64 ≈ 5MB binario
  parsed_data JSONB,               -- ya procesado por server (rows, headers, sheets)
  parse_error TEXT,                -- si parse falló, se guarda razón para debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (size_bytes >= 0 AND size_bytes <= 6 * 1024 * 1024)  -- 6 MB hard limit
);

ALTER TABLE orchestrator_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_orch_attach_session
  ON orchestrator_attachments(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orch_attach_user_created
  ON orchestrator_attachments(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_auto_customer_id ON orchestrator_attachments;
CREATE TRIGGER trg_auto_customer_id
  BEFORE INSERT ON orchestrator_attachments
  FOR EACH ROW EXECUTE FUNCTION auto_set_customer_id();

-- RLS: user ve sus propios attachments; admin del customer ve todos.
-- INSERT solo desde service_role (endpoint /upload tras validar auth).
DROP POLICY IF EXISTS orch_attach_select ON orchestrator_attachments;
CREATE POLICY orch_attach_select ON orchestrator_attachments FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND (
      user_id = (SELECT auth.uid())
      OR (SELECT current_user_role()) = 'admin'::user_role
    )
  );

COMMENT ON TABLE orchestrator_attachments IS
  'ADR-092 / Ola 2 / 2.8. Archivos adjuntados a sesiones del orquestador AI. content_base64 inline (hasta 6MB total con CHECK). parsed_data pre-procesado para que tools no hagan re-parsing.';

COMMIT;
