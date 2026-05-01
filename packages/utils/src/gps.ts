// Helpers de cálculo geográfico para GPS / rutas.

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Distancia haversine entre dos puntos lat/lng en metros.
 * Ignora elevación. Suficiente para distancias urbanas (<100km).
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

/**
 * Detecta si una posición está fuera del corredor esperado de la ruta.
 * Útil para alertar al encargado de zona si el chofer se desvía.
 */
export function isOffRoute(
  currentLat: number,
  currentLng: number,
  expectedLat: number,
  expectedLng: number,
  toleranceMeters: number,
): boolean {
  return haversineMeters(currentLat, currentLng, expectedLat, expectedLng) > toleranceMeters;
}
