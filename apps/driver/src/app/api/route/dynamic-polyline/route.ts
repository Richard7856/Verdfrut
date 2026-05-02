// Polyline desde la posición actual del chofer hasta la próxima parada.
// El cliente la consume desde NavigationClient cada vez que el chofer se mueve
// significativamente (throttle 500m / 60s para no saturar Mapbox).
//
// Por qué endpoint y no client-direct: el MAPBOX_DIRECTIONS_TOKEN es secret
// (sk.*) y no debe exponerse al browser. El server lo guarda y devuelve solo
// la geometry resultante.

import 'server-only';
import { requireDriverProfile } from '@/lib/auth';
import { createServerClient } from '@verdfrut/supabase/server';
import { getMapboxDirections } from '@/lib/mapbox';

interface BodyPayload {
  from: { lat: number; lng: number };
  /** ID del stop al que vamos. Si no se manda, server toma el primer pending. */
  toStopId?: string | null;
}

export async function POST(req: Request) {
  await requireDriverProfile({ skipPasswordResetCheck: true });

  let body: BodyPayload;
  try {
    body = (await req.json()) as BodyPayload;
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 });
  }

  if (
    typeof body.from?.lat !== 'number' ||
    typeof body.from?.lng !== 'number'
  ) {
    return Response.json({ error: 'Falta from.lat/lng' }, { status: 400 });
  }

  const supabase = await createServerClient();

  // Resolver el stop destino. Si el cliente especificó toStopId, usar ese
  // (verificando que pertenezca a una ruta del chofer via RLS). Si no,
  // tomar el primer pending de la ruta activa del chofer.
  let stopRow: { id: string; route_id: string; store_id: string; sequence: number } | null = null;

  if (body.toStopId) {
    const { data } = await supabase
      .from('stops')
      .select('id, route_id, store_id, sequence')
      .eq('id', body.toStopId)
      .maybeSingle();
    stopRow = data;
  } else {
    // Primer pending por sequence en cualquier ruta IN_PROGRESS/PUBLISHED del chofer.
    const { data } = await supabase
      .from('stops')
      .select('id, route_id, store_id, sequence, status')
      .eq('status', 'pending')
      .order('sequence', { ascending: true })
      .limit(1);
    stopRow = data?.[0] ?? null;
  }

  if (!stopRow) {
    return Response.json({ geometry: null, reason: 'no_pending_stop' });
  }

  // Coords del store destino.
  const { data: storeRow } = await supabase
    .from('stores')
    .select('lat, lng, name, code')
    .eq('id', stopRow.store_id)
    .maybeSingle();
  if (!storeRow) {
    return Response.json({ geometry: null, reason: 'store_not_found' });
  }

  const result = await getMapboxDirections([
    [body.from.lng, body.from.lat],
    [storeRow.lng, storeRow.lat],
  ]);

  if (!result) {
    return Response.json({ geometry: null, reason: 'mapbox_unavailable' });
  }

  return Response.json(
    {
      geometry: result.geometry,
      distance: result.distance, // metros
      duration: result.duration, // segundos
      steps: result.steps, // turn-by-turn instrucciones en español
      stopId: stopRow.id,
      storeName: storeRow.name,
      storeCode: storeRow.code,
    },
    {
      headers: {
        // Cache 60s — el chofer en movimiento querrá fresh data, pero no
        // cada GPS update.
        'Cache-Control': 'private, max-age=60',
      },
    },
  );
}
