// Cliente de Mapbox APIs server-side. Solo usar desde Server Actions / Route Handlers.
// El token (MAPBOX_DIRECTIONS_TOKEN) NUNCA debe llegar al cliente.
//
// APIs cubiertas:
//   - Directions Matrix API: tiempos/distancias entre N puntos por carretera real
//   - Directions API: polyline geometry de UNA ruta (para renderizar en mapa)
//
// Pricing relevante (octubre 2024):
//   - Matrix API: $2 / 1k requests (free 100K/mes en plan dev)
//   - Directions API: $2 / 1k requests (free 100K/mes en plan dev)
// Una ruta de 30 paradas = 1 Matrix call (con dimensiones 31x31) + 1 Directions
// = 2 requests. 10 rutas/día × 30 días = 600/mes. Muy bajo el free tier.

import 'server-only';

const MATRIX_BASE = 'https://api.mapbox.com/directions-matrix/v1/mapbox';
const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox';

/**
 * Mapbox Matrix API tiene un límite duro: máximo 25 coordenadas por request
 * (en plan dev — paid sube a 100). Para rutas grandes hay que partir en chunks
 * y combinar las matrices, pero en V1 asumimos rutas <25 puntos por simplicidad.
 * 25 puntos = 1 vehículo (start+end = 2) + 23 paradas = ruta razonable de medio día.
 */
const MATRIX_MAX_COORDS = 25;

/**
 * Profile de Mapbox a usar. `driving-traffic` aplica tráfico estimado en tiempo real
 * para CDMX, lo cual nos importa. Alternativas: `driving` (sin tráfico), `walking`,
 * `cycling`. Cambiar si el cliente quiere optimizar para distancia pura.
 */
const PROFILE = 'driving-traffic';

interface MatrixResult {
  durations: number[][]; // segundos
  distances: number[][]; // metros
}

/**
 * Llama Mapbox Directions Matrix API.
 * Devuelve durations[i][j] (segundos) y distances[i][j] (metros) entre N puntos.
 *
 * Si el token no está configurado, lanza error claro — el caller decide si caer
 * a fallback (haversine) o fallar.
 */
export async function getMapboxMatrix(
  coords: Array<[number, number]>, // [lng, lat]
): Promise<MatrixResult> {
  const token = process.env.MAPBOX_DIRECTIONS_TOKEN;
  if (!token) {
    throw new Error('[mapbox] MAPBOX_DIRECTIONS_TOKEN no está configurado');
  }
  if (coords.length < 2) {
    return { durations: [[0]], distances: [[0]] };
  }
  if (coords.length > MATRIX_MAX_COORDS) {
    throw new Error(
      `[mapbox.matrix] ${coords.length} coords excede el límite de ${MATRIX_MAX_COORDS}. ` +
      `Implementar chunking si rutas grandes son necesarias.`,
    );
  }

  // Mapbox espera coords como `lng,lat;lng,lat;...`
  const coordStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `${MATRIX_BASE}/${PROFILE}/${encodeURIComponent(coordStr)}` +
    `?annotations=duration,distance&access_token=${token}`;

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[mapbox.matrix] HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    code: string;
    durations: Array<Array<number | null>>;
    distances: Array<Array<number | null>>;
  };
  if (data.code !== 'Ok') {
    throw new Error(`[mapbox.matrix] code=${data.code}`);
  }

  // Mapbox puede devolver null si no hay ruta entre dos puntos (caso raro).
  // Caemos a un valor grande para que VROOM evite ese arco.
  const SENTINEL = 999_999;
  const durations = data.durations.map((row) =>
    row.map((v) => (v === null ? SENTINEL : Math.round(v))),
  );
  const distances = data.distances.map((row) =>
    row.map((v) => (v === null ? SENTINEL : Math.round(v))),
  );

  return { durations, distances };
}

/**
 * Llama Mapbox Directions API para obtener la GEOMETRÍA de la ruta entre N waypoints.
 * Devuelve un GeoJSON LineString para dibujar en el mapa.
 *
 * Limit: máximo 25 waypoints (igual que Matrix). Para rutas más grandes,
 * concatenar varias requests partidas.
 */
export async function getMapboxDirections(
  waypoints: Array<[number, number]>, // [lng, lat] en orden de visita
): Promise<{ geometry: GeoJSON.LineString; distance: number; duration: number } | null> {
  const token = process.env.MAPBOX_DIRECTIONS_TOKEN;
  if (!token) return null;
  if (waypoints.length < 2) return null;
  if (waypoints.length > 25) {
    throw new Error('[mapbox.directions] Más de 25 waypoints — implementar split');
  }

  const coordStr = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `${DIRECTIONS_BASE}/${PROFILE}/${encodeURIComponent(coordStr)}` +
    `?geometries=geojson&overview=full&access_token=${token}`;

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[mapbox.directions] HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    code: string;
    routes: Array<{
      geometry: GeoJSON.LineString;
      distance: number;
      duration: number;
    }>;
  };
  if (data.code !== 'Ok' || !data.routes[0]) return null;

  return {
    geometry: data.routes[0].geometry,
    distance: data.routes[0].distance,
    duration: data.routes[0].duration,
  };
}
