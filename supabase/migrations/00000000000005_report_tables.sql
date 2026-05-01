-- Reportes de entrega y mensajes del chat. Equivalente a `reportes` y `messages`
-- del prototipo Verdefrut Driver, pero ligado a stops/routes.

CREATE TABLE IF NOT EXISTS delivery_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id UUID NOT NULL UNIQUE REFERENCES stops(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  -- Denormalizado para no joinear en queries de listado.
  store_code TEXT NOT NULL,
  store_name TEXT NOT NULL,
  type report_type NOT NULL,
  status report_status NOT NULL DEFAULT 'draft',
  -- Paso actual del flujo (para recuperar si la app se cierra).
  current_step TEXT NOT NULL,
  -- URLs de evidencia: { arrival_exhibit, product_arranged, ticket_recibido, etc. }
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Datos extraídos del recibo principal (Claude Vision).
  ticket_data JSONB,
  ticket_image_url TEXT,
  ticket_extraction_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  -- Datos extraídos del ticket de merma.
  return_ticket_data JSONB,
  return_ticket_extraction_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  -- Incidencias declaradas durante el flujo.
  incident_details JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Resolución final del reporte.
  resolution_type resolution_type,
  partial_failure_items JSONB,
  -- Razón si no hay recibo + foto opcional.
  no_ticket_reason TEXT,
  no_ticket_reason_photo_url TEXT,
  -- Otra incidencia descrita libremente.
  other_incident_description TEXT,
  other_incident_photo_url TEXT,
  has_merma BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  submitted_at TIMESTAMPTZ,
  -- Ventana de 20 minutos del chat para escalación.
  timeout_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE delivery_reports ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_reports_route ON delivery_reports(route_id);
CREATE INDEX IF NOT EXISTS idx_reports_zone_status ON delivery_reports(zone_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_driver ON delivery_reports(driver_id);
CREATE INDEX IF NOT EXISTS idx_reports_status_active
  ON delivery_reports(status)
  WHERE status IN ('submitted', 'resolved_by_driver');

-- Mensajes del chat entre chofer y encargado de zona.
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES delivery_reports(id) ON DELETE CASCADE,
  sender message_sender NOT NULL,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  text TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (text IS NOT NULL OR image_url IS NOT NULL)
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_messages_report ON messages(report_id, created_at);
