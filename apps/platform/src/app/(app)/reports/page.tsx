// Reportes operativos — Sprint H5 / ADR-055.
// Vista enfocada en métricas de operación día a día (vs /dashboard que es
// comercial). Filtros por rango de fechas + zona; KPIs: rutas por status,
// cumplimiento, distancia, paradas pendientes vs completadas.
//
// Cuando llegue el cliente a pedir números específicos, este page se extiende
// con drill-downs y más filtros. La meta H5 es ya no ser stub.

import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { createServerClient } from '@tripdrive/supabase/server';
import { todayInZone } from '@tripdrive/utils';
import type { RouteStatus } from '@tripdrive/types';

export const metadata = { title: 'Reportes' };
export const dynamic = 'force-dynamic';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

interface SearchParams {
  from?: string;  // YYYY-MM-DD
  to?: string;
  zone?: string;
  /** UXR-3 drill-down: ?manual=1 expande la lista de rutas con optimization_skipped=true. */
  manual?: string;
}

interface PageProps {
  searchParams: Promise<SearchParams>;
}

function defaultRange(): { from: string; to: string } {
  const today = todayInZone(TZ);
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 30);
  const from = d.toISOString().slice(0, 10);
  return { from, to: today };
}

export default async function ReportsPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  const params = await searchParams;
  const defaults = defaultRange();
  const from = params.from ?? defaults.from;
  const to = params.to ?? defaults.to;
  const zoneFilter = params.zone ?? '';

  const zones = await listZones();
  const supabase = await createServerClient();

  // Rutas en el rango. Query manual porque listRoutes() acepta UNA fecha; acá
  // queremos un rango con gte/lte. Limit 2000 — para tenants con más, paginar.
  let q = supabase
    .from('routes')
    .select(
      'id, name, date, status, total_distance_meters, total_duration_seconds, zone_id, vehicle_id, optimization_skipped',
      { count: 'exact' },
    )
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .limit(2000);
  if (zoneFilter) q = q.eq('zone_id', zoneFilter);

  const { data: routesRows, error: routesErr } = await q;
  if (routesErr) {
    return (
      <>
        <PageHeader title="Reportes" />
        <Card className="border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]">
          <p className="text-sm" style={{ color: 'var(--color-danger-fg)' }}>
            Error cargando rutas: {routesErr.message}
          </p>
        </Card>
      </>
    );
  }

  const routes = (routesRows ?? []) as Array<{
    id: string;
    name: string;
    date: string;
    status: RouteStatus;
    total_distance_meters: number | null;
    total_duration_seconds: number | null;
    zone_id: string;
    vehicle_id: string;
    optimization_skipped: boolean | null;
  }>;

  // Buckets por status.
  const counts: Record<RouteStatus, number> = {
    DRAFT: 0,
    OPTIMIZED: 0,
    APPROVED: 0,
    PUBLISHED: 0,
    IN_PROGRESS: 0,
    INTERRUPTED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  for (const r of routes) counts[r.status]++;

  // Cumplimiento: COMPLETED vs ejecutadas (cualquier post-publicación).
  const executed =
    counts.COMPLETED + counts.IN_PROGRESS + counts.INTERRUPTED + counts.CANCELLED;
  const completionRate = executed > 0 ? Math.round((counts.COMPLETED / executed) * 100) : null;

  // Distancia y duración acumuladas.
  const totalDistanceKm = routes.reduce(
    (s, r) => s + (r.total_distance_meters ?? 0) / 1000,
    0,
  );
  const totalDriveHours = routes.reduce(
    (s, r) => s + (r.total_duration_seconds ?? 0) / 3600,
    0,
  );

  // UXR-3 / ADR-110: % rutas manuales (DRAFT → APPROVED sin VROOM).
  // Solo contamos rutas que YA pasaron la decisión (status ≠ DRAFT). Una DRAFT
  // todavía puede correr el optimizer, así que no debería sumar al denominador.
  const decidedRoutes = routes.filter((r) => r.status !== 'DRAFT');
  const manualRoutesList = decidedRoutes.filter((r) => r.optimization_skipped === true);
  const manualRoutes = manualRoutesList.length;
  const manualPct =
    decidedRoutes.length > 0
      ? Math.round((manualRoutes / decidedRoutes.length) * 100)
      : null;

  // UXR-3 drill-down: ?manual=1 expande la lista. Cargamos vehicles solo
  // cuando se necesitan (ahorra una query en el render base).
  const showManualList = params.manual === '1' && manualRoutesList.length > 0;
  let vehiclesByIdForManual = new Map<string, { alias: string | null; plate: string }>();
  if (showManualList) {
    const vehicleIds = [...new Set(manualRoutesList.map((r) => r.vehicle_id))];
    const { data: vRows } = await supabase
      .from('vehicles')
      .select('id, alias, plate')
      .in('id', vehicleIds);
    vehiclesByIdForManual = new Map(
      (vRows ?? []).map((v) => [
        v.id as string,
        { alias: (v.alias as string | null) ?? null, plate: v.plate as string },
      ]),
    );
  }
  // Link toggle del drill-down — preserva filtros actuales y solo cambia ?manual.
  const drillDownParams = new URLSearchParams();
  if (from) drillDownParams.set('from', from);
  if (to) drillDownParams.set('to', to);
  if (zoneFilter) drillDownParams.set('zone', zoneFilter);
  const drillDownExpandedHref = `/reports?${(() => {
    const p = new URLSearchParams(drillDownParams);
    p.set('manual', '1');
    return p.toString();
  })()}`;
  const drillDownCollapsedHref = `/reports?${drillDownParams.toString()}`;

  // Paradas agregadas — 1 query batch via .in('route_id', [...]).
  const routeIds = routes.map((r) => r.id);
  let pendingStops = 0;
  let completedStops = 0;
  let skippedStops = 0;
  if (routeIds.length > 0) {
    const { data: stopsRows } = await supabase
      .from('stops')
      .select('status')
      .in('route_id', routeIds);
    for (const s of stopsRows ?? []) {
      if (s.status === 'completed') completedStops++;
      else if (s.status === 'pending') pendingStops++;
      else if (s.status === 'skipped') skippedStops++;
    }
  }

  return (
    <>
      <PageHeader
        title="Reportes"
        description={`Operación entre ${from} y ${to}${zoneFilter ? ' · zona seleccionada' : ' · todas las zonas'}.`}
      />

      {/* Filtros */}
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <Field label="Desde">
            <input
              type="date"
              name="from"
              defaultValue={from}
              max={to}
              className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1"
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              name="to"
              defaultValue={to}
              min={from}
              max={defaults.to}
              className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1"
            />
          </Field>
          <Field label="Zona">
            <select
              name="zone"
              defaultValue={zoneFilter}
              className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1"
            >
              <option value="">Todas</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            className="rounded-md bg-[var(--vf-green-600,#15803d)] px-4 py-1.5 text-white"
          >
            Aplicar
          </button>
          {(params.from || params.to || params.zone) && (
            <Link
              href="/reports"
              className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
            >
              Limpiar
            </Link>
          )}
        </form>
      </Card>

      {/* KPIs principales */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Rutas en rango" value={routes.length} />
        <Kpi label="Completadas" value={counts.COMPLETED} hint="Ejecutadas con éxito" />
        <Kpi
          label="Cumplimiento"
          value={completionRate === null ? '—' : `${completionRate}%`}
          hint={
            completionRate === null
              ? 'sin rutas ejecutadas'
              : `${counts.COMPLETED} de ${executed} ejecutadas`
          }
        />
        <Kpi
          label="Canceladas/Interr."
          value={counts.CANCELLED + counts.INTERRUPTED}
          hint={`${counts.CANCELLED} canc · ${counts.INTERRUPTED} interr`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Distancia" value={`${totalDistanceKm.toFixed(0)} km`} hint="Sumado optimizer" />
        <Kpi label="Tiempo manejo" value={`${totalDriveHours.toFixed(0)} h`} hint="Optimizer estimado" />
        <Kpi label="Paradas completas" value={completedStops} hint={`${completedStops + pendingStops + skippedStops} total`} />
        <Kpi label="Paradas pendientes" value={pendingStops} hint={`${skippedStops} omitidas`} />
      </div>

      {/* UXR-3 / ADR-110: visibilidad del % de rutas que el dispatcher publicó
          sin pasar por el optimizer + drill-down con la lista. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="% Rutas manuales"
          value={manualPct === null ? '—' : `${manualPct}%`}
          hint={
            manualPct === null
              ? 'sin rutas decididas en el rango'
              : `${manualRoutes} de ${decidedRoutes.length} sin VROOM`
          }
          link={
            manualRoutes > 0
              ? {
                  href: showManualList ? drillDownCollapsedHref : drillDownExpandedHref,
                  label: showManualList ? 'Ocultar lista ↑' : 'Ver lista ↓',
                }
              : undefined
          }
        />
      </div>

      {showManualList && (
        <Card className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Rutas manuales ({manualRoutes})
          </p>
          <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">
            Aprobadas/publicadas sin pasar por VROOM. El dispatcher decidió que el
            orden manual era suficiente.
          </p>
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {manualRoutesList.map((r) => {
              const zone = zones.find((z) => z.id === r.zone_id);
              const vehicle = vehiclesByIdForManual.get(r.vehicle_id);
              const vehicleLabel = vehicle
                ? vehicle.alias
                  ? `${vehicle.alias} · ${vehicle.plate}`
                  : vehicle.plate
                : '—';
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/routes/${r.id}`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--vf-text)' }}
                    >
                      {r.name}
                    </Link>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      <span className="font-mono">{r.date}</span> · {zone?.code ?? '—'} ·{' '}
                      {vehicleLabel}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    {r.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Breakdown por status */}
      <Card className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Estado de rutas
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <StatusRow label="Borrador" count={counts.DRAFT} />
          <StatusRow label="Optimizadas" count={counts.OPTIMIZED} />
          <StatusRow label="Aprobadas" count={counts.APPROVED} />
          <StatusRow label="Publicadas" count={counts.PUBLISHED} />
          <StatusRow label="En curso" count={counts.IN_PROGRESS} />
          <StatusRow label="Interrumpidas" count={counts.INTERRUPTED} />
          <StatusRow label="Completadas" count={counts.COMPLETED} />
          <StatusRow label="Canceladas" count={counts.CANCELLED} />
        </div>
      </Card>

      {routes.length === 0 && (
        <EmptyState
          title="Sin rutas en el rango"
          description="Ajusta el filtro de fechas o la zona. Las rutas DRAFT se crean al armar tiros."
        />
      )}

      <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
        <p className="text-xs text-[var(--color-text-muted)]">
          ¿Buscas reportes comerciales (facturado, tickets, merma)? Ve a{' '}
          <Link href="/dashboard" className="text-[var(--vf-green-600)] underline-offset-2 hover:underline">
            Overview
          </Link>{' '}
          que tiene los KPIs del negocio.
        </p>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  link,
}: {
  label: string;
  value: number | string;
  hint?: string;
  /** Acción de drill-down opcional (UXR-3): "Ver lista" / "Ocultar lista". */
  link?: { href: string; label: string };
}) {
  return (
    <Card>
      <p className="text-[10px] uppercase tracking-[0.04em]" style={{ color: 'var(--vf-text-mute)' }}>
        {label}
      </p>
      <p
        className="mt-1 font-mono text-[28px] tabular-nums"
        style={{ color: 'var(--vf-text)', fontWeight: 500, letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[10px]" style={{ color: 'var(--vf-text-mute)' }}>
          {hint}
        </p>
      )}
      {link && (
        <Link
          href={link.href}
          className="mt-1 inline-block text-[10px] underline-offset-2 hover:underline"
          style={{ color: 'var(--vf-green-600)' }}
        >
          {link.label}
        </Link>
      )}
    </Card>
  );
}

function StatusRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2">
      <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{count}</span>
    </div>
  );
}
