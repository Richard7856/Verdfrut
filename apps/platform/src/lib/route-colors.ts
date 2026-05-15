// Mapeo color-name (alias del vehículo) → hex del polyline/marker.
//
// Por qué: el dispatcher identifica camionetas por color ("la Roja", "la Verde").
// Si el polyline del mapa muestra otro color que el nombre, se confunde. Este
// módulo intenta deducir el hex desde el alias; si no matchea, cae al PALETTE
// indexado por orden (legacy).

const COLOR_BY_NAME: Record<string, string> = {
  rojo: '#dc2626',
  roja: '#dc2626',
  azul: '#2563eb',
  verde: '#16a34a',
  amarillo: '#eab308',
  amarilla: '#eab308',
  blanco: '#94a3b8', // gris claro — blanco puro sería invisible en mapa light
  blanca: '#94a3b8',
  negro: '#111827',
  negra: '#111827',
  naranja: '#ea580c',
  morado: '#9333ea',
  morada: '#9333ea',
  gris: '#6b7280',
  rosa: '#ec4899',
  // Sinónimos / variantes comunes en MX
  cafe: '#92400e',
  café: '#92400e',
  marron: '#92400e',
  marrón: '#92400e',
  dorado: '#ca8a04',
  plateado: '#9ca3af',
  cyan: '#0891b2',
  cian: '#0891b2',
  turquesa: '#14b8a6',
  violeta: '#7c3aed',
};

// Fallback ordenado para rutas cuyo alias no es un color conocido. Mismos
// hex que vivían en multi-route-map.tsx — preservados para no romper UX legacy.
export const FALLBACK_PALETTE = [
  '#16a34a',
  '#2563eb',
  '#dc2626',
  '#f59e0b',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#ca8a04',
  '#059669',
  '#9333ea',
  '#0284c7',
  '#e11d48',
];

/**
 * Deduce el hex desde el alias del vehículo. Normaliza minúsculas, recorta
 * espacios y descarta paréntesis: "Roja (VFR-001)" → "roja" → "#dc2626".
 *
 * Devuelve null si el alias no matchea ningún color conocido — el caller
 * debería usar el fallback indexado.
 */
export function colorFromVehicleAlias(alias: string | null | undefined): string | null {
  if (!alias) return null;
  // Tomar la primera palabra antes de paréntesis/espacio. Ej "Roja (VFR-001)" → "Roja"
  const firstToken = alias.split(/[\s(]+/)[0]?.trim().toLowerCase() ?? '';
  if (!firstToken) return null;
  return COLOR_BY_NAME[firstToken] ?? null;
}

/**
 * Elige el color de una ruta priorizando el alias del vehículo. Si dos rutas
 * comparten el mismo color (ej dos camionetas "Rojas"), el caller idealmente
 * debería garantizar aliases únicos — aquí no resolvemos colisiones, solo
 * devolvemos lo que el alias dicta.
 */
export function pickRouteColor(
  vehicleAlias: string | null | undefined,
  fallbackIndex: number,
): string {
  return (
    colorFromVehicleAlias(vehicleAlias) ??
    FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length]!
  );
}
