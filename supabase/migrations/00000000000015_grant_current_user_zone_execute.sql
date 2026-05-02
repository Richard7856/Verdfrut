-- 015_grant_current_user_zone_execute
--
-- Continuación de la 014. La función current_user_zone() también es usada por
-- RLS policies (scope de routes/stops por zona del zone_manager) y tampoco
-- tenía GRANT EXECUTE a authenticated. Detectado al primer SELECT a routes
-- desde un usuario logueado.
--
-- Es segura de exponer: SECURITY DEFINER, sólo devuelve la zone_id del
-- propio caller (auth.uid()).

GRANT EXECUTE ON FUNCTION public.current_user_zone() TO authenticated;
