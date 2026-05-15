-- ADR-102 / Sprint Stripe: per-seat billing con Stripe.
--
-- Modelo: 1 Subscription por customer con 2 line items recurring monthly MXN:
--   - Admin seat: $X × N admins activos
--   - Driver seat: $Y × N choferes activos
--
-- Auto-sync: cuando un admin crea/desactiva un chofer, el server action llama
-- `syncSeats(customerId)` que cuenta seats activos y hace UPDATE de quantity
-- en Stripe (proration ON). El cliente NUNCA ve un form de billing — su uso
-- se traduce a su factura.
--
-- CFDI: el cliente lo factura aparte. NO integramos SAT vía Stripe (Phase 2).
--
-- Por qué columnas en customers vs tabla separada:
--   - Cardinalidad 1-1 customer↔subscription. Una tabla `subscriptions`
--     agregaría JOIN sin valor.
--   - Stripe es source-of-truth real; estas columnas son cache del status
--     más reciente que recibimos vía webhook. Si Stripe y BD disienten,
--     Stripe gana — UI debe refetchear al cargar /settings/billing.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS — re-run seguro.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- 1. Columnas en customers
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  -- Status última versión del webhook:
  --   'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' |
  --   'incomplete_expired' | 'unpaid' | 'paused' | null (sin suscripción).
  -- NULL = customer todavía no ha completado checkout.
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  -- Cuándo expira el ciclo de facturación actual (ISO 8601). Útil para
  -- UI: "Próxima factura: 2026-06-15 estimada $XXX MXN".
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ,
  -- Cache del último conteo de seats reportado a Stripe — para
  -- diagnosticar drift entre BD y Stripe sin tener que llamar la API.
  ADD COLUMN IF NOT EXISTS last_synced_admin_seats INTEGER,
  ADD COLUMN IF NOT EXISTS last_synced_driver_seats INTEGER,
  ADD COLUMN IF NOT EXISTS last_seats_synced_at TIMESTAMPTZ;

-- Únicos para evitar dos customers apuntando al mismo Stripe customer
-- (sólo si están seteados). El partial index respeta NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_stripe_customer_id
  ON customers (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_stripe_subscription_id
  ON customers (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- 2. Audit de cambios de seats (opcional pero útil para debugging)
-- ════════════════════════════════════════════════════════════════════
--
-- Cada vez que syncSeats hace UPDATE en Stripe, insertamos una fila acá.
-- Si el cliente disputa "me cobraste 12 choferes el mes pasado", tenemos
-- timeline exacto de cuándo cambió cada quantity.

CREATE TABLE IF NOT EXISTS billing_seats_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- 'admin' | 'driver' — qué tipo de seat cambió.
  seat_type TEXT NOT NULL CHECK (seat_type IN ('admin', 'driver')),
  prev_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  -- Razón humana de quién/qué disparó el sync:
  --   'driver_created' | 'driver_deactivated' | 'user_promoted' | 'manual' | 'webhook'
  reason TEXT NOT NULL,
  -- Si vino de una server action con auth, el user_profile que la disparó.
  triggered_by UUID REFERENCES user_profiles(id),
  -- Si la sincronización falló, capturamos el error para diagnóstico
  -- (no abortamos el flujo del usuario; el sync es best-effort).
  stripe_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_seats_audit_customer
  ON billing_seats_audit (customer_id, created_at DESC);

ALTER TABLE billing_seats_audit ENABLE ROW LEVEL SECURITY;

-- Política RLS: solo admins/dispatchers del mismo customer pueden ver el
-- audit. Sigue el mismo patrón que el resto de tablas multi-customer.
-- (control_plane impersona service role, así que tiene acceso global.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_seats_audit'
      AND policyname = 'billing_seats_audit_select_same_customer'
  ) THEN
    CREATE POLICY billing_seats_audit_select_same_customer
      ON billing_seats_audit FOR SELECT
      USING (
        customer_id = (
          SELECT customer_id FROM user_profiles
          WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
