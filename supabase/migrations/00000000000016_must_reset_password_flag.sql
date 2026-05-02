-- 016_must_reset_password_flag
--
-- Flag que fuerza al usuario a establecer una contraseña nueva en su próximo login.
-- Se setea TRUE al invitar un usuario y al admin "forzar reset". El driver app
-- consulta este flag en cada request y redirige a /auth/set-password si está TRUE.
--
-- Default FALSE para no afectar al admin bootstrapeado a mano (ya tiene contraseña).
-- El flujo de invite vía platform los setea a TRUE manualmente.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.must_reset_password IS
  'Si TRUE, el usuario debe establecer contraseña nueva antes de continuar. Lo setea inviteUser() y el admin vía "forzar reset".';
