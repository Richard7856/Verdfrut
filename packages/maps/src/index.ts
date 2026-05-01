// Wrapper de Mapbox GL JS. Abstrae la dependencia para permitir cambio futuro
// (ej: a Google Maps o tiles self-hosted) sin tocar las apps.
//
// Componentes y helpers se agregan conforme las apps los necesiten — no anticipar.

import mapboxgl from 'mapbox-gl';

export { mapboxgl };

/**
 * Configura el access token global de Mapbox.
 * Llamar una vez al cargar la app (en un Client Component que renderice un mapa).
 */
export function setMapboxToken(token: string): void {
  // En mapbox-gl v3 el accessToken se setea via el namespace default.
  (mapboxgl as unknown as { accessToken: string }).accessToken = token;
}
