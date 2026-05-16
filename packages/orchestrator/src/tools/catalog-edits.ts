// Tools de edición de catálogo no-tienda (Phase 2 / 2026-05-15 noche).
// update_driver, update_vehicle, create_zone, update_zone.
// archive_store vive en places.ts junto a create_store/update_store.

import type { ToolDefinition, ToolResult } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badArg<T = unknown>(field: string, msg: string): ToolResult<T> {
  return { ok: false, error: `Argumento inválido "${field}": ${msg}` };
}

// ============================================================================
// update_driver
// ============================================================================
// Particularidad: full_name + phone viven en user_profiles (1:1 con driver.user_id),
// no en la tabla drivers. La tool maneja ambas tablas en una operación.

interface UpdateDriverArgs {
  driver_id: string;
  full_name?: string;
  phone?: string | null;
  zone_id?: string;
  license_number?: string | null;
  license_expires_at?: string | null;
  is_active?: boolean;
}

interface UpdateDriverResult {
  driver_id: string;
  full_name: string;
  updated_fields: string[];
}

const update_driver: ToolDefinition<UpdateDriverArgs, UpdateDriverResult> = {
  name: 'update_driver',
  description:
    'Actualiza campos de un chofer existente. PATCH semantics — solo pasa lo que vas a cambiar. Casos típicos: cambiar nombre, teléfono, zona asignada, datos de licencia, marcar inactivo. NOTA: nombre/teléfono se actualizan en user_profiles (perfil); el resto en la tabla drivers. La tool lo maneja transparente. Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      driver_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del chofer (NO el user_id). Resuelve con list_available_drivers si solo tienes el nombre.',
      },
      full_name: {
        type: 'string',
        description: 'Nuevo nombre completo del chofer (2-100 chars). Se guarda en user_profiles.',
      },
      phone: {
        type: 'string',
        description: 'Nuevo teléfono (formato libre, max 30 chars). Pasar "" para limpiar.',
      },
      zone_id: {
        type: 'string',
        format: 'uuid',
        description: 'Nueva zona donde opera. Afecta qué rutas le pueden asignar.',
      },
      license_number: {
        type: 'string',
        description: 'Número de licencia (max 50 chars). Pasar "" para limpiar.',
      },
      license_expires_at: {
        type: 'string',
        description: 'Vencimiento de licencia YYYY-MM-DD. Pasar "" para limpiar.',
      },
      is_active: {
        type: 'boolean',
        description: 'true = activo, false = desactivado (no aparece en list_available_drivers).',
      },
    },
    required: ['driver_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<UpdateDriverResult>> => {
    if (!UUID_RE.test(args.driver_id)) return badArg('driver_id', 'UUID inválido.');

    // Cargar driver para obtener user_id + validar customer.
    const { data: driver } = await ctx.supabase
      .from('drivers')
      .select('id, user_id, customer_id')
      .eq('id', args.driver_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!driver) {
      return { ok: false, error: 'Chofer no encontrado o no pertenece a tu organización.' };
    }

    const updatedFields: string[] = [];

    // Split: campos de user_profiles vs drivers.
    const profilePatch: Record<string, unknown> = {};
    const driverPatch: Record<string, unknown> = {};

    if (args.full_name !== undefined) {
      const name = String(args.full_name).trim();
      if (name.length < 2 || name.length > 100) return badArg('full_name', '2-100 chars.');
      profilePatch.full_name = name;
      updatedFields.push('full_name');
    }
    if (args.phone !== undefined) {
      if (args.phone !== null && args.phone !== '' && String(args.phone).length > 30) {
        return badArg('phone', 'max 30 chars.');
      }
      profilePatch.phone = args.phone === '' ? null : args.phone;
      updatedFields.push('phone');
    }
    if (args.zone_id !== undefined) {
      if (!UUID_RE.test(args.zone_id)) return badArg('zone_id', 'UUID inválido.');
      const { data: zone } = await ctx.supabase
        .from('zones')
        .select('id')
        .eq('id', args.zone_id)
        .eq('customer_id', ctx.customerId)
        .maybeSingle();
      if (!zone) return { ok: false, error: 'Zona no pertenece a tu organización.' };
      driverPatch.zone_id = args.zone_id;
      updatedFields.push('zone_id');
    }
    if (args.license_number !== undefined) {
      if (args.license_number !== null && args.license_number !== '' && String(args.license_number).length > 50) {
        return badArg('license_number', 'max 50 chars.');
      }
      driverPatch.license_number = args.license_number === '' ? null : args.license_number;
      updatedFields.push('license_number');
    }
    if (args.license_expires_at !== undefined) {
      if (args.license_expires_at === '' || args.license_expires_at === null) {
        driverPatch.license_expires_at = null;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(args.license_expires_at)) {
        return badArg('license_expires_at', 'formato YYYY-MM-DD (o "" para limpiar).');
      } else {
        driverPatch.license_expires_at = args.license_expires_at;
      }
      updatedFields.push('license_expires_at');
    }
    if (args.is_active !== undefined) {
      driverPatch.is_active = Boolean(args.is_active);
      updatedFields.push('is_active');
    }

    if (updatedFields.length === 0) {
      return { ok: false, error: 'No se pasaron campos a actualizar.' };
    }

    // Apply profile patch (si hay).
    if (Object.keys(profilePatch).length > 0) {
      const { error: profErr } = await ctx.supabase
        .from('user_profiles')
        .update(profilePatch as never)
        .eq('id', driver.user_id as string);
      if (profErr) {
        return { ok: false, error: `Error actualizando perfil: ${profErr.message}` };
      }
    }

    // Apply driver patch (si hay).
    if (Object.keys(driverPatch).length > 0) {
      const { error: drvErr } = await ctx.supabase
        .from('drivers')
        .update(driverPatch as never)
        .eq('id', args.driver_id)
        .eq('customer_id', ctx.customerId);
      if (drvErr) {
        return { ok: false, error: `Error actualizando chofer: ${drvErr.message}` };
      }
    }

    // Releer nombre final para summary.
    const { data: finalProfile } = await ctx.supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', driver.user_id as string)
      .maybeSingle();

    const finalName = (finalProfile as { full_name?: string } | null)?.full_name ?? '(sin nombre)';
    return {
      ok: true,
      data: {
        driver_id: args.driver_id,
        full_name: finalName,
        updated_fields: updatedFields,
      },
      summary: `Chofer **${finalName}** actualizado (${updatedFields.length} campo${updatedFields.length > 1 ? 's' : ''}: ${updatedFields.join(', ')}). [Ver lista de choferes](/drivers).`,
    };
  },
};

// ============================================================================
// update_vehicle
// ============================================================================

interface UpdateVehicleArgs {
  vehicle_id: string;
  alias?: string | null;
  zone_id?: string;
  capacity?: number[];
  depot_id?: string | null;
  depot_lat?: number | null;
  depot_lng?: number | null;
  status?: 'available' | 'maintenance' | 'retired';
  is_active?: boolean;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engine_size_l?: number | null;
  fuel_consumption_l_per_100km?: number | null;
  notes?: string | null;
}

interface UpdateVehicleResult {
  vehicle_id: string;
  plate: string;
  alias: string | null;
  updated_fields: string[];
}

const update_vehicle: ToolDefinition<UpdateVehicleArgs, UpdateVehicleResult> = {
  name: 'update_vehicle',
  description:
    'Actualiza campos de un vehículo existente. PATCH semantics. Casos típicos: cambiar alias, depot asignado, capacidad multi-dimensional [peso_kg, volumen_m3, cajas], marcar en mantenimiento o retirado, actualizar specs (make/model/year/fuel). La PLACA no es editable (clave de identificación). Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      vehicle_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del vehículo. Resuelve con list_available_vehicles si solo tienes la placa.',
      },
      alias: {
        type: 'string',
        description: 'Apodo/alias humano (ej. "Camioneta Sur"). Pasar "" para limpiar.',
      },
      zone_id: {
        type: 'string',
        format: 'uuid',
        description: 'Nueva zona operativa.',
      },
      capacity: {
        type: 'array',
        items: { type: 'number', description: 'Capacidad en una dimensión.' },
        description: 'Capacidad multi-dimensional [peso_kg, volumen_m3, cajas]. Array de 3 números.',
      },
      depot_id: {
        type: 'string',
        format: 'uuid',
        description: 'CEDIS/depot base del vehículo. Pasar "" para limpiar (usar depot_lat/lng directamente).',
      },
      depot_lat: {
        type: 'number',
        description: 'Lat del depot custom (cuando no usas depot_id de catálogo).',
      },
      depot_lng: {
        type: 'number',
        description: 'Lng del depot custom.',
      },
      status: {
        type: 'string',
        enum: ['available', 'maintenance', 'retired'],
        description: 'available = puede operar; maintenance = fuera temporal; retired = baja permanente.',
      },
      is_active: {
        type: 'boolean',
        description: 'true = aparece en list_available_vehicles; false = oculto del catálogo operativo.',
      },
      make: { type: 'string', description: 'Marca (ej. "Renault"). Pasar "" para limpiar.' },
      model: { type: 'string', description: 'Modelo (ej. "Kangoo"). Pasar "" para limpiar.' },
      year: { type: 'integer', description: 'Año del vehículo (1990-2030).' },
      engine_size_l: { type: 'number', description: 'Cilindrada en litros (0.5-10).' },
      fuel_consumption_l_per_100km: {
        type: 'number',
        description: 'Consumo en L/100km (típico 5-25 para vans de reparto).',
      },
      notes: { type: 'string', description: 'Notas operativas (max 500 chars). Pasar "" para limpiar.' },
    },
    required: ['vehicle_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<UpdateVehicleResult>> => {
    if (!UUID_RE.test(args.vehicle_id)) return badArg('vehicle_id', 'UUID inválido.');

    const patch: Record<string, unknown> = {};
    const updatedFields: string[] = [];

    if (args.alias !== undefined) {
      patch.alias = args.alias === '' ? null : args.alias;
      updatedFields.push('alias');
    }
    if (args.zone_id !== undefined) {
      if (!UUID_RE.test(args.zone_id)) return badArg('zone_id', 'UUID inválido.');
      const { data: zone } = await ctx.supabase
        .from('zones')
        .select('id')
        .eq('id', args.zone_id)
        .eq('customer_id', ctx.customerId)
        .maybeSingle();
      if (!zone) return { ok: false, error: 'Zona no pertenece a tu organización.' };
      patch.zone_id = args.zone_id;
      updatedFields.push('zone_id');
    }
    if (args.capacity !== undefined) {
      if (
        !Array.isArray(args.capacity) ||
        args.capacity.length !== 3 ||
        args.capacity.some((n) => typeof n !== 'number' || n < 0 || n > 100_000)
      ) {
        return badArg('capacity', 'array de 3 números [peso_kg, volumen_m3, cajas], cada uno 0-100000.');
      }
      patch.capacity = args.capacity;
      updatedFields.push('capacity');
    }
    if (args.depot_id !== undefined) {
      if (args.depot_id === '' || args.depot_id === null) {
        patch.depot_id = null;
      } else if (!UUID_RE.test(args.depot_id)) {
        return badArg('depot_id', 'UUID inválido (o "" para limpiar).');
      } else {
        patch.depot_id = args.depot_id;
      }
      updatedFields.push('depot_id');
    }
    if (args.depot_lat !== undefined) {
      if (args.depot_lat !== null && (typeof args.depot_lat !== 'number' || args.depot_lat < -90 || args.depot_lat > 90)) {
        return badArg('depot_lat', 'rango -90 a 90.');
      }
      patch.depot_lat = args.depot_lat;
      updatedFields.push('depot_lat');
    }
    if (args.depot_lng !== undefined) {
      if (args.depot_lng !== null && (typeof args.depot_lng !== 'number' || args.depot_lng < -180 || args.depot_lng > 180)) {
        return badArg('depot_lng', 'rango -180 a 180.');
      }
      patch.depot_lng = args.depot_lng;
      updatedFields.push('depot_lng');
    }
    if (args.status !== undefined) {
      if (!['available', 'maintenance', 'retired'].includes(args.status)) {
        return badArg('status', 'available | maintenance | retired.');
      }
      patch.status = args.status;
      updatedFields.push('status');
    }
    if (args.is_active !== undefined) {
      patch.is_active = Boolean(args.is_active);
      updatedFields.push('is_active');
    }
    if (args.make !== undefined) {
      patch.make = args.make === '' ? null : args.make;
      updatedFields.push('make');
    }
    if (args.model !== undefined) {
      patch.model = args.model === '' ? null : args.model;
      updatedFields.push('model');
    }
    if (args.year !== undefined) {
      if (args.year !== null && (typeof args.year !== 'number' || args.year < 1990 || args.year > 2030)) {
        return badArg('year', '1990-2030.');
      }
      patch.year = args.year;
      updatedFields.push('year');
    }
    if (args.engine_size_l !== undefined) {
      if (args.engine_size_l !== null && (typeof args.engine_size_l !== 'number' || args.engine_size_l < 0.5 || args.engine_size_l > 10)) {
        return badArg('engine_size_l', '0.5-10 litros.');
      }
      patch.engine_size_l = args.engine_size_l;
      updatedFields.push('engine_size_l');
    }
    if (args.fuel_consumption_l_per_100km !== undefined) {
      if (
        args.fuel_consumption_l_per_100km !== null &&
        (typeof args.fuel_consumption_l_per_100km !== 'number' ||
          args.fuel_consumption_l_per_100km < 1 ||
          args.fuel_consumption_l_per_100km > 100)
      ) {
        return badArg('fuel_consumption_l_per_100km', '1-100 L/100km.');
      }
      patch.fuel_consumption_l_per_100km = args.fuel_consumption_l_per_100km;
      updatedFields.push('fuel_consumption_l_per_100km');
    }
    if (args.notes !== undefined) {
      if (args.notes !== null && args.notes !== '' && String(args.notes).length > 500) {
        return badArg('notes', 'max 500 chars.');
      }
      patch.notes = args.notes === '' ? null : args.notes;
      updatedFields.push('notes');
    }

    if (updatedFields.length === 0) {
      return { ok: false, error: 'No se pasaron campos a actualizar.' };
    }

    // Verificar ownership (RLS también protege).
    const { data: existing } = await ctx.supabase
      .from('vehicles')
      .select('id, plate, alias')
      .eq('id', args.vehicle_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!existing) {
      return { ok: false, error: 'Vehículo no encontrado o no pertenece a tu organización.' };
    }

    const { data, error } = await ctx.supabase
      .from('vehicles')
      .update(patch as never)
      .eq('id', args.vehicle_id)
      .eq('customer_id', ctx.customerId)
      .select('id, plate, alias')
      .single();

    if (error) {
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    return {
      ok: true,
      data: {
        vehicle_id: data.id as string,
        plate: data.plate as string,
        alias: data.alias as string | null,
        updated_fields: updatedFields,
      },
      summary: `Vehículo [${data.plate}${data.alias ? ` (${data.alias})` : ''}](/settings/vehicles/${data.id}) actualizado (${updatedFields.length} campo${updatedFields.length > 1 ? 's' : ''}: ${updatedFields.join(', ')}).`,
    };
  },
};

// ============================================================================
// create_zone
// ============================================================================

interface CreateZoneArgs {
  code: string;
  name: string;
}

interface CreateZoneResult {
  zone_id: string;
  code: string;
  name: string;
}

const create_zone: ToolDefinition<CreateZoneArgs, CreateZoneResult> = {
  name: 'create_zone',
  description:
    'Crea una zona operativa nueva (ej. "CDMX", "Toluca", "Querétaro Norte"). Las zonas agrupan tiendas, vehículos y choferes operativamente. Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Código corto único (2-20 chars alfanum+guión). Ej. "CDMX", "TOL", "QRO-N".',
      },
      name: {
        type: 'string',
        description: 'Nombre descriptivo (2-100 chars). Ej. "CDMX", "Toluca", "Querétaro Norte".',
      },
    },
    required: ['code', 'name'],
  },
  handler: async (args, ctx): Promise<ToolResult<CreateZoneResult>> => {
    const code = String(args.code).toUpperCase().trim();
    if (!/^[A-Z0-9-]{2,20}$/.test(code)) return badArg('code', '2-20 chars alfanum + guiones.');
    const name = String(args.name).trim();
    if (name.length < 2 || name.length > 100) return badArg('name', '2-100 chars.');

    const { data, error } = await ctx.supabase
      .from('zones')
      .insert({
        code,
        name,
        customer_id: ctx.customerId,
        is_active: true,
      })
      .select('id, code, name')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: `Ya existe una zona con código "${code}".` };
      }
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    return {
      ok: true,
      data: {
        zone_id: data.id as string,
        code: data.code as string,
        name: data.name as string,
      },
      summary: `Zona **${name}** (${code}) creada. [Ver zonas](/settings/zones).`,
    };
  },
};

// ============================================================================
// update_zone
// ============================================================================

interface UpdateZoneArgs {
  zone_id: string;
  code?: string;
  name?: string;
  is_active?: boolean;
}

interface UpdateZoneResult {
  zone_id: string;
  code: string;
  name: string;
  updated_fields: string[];
}

const update_zone: ToolDefinition<UpdateZoneArgs, UpdateZoneResult> = {
  name: 'update_zone',
  description:
    'Actualiza una zona existente. Casos: renombrar, cambiar código, marcar inactiva (no aparece en listas de selección pero preserva historial). Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      zone_id: { type: 'string', format: 'uuid', description: 'UUID de la zona.' },
      code: { type: 'string', description: 'Nuevo código (2-20 chars alfanum + guión).' },
      name: { type: 'string', description: 'Nuevo nombre (2-100 chars).' },
      is_active: { type: 'boolean', description: 'true = activa, false = desactivada.' },
    },
    required: ['zone_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<UpdateZoneResult>> => {
    if (!UUID_RE.test(args.zone_id)) return badArg('zone_id', 'UUID inválido.');

    const patch: Record<string, unknown> = {};
    const updatedFields: string[] = [];

    if (args.code !== undefined) {
      const code = String(args.code).toUpperCase().trim();
      if (!/^[A-Z0-9-]{2,20}$/.test(code)) return badArg('code', '2-20 chars alfanum + guiones.');
      patch.code = code;
      updatedFields.push('code');
    }
    if (args.name !== undefined) {
      const name = String(args.name).trim();
      if (name.length < 2 || name.length > 100) return badArg('name', '2-100 chars.');
      patch.name = name;
      updatedFields.push('name');
    }
    if (args.is_active !== undefined) {
      patch.is_active = Boolean(args.is_active);
      updatedFields.push('is_active');
    }

    if (updatedFields.length === 0) {
      return { ok: false, error: 'No se pasaron campos a actualizar.' };
    }

    const { data: existing } = await ctx.supabase
      .from('zones')
      .select('id')
      .eq('id', args.zone_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!existing) {
      return { ok: false, error: 'Zona no encontrada o no pertenece a tu organización.' };
    }

    const { data, error } = await ctx.supabase
      .from('zones')
      .update(patch as never)
      .eq('id', args.zone_id)
      .eq('customer_id', ctx.customerId)
      .select('id, code, name')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: 'Ya existe otra zona con ese código.' };
      }
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    return {
      ok: true,
      data: {
        zone_id: data.id as string,
        code: data.code as string,
        name: data.name as string,
        updated_fields: updatedFields,
      },
      summary: `Zona **${data.name}** actualizada (${updatedFields.join(', ')}). [Ver zonas](/settings/zones).`,
    };
  },
};

// ============================================================================
// Registry export
// ============================================================================
export const CATALOG_EDIT_TOOLS: ReadonlyArray<ToolDefinition> = [
  update_driver as unknown as ToolDefinition,
  update_vehicle as unknown as ToolDefinition,
  create_zone as unknown as ToolDefinition,
  update_zone as unknown as ToolDefinition,
];
