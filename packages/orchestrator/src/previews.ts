// Previews enriquecidos para tools que requieren confirmación.
//
// El runner llama enrichPreviewForTool() antes de emitir
// confirmation_required. Cada tool destructiva tiene un enricher que
// consulta el estado actual + arma un resumen humano del impacto.
//
// Por qué importa: la UX del modal de confirmación define la confianza
// del operador en el agente. Un modal con JSON crudo se siente "demo"; un
// modal con "Publicar TOL-Mañana: 5 rutas, 23 paradas, 4 choferes
// recibirán push" se siente producto serio. Crítico para defender pricing.

import type { ToolContext } from './types';

export interface EnrichedPreview {
  /** Título corto en humano del impacto principal. */
  headline: string;
  /** 3-7 puntos descriptivos para que el operador entienda rápido. */
  bullets: string[];
  /** Advertencias visibles (ej. publicar dispara push a N choferes). */
  warnings: string[];
  /** Args originales para debug/audit. */
  args: Record<string, unknown>;
}

export async function enrichPreviewForTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  try {
    switch (toolName) {
      case 'publish_dispatch':
        return await enrichPublishDispatch(args, ctx);
      case 'cancel_dispatch':
        return await enrichCancelDispatch(args, ctx);
      case 'reassign_driver':
        return await enrichReassignDriver(args, ctx);
      case 'add_route_to_dispatch':
        return await enrichAddRoute(args, ctx);
      case 'add_stop_to_route':
        return await enrichAddStop(args, ctx);
      case 'remove_stop':
        return await enrichRemoveStop(args, ctx);
      case 'bulk_create_stores':
        return await enrichBulkCreateStores(args);
      case 'create_store':
        return await enrichCreateStore(args, ctx);
      case 'optimize_dispatch':
        return await enrichOptimizeDispatch(args, ctx);
      default:
        return fallbackPreview(toolName, args);
    }
  } catch (err) {
    // Si el enricher falla, no rompemos el flow — usamos fallback.
    return {
      ...fallbackPreview(toolName, args),
      warnings: [
        `No se pudo cargar contexto enriquecido: ${err instanceof Error ? err.message : 'error'}.`,
      ],
    };
  }
}

function fallbackPreview(toolName: string, args: Record<string, unknown>): EnrichedPreview {
  return {
    headline: `Ejecutar ${toolName}`,
    bullets: Object.entries(args)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}: ${formatVal(v)}`),
    warnings: [],
    args,
  };
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '…' : v;
  if (Array.isArray(v)) return `[${v.length} elementos]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

// ============================================================================
// publish_dispatch
// ============================================================================
async function enrichPublishDispatch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const dispatchId = String(args.dispatch_id ?? '');
  const { data: dispatch } = await ctx.supabase
    .from('dispatches')
    .select('name, date, zones:zone_id ( name )')
    .eq('id', dispatchId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  const dispatchData = dispatch as unknown as {
    name: string;
    date: string;
    zones: { name: string } | null;
  } | null;

  if (!dispatchData) {
    return {
      headline: 'Publicar tiro',
      bullets: [`Tiro ID: ${dispatchId} (no se pudo cargar nombre).`],
      warnings: ['ID no encontrado — la operación probablemente fallará.'],
      args,
    };
  }

  const { data: routes } = await ctx.supabase
    .from('routes')
    .select(`
      id, name, driver_id,
      drivers:driver_id ( user_profiles:user_id ( full_name ) )
    `)
    .eq('customer_id', ctx.customerId)
    .eq('dispatch_id', dispatchId);

  const routesData = (routes ?? []) as unknown as Array<{
    id: string;
    name: string;
    driver_id: string | null;
    drivers: { user_profiles: { full_name: string } | null } | null;
  }>;

  const routeIds = routesData.map((r) => r.id);
  const { count: stopsCount } = await ctx.supabase
    .from('stops')
    .select('id', { count: 'exact', head: true })
    .in('route_id', routeIds);

  const driversAssigned = routesData.filter((r) => r.driver_id !== null);
  const missingDrivers = routesData.filter((r) => r.driver_id === null);
  const driverNames = driversAssigned
    .map((r) => r.drivers?.user_profiles?.full_name ?? '(sin nombre)')
    .filter((n, i, arr) => arr.indexOf(n) === i);

  const warnings: string[] = [];
  if (missingDrivers.length > 0) {
    warnings.push(
      `⚠ ${missingDrivers.length} ruta(s) sin chofer: ${missingDrivers.map((r) => r.name).join(', ')}. La publicación fallará.`,
    );
  }
  warnings.push(
    `🔔 Los ${driversAssigned.length} chofer(es) recibirán push notification al publicar.`,
  );

  return {
    headline: `Publicar "${dispatchData.name}" (${dispatchData.date})`,
    bullets: [
      `Zona: ${dispatchData.zones?.name ?? '—'}`,
      `${routesData.length} ruta(s): ${routesData.map((r) => r.name).join(', ')}`,
      `Total paradas: ${stopsCount ?? 0}`,
      `Choferes asignados: ${driverNames.join(', ') || 'ninguno'}`,
    ],
    warnings,
    args,
  };
}

// ============================================================================
// cancel_dispatch
// ============================================================================
async function enrichCancelDispatch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const dispatchId = String(args.dispatch_id ?? '');
  const reason = String(args.reason ?? '');

  const { data: dispatch } = await ctx.supabase
    .from('dispatches')
    .select('name, date, status')
    .eq('id', dispatchId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  const { data: routes } = await ctx.supabase
    .from('routes')
    .select('id, name, status')
    .eq('customer_id', ctx.customerId)
    .eq('dispatch_id', dispatchId)
    .not('status', 'in', '(CANCELLED,COMPLETED)');

  const active = (routes ?? []) as Array<{ id: string; name: string; status: string }>;
  const liveRoutes = active.filter((r) => r.status === 'PUBLISHED' || r.status === 'IN_PROGRESS');

  const warnings: string[] = [];
  if (liveRoutes.length > 0) {
    warnings.push(
      `🚨 ${liveRoutes.length} ruta(s) ya publicadas/en curso: ${liveRoutes.map((r) => r.name).join(', ')}. Los choferes las verán desaparecer.`,
    );
  }

  return {
    headline: `Cancelar "${(dispatch as { name?: string } | null)?.name ?? dispatchId}"`,
    bullets: [
      `Estado actual: ${(dispatch as { status?: string } | null)?.status ?? '—'}`,
      `Rutas afectadas: ${active.length}`,
      reason ? `Motivo: ${reason}` : 'Sin motivo registrado.',
    ],
    warnings,
    args,
  };
}

// ============================================================================
// reassign_driver
// ============================================================================
async function enrichReassignDriver(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const routeId = String(args.route_id ?? '');
  const newDriverId = String(args.new_driver_id ?? '');

  const { data: route } = await ctx.supabase
    .from('routes')
    .select(`
      name, status, date,
      drivers:driver_id ( user_profiles:user_id ( full_name ) )
    `)
    .eq('id', routeId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  const { data: newDriver } = await ctx.supabase
    .from('drivers')
    .select('user_profiles:user_id ( full_name )')
    .eq('id', newDriverId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  const routeData = route as unknown as {
    name: string;
    status: string;
    date: string;
    drivers: { user_profiles: { full_name: string } | null } | null;
  } | null;
  const newDriverData = newDriver as unknown as {
    user_profiles: { full_name: string } | null;
  } | null;

  const oldName = routeData?.drivers?.user_profiles?.full_name ?? '(sin asignar)';
  const newName = newDriverData?.user_profiles?.full_name ?? '(desconocido)';
  const isLive = routeData?.status === 'PUBLISHED' || routeData?.status === 'IN_PROGRESS';

  const warnings: string[] = [];
  if (isLive) {
    warnings.push(
      `🚨 La ruta está ${routeData?.status} — el chofer anterior pierde acceso inmediato y el nuevo recibe push.`,
    );
  }

  return {
    headline: `Reasignar chofer de "${routeData?.name ?? routeId}"`,
    bullets: [
      `Chofer anterior: ${oldName}`,
      `Chofer nuevo: ${newName}`,
      `Fecha de ruta: ${routeData?.date ?? '—'}`,
      `Estado: ${routeData?.status ?? '—'}`,
    ],
    warnings,
    args,
  };
}

// ============================================================================
// add_route_to_dispatch
// ============================================================================
async function enrichAddRoute(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const dispatchId = String(args.dispatch_id ?? '');
  const vehicleId = String(args.vehicle_id ?? '');
  const driverId = args.driver_id ? String(args.driver_id) : null;
  const codes = Array.isArray(args.store_codes) ? (args.store_codes as string[]) : [];

  const [dispatchQ, vehicleQ, driverQ] = await Promise.all([
    ctx.supabase
      .from('dispatches')
      .select('name, date, zones:zone_id ( name )')
      .eq('id', dispatchId)
      .eq('customer_id', ctx.customerId)
      .maybeSingle(),
    ctx.supabase
      .from('vehicles')
      .select('plate, alias')
      .eq('id', vehicleId)
      .eq('customer_id', ctx.customerId)
      .maybeSingle(),
    driverId
      ? ctx.supabase
          .from('drivers')
          .select('user_profiles:user_id ( full_name )')
          .eq('id', driverId)
          .eq('customer_id', ctx.customerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const dispatchData = dispatchQ.data as unknown as {
    name: string;
    date: string;
    zones: { name: string } | null;
  } | null;
  const vehicleData = vehicleQ.data as unknown as { plate: string; alias: string | null } | null;
  const driverData = driverQ.data as unknown as {
    user_profiles: { full_name: string } | null;
  } | null;

  return {
    headline: `Agregar ruta a "${dispatchData?.name ?? dispatchId}"`,
    bullets: [
      `Tiro: ${dispatchData?.name} (${dispatchData?.date}) · Zona ${dispatchData?.zones?.name ?? '—'}`,
      `Vehículo: ${vehicleData?.plate ?? vehicleId}${vehicleData?.alias ? ` (${vehicleData.alias})` : ''}`,
      `Chofer: ${driverData?.user_profiles?.full_name ?? '(sin asignar)'}`,
      `Paradas: ${codes.length} tienda(s) → ${codes.slice(0, 5).join(', ')}${codes.length > 5 ? '…' : ''}`,
    ],
    warnings: codes.length === 0 ? ['⚠ Sin tiendas — la ruta quedará vacía.'] : [],
    args,
  };
}

// ============================================================================
// add_stop_to_route
// ============================================================================
async function enrichAddStop(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const routeId = String(args.route_id ?? '');
  const storeCode = String(args.store_code ?? '');
  const position = args.position;

  const { data: route } = await ctx.supabase
    .from('routes')
    .select('name, status')
    .eq('id', routeId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  const isLive =
    (route as { status?: string } | null)?.status === 'PUBLISHED' ||
    (route as { status?: string } | null)?.status === 'IN_PROGRESS';

  return {
    headline: `Agregar parada "${storeCode}" a "${(route as { name?: string } | null)?.name ?? routeId}"`,
    bullets: [
      `Tienda: ${storeCode}`,
      `Posición: ${position ? `#${position}` : 'al final'}`,
      `Estado de ruta: ${(route as { status?: string } | null)?.status ?? '—'}`,
    ],
    warnings: isLive
      ? ['🚨 La ruta está en curso — el chofer verá la nueva parada al recargar.']
      : [],
    args,
  };
}

// ============================================================================
// remove_stop
// ============================================================================
async function enrichRemoveStop(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const stopId = String(args.stop_id ?? '');

  const { data: stop } = await ctx.supabase
    .from('stops')
    .select(`
      sequence, status,
      stores:store_id ( code, name ),
      routes:route_id ( name, status )
    `)
    .eq('id', stopId)
    .maybeSingle();

  const stopData = stop as unknown as {
    sequence: number;
    status: string;
    stores: { code: string; name: string } | null;
    routes: { name: string; status: string } | null;
  } | null;

  return {
    headline: `Eliminar parada #${stopData?.sequence ?? '?'} (${stopData?.stores?.code ?? stopId})`,
    bullets: [
      `Tienda: ${stopData?.stores?.name ?? '—'} (${stopData?.stores?.code ?? '—'})`,
      `Ruta: ${stopData?.routes?.name ?? '—'}`,
      `Estado de parada: ${stopData?.status ?? '—'}`,
    ],
    warnings:
      stopData?.routes?.status === 'IN_PROGRESS'
        ? ['🚨 La ruta está en curso — las paradas siguientes se re-enumerarán.']
        : [],
    args,
  };
}

// ============================================================================
// bulk_create_stores
// ============================================================================
async function enrichBulkCreateStores(
  args: Record<string, unknown>,
): Promise<EnrichedPreview> {
  const stores = Array.isArray(args.stores) ? (args.stores as Array<Record<string, unknown>>) : [];
  const dryRun = args.dry_run === true;

  const sample = stores.slice(0, 5).map((s) => `${s.code} - ${s.name}`);

  return {
    headline: `Crear ${stores.length} tienda(s) en bulk`,
    bullets: [
      `Total a crear: ${stores.length}`,
      `Modo: ${dryRun ? 'DRY-RUN (preview, no escribe)' : 'COMMIT (escribe en BD)'}`,
      sample.length > 0 ? `Primeras 5: ${sample.join(' · ')}` : 'Sin tiendas.',
    ],
    warnings: dryRun
      ? []
      : [
          '⚠ Modo COMMIT — las tiendas se crearán permanentemente. Considera dry_run=true primero.',
        ],
    args,
  };
}

// ============================================================================
// optimize_dispatch
// ============================================================================
async function enrichOptimizeDispatch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const dispatchId = String(args.dispatch_id ?? '');
  const apply = args.apply === true;
  const vehicleIds = Array.isArray(args.vehicle_ids)
    ? (args.vehicle_ids as string[])
    : [];

  const { data: dispatch } = await ctx.supabase
    .from('dispatches')
    .select('name, date, status, zones:zone_id ( name )')
    .eq('id', dispatchId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  const dispatchData = dispatch as unknown as {
    name: string;
    date: string;
    status: string;
    zones: { name: string } | null;
  } | null;

  const { data: routes } = await ctx.supabase
    .from('routes')
    .select('id, name, status, total_distance_meters, total_duration_seconds')
    .eq('customer_id', ctx.customerId)
    .eq('dispatch_id', dispatchId)
    .not('status', 'in', '(CANCELLED)');

  const routesData = (routes ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    total_distance_meters: number | null;
    total_duration_seconds: number | null;
  }>;

  const routeIds = routesData.map((r) => r.id);
  const { count: stopsCount } = await ctx.supabase
    .from('stops')
    .select('id', { count: 'exact', head: true })
    .in('route_id', routeIds);

  const totalKm = (
    routesData.reduce((s, r) => s + (r.total_distance_meters ?? 0), 0) / 1000
  ).toFixed(1);
  const totalMin = Math.round(
    routesData.reduce((s, r) => s + (r.total_duration_seconds ?? 0), 0) / 60,
  );

  const warnings: string[] = [];
  const liveStatuses = routesData.filter((r) =>
    ['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED'].includes(r.status),
  );
  if (liveStatuses.length > 0) {
    warnings.push(
      `🚨 ${liveStatuses.length} ruta(s) ya publicadas/en curso (${liveStatuses.map((r) => r.name).join(', ')}). No se puede optimizar — cancélalas primero.`,
    );
  }
  if (apply) {
    warnings.push(
      `⚠ apply=true: las ${routesData.length} ruta(s) actuales se CANCELARÁN y se crearán nuevas con el plan optimizado. Operación atómica.`,
    );
  } else {
    warnings.push(
      `ℹ️ apply=false (dry-run): solo se calculará el plan, no se aplicará. El operador puede aprobar después con apply=true.`,
    );
  }

  return {
    headline: apply
      ? `Re-rutear "${dispatchData?.name ?? dispatchId}" (${dispatchData?.date ?? '—'}) — APLICAR`
      : `Calcular plan optimizado para "${dispatchData?.name ?? dispatchId}" — DRY-RUN`,
    bullets: [
      `Zona: ${dispatchData?.zones?.name ?? '—'}`,
      `Estado actual del tiro: ${dispatchData?.status ?? '—'}`,
      `Plan actual: ${routesData.length} ruta(s), ${stopsCount ?? 0} parada(s).`,
      `Métricas actuales: ${totalKm} km · ${totalMin} min totales.`,
      vehicleIds.length > 0
        ? `Vehículos especificados: ${vehicleIds.length}`
        : 'Vehículos: los mismos del tiro actual.',
    ],
    warnings,
    args,
  };
}

// ============================================================================
// create_store
// ============================================================================
async function enrichCreateStore(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EnrichedPreview> {
  const zoneId = String(args.zone_id ?? '');
  const { data: zone } = await ctx.supabase
    .from('zones')
    .select('name')
    .eq('id', zoneId)
    .eq('customer_id', ctx.customerId)
    .maybeSingle();

  return {
    headline: `Crear tienda "${args.code}"`,
    bullets: [
      `Nombre: ${args.name}`,
      `Dirección: ${args.address}`,
      `Zona: ${(zone as { name?: string } | null)?.name ?? '—'}`,
      `Coords: ${args.lat}, ${args.lng}`,
    ],
    warnings: [],
    args,
  };
}
