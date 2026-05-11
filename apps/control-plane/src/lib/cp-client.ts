// Cliente Supabase del Control Plane.
//
// El CP solo accede a `control_plane.*` (tablas con RLS que bloquea cualquier
// otro rol). Usamos service_role para bypassear RLS — la auth está en el
// middleware (cookie HMAC), no en Supabase Auth para V1.
//
// Helper que ya viene apuntando al schema correcto: evita repetir `.schema('control_plane')`
// en cada query.

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';

export function cpClient() {
  return createServiceRoleClient().schema('control_plane');
}
