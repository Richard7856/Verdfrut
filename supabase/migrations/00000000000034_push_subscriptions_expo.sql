-- Extiende push_subscriptions para soportar tokens nativos de Expo además
-- de subscripciones VAPID Web Push.
--
-- ADR-081: el web driver/platform usa Web Push (endpoint + p256dh + auth);
-- el native driver usa Expo Notifications que devuelve un único token string
-- como "ExponentPushToken[xxxxxxxxxxxxxxxx]". Para no duplicar tabla ni
-- complicar la fanout, agregamos columnas y discriminamos por `platform`.
--
-- Cambios:
--   1. Nueva columna `platform` ('web' | 'expo') con default 'web' para que
--      las filas existentes (todas web) sigan siendo válidas sin backfill.
--   2. Nueva columna `expo_token` (TEXT, nullable) — el token completo de
--      Expo. UNIQUE por user + token para idempotencia al re-registrar.
--   3. Columnas `endpoint`, `p256dh`, `auth` ahora NULLABLE. Las filas web
--      siguen requiriéndolas vía CHECK constraint que valida por platform.
--   4. Trigger CHECK que garantiza consistencia: web ⇒ endpoint+keys NOT NULL;
--      expo ⇒ expo_token NOT NULL.
--   5. Índice por expo_token para queries del fanout.
--
-- Rollback:
--   1. UPDATE push_subscriptions SET platform='web' WHERE platform='expo';
--   2. DELETE FROM push_subscriptions WHERE expo_token IS NOT NULL;
--   3. ALTER TABLE: drop columns + drop check, restore NOT NULL en endpoint/p256dh/auth.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS expo_token TEXT;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_platform_check
  CHECK (platform IN ('web', 'expo'));

-- Permitir NULL en columnas web-specific.
ALTER TABLE push_subscriptions ALTER COLUMN endpoint DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN p256dh   DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth     DROP NOT NULL;

-- Consistency CHECK: cada plataforma exige sus campos.
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_payload_shape
  CHECK (
    (platform = 'web'  AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL AND expo_token IS NULL)
    OR
    (platform = 'expo' AND expo_token IS NOT NULL AND endpoint IS NULL AND p256dh IS NULL AND auth IS NULL)
  );

-- UNIQUE por user + token. NULLS NOT DISTINCT no aplica en Postgres < 15 —
-- pero como NULL aparece sólo cuando platform='web' (y allí ya hay UNIQUE
-- por endpoint), el UNIQUE parcial cubre el caso expo sin conflicto.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_user_expo_token
  ON push_subscriptions (user_id, expo_token)
  WHERE expo_token IS NOT NULL;

-- Index para fanout: "dame las subs de role=X zone=Y de cualquier platform".
-- El índice existente idx_push_role_zone ya cubre el caso (platform es
-- secundario en la query). Sólo agregamos uno por expo_token para lookup
-- directo si en el futuro necesitamos invalidar tokens muertos.
CREATE INDEX IF NOT EXISTS idx_push_expo_token
  ON push_subscriptions (expo_token)
  WHERE expo_token IS NOT NULL;
