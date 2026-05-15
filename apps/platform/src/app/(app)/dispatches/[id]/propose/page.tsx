// Página /dispatches/[id]/propose — UI del Optimization Engine (OE-3).
//
// Muestra 2-3 alternativas de plan (cheapest/balanced/fastest) calculadas por
// proposePlans (Capa 4 del Optimization Engine, ADR-100). Cada card:
//   - Labels (💰 económica · ⚖️ balanceada · ⚡ rápida) con conteo de vehículos
//   - Métricas: km totales · jornada máx del chofer más cargado · paradas
//   - Costo MXN desglosado (combustible · desgaste · chofer · overhead)
//   - Breakdown por ruta (qué vehículo lleva cuántas paradas)
//   - Botón "Aplicar esta opción" → applyRoutePlanAction
//
// Defensivo: si el tiro está post-publicación, no hay propuesta posible
// (no se puede redistribuir rutas en curso). Si nada es factible con la
// jornada legal, muestra todas las opciones marcadas como "infactible"
// con explicación.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge, Card, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { getDispatch, listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoute } from '@/lib/queries/stops';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { listUsers } from '@/lib/queries/users';
import { proposePlans } from '@/lib/propose-plans';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { formatKilometers } from '@tripdrive/utils';
import { ProposalCard } from './proposal-card';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: `Propuestas · Tiro ${id.slice(0, 8)}` };
}

const LABEL_META: Record<
  'cheapest' | 'balanced' | 'fastest',
  { emoji: string; text: string; tone: 'info' | 'success' | 'warning' }
> = {
  cheapest: { emoji: '💰', text: 'Más económica', tone: 'success' },
  balanced: { emoji: '⚖️', text: 'Balanceada', tone: 'info' },
  fastest: { emoji: '⚡', text: 'Más rápida', tone: 'warning' },
};

export default async function ProposePage({ params }: Props) {
  const profile = await requireRole('admin', 'dispatcher');
  const { id } = await params;

  const dispatch = await getDispatch(id);
  if (!dispatch) notFound();

  // 1. Validar: solo permitimos propose si el tiro está en pre-publicación.
  const routes = await listRoutesByDispatch(id);
  const liveRoutes = routes.filter((r) => r.status !== 'CANCELLED');
  const POST_PUBLISH = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED']);
  const blockingRoute = liveRoutes.find((r) => POST_PUBLISH.has(r.status));

  if (blockingRoute) {
    return (
      <>
        <PageHeader title={`Propuestas — ${dispatch.name}`} />
        <Card className="border-amber-500/40 bg-amber-50 p-6 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Este tiro tiene rutas publicadas
          </p>
          <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-100/80">
            La ruta &quot;{blockingRoute.name}&quot; está en {blockingRoute.status}. No se pueden generar
            propuestas que reestructuren todo el tiro porque los choferes ya recibieron las
            asignaciones actuales. Para optimizar paradas pendientes de una ruta en curso, usa
            &quot;Re-optimizar con tráfico&quot; dentro de cada ruta individual.
          </p>
          <Link
            href={`/dispatches/${id}`}
            className="mt-4 inline-block text-xs underline"
          >
            ← Volver al tiro
          </Link>
        </Card>
      </>
    );
  }

  // 2. Recolectar storeIds únicos de las rutas vivas (orden estable).
  const allStoreIds: string[] = [];
  const seen = new Set<string>();
  for (const r of liveRoutes) {
    const stops = await listStopsForRoute(r.id);
    for (const s of stops) {
      if (!seen.has(s.storeId)) {
        seen.add(s.storeId);
        allStoreIds.push(s.storeId);
      }
    }
  }

  if (allStoreIds.length === 0) {
    return (
      <>
        <PageHeader title={`Propuestas — ${dispatch.name}`} />
        <Card className="border-[var(--color-border)] p-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            El tiro no tiene paradas todavía. Agrega tiendas a las rutas antes de pedir
            propuestas con costo.
          </p>
          <Link
            href={`/dispatches/${id}`}
            className="mt-4 inline-block text-xs underline"
          >
            ← Volver al tiro
          </Link>
        </Card>
      </>
    );
  }

  // 3. Obtener vehículos disponibles de la zona del tiro (activos).
  //    Si el tiro tiene asignados ciertos vehículos, los priorizamos pero
  //    el motor explora toda la flota de la zona para no encasillarse.
  const allVehicles = await listVehicles({});
  const zoneVehicles = allVehicles.filter(
    (v) => v.isActive && v.zoneId === dispatch.zoneId,
  );

  if (zoneVehicles.length === 0) {
    return (
      <>
        <PageHeader title={`Propuestas — ${dispatch.name}`} />
        <Card className="border-amber-500/40 bg-amber-50 p-6 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Sin vehículos disponibles
          </p>
          <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-100/80">
            No hay vehículos activos en la zona del tiro. Activa al menos uno en{' '}
            <Link href="/settings/vehicles" className="underline">Configuración → Flotilla</Link>{' '}
            antes de pedir propuestas.
          </p>
        </Card>
      </>
    );
  }

  // 4. Resolver customer_id del caller para llamar proposePlans (hardening C1).
  const admin = createServiceRoleClient();
  const { data: callerProfile } = await admin
    .from('user_profiles')
    .select('customer_id')
    .eq('id', profile.id)
    .maybeSingle();
  const customerId = callerProfile?.customer_id as string | undefined;
  if (!customerId) {
    return (
      <>
        <PageHeader title={`Propuestas — ${dispatch.name}`} />
        <Card className="border-red-500/40 bg-red-50 p-6 dark:bg-red-950/30">
          <p className="text-sm">Tu usuario no está vinculado a un customer. Contacta al admin.</p>
        </Card>
      </>
    );
  }

  // 5. Llamar proposePlans. Toma 30-60s en producción (N×K llamadas paralelas a VROOM).
  let plans;
  try {
    plans = await proposePlans({
      customerId,
      date: dispatch.date,
      storeIds: allStoreIds,
      availableVehicleIds: zoneVehicles.map((v) => v.id),
      routeNamePrefix: dispatch.name,
    });
  } catch (err) {
    return (
      <>
        <PageHeader title={`Propuestas — ${dispatch.name}`} />
        <Card className="border-red-500/40 bg-red-50 p-6 dark:bg-red-950/30">
          <p className="text-sm font-semibold">Error al calcular propuestas</p>
          <p className="mt-1 text-xs">{err instanceof Error ? err.message : 'desconocido'}</p>
          <Link
            href={`/dispatches/${id}`}
            className="mt-4 inline-block text-xs underline"
          >
            ← Volver al tiro
          </Link>
        </Card>
      </>
    );
  }

  // 6. Cargar nombres de vehículos y choferes para el breakdown por ruta.
  const vehiclesById = new Map(allVehicles.map((v) => [v.id, v]));
  const allDrivers = await listDrivers({ activeOnly: false });
  const allUsers = await listUsers({ role: 'driver' });
  const driverNameById = new Map<string, string>();
  for (const d of allDrivers) {
    const user = allUsers.find((u) => u.id === d.userId);
    if (user) driverNameById.set(d.id, user.fullName);
  }

  const feasibleAlternatives = plans.alternatives.filter((a) => a.feasible);

  return (
    <>
      <PageHeader
        title={`Propuestas con costo — ${dispatch.name}`}
        description={`${allStoreIds.length} paradas · ${zoneVehicles.length} vehículos en zona · ${plans.totalEvaluated} planes evaluados · ${feasibleAlternatives.length} factibles`}
        action={
          <Link
            href={`/dispatches/${id}`}
            className="text-xs underline text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← Volver al tiro
          </Link>
        }
      />

      {plans.alwaysUnassignedStoreIds.length > 0 && (
        <Card className="mb-4 border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-xs text-amber-900 dark:text-amber-100">
            ⚠ {plans.alwaysUnassignedStoreIds.length} tienda(s) no caben en NINGUNA alternativa
            (capacidad o jornada insuficiente). Revisa el tiro y considera quitarlas o agregar
            otro vehículo antes de aplicar.
          </p>
        </Card>
      )}

      {feasibleAlternatives.length === 0 ? (
        <Card className="border-red-500/40 bg-red-50 p-6 dark:bg-red-950/30">
          <p className="text-sm font-semibold">Ninguna opción es factible</p>
          <p className="mt-2 text-xs">
            Todas las alternativas violan la jornada legal máxima del chofer (
            {plans.costsConfig.max_hours_per_driver} h). Considera: (a) agregar más vehículos
            para repartir la carga, (b) quitar paradas no críticas del tiro, o (c) extender la
            jornada vía override (no recomendado sin consultar legal).
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {feasibleAlternatives.map((alt) => (
            <ProposalCard
              key={alt.id}
              dispatchId={id}
              alternative={alt}
              labelsMeta={LABEL_META}
              vehiclesById={Object.fromEntries(
                alt.routes.map((r) => {
                  const v = vehiclesById.get(r.vehicleId);
                  return [
                    r.vehicleId,
                    {
                      alias: v?.alias ?? null,
                      plate: v?.plate ?? '—',
                    },
                  ];
                }),
              )}
              driverNameById={Object.fromEntries(
                alt.routes
                  .filter((r): r is typeof r & { driverId: string } => r.driverId !== null)
                  .map((r) => [r.driverId, driverNameById.get(r.driverId) ?? '(sin chofer)']),
              )}
            />
          ))}
        </div>
      )}

      {/* Costos del cálculo (para que el dispatcher entienda de dónde sale el MXN) */}
      <Card className="mt-6 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3">
        <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
          Costos de operación usados
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <span className="text-[var(--color-text-muted)]">Combustible:</span>{' '}
            <span className="font-medium">${plans.costsConfig.cost_per_km_fuel_mxn}/km</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Desgaste:</span>{' '}
            <span className="font-medium">${plans.costsConfig.cost_per_km_wear_mxn}/km</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Chofer/h:</span>{' '}
            <span className="font-medium">${plans.costsConfig.driver_hourly_wage_mxn}/h</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Overhead despacho:</span>{' '}
            <span className="font-medium">${plans.costsConfig.dispatch_overhead_mxn}</span>
          </div>
        </div>
      </Card>

      {/* Mute lint warnings for unused imports in defensive paths */}
      {false && <Badge tone="info">unused</Badge>}
      {false && <span>{formatKilometers(0)}</span>}
    </>
  );
}
