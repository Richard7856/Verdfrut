// /settings/workbench — administración del modo planeación (ADR-112).
//
// Acciones soportadas en WB-1 MVP:
//   • Toggle del modo (también accesible desde el topbar).
//   • Reset: borra TODO lo sandbox del customer.
//   • Stats: conteo actual de entidades sandbox.
//
// Acciones diferidas a WB-1b / fases siguientes:
//   • Promover sandbox → real (copia una dispatch sandbox a operación real).
//   • Seed from real (copia todo el catálogo real al sandbox para arrancar).

import { Card, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';
import { getCurrentMode } from '@/lib/workbench-mode';
import { WorkbenchManager } from './workbench-manager';

export const metadata = { title: 'Modo planeación · Workbench' };
export const dynamic = 'force-dynamic';

export default async function WorkbenchPage() {
  const caller = await requireRole('admin', 'dispatcher');
  const mode = await getCurrentMode();
  const supabase = await createServerClient();

  // Resolver customer_id del caller para acotar conteos.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('customer_id')
    .eq('id', caller.id)
    .maybeSingle();
  const customerId = (profile?.customer_id as string | undefined) ?? null;

  // Conteos de sandbox. Pasamos sandbox=true para forzar el filtro
  // independientemente del modo del request.
  let stats = {
    dispatches: 0,
    routes: 0,
    stops: 0,
    stores: 0,
    vehicles: 0,
    drivers: 0,
  };
  if (customerId) {
    const baseFilter = (table: string) =>
      supabase
        .from(table as never)
        .select('id', { count: 'exact', head: true })
        .eq('customer_id' as never, customerId)
        .eq('is_sandbox' as never, true);
    // stops no tiene customer_id — contamos via route_id sandbox.
    const [d, r, s, v, dr] = await Promise.all([
      baseFilter('dispatches'),
      baseFilter('routes'),
      baseFilter('stores'),
      baseFilter('vehicles'),
      baseFilter('drivers'),
    ]);
    const { data: sandboxRoutes } = await supabase
      .from('routes')
      .select('id')
      .eq('customer_id', customerId)
      .eq('is_sandbox', true);
    const routeIds = (sandboxRoutes ?? []).map((row) => row.id as string);
    let stopsCount = 0;
    if (routeIds.length > 0) {
      const { count } = await supabase
        .from('stops')
        .select('id', { count: 'exact', head: true })
        .in('route_id', routeIds);
      stopsCount = count ?? 0;
    }
    stats = {
      dispatches: d.count ?? 0,
      routes: r.count ?? 0,
      stops: stopsCount,
      stores: s.count ?? 0,
      vehicles: v.count ?? 0,
      drivers: dr.count ?? 0,
    };
  }
  const totalSandbox =
    stats.dispatches + stats.routes + stats.stops + stats.stores + stats.vehicles + stats.drivers;

  return (
    <>
      <PageHeader
        title="🧪 Modo planeación"
        description="Espacio paralelo para probar escenarios sin afectar la operación real. Compartido con todo tu equipo del cliente."
      />

      <Card className="mb-4">
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">¿Qué es?</p>
        <ul className="space-y-1.5 text-sm text-[var(--color-text-muted)]">
          <li>
            • <strong>Tiros y rutas hipotéticos</strong>: en modo planeación, lo que crees vive
            aislado. Tu chofer NO recibe nada de aquí.
          </li>
          <li>
            • <strong>Catálogo mezclado</strong>: ves tus tiendas, camionetas y choferes reales
            + cualquier hipotético que agregues (marcado 🧪).
          </li>
          <li>
            • <strong>Compartido por cliente</strong>: tus compañeros del mismo cliente ven los
            mismos escenarios — pueden colaborar y debatir antes de promover algo a operación.
          </li>
          <li>
            • <strong>Sin impacto en facturación</strong>: las camionetas/choferes hipotéticos
            no cuentan en tu Stripe.
          </li>
        </ul>
      </Card>

      <WorkbenchManager mode={mode} stats={stats} totalSandbox={totalSandbox} />
    </>
  );
}
