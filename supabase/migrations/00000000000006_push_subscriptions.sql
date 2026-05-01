-- Suscripciones de push notifications (VAPID web push).
-- Cada usuario puede tener múltiples (un device por suscripción).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- Snapshot del rol y zona al momento de suscribir, para queries rápidas
  -- ("¿a quién mando push?") sin joinear con user_profiles.
  role user_role NOT NULL,
  zone_id UUID REFERENCES zones(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_role_zone ON push_subscriptions(role, zone_id);
