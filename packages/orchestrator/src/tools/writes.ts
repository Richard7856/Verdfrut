// Tools de escritura — modifican estado en BD.
// is_write=true → cuentan al quota mensual del customer.
// requires_confirmation=true en destructivas (publish, cancel, remove_stop,
//   reassign_driver, add_route_to_dispatch, add_stop_to_route).
//
// Estas tools NO reusan las server actions de apps/platform (esas dependen
// de cookies de sesión). Replican la lógica usando ctx.supabase (service_role)
// + validación estricta de args + defensa por customer_id.

import type { ToolDefinition, ToolResult, ToolContext } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badArg<T = unknown>(field: string, msg: string): ToolResult<T> {
  return { ok: false, error: `Argumento inválido "${field}": ${msg}` };
}

// ============================================================================
// create_dispatch
// ============================================================================
interface CreateDispatchArgs {
  name: string;
  date: string;
  zone_id: string;
  notes?: string;
}

const create_dispatch: ToolDefinition<CreateDispatchArgs, { dispatch_id: string; name: string }> = {
  name: 'create_dispatch',
  description:
    'Crea un tiro (dispatch) vacío en estado planning. Después agrega rutas con add_route_to_dispatch. Bajo impacto: el tiro vacío no genera operación.',
  is_write: true,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Nombre del tiro (2-80 chars). Ej: "Toluca 14/05" o "CDMX zona oriente".',
      },
      date: {
        type: 'string',
        format: 'date',
        description: 'Fecha operativa en formato YYYY-MM-DD.',
      },
      zone_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID de la zona. Resuélvelo previamente con list_dispatches_today o pídelo al usuario.',
      },
      notes: {
        type: 'string',
        description: 'Notas opcionales (máx 500 chars).',
      },
    },
    required: ['name', 'date', 'zone_id'],
  },
  handler: async (args, ctx) => {
    const name = (args.name ?? '').trim();
    if (name.length < 2 || name.length > 80) return badArg('name', '2-80 chars.');
    if (!DATE_RE.test(args.date)) return badArg('date', 'formato YYYY-MM-DD.');
    if (!UUID_RE.test(args.zone_id)) return badArg('zone_id', 'UUID inválido.');
    const notes = (args.notes ?? '').trim();
    if (notes.length > 500) return badArg('notes', 'máx 500 chars.');

    // Validar zona pertenece al customer.
    const { data: zone } = await ctx.supabase
      .from('zones')
      .select('id')
      .eq('id', args.zone_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!zone) return { ok: false, error: 'Zona no pertenece a tu organización.' };

    const { data, error } = await ctx.supabase
      .from('dispatches')
      .insert({
        name,
        date: args.date,
        zone_id: args.zone_id,
        notes: notes || null,
        created_by: ctx.userId,
        customer_id: ctx.customerId,
      })
      .select('id, name')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: `Ya existe un tiro "${name}" para esa zona y fecha.` };
      }
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    return {
      ok: true,
      data: { dispatch_id: data.id as string, name: data.name as string },
      // Link clickeable al detalle del tiro recién creado (Stream AI Fase A).
      summary: `Tiro [${name}](/dispatches/${data.id}) creado para ${args.date}.`,
    };
  },
};

// ============================================================================
// add_route_to_dispatch
// ============================================================================
interface AddRouteArgs {
  dispatch_id: string;
  vehicle_id: string;
  driver_id?: string;
  store_codes: string[];
  route_name?: string;
}

interface AddRouteResult {
  route_id: string;
  name: string;
  stop_count: number;
  unmatched_codes: string[];
}

const add_route_to_dispatch: ToolDefinition<AddRouteArgs, AddRouteResult> = {
  name: 'add_route_to_dispatch',
  description:
    'Agrega una ruta nueva (status=DRAFT) a un tiro existente, con las tiendas indicadas como paradas en orden. El chofer es opcional; si se omite, queda sin asignar. La ruta queda DRAFT — no impacta operación hasta publish_dispatch.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del tiro destino. Resuélvelo con list_dispatches_today.',
      },
      vehicle_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del vehículo asignado. Resuélvelo con list_available_vehicles.',
      },
      driver_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del chofer (opcional). Resuélvelo con list_available_drivers.',
      },
      store_codes: {
        type: 'array',
        items: { type: 'string', description: 'Código de tienda (ej. TOL-1422).' },
        description: 'Códigos de tienda en el orden deseado. Mínimo 1.',
      },
      route_name: {
        type: 'string',
        description: 'Nombre de la ruta (opcional). Default "Ruta {plate}".',
      },
    },
    required: ['dispatch_id', 'vehicle_id', 'store_codes'],
  },
  handler: async (args, ctx): Promise<ToolResult<AddRouteResult>> => {
    if (!UUID_RE.test(args.dispatch_id)) return badArg('dispatch_id', 'UUID inválido.');
    if (!UUID_RE.test(args.vehicle_id)) return badArg('vehicle_id', 'UUID inválido.');
    if (args.driver_id && !UUID_RE.test(args.driver_id)) return badArg('driver_id', 'UUID inválido.');
    if (!Array.isArray(args.store_codes) || args.store_codes.length === 0) {
      return badArg('store_codes', 'array no vacío requerido.');
    }

    // Validar dispatch + zone.
    const { data: dispatch } = await ctx.supabase
      .from('dispatches')
      .select('id, date, zone_id, status')
      .eq('id', args.dispatch_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!dispatch) return { ok: false, error: 'Tiro no encontrado.' };
    if (dispatch.status === 'completed' || dispatch.status === 'cancelled') {
      return { ok: false, error: `No puedes agregar rutas a un tiro en estado ${dispatch.status}.` };
    }

    // Validar vehicle + zone match.
    const { data: vehicle } = await ctx.supabase
      .from('vehicles')
      .select('id, plate, zone_id, is_active')
      .eq('id', args.vehicle_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!vehicle) return { ok: false, error: 'Vehículo no encontrado.' };
    if (!vehicle.is_active) return { ok: false, error: 'Vehículo no está activo.' };
    if (vehicle.zone_id !== dispatch.zone_id) {
      return { ok: false, error: 'Vehículo no pertenece a la misma zona del tiro.' };
    }

    // Validar driver si viene.
    if (args.driver_id) {
      const { data: driver } = await ctx.supabase
        .from('drivers')
        .select('id, zone_id, is_active')
        .eq('id', args.driver_id)
        .eq('customer_id', ctx.customerId)
        .maybeSingle();
      if (!driver) return { ok: false, error: 'Chofer no encontrado.' };
      if (!driver.is_active) return { ok: false, error: 'Chofer no está activo.' };
      if (driver.zone_id !== dispatch.zone_id) {
        return { ok: false, error: 'Chofer no pertenece a la misma zona del tiro.' };
      }

      // Verificar que el chofer no tenga otra ruta para la misma fecha.
      const { data: conflict } = await ctx.supabase
        .from('routes')
        .select('id, name')
        .eq('customer_id', ctx.customerId)
        .eq('driver_id', args.driver_id)
        .eq('date', dispatch.date)
        .in('status', ['DRAFT', 'OPTIMIZED', 'APPROVED', 'PUBLISHED', 'IN_PROGRESS'])
        .limit(1);
      if (conflict && conflict.length > 0) {
        return {
          ok: false,
          error: `El chofer ya tiene la ruta "${conflict[0]!.name}" asignada para ${dispatch.date}.`,
        };
      }
    }

    // Resolver store_codes → ids. Cualquier código no encontrado se reporta.
    const upperCodes = args.store_codes.map((c) => c.toUpperCase().trim()).filter(Boolean);
    const { data: stores } = await ctx.supabase
      .from('stores')
      .select('id, code, zone_id, is_active')
      .eq('customer_id', ctx.customerId)
      .in('code', upperCodes);

    const found = new Map<string, { id: string; zone_id: string; is_active: boolean }>();
    for (const s of stores ?? []) {
      found.set(s.code as string, {
        id: s.id as string,
        zone_id: s.zone_id as string,
        is_active: s.is_active as boolean,
      });
    }
    const unmatched: string[] = [];
    const sequenceList: Array<{ store_id: string; sequence: number; code: string }> = [];
    let seq = 1;
    for (const code of upperCodes) {
      const hit = found.get(code);
      if (!hit) {
        unmatched.push(code);
        continue;
      }
      if (!hit.is_active) {
        unmatched.push(`${code} (inactiva)`);
        continue;
      }
      if (hit.zone_id !== dispatch.zone_id) {
        unmatched.push(`${code} (zona distinta)`);
        continue;
      }
      sequenceList.push({ store_id: hit.id, sequence: seq++, code });
    }

    if (sequenceList.length === 0) {
      return {
        ok: false,
        error: `Ninguna tienda válida. Códigos no encontrados o inválidos: ${unmatched.join(', ')}`,
      };
    }

    // Crear route.
    const routeName = (args.route_name ?? `Ruta ${vehicle.plate}`).trim().slice(0, 100);
    const { data: route, error: routeErr } = await ctx.supabase
      .from('routes')
      .insert({
        name: routeName,
        date: dispatch.date,
        vehicle_id: args.vehicle_id,
        driver_id: args.driver_id ?? null,
        zone_id: dispatch.zone_id,
        status: 'DRAFT',
        created_by: ctx.userId,
        dispatch_id: args.dispatch_id,
        customer_id: ctx.customerId,
      })
      .select('id, name')
      .single();
    if (routeErr || !route) {
      return { ok: false, error: `No se pudo crear la ruta: ${routeErr?.message ?? 'desconocido'}` };
    }

    // Crear stops batched.
    const stopsPayload = sequenceList.map((s) => ({
      route_id: route.id as string,
      store_id: s.store_id,
      sequence: s.sequence,
      status: 'pending' as const,
    }));
    const { error: stopsErr } = await ctx.supabase.from('stops').insert(stopsPayload);
    if (stopsErr) {
      // Rollback: borrar la ruta huérfana.
      await ctx.supabase.from('routes').delete().eq('id', route.id);
      return {
        ok: false,
        error: `No se pudieron insertar las paradas: ${stopsErr.message}`,
      };
    }

    return {
      ok: true,
      data: {
        route_id: route.id as string,
        name: route.name as string,
        stop_count: sequenceList.length,
        unmatched_codes: unmatched,
      },
      summary:
        `Ruta [${routeName}](/routes/${route.id}) creada con ${sequenceList.length} parada(s).` +
        (unmatched.length > 0
          ? ` No incluidas: ${unmatched.join(', ')} — el usuario debe revisarlas.`
          : ''),
    };
  },
};

// ============================================================================
// add_stop_to_route
// ============================================================================
interface AddStopArgs {
  route_id: string;
  store_code: string;
  position?: number;
}

const add_stop_to_route: ToolDefinition<AddStopArgs, { stop_id: string; sequence: number }> = {
  name: 'add_stop_to_route',
  description:
    'Agrega una parada (tienda) a una ruta existente en la posición indicada o al final. Re-numera secuencias si position interrumpe. Si la ruta está PUBLISHED/IN_PROGRESS, requiere confirmación porque afecta operación en curso.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      route_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID de la ruta destino.',
      },
      store_code: {
        type: 'string',
        description: 'Código de la tienda (ej. TOL-1422). Debe existir en la misma zona de la ruta.',
      },
      position: {
        type: 'integer',
        description: 'Posición 1-based donde insertar. Si omites, va al final. Las paradas siguientes se re-enumeran +1.',
      },
    },
    required: ['route_id', 'store_code'],
  },
  handler: async (args, ctx): Promise<ToolResult<{ stop_id: string; sequence: number }>> => {
    if (!UUID_RE.test(args.route_id)) return badArg('route_id', 'UUID inválido.');
    const code = (args.store_code ?? '').toUpperCase().trim();
    if (!code) return badArg('store_code', 'requerido.');

    const { data: route } = await ctx.supabase
      .from('routes')
      .select('id, zone_id, status')
      .eq('id', args.route_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!route) return { ok: false, error: 'Ruta no encontrada.' };
    if (['CANCELLED', 'COMPLETED', 'INTERRUPTED'].includes(route.status as string)) {
      return { ok: false, error: `Ruta en estado ${route.status} no acepta paradas nuevas.` };
    }

    const { data: store } = await ctx.supabase
      .from('stores')
      .select('id, code, zone_id, is_active')
      .eq('code', code)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!store) return { ok: false, error: `Tienda "${code}" no encontrada.` };
    if (!store.is_active) return { ok: false, error: `Tienda "${code}" no está activa.` };
    if (store.zone_id !== route.zone_id) {
      return { ok: false, error: `Tienda "${code}" no pertenece a la zona de la ruta.` };
    }

    // Existing stops para resolver position.
    const { data: existing } = await ctx.supabase
      .from('stops')
      .select('id, sequence')
      .eq('route_id', args.route_id)
      .order('sequence', { ascending: true });

    const currentMax = (existing ?? []).reduce(
      (max, s) => Math.max(max, s.sequence as number),
      0,
    );
    const insertAt =
      args.position !== undefined && args.position > 0 && args.position <= currentMax + 1
        ? args.position
        : currentMax + 1;

    // Si insertAt no es el final, hay que correr las secuencias.
    // Estrategia: 2 pasos — primero a negativos temporales (para evitar
    // UNIQUE clash), después a finales.
    if (insertAt <= currentMax) {
      const toShift = (existing ?? []).filter((s) => (s.sequence as number) >= insertAt);
      for (const s of toShift) {
        await ctx.supabase
          .from('stops')
          .update({ sequence: -((s.sequence as number) + 1) })
          .eq('id', s.id);
      }
      for (const s of toShift) {
        await ctx.supabase
          .from('stops')
          .update({ sequence: (s.sequence as number) + 1 })
          .eq('id', s.id);
      }
    }

    const { data: newStop, error: insErr } = await ctx.supabase
      .from('stops')
      .insert({
        route_id: args.route_id,
        store_id: store.id,
        sequence: insertAt,
        status: 'pending' as const,
      })
      .select('id, sequence')
      .single();

    if (insErr || !newStop) {
      return { ok: false, error: `No se pudo agregar la parada: ${insErr?.message ?? 'desconocido'}` };
    }

    return {
      ok: true,
      data: { stop_id: newStop.id as string, sequence: newStop.sequence as number },
      summary: `Tienda ${code} agregada como parada #${newStop.sequence} en la [ruta](/routes/${args.route_id}).`,
    };
  },
};

// ============================================================================
// move_stop
// ============================================================================
interface MoveStopArgs {
  route_id: string;
  from_sequence: number;
  to_sequence: number;
}

const move_stop: ToolDefinition<MoveStopArgs, { stops_renumbered: number }> = {
  name: 'move_stop',
  description:
    'Cambia el orden de una parada dentro de su ruta. Re-numera las secuencias entre from y to. No requiere confirmación: las paradas siguen siendo las mismas, solo cambia el orden.',
  is_write: true,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      route_id: { type: 'string', format: 'uuid', description: 'UUID de la ruta.' },
      from_sequence: {
        type: 'integer',
        description: 'Posición actual (1-based) de la parada a mover.',
      },
      to_sequence: {
        type: 'integer',
        description: 'Nueva posición (1-based).',
      },
    },
    required: ['route_id', 'from_sequence', 'to_sequence'],
  },
  handler: async (args, ctx): Promise<ToolResult<{ stops_renumbered: number }>> => {
    if (!UUID_RE.test(args.route_id)) return badArg('route_id', 'UUID inválido.');
    if (args.from_sequence < 1 || args.to_sequence < 1) {
      return badArg('sequence', 'debe ser >= 1.');
    }
    if (args.from_sequence === args.to_sequence) {
      return { ok: true, data: { stops_renumbered: 0 }, summary: 'Sin cambios — mismo orden.' };
    }

    const { data: route } = await ctx.supabase
      .from('routes')
      .select('id, status')
      .eq('id', args.route_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!route) return { ok: false, error: 'Ruta no encontrada.' };
    if (['CANCELLED', 'COMPLETED', 'INTERRUPTED'].includes(route.status as string)) {
      return { ok: false, error: `Ruta en estado ${route.status} no acepta reorden.` };
    }

    const { data: stops } = await ctx.supabase
      .from('stops')
      .select('id, sequence, status')
      .eq('route_id', args.route_id)
      .order('sequence', { ascending: true });

    if (!stops || stops.length === 0) return { ok: false, error: 'Ruta sin paradas.' };

    const target = stops.find((s) => s.sequence === args.from_sequence);
    if (!target) return { ok: false, error: `No hay parada en posición ${args.from_sequence}.` };
    if (target.status !== 'pending') {
      return { ok: false, error: 'Solo paradas pendientes se pueden mover.' };
    }
    if (args.to_sequence > stops.length) {
      return badArg('to_sequence', `máx ${stops.length} (paradas totales).`);
    }

    // Rebuilds completos: armar lista nueva, ejecutar 2-pass UPDATE.
    const reordered = [...stops];
    const [moved] = reordered.splice(args.from_sequence - 1, 1);
    reordered.splice(args.to_sequence - 1, 0, moved!);

    // 1ª pasada: negativos temporales.
    for (let i = 0; i < reordered.length; i++) {
      await ctx.supabase
        .from('stops')
        .update({ sequence: -(i + 1) })
        .eq('id', reordered[i]!.id);
    }
    // 2ª pasada: secuencias finales.
    for (let i = 0; i < reordered.length; i++) {
      await ctx.supabase
        .from('stops')
        .update({ sequence: i + 1 })
        .eq('id', reordered[i]!.id);
    }

    return {
      ok: true,
      data: { stops_renumbered: reordered.length },
      summary: `Parada movida de #${args.from_sequence} a #${args.to_sequence} en la [ruta](/routes/${args.route_id}). ${reordered.length} secuencia(s) re-enumeradas.`,
    };
  },
};

// ============================================================================
// remove_stop
// ============================================================================
interface RemoveStopArgs {
  stop_id: string;
}

const remove_stop: ToolDefinition<RemoveStopArgs, { route_id: string; removed_sequence: number }> = {
  name: 'remove_stop',
  description:
    'Elimina una parada de su ruta. Re-numera las siguientes para que no queden huecos. Destructiva: requiere confirmación. Solo paradas pending pueden eliminarse — las arrived/completed/skipped quedan en historia.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      stop_id: { type: 'string', format: 'uuid', description: 'UUID de la parada.' },
    },
    required: ['stop_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<{ route_id: string; removed_sequence: number }>> => {
    if (!UUID_RE.test(args.stop_id)) return badArg('stop_id', 'UUID inválido.');

    const { data: stop } = await ctx.supabase
      .from('stops')
      .select('id, route_id, sequence, status')
      .eq('id', args.stop_id)
      .maybeSingle();
    if (!stop) return { ok: false, error: 'Parada no encontrada.' };
    if (stop.status !== 'pending') {
      return { ok: false, error: `Solo paradas pending se pueden eliminar (actual: ${stop.status}).` };
    }

    // Validar ownership via route.customer_id.
    const { data: route } = await ctx.supabase
      .from('routes')
      .select('id, customer_id, status')
      .eq('id', stop.route_id)
      .maybeSingle();
    if (!route || route.customer_id !== ctx.customerId) {
      return { ok: false, error: 'Parada no pertenece a tu organización.' };
    }
    if (['CANCELLED', 'COMPLETED', 'INTERRUPTED'].includes(route.status as string)) {
      return { ok: false, error: `Ruta en estado ${route.status} no acepta cambios.` };
    }

    const removedSeq = stop.sequence as number;
    const { error: delErr } = await ctx.supabase.from('stops').delete().eq('id', args.stop_id);
    if (delErr) return { ok: false, error: `No se pudo eliminar: ${delErr.message}` };

    // Re-numerar siguientes (sequence > removedSeq → sequence - 1) en 2 pasos.
    const { data: following } = await ctx.supabase
      .from('stops')
      .select('id, sequence')
      .eq('route_id', stop.route_id)
      .gt('sequence', removedSeq)
      .order('sequence', { ascending: true });

    for (const s of following ?? []) {
      await ctx.supabase
        .from('stops')
        .update({ sequence: -(s.sequence as number) })
        .eq('id', s.id);
    }
    for (const s of following ?? []) {
      await ctx.supabase
        .from('stops')
        .update({ sequence: (s.sequence as number) - 1 })
        .eq('id', s.id);
    }

    return {
      ok: true,
      data: { route_id: stop.route_id as string, removed_sequence: removedSeq },
      summary: `Parada eliminada (era #${removedSeq}) de la [ruta](/routes/${stop.route_id}). ${following?.length ?? 0} parada(s) re-enumeradas.`,
    };
  },
};

// ============================================================================
// publish_dispatch
// ============================================================================
interface PublishDispatchArgs {
  dispatch_id: string;
}

interface PublishResult {
  routes_published: number;
  drivers_assigned: number;
  total_stops: number;
}

const publish_dispatch: ToolDefinition<PublishDispatchArgs, PublishResult> = {
  name: 'publish_dispatch',
  description:
    'Publica un tiro: cambia status a "dispatched" y todas sus rutas pasan a PUBLISHED (los choferes asignados las ven en su app y reciben push). Requiere que cada ruta tenga chofer asignado y al menos 1 parada. ALTO IMPACTO — requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: { type: 'string', format: 'uuid', description: 'UUID del tiro.' },
    },
    required: ['dispatch_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<PublishResult>> => {
    if (!UUID_RE.test(args.dispatch_id)) return badArg('dispatch_id', 'UUID inválido.');

    const { data: dispatch } = await ctx.supabase
      .from('dispatches')
      .select('id, status, date')
      .eq('id', args.dispatch_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!dispatch) return { ok: false, error: 'Tiro no encontrado.' };
    if (dispatch.status !== 'planning') {
      return { ok: false, error: `Tiro no está en planning (actual: ${dispatch.status}).` };
    }

    const { data: routes } = await ctx.supabase
      .from('routes')
      .select('id, name, driver_id, status')
      .eq('customer_id', ctx.customerId)
      .eq('dispatch_id', args.dispatch_id);

    if (!routes || routes.length === 0) {
      return { ok: false, error: 'El tiro no tiene rutas — agrega al menos una antes de publicar.' };
    }

    const missingDriver = routes.filter((r) => !r.driver_id);
    if (missingDriver.length > 0) {
      return {
        ok: false,
        error: `Hay ${missingDriver.length} ruta(s) sin chofer asignado: ${missingDriver.map((r) => r.name).join(', ')}. Asígnalos antes de publicar.`,
      };
    }

    const routeIds = routes.map((r) => r.id as string);
    const { data: stopsCount } = await ctx.supabase
      .from('stops')
      .select('route_id')
      .in('route_id', routeIds);
    const stopsByRoute = new Map<string, number>();
    for (const s of stopsCount ?? []) {
      stopsByRoute.set(s.route_id as string, (stopsByRoute.get(s.route_id as string) ?? 0) + 1);
    }
    const emptyRoutes = routes.filter((r) => (stopsByRoute.get(r.id as string) ?? 0) === 0);
    if (emptyRoutes.length > 0) {
      return {
        ok: false,
        error: `Hay ${emptyRoutes.length} ruta(s) sin paradas: ${emptyRoutes.map((r) => r.name).join(', ')}.`,
      };
    }

    // Atomic-ish: actualizar routes + dispatch. Hacemos routes primero (más
    // rows que pueden fallar) y luego dispatch.
    const nowIso = new Date().toISOString();
    const { error: routesErr } = await ctx.supabase
      .from('routes')
      .update({
        status: 'PUBLISHED',
        published_at: nowIso,
        published_by: ctx.userId,
        updated_at: nowIso,
      })
      .in('id', routeIds);
    if (routesErr) return { ok: false, error: `Falló al publicar rutas: ${routesErr.message}` };

    const { error: dispErr } = await ctx.supabase
      .from('dispatches')
      .update({ status: 'dispatched', updated_at: nowIso })
      .eq('id', args.dispatch_id);
    if (dispErr) {
      return { ok: false, error: `Rutas publicadas pero dispatch falló: ${dispErr.message}` };
    }

    const totalStops = Array.from(stopsByRoute.values()).reduce((sum, n) => sum + n, 0);

    return {
      ok: true,
      data: {
        routes_published: routes.length,
        drivers_assigned: routes.length,
        total_stops: totalStops,
      },
      summary: `[Tiro](/dispatches/${args.dispatch_id}) publicado: ${routes.length} ruta(s), ${totalStops} parada(s). Los choferes verán las rutas en su app.`,
    };
  },
};

// ============================================================================
// cancel_dispatch
// ============================================================================
interface CancelDispatchArgs {
  dispatch_id: string;
  reason?: string;
}

const cancel_dispatch: ToolDefinition<CancelDispatchArgs, { routes_cancelled: number }> = {
  name: 'cancel_dispatch',
  description:
    'Cancela un tiro y todas sus rutas asociadas (CANCELLED). Destructivo — requiere confirmación. Las rutas que ya estaban PUBLISHED/IN_PROGRESS quedan también canceladas; el chofer las verá desaparecer.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: { type: 'string', format: 'uuid', description: 'UUID del tiro.' },
      reason: { type: 'string', description: 'Motivo (opcional, se agrega a notes).' },
    },
    required: ['dispatch_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<{ routes_cancelled: number }>> => {
    if (!UUID_RE.test(args.dispatch_id)) return badArg('dispatch_id', 'UUID inválido.');

    const { data: dispatch } = await ctx.supabase
      .from('dispatches')
      .select('id, status, notes')
      .eq('id', args.dispatch_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!dispatch) return { ok: false, error: 'Tiro no encontrado.' };
    if (dispatch.status === 'cancelled' || dispatch.status === 'completed') {
      return { ok: false, error: `Tiro ya está ${dispatch.status}.` };
    }

    const nowIso = new Date().toISOString();
    const newNotes =
      args.reason && args.reason.trim()
        ? `${dispatch.notes ?? ''}\n[CANCELADO ${nowIso}] ${args.reason.trim()}`.trim()
        : dispatch.notes;

    // Cancelar rutas asociadas (las que no están CANCELLED/COMPLETED ya).
    const { data: routes } = await ctx.supabase
      .from('routes')
      .select('id, status')
      .eq('customer_id', ctx.customerId)
      .eq('dispatch_id', args.dispatch_id)
      .not('status', 'in', '(CANCELLED,COMPLETED)');

    const routeIds = (routes ?? []).map((r) => r.id as string);
    if (routeIds.length > 0) {
      await ctx.supabase
        .from('routes')
        .update({ status: 'CANCELLED', updated_at: nowIso })
        .in('id', routeIds);
    }

    const { error: dispErr } = await ctx.supabase
      .from('dispatches')
      .update({ status: 'cancelled', notes: newNotes, updated_at: nowIso })
      .eq('id', args.dispatch_id);
    if (dispErr) return { ok: false, error: `Falló al cancelar: ${dispErr.message}` };

    return {
      ok: true,
      data: { routes_cancelled: routeIds.length },
      summary: `[Tiro](/dispatches/${args.dispatch_id}) cancelado. ${routeIds.length} ruta(s) afectada(s).`,
    };
  },
};

// ============================================================================
// reassign_driver
// ============================================================================
interface ReassignDriverArgs {
  route_id: string;
  new_driver_id: string;
}

const reassign_driver: ToolDefinition<ReassignDriverArgs, { route_id: string; previous_driver_id: string | null; new_driver_id: string }> = {
  name: 'reassign_driver',
  description:
    'Cambia el chofer asignado a una ruta. Si la ruta está PUBLISHED/IN_PROGRESS, el chofer anterior pierde acceso y el nuevo recibe push. Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      route_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID de la ruta a reasignar.',
      },
      new_driver_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del nuevo chofer. Resuélvelo con list_available_drivers.',
      },
    },
    required: ['route_id', 'new_driver_id'],
  },
  handler: async (
    args,
    ctx,
  ): Promise<
    ToolResult<{
      route_id: string;
      previous_driver_id: string | null;
      new_driver_id: string;
    }>
  > => {
    if (!UUID_RE.test(args.route_id)) return badArg('route_id', 'UUID inválido.');
    if (!UUID_RE.test(args.new_driver_id)) return badArg('new_driver_id', 'UUID inválido.');

    const { data: route } = await ctx.supabase
      .from('routes')
      .select('id, date, zone_id, status, driver_id')
      .eq('id', args.route_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!route) return { ok: false, error: 'Ruta no encontrada.' };
    if (['CANCELLED', 'COMPLETED', 'INTERRUPTED'].includes(route.status as string)) {
      return { ok: false, error: `Ruta en estado ${route.status} no acepta reasignación.` };
    }

    const { data: driver } = await ctx.supabase
      .from('drivers')
      .select('id, zone_id, is_active')
      .eq('id', args.new_driver_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!driver) return { ok: false, error: 'Chofer no encontrado.' };
    if (!driver.is_active) return { ok: false, error: 'Chofer no está activo.' };
    if (driver.zone_id !== route.zone_id) {
      return { ok: false, error: 'Chofer no pertenece a la misma zona de la ruta.' };
    }

    // Conflicto: ¿tiene otra ruta para esa fecha?
    const { data: conflict } = await ctx.supabase
      .from('routes')
      .select('id, name')
      .eq('customer_id', ctx.customerId)
      .eq('driver_id', args.new_driver_id)
      .eq('date', route.date)
      .in('status', ['DRAFT', 'OPTIMIZED', 'APPROVED', 'PUBLISHED', 'IN_PROGRESS'])
      .neq('id', args.route_id)
      .limit(1);
    if (conflict && conflict.length > 0) {
      return {
        ok: false,
        error: `El chofer ya tiene la ruta "${conflict[0]!.name}" para ${route.date}.`,
      };
    }

    const prev = route.driver_id as string | null;
    const { error: updErr } = await ctx.supabase
      .from('routes')
      .update({ driver_id: args.new_driver_id, updated_at: new Date().toISOString() })
      .eq('id', args.route_id);
    if (updErr) return { ok: false, error: `Falló al reasignar: ${updErr.message}` };

    return {
      ok: true,
      data: {
        route_id: args.route_id,
        previous_driver_id: prev,
        new_driver_id: args.new_driver_id,
      },
      summary: prev
        ? `Chofer cambiado en la [ruta](/routes/${args.route_id}). El anterior pierde acceso, el nuevo recibe la asignación.`
        : `Chofer asignado a la [ruta](/routes/${args.route_id}).`,
    };
  },
};

// ============================================================================
// Registry export
// ============================================================================
export const WRITE_TOOLS: ReadonlyArray<ToolDefinition> = [
  create_dispatch as unknown as ToolDefinition,
  add_route_to_dispatch as unknown as ToolDefinition,
  add_stop_to_route as unknown as ToolDefinition,
  move_stop as unknown as ToolDefinition,
  remove_stop as unknown as ToolDefinition,
  publish_dispatch as unknown as ToolDefinition,
  cancel_dispatch as unknown as ToolDefinition,
  reassign_driver as unknown as ToolDefinition,
];
