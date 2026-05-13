// Registro central de tools del orquestador.
//
// Una sola fuente de verdad: cada tool se exporta desde su archivo y se
// agrega al array TOOLS. El runner busca por name aquí; la API expone la
// lista a Anthropic; la UI usa para previews.

import type { ToolDefinition } from '../types';

// Cada archivo de tool exporta su array. Aquí los concatenamos.
// 2.1.c: 5 reads. 2.2.a: 8 writes con requires_confirmation en destructivas.
// 2.7: 3 places (geocode + search_place + create_store).
// 2.8: 2 xlsx (parse_xlsx_attachment + bulk_create_stores).
import { READ_TOOLS } from './reads';
import { WRITE_TOOLS } from './writes';
import { PLACES_TOOLS } from './places';
import { XLSX_TOOLS } from './xlsx';

export const TOOLS: ReadonlyArray<ToolDefinition> = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...PLACES_TOOLS,
  ...XLSX_TOOLS,
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS_BY_NAME.get(name);
}

export function listToolsForRole(role: 'admin' | 'dispatcher'): ToolDefinition[] {
  return TOOLS.filter((t) => {
    const allowed = t.allowed_roles ?? ['admin', 'dispatcher'];
    return allowed.includes(role);
  });
}

/**
 * Filtra por allowlist del customer (si está configurada en
 * customers.flow_engine_overrides.ai_tools_allowlist).
 * Sin allowlist → todas habilitadas (default tier).
 */
export function listToolsForCustomer(
  role: 'admin' | 'dispatcher',
  allowlist?: string[],
): ToolDefinition[] {
  const roleTools = listToolsForRole(role);
  if (!allowlist || allowlist.length === 0) return roleTools;
  return roleTools.filter((t) => allowlist.includes(t.name));
}
