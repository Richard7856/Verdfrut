// Devuelve los breadcrumbs de una ruta en orden cronológico.
// El supervisor que entra al mapa después de iniciada la ruta puede ver
// el recorrido pasado del chofer (issue #32).

import 'server-only';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';

const MAX_BREADCRUMBS = 500; // límite defensivo — 500 puntos = ~12 horas a 1/90s

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  const { id } = await params;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('route_breadcrumbs')
    .select('lat, lng, recorded_at, speed, heading')
    .eq('route_id', id)
    .order('recorded_at', { ascending: true })
    .limit(MAX_BREADCRUMBS);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    breadcrumbs: data ?? [],
    truncated: (data?.length ?? 0) >= MAX_BREADCRUMBS,
  }, {
    headers: {
      // Cache corto — el chofer está vivo emitiendo nuevos. 30s balance OK.
      'Cache-Control': 'private, max-age=30',
    },
  });
}
