// Tools de lectura — sin side effects en BD.
// is_write=false → no consumen quota mensual del customer.
// requires_confirmation=false → ejecutan inmediato.
//
// 2.1.b: skeleton vacío. 2.1.c: agrega list_dispatches_today,
// list_routes, search_stores, list_available_drivers, list_available_vehicles.

import type { ToolDefinition } from '../types';

export const READ_TOOLS: ReadonlyArray<ToolDefinition> = [];
