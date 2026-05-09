-- Migración 030 (ADR-046): enlace público read-only para tiros.
--
-- Razón: el cliente quiere compartir la vista del tiro (mapa + lista de rutas
-- con sus paradas) con su equipo SIN requerir login. Solo lectura — nadie
-- puede mover paradas o crear rutas desde la URL pública.
--
-- Diseño:
--   - Columna `public_share_token UUID NULL` en dispatches.
--     NULL = compartir deshabilitado (default).
--     UUID = enlace activo en /share/dispatch/{token}.
--   - El admin habilita/deshabilita explícitamente desde UI.
--   - Revocar = setear NULL (cualquier persona con el link viejo deja de tener acceso).
--   - UNIQUE INDEX para que el token sea único globalmente y no se pueda
--     adivinar entre tiros distintos.
--
-- Seguridad:
--   - UUID es 122 bits de entropía — no brute-forceable.
--   - El endpoint /share/dispatch/{token} debe usar service_role para BYPASS
--     de RLS (el visitante anónimo no tiene sesión). Validación se hace por
--     token match en código, no por RLS.
--   - NO incluir info sensible en la vista pública (sin precios, sin contactos
--     personales). UI específica para read-only.

BEGIN;

ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS public_share_token UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dispatches_public_share_token_unique
  ON dispatches (public_share_token)
  WHERE public_share_token IS NOT NULL;

COMMENT ON COLUMN dispatches.public_share_token IS
  'UUID que permite acceso anónimo read-only al tiro vía /share/dispatch/{token}. NULL = compartir deshabilitado. Revocar = setear NULL.';

COMMIT;
