// Helpers geo: haversine + utilidades de distancia.
//
// Duplicado puntual de @tripdrive/utils.haversineMeters porque importar el
// package web arrastra deps Node (Temporal polyfill) que no le sirven al native.
// Igual que en N2: si N4-N5 muestra que vale la pena un package compartido,
// movemos entonces.

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Distancia en metros entre dos puntos geo (lat/lng en grados).
 * Implementación Haversine — precisión razonable para distancias hasta ~100km.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/** Formatea metros → string humano: "127 m" o "1.4 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
