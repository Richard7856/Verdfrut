// Tools de procesamiento de adjuntos XLSX/CSV.
// El cliente sube via POST /api/orchestrator/upload y obtiene attachment_id.
// El agente usa parse_xlsx_attachment(attachment_id) para leer la data ya
// procesada por server. Después bulk_create_stores convierte rows a tiendas.

import type { ToolDefinition, ToolResult } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badArg<T = unknown>(field: string, msg: string): ToolResult<T> {
  return { ok: false, error: `Argumento inválido "${field}": ${msg}` };
}

// ============================================================================
// parse_xlsx_attachment
// ============================================================================
interface ParseAttachmentArgs {
  attachment_id: string;
  sheet_name?: string;
  preview_rows?: number;
}

interface ParseAttachmentResult {
  filename: string;
  sheets: Array<{
    name: string;
    headers: string[];
    row_count: number;
    preview: Array<Record<string, unknown>>;
  }>;
}

const parse_xlsx_attachment: ToolDefinition<ParseAttachmentArgs, ParseAttachmentResult> = {
  name: 'parse_xlsx_attachment',
  description:
    'Lee un archivo XLSX/CSV adjunto por el usuario y devuelve sus headers + preview de filas. Úsala cuando el usuario menciona un attachment_id en su mensaje (ej. "te paso el sheet attach_xxx"). El attachment_id viene del endpoint /api/orchestrator/upload.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      attachment_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del attachment subido previamente.',
      },
      sheet_name: {
        type: 'string',
        description: 'Nombre específico de hoja (opcional, default todas).',
      },
      preview_rows: {
        type: 'integer',
        description: 'Cuántas filas mostrar por hoja como preview. Default 5, max 50.',
      },
    },
    required: ['attachment_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<ParseAttachmentResult>> => {
    if (!UUID_RE.test(args.attachment_id)) return badArg('attachment_id', 'UUID inválido.');

    const { data: attach, error } = await ctx.supabase
      .from('orchestrator_attachments')
      .select('id, filename, kind, parsed_data, parse_error, user_id')
      .eq('id', args.attachment_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();

    if (error || !attach) {
      return { ok: false, error: 'Attachment no encontrado o no pertenece a tu organización.' };
    }
    if (attach.user_id !== ctx.userId) {
      // Caso edge: admin del customer abriendo conversación con attachment de otro user.
      // Por ahora, permitimos solo el dueño. Si requerido, agregar role-check.
      return { ok: false, error: 'No tienes acceso a ese attachment.' };
    }
    if (attach.parse_error) {
      return { ok: false, error: `Archivo no se pudo parsear: ${attach.parse_error}` };
    }
    if (!attach.parsed_data) {
      return { ok: false, error: 'Archivo aún no procesado o tipo no soportado.' };
    }

    const parsed = attach.parsed_data as {
      sheets?: Array<{
        name: string;
        headers: string[];
        rows: Array<Record<string, unknown>>;
        row_count: number;
      }>;
    };
    if (!parsed.sheets) {
      return { ok: false, error: 'Estructura de parsed_data inesperada.' };
    }

    const previewRows = Math.min(Math.max(args.preview_rows ?? 5, 1), 50);
    const filtered = args.sheet_name
      ? parsed.sheets.filter((s) => s.name === args.sheet_name)
      : parsed.sheets;

    if (filtered.length === 0) {
      return {
        ok: false,
        error: `Hoja "${args.sheet_name}" no existe. Hojas disponibles: ${parsed.sheets.map((s) => s.name).join(', ')}.`,
      };
    }

    return {
      ok: true,
      data: {
        filename: attach.filename as string,
        sheets: filtered.map((s) => ({
          name: s.name,
          headers: s.headers,
          row_count: s.row_count,
          preview: s.rows.slice(0, previewRows),
        })),
      },
      summary: `Archivo "${attach.filename}": ${filtered.length} hoja(s), ${filtered.reduce((sum, s) => sum + s.row_count, 0)} filas totales.`,
    };
  },
};

// ============================================================================
// bulk_create_stores
// ============================================================================
interface StoreRow {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  zone_id: string;
  contact_name?: string;
  contact_phone?: string;
  service_time_seconds?: number;
}

interface BulkCreateStoresArgs {
  stores: StoreRow[];
  dry_run?: boolean;
}

interface BulkCreateStoresResult {
  total: number;
  created: number;
  skipped_duplicates: number;
  failed: number;
  dry_run: boolean;
  errors: Array<{ code: string; reason: string }>;
  created_codes: string[];
}

const bulk_create_stores: ToolDefinition<BulkCreateStoresArgs, BulkCreateStoresResult> = {
  name: 'bulk_create_stores',
  description:
    'Crea múltiples tiendas en una sola operación. Recomendado: dry_run=true primero para validar sin escribir. Cada tienda debe tener lat/lng resueltas (idealmente desde parse_xlsx_attachment + geocode_address). Códigos duplicados se SKIPEAN (no se sobrescriben). Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      stores: {
        type: 'array',
        description: 'Lista de tiendas a crear. Mínimo 1, máximo 100.',
        items: {
          type: 'object',
          description: 'Datos de una tienda.',
        },
      },
      dry_run: {
        type: 'boolean',
        description: 'Si true, NO escribe en BD — solo valida y reporta qué pasaría. Default false.',
      },
    },
    required: ['stores'],
  },
  handler: async (args, ctx): Promise<ToolResult<BulkCreateStoresResult>> => {
    if (!Array.isArray(args.stores) || args.stores.length === 0) {
      return badArg('stores', 'array no vacío requerido.');
    }
    if (args.stores.length > 100) {
      return badArg('stores', 'máx 100 por operación.');
    }
    const dryRun = args.dry_run ?? false;

    // Validar cada row y normalizar.
    const errors: Array<{ code: string; reason: string }> = [];
    const validRows: Array<StoreRow & { code: string }> = [];

    for (let i = 0; i < args.stores.length; i++) {
      const r = args.stores[i]!;
      const code = String(r.code ?? '').toUpperCase().trim();
      if (!code || !/^[A-Z0-9-]{2,30}$/.test(code)) {
        errors.push({ code: code || `(row ${i + 1})`, reason: 'code inválido (2-30 chars alfanum + guiones).' });
        continue;
      }
      const name = String(r.name ?? '').trim();
      if (name.length < 2 || name.length > 100) {
        errors.push({ code, reason: 'name 2-100 chars.' });
        continue;
      }
      const address = String(r.address ?? '').trim();
      if (address.length < 5) {
        errors.push({ code, reason: 'address mínimo 5 chars.' });
        continue;
      }
      if (typeof r.lat !== 'number' || r.lat < -90 || r.lat > 90) {
        errors.push({ code, reason: `lat inválida (${r.lat}).` });
        continue;
      }
      if (typeof r.lng !== 'number' || r.lng < -180 || r.lng > 180) {
        errors.push({ code, reason: `lng inválida (${r.lng}).` });
        continue;
      }
      if (!UUID_RE.test(String(r.zone_id ?? ''))) {
        errors.push({ code, reason: 'zone_id UUID inválido.' });
        continue;
      }
      validRows.push({ ...r, code, name, address });
    }

    if (validRows.length === 0) {
      return {
        ok: false,
        error: `Ninguna tienda válida. Errores: ${errors.length}.`,
        recoverable: true,
      };
    }

    // Validar zonas (1 query única).
    const zoneIds = [...new Set(validRows.map((r) => r.zone_id))];
    const { data: zones } = await ctx.supabase
      .from('zones')
      .select('id')
      .in('id', zoneIds)
      .eq('customer_id', ctx.customerId);
    const validZones = new Set((zones ?? []).map((z) => z.id as string));
    const finalRows = validRows.filter((r) => {
      if (!validZones.has(r.zone_id)) {
        errors.push({ code: r.code, reason: `zone_id no pertenece a tu organización.` });
        return false;
      }
      return true;
    });

    // Check duplicados (1 query).
    const codes = finalRows.map((r) => r.code);
    const { data: existing } = await ctx.supabase
      .from('stores')
      .select('code')
      .in('code', codes)
      .eq('customer_id', ctx.customerId);
    const existingCodes = new Set((existing ?? []).map((s) => s.code as string));
    const toInsert = finalRows.filter((r) => !existingCodes.has(r.code));
    const skippedDuplicates = finalRows.length - toInsert.length;

    if (dryRun) {
      return {
        ok: true,
        data: {
          total: args.stores.length,
          created: 0,
          skipped_duplicates: skippedDuplicates,
          failed: errors.length,
          dry_run: true,
          errors,
          created_codes: toInsert.map((r) => r.code),
        },
        summary:
          `Dry-run: ${toInsert.length} tienda(s) se crearían, ${skippedDuplicates} duplicado(s), ${errors.length} error(es).`,
      };
    }

    if (toInsert.length === 0) {
      return {
        ok: true,
        data: {
          total: args.stores.length,
          created: 0,
          skipped_duplicates: skippedDuplicates,
          failed: errors.length,
          dry_run: false,
          errors,
          created_codes: [],
        },
        summary: 'Nada que crear (todos duplicados o inválidos).',
      };
    }

    // Insert masivo.
    const payload = toInsert.map((r) => ({
      code: r.code,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      zone_id: r.zone_id,
      customer_id: ctx.customerId,
      contact_name: r.contact_name ?? null,
      contact_phone: r.contact_phone ?? null,
      service_time_seconds: r.service_time_seconds ?? 900,
      coord_verified: true,
      is_active: true,
    }));

    const { data: created, error: insErr } = await ctx.supabase
      .from('stores')
      .insert(payload)
      .select('code');

    if (insErr) {
      return { ok: false, error: `BD falló: ${insErr.message}` };
    }

    return {
      ok: true,
      data: {
        total: args.stores.length,
        created: (created ?? []).length,
        skipped_duplicates: skippedDuplicates,
        failed: errors.length,
        dry_run: false,
        errors,
        created_codes: (created ?? []).map((c) => c.code as string),
      },
      summary: `Creadas ${(created ?? []).length} tienda(s). ${skippedDuplicates} duplicado(s) ignorada(s). ${errors.length} error(es).`,
    };
  },
};

// ============================================================================
// Registry export
// ============================================================================
export const XLSX_TOOLS: ReadonlyArray<ToolDefinition> = [
  parse_xlsx_attachment as unknown as ToolDefinition,
  bulk_create_stores as unknown as ToolDefinition,
];
