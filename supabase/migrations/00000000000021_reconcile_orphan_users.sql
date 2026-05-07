-- #16: función que detecta auth.users sin user_profiles correspondiente.
--
-- Por qué puede quedar huérfano: si inviteUser() crea el auth.user pero el
-- INSERT a user_profiles falla a mitad del flow (red, error transient, timeout),
-- queda una identidad sin perfil. El siguiente login de ese email da
-- "Perfil no encontrado" y el usuario queda bloqueado.
--
-- La función SOLO detecta — la eliminación se hace vía Admin API desde el
-- endpoint cron (admin.auth.admin.deleteUser) para limpiar correctamente todas
-- las tablas internas de Supabase Auth, no con DELETE directo sobre auth.users.
--
-- Criterios para marcar como huérfano:
--   - No tiene fila en public.user_profiles
--   - Creado hace más de 1 hora (ventana de gracia para invites en progreso)
--   - No es cuenta de sistema de Supabase
-- Frecuencia recomendada: 1× por día vía n8n → POST /api/cron/reconcile-orphan-users

CREATE OR REPLACE FUNCTION public.get_orphan_auth_users()
RETURNS TABLE (user_id UUID, email TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    au.id        AS user_id,
    au.email     AS email,
    au.created_at AS created_at
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON up.id = au.id
  WHERE up.id IS NULL
    -- Ventana de 1h para no tocar invites que están en progreso de onboarding
    AND au.created_at < NOW() - INTERVAL '1 hour'
    -- Excluir cuentas internas de Supabase
    AND COALESCE(au.email, '') NOT LIKE '%@supabase.io';
$$;

REVOKE ALL ON FUNCTION public.get_orphan_auth_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orphan_auth_users() TO service_role;
