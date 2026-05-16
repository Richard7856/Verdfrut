'use server';

// Server actions del Workbench (ADR-112).
// - setWorkbenchModeAction(mode): cambia la cookie tripdrive-mode.
// - resetSandboxAction(): borra TODO lo is_sandbox=true del customer.

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { setMode, type WorkbenchMode } from '@/lib/workbench-mode';
import { logger } from '@tripdrive/observability';

interface ActionResult {
  ok: boolean;
  error?: string;
}

interface ResetSandboxResult extends ActionResult {
  deleted?: {
    dispatches: number;
    routes: number;
    stops: number;
    stores: number;
    vehicles: number;
    drivers: number;
  };
}

/**
 * Cambia el modo Workbench del caller. Persiste en cookie HTTP por 30 días.
 * Sin restricción de rol — admin Y dispatcher pueden alternar entre modos
 * (el modo es por-sesión, no cambia datos del customer).
 */
export async function setWorkbenchModeAction(mode: WorkbenchMode): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  if (mode !== 'real' && mode !== 'sandbox') {
    return { ok: false, error: 'Modo inválido.' };
  }
  await setMode(mode);
  // Revalidar todo el shell — listas filtradas por modo deben re-renderear.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Borra TODO lo sandbox del customer del caller. Operación destructiva pero
 * acotada a is_sandbox=true — la operación real está protegida por el
 * filtro. Orden de borrado respeta FK (stops → routes → dispatches → catálogo).
 *
 * Sin restricción a admin: cualquier dispatcher puede limpiar el sandbox.
 * El sandbox es compartido por customer, así que es trabajo colaborativo.
 */
export async function resetSandboxAction(): Promise<ResetSandboxResult> {
  const caller = await requireRole('admin', 'dispatcher');
  const admin = createServiceRoleClient();

  // Resolver customer_id del caller — admin del cliente, no super-admin.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('customer_id')
    .eq('id', caller.id)
    .maybeSingle();
  const customerId = (profile?.customer_id as string | undefined) ?? null;
  if (!customerId) {
    return { ok: false, error: 'No se pudo resolver el customer del caller.' };
  }

  // Orden de borrado: hijos primero para evitar violaciones de FK.
  //   stops → routes → dispatches (operacional)
  //   stores → vehicles → drivers (catálogo)
  // stops no tiene customer_id; los borramos vía route_id usando un subselect
  // y luego routes hace cascada si tuviera FK ON DELETE CASCADE — la mayoría
  // ya están definidas así, pero por defensa borramos explícito.
  const deleted = {
    dispatches: 0,
    routes: 0,
    stops: 0,
    stores: 0,
    vehicles: 0,
    drivers: 0,
  };

  try {
    // 1. Stops: vía route_id sandbox del customer.
    const { data: sandboxRoutes } = await admin
      .from('routes')
      .select('id')
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    const routeIds = (sandboxRoutes ?? []).map((r) => r.id as string);
    if (routeIds.length > 0) {
      const { count: c, error } = await admin
        .from('stops')
        .delete({ count: 'exact' })
        .in('route_id', routeIds);
      if (error) throw error;
      deleted.stops = c ?? 0;
    }

    // 2. Routes sandbox.
    const { count: cR, error: eR } = await admin
      .from('routes')
      .delete({ count: 'exact' })
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    if (eR) throw eR;
    deleted.routes = cR ?? 0;

    // 3. Dispatches sandbox.
    const { count: cD, error: eD } = await admin
      .from('dispatches')
      .delete({ count: 'exact' })
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    if (eD) throw eD;
    deleted.dispatches = cD ?? 0;

    // 4. Catálogo sandbox — tiendas, vehículos, choferes hipotéticos.
    const { count: cS, error: eS } = await admin
      .from('stores')
      .delete({ count: 'exact' })
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    if (eS) throw eS;
    deleted.stores = cS ?? 0;

    const { count: cV, error: eV } = await admin
      .from('vehicles')
      .delete({ count: 'exact' })
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    if (eV) throw eV;
    deleted.vehicles = cV ?? 0;

    const { count: cDr, error: eDr } = await admin
      .from('drivers')
      .delete({ count: 'exact' })
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    if (eDr) throw eDr;
    deleted.drivers = cDr ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logger.error('workbench.reset_sandbox.failed', {
      customer_id: customerId,
      err: msg,
    });
    return { ok: false, error: `Error al limpiar sandbox: ${msg}` };
  }

  logger.info('workbench.reset_sandbox.ok', {
    customer_id: customerId,
    triggered_by: caller.id,
    deleted,
  });
  revalidatePath('/', 'layout');
  return { ok: true, deleted };
}
