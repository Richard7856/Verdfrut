// Mapbox Directions API server-side para la driver app.
// Solo lo usa el server component que arma datos para <NavigationMap>.
// El MAPBOX_DIRECTIONS_TOKEN NUNCA se expone al cliente.

import 'server-only';
import { logger } from '@tripdrive/observability';

const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox';
const PROFILE = 'driving-traffic';

/**
 * Tipo de instrucción turn-by-turn de Mapbox para un step.
 * No incluyo TODOS los campos del API — solo los que la UI usa.
 * Doc completa: https://docs.mapbox.com/api/navigation/directions/#response-step-maneuver
 */
export interface NavStep {
  /** Texto natural en español: "Gira a la izquierda en Av. Insurgentes". */
  instruction: string;
  /** Tipo de maneuver: turn, merge, depart, arrive, etc. */
  type: string;
  /** Modificador: left, right, slight left, etc. — usado para iconos. */
  modifier?: string;
  /** Distancia del step en metros. */
  distance: number;
  /** Duración estimada en segundos. */
  duration: number;
  /** Coords [lng, lat] donde ocurre el maneuver. */
  location: [number, number];
  /** Geometría parcial del step (para resaltar el siguiente segmento si quisieras). */
  geometry?: GeoJSON.LineString;
  /** Voice instructions con announceAt distance — opcional, varias por step. */
  voiceInstructions?: Array<{
    distanceAlongGeometry: number;
    announcement: string;
    ssmlAnnouncement?: string;
  }>;
}

export interface DirectionsResult {
  geometry: GeoJSON.LineString;
  distance: number; // metros totales
  duration: number; // segundos totales
  steps: NavStep[];
}

/**
 * Llama Mapbox Directions API. Pide steps detallados + voice instructions
 * en español para turn-by-turn navigation.
 *
 * Si MAPBOX_DIRECTIONS_TOKEN no está set o falla la llamada, devuelve null —
 * el cliente cae a líneas rectas como fallback visual.
 */
export async function getMapboxDirections(
  waypoints: Array<[number, number]>,
): Promise<DirectionsResult | null> {
  const token = process.env.MAPBOX_DIRECTIONS_TOKEN;
  if (!token) return null;
  if (waypoints.length < 2) return null;
  if (waypoints.length > 25) {
    console.warn('[mapbox.directions] >25 waypoints — chunking pendiente');
    return null;
  }

  const coordStr = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  // steps=true + voice_instructions=true habilita turn-by-turn en español.
  // banner_instructions también disponible si quisieras un estilo más rico.
  const url =
    `${DIRECTIONS_BASE}/${PROFILE}/${encodeURIComponent(coordStr)}` +
    `?geometries=geojson&overview=full` +
    `&steps=true&voice_instructions=true&banner_instructions=true` +
    `&language=es` +
    `&access_token=${token}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code: string;
      routes: Array<{
        geometry: GeoJSON.LineString;
        distance: number;
        duration: number;
        legs: Array<{
          steps: Array<{
            maneuver: {
              instruction: string;
              type: string;
              modifier?: string;
              location: [number, number];
            };
            distance: number;
            duration: number;
            geometry: GeoJSON.LineString;
            voiceInstructions?: Array<{
              distanceAlongGeometry: number;
              announcement: string;
              ssmlAnnouncement?: string;
            }>;
          }>;
        }>;
      }>;
    };
    if (data.code !== 'Ok' || !data.routes[0]) return null;
    const route = data.routes[0];

    // Aplanar los legs.steps a un solo array (puede haber varios legs si hay
    // waypoints intermedios; para UI lineal nos sirve plano).
    const steps: NavStep[] = [];
    for (const leg of route.legs) {
      for (const s of leg.steps) {
        steps.push({
          instruction: s.maneuver.instruction,
          type: s.maneuver.type,
          modifier: s.maneuver.modifier,
          distance: s.distance,
          duration: s.duration,
          location: s.maneuver.location,
          geometry: s.geometry,
          voiceInstructions: s.voiceInstructions,
        });
      }
    }

    return {
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      steps,
    };
  } catch (err) {
    await logger.error('[mapbox.directions] error', { err });
    return null;
  }
}
