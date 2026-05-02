-- 014_grant_rls_helper_execute
--
-- Fix: las funciones helper que invocan las RLS policies necesitan EXECUTE
-- para el rol `authenticated` (usuarios logueados via Supabase Auth).
-- La migración 011_security_hardening revocó EXECUTE de PUBLIC pero no
-- re-grantó a authenticated, dejando todas las RLS rotas para usuarios reales.
--
-- Detectado al hacer el primer login de admin: requireProfile() devolvía
-- "Tu cuenta no tiene perfil configurado" porque el SELECT a user_profiles
-- fallaba con "permission denied for function is_admin_or_dispatcher".
--
-- Las funciones siguen siendo seguras: current_user_role() es SECURITY DEFINER
-- y sólo lee el role del propio caller (auth.uid()); is_admin_or_dispatcher()
-- delega en current_user_role(). No hay leak entre usuarios.

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_dispatcher() TO authenticated;
