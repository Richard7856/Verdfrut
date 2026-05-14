-- HARDENING C2 / share dispatch URL expiry.
--
-- Problema: hoy `dispatches.public_share_token` no caduca ni se revoca
-- automáticamente. Un link compartido con un proveedor para ver una ruta
-- sigue funcionando para siempre — incluso después de que el dispatch
-- se completa o el chofer cambia.
--
-- Fix: agregar `public_share_expires_at TIMESTAMPTZ`. La query pública
-- filtra `WHERE expires_at > NOW()`. Default al crear: NOW() + 7 días.
-- El admin puede ampliar/revocar desde UI.
--
-- Idempotente: re-run safe.

BEGIN;

ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS public_share_expires_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN dispatches.public_share_expires_at IS
  'HARDENING C2. Fecha de expiración del link público. Si NULL y el ' ||
  'token existe (data pre-migración), tratar como "expirado para nuevos accesos".';

-- Backfill: cualquier token existente con expires_at NULL queda como
-- expirado de inmediato (forzar al user a regenerar con expiry explícito).
-- Esto es seguro porque sólo había shares en demo/dev de VerdFrut.
UPDATE dispatches
   SET public_share_expires_at = NOW() - INTERVAL '1 day'
 WHERE public_share_token IS NOT NULL
   AND public_share_expires_at IS NULL;

-- Helper index para que el filtro `expires_at > NOW()` use índice.
CREATE INDEX IF NOT EXISTS dispatches_share_active
  ON dispatches (public_share_token, public_share_expires_at)
  WHERE public_share_token IS NOT NULL;

COMMIT;
