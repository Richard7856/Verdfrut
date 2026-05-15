// Stream AI-1 / Phase 1: extrae contexto de la URL para el floating chat.
//
// Reconoce patrones de ruta conocidos y extrae IDs (UUIDs). El backend
// recibe este objeto y lo inyecta en el primer user message.
//
// Patrones soportados hoy:
//   /dispatches/[id]                          → { dispatch_id }
//   /dispatches/[id]/edit                     → { dispatch_id }
//   /settings/stores/[id]                     → { store_id }
//   /settings/drivers/[id]                    → { driver_id }
//   /settings/vehicles/[id]                   → { vehicle_id }
//   /settings/zones/[id]                      → { zone_id }
//   /incidents/[id]                           → { incident_id }
//
// El resto de rutas solo pasa el path sin entities — el AI infiere
// contexto del path mismo.

'use client';

import { usePathname } from 'next/navigation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PageContext {
  path: string;
  entities: Record<string, string>;
  /** Hint humano del tipo de pantalla — útil para el saludo inicial del chat. */
  screenLabel: string;
}

export function usePageContext(): PageContext {
  const pathname = usePathname() ?? '/';
  return extractContext(pathname);
}

export function extractContext(pathname: string): PageContext {
  const segments = pathname.split('/').filter(Boolean);
  const entities: Record<string, string> = {};
  let screenLabel = 'Dashboard';

  // /dispatches/[id]/...
  if (segments[0] === 'dispatches' && segments[1] && UUID_RE.test(segments[1])) {
    entities.dispatch_id = segments[1];
    screenLabel = segments[2] === 'edit' ? 'Edición de tiro' : 'Detalle de tiro';
  } else if (segments[0] === 'dispatches' && segments[1] === 'new') {
    screenLabel = 'Crear tiro';
  } else if (segments[0] === 'dispatches') {
    screenLabel = 'Lista de tiros';
  }

  // /settings/stores/[id]
  else if (segments[0] === 'settings' && segments[1] === 'stores' && segments[2] && UUID_RE.test(segments[2])) {
    entities.store_id = segments[2];
    screenLabel = 'Detalle de tienda';
  } else if (segments[0] === 'settings' && segments[1] === 'stores') {
    screenLabel = 'Catálogo de tiendas';
  }

  // /settings/drivers/[id]
  else if (segments[0] === 'settings' && segments[1] === 'drivers' && segments[2] && UUID_RE.test(segments[2])) {
    entities.driver_id = segments[2];
    screenLabel = 'Detalle de chofer';
  } else if (segments[0] === 'settings' && segments[1] === 'drivers') {
    screenLabel = 'Lista de choferes';
  }

  // /settings/vehicles/[id]
  else if (segments[0] === 'settings' && segments[1] === 'vehicles' && segments[2] && UUID_RE.test(segments[2])) {
    entities.vehicle_id = segments[2];
    screenLabel = 'Detalle de vehículo';
  } else if (segments[0] === 'settings' && segments[1] === 'vehicles') {
    screenLabel = 'Lista de vehículos';
  }

  // /settings/zones/[id]
  else if (segments[0] === 'settings' && segments[1] === 'zones') {
    if (segments[2] && UUID_RE.test(segments[2])) {
      entities.zone_id = segments[2];
      screenLabel = 'Detalle de zona';
    } else {
      screenLabel = 'Zonas';
    }
  }

  // /incidents/[id]
  else if (segments[0] === 'incidents' && segments[1] && UUID_RE.test(segments[1])) {
    entities.incident_id = segments[1];
    screenLabel = 'Detalle de incidencia';
  } else if (segments[0] === 'incidents') {
    screenLabel = 'Incidencias';
  }

  // /map
  else if (segments[0] === 'map') {
    screenLabel = 'Mapa en vivo';
  }

  // /reports
  else if (segments[0] === 'reports') {
    screenLabel = 'Reportes';
  }

  // /stores/import
  else if (segments[0] === 'stores' && segments[1] === 'import') {
    screenLabel = 'Importar tiendas desde Excel';
  }

  return { path: pathname, entities, screenLabel };
}

/**
 * Devuelve true si la pantalla actual NO debe mostrar el floating chat.
 * Evita doble-chat en /orchestrator que ya tiene UI dedicada.
 */
export function shouldHideFloatingChat(pathname: string): boolean {
  return pathname.startsWith('/orchestrator');
}
