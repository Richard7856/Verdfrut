// Proxy de Google Places Text Search para el mapa de tiendas.
// Usa GOOGLE_GEOCODING_API_KEY existente (misma key de scripts y orquestador).
// requireAdminOrDispatcher — no exponer la key al cliente.

import 'server-only';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlaceResult {
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string;
  types: string[];
  rating?: number;
}

export async function GET(req: Request) {
  await requireRole('admin', 'dispatcher');

  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const nearLat = url.searchParams.get('lat');
  const nearLng = url.searchParams.get('lng');
  const radius = url.searchParams.get('radius') ?? '15000';

  if (query.length < 3) {
    return Response.json({ error: 'query mínima 3 chars' }, { status: 400 });
  }

  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) {
    return Response.json(
      { error: 'GOOGLE_GEOCODING_API_KEY no configurada' },
      { status: 503 },
    );
  }

  const params = new URLSearchParams({ query, region: 'mx', key });
  if (nearLat && nearLng) {
    params.set('location', `${nearLat},${nearLng}`);
    params.set('radius', radius);
  }
  const gUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

  try {
    const res = await fetch(gUrl, { signal: AbortSignal.timeout(15_000) });
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        place_id: string;
        types: string[];
        rating?: number;
      }>;
      error_message?: string;
    };

    if (data.status === 'ZERO_RESULTS') {
      return Response.json({ results: [] });
    }
    if (data.status !== 'OK' || !data.results) {
      return Response.json(
        { error: `Places: ${data.status} — ${data.error_message ?? ''}` },
        { status: 502 },
      );
    }

    const results: PlaceResult[] = data.results.slice(0, 8).map((r) => ({
      name: r.name,
      formatted_address: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      place_id: r.place_id,
      types: r.types,
      rating: r.rating,
    }));

    return Response.json({ results });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'fetch falló' },
      { status: 500 },
    );
  }
}
