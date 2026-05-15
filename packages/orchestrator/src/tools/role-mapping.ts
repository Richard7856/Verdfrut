// Mapping de tools → roles de agente runtime (Stream R, ROADMAP 2026-05-15).
//
// Diseño: cada rol expone un SUBCONJUNTO de las TOOLS globales. Un mismo
// tool puede aparecer en varios roles (ej. `search_stores` lo usan
// orchestrator y router). No duplicamos definiciones — solo nombres.
//
// Sprint R1 (current): orchestrator mantiene TODO lo que tenía hoy →
// cero cambio funcional. geo y router declaran su subset pero NO se
// invocan desde ningún caller real todavía. Eso pasa en R2/R3.
//
// Cómo agregar un tool nuevo:
//   1. Define el tool en su archivo (reads.ts, writes.ts, etc.).
//   2. Decide a qué rol(es) pertenece y agrégalo abajo.
//   3. Si NO lo agregas a ningún rol, queda inaccesible (defensa por
//      defecto contra olvidos).

import type { AgentRole } from '../types';

// Lista completa de tools por rol. Cualquier nombre aquí debe existir
// en el registry global (TOOLS de registry.ts) — si no, el filtro lo
// ignora silenciosamente (warning en dev recomendado en R2).
//
// IMPORTANTE: el orchestrator NO incluye geo/router subsets directamente
// porque a esos los va a invocar via `delegate_to_geo` / handoff de
// conversación, no llamando los tools individuales. Excepción R1: el
// orchestrator mantiene TODOS los tools (incluyendo geo/router) hasta
// que R2 mueva geo a delegate_to_geo, y R3 mueva router a handoff.

export const TOOLS_BY_ROLE: Record<AgentRole, readonly string[]> = {
  // ORCHESTRATOR (R2): mantiene catalog + dispatch lifecycle + xlsx + writes
  // geo (create_store, bulk_create_stores) porque esas requieren confirmación
  // del user — el geo agent es read-only por diseño. Para resolver coords
  // de direcciones el orchestrator NO llama geocode_address directo; usa
  // `delegate_to_geo` que abre un sub-loop en el geo agent (R2 activo).
  // En R3 le quitamos las routing/edit (handoff a router agent).
  orchestrator: [
    // catalog reads
    'search_stores',
    'list_available_drivers',
    'list_available_vehicles',
    // dispatch state reads
    'list_dispatches_today',
    'list_routes',
    // dispatch lifecycle writes
    'create_dispatch',
    'add_route_to_dispatch',
    'add_stop_to_route',
    'move_stop',
    'remove_stop',
    'publish_dispatch',
    'cancel_dispatch',
    'reassign_driver',
    // store writes (requieren confirmation del user)
    'create_store',
    'update_store',
    'archive_store',
    'bulk_create_stores',
    // catalog edits (drivers, vehicles, zones — Phase 2)
    'update_driver',
    'update_vehicle',
    'create_zone',
    'update_zone',
    // xlsx (ingestion entry-point — el orchestrator lo llama para extraer
    // direcciones del adjunto antes de delegar a geo)
    'parse_xlsx_attachment',
    // optimize: legacy (re-rutea un tiro existente) + propose (3 alternativas con costo MXN).
    // ADR-100 / OE-2: propose_route_plan vive en orchestrator desde 2026-05-15 noche
    // (decisión pre-demo: sin handoff a router agent, un solo modelo conversa con user).
    'optimize_dispatch',
    'propose_route_plan',
    // OE-3: aplicar una alternativa de propose_route_plan (re-estructura
    // atómica del tiro con los vehículos elegidos por el user).
    'apply_route_plan',
    // delegación a sub-agentes batch (R2 / ADR-099)
    'delegate_to_geo',
    // NOTA: enter_router_mode REMOVIDO temporalmente (pre-demo 2026-05-15).
    // La handoff conversacional confundía al modelo en multi-turn complejo.
    // Re-habilitar cuando OE-3 traiga UI badge + flow validado.
  ],

  // GEO (R2 activo): tool batch worker read-only. Recibe input estructurado
  // del orchestrator via `delegate_to_geo`. Hace geocoding + búsqueda Places
  // + validación de coords + lookup de stores existentes. NO escribe a BD;
  // los writes vuelven al orchestrator que pide confirmation al user.
  geo: [
    'geocode_address',
    'search_place',
    'search_stores',
  ],

  // ROUTER (R3 activo 2026-05-15): especialista en armado/optimización de
  // rutas. Patrón conversation handoff — toma la conversación con el user
  // hasta llamar `exit_router_mode`.
  router: [
    // Reads para resolver tiendas, ver estado actual, listar recursos.
    'search_stores',
    'list_routes',
    'list_dispatches_today',
    'list_available_drivers',
    'list_available_vehicles',
    // Writes de armado y edición (algunos requieren confirmation del user).
    'add_route_to_dispatch',
    'add_stop_to_route',
    'move_stop',
    'remove_stop',
    'reassign_driver',
    // Optimización: legacy + propuesta de alternativas (R4 deprecará optimize_dispatch).
    'optimize_dispatch',
    'propose_route_plan',
    'apply_route_plan',
    // Control: devolver el turno al orchestrator.
    'exit_router_mode',
  ],
};

export function getRoleToolNames(role: AgentRole): readonly string[] {
  return TOOLS_BY_ROLE[role];
}
