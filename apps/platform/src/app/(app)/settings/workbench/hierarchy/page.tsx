// Vista jerárquica de la operación (Workbench WB-6 / ADR-118).
//
// Drill-down navegable: Día → Zona → Frecuencia → Camioneta → Ruta → Parada.
// La "Frecuencia" se infiere del histórico de cada camioneta (días-de-semana
// recientes). El admin tiene un mental model completo de su operación en una
// sola vista colapsable.

import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { todayInZone } from '@tripdrive/utils';
import { getOperationHierarchy } from '@/lib/queries/operation-hierarchy';
import type {
  HierarchyZone,
  HierarchyFrequencyGroup,
  HierarchyVehicle,
  HierarchyRoute,
} from '@/lib/queries/operation-hierarchy';

export const metadata = { title: 'Vista jerárquica' };
export const dynamic = 'force-dynamic';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function HierarchyPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const params = await searchParams;
  const today = todayInZone(TZ);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : today;

  const data = await getOperationHierarchy(date);

  return (
    <>
      <PageHeader
        title="🌳 Vista jerárquica"
        description="Drill-down de la operación de un día: Zona → Frecuencia → Camioneta → Ruta → Parada. Los grupos de frecuencia se infieren del histórico de cada camioneta (últimos 60 días) para que veas tus patrones operativos recurrentes."
      />

      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <Field label="Día a explorar">
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5"
            />
          </Field>
          <button
            type="submit"
            className="rounded-md bg-[var(--vf-green-600,#15803d)] px-4 py-1.5 text-white"
          >
            Ver día
          </button>
          {date !== today && (
            <Link
              href="/settings/workbench/hierarchy"
              className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
            >
              Hoy
            </Link>
          )}
        </form>
      </Card>

      {!data || data.routeCount === 0 ? (
        <EmptyState
          title="Sin operación este día"
          description={`No hay rutas reales activas para ${date}. Prueba otro día o ejecuta operación.`}
        />
      ) : (
        <>
          {/* Resumen del día */}
          <Card className="mb-4">
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Día {data.date}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Summary label="Zonas" value={String(data.zones.length)} />
              <Summary label="Camionetas" value={String(data.vehicleCount)} />
              <Summary label="Rutas" value={String(data.routeCount)} />
              <Summary label="Paradas" value={String(data.totalStops)} />
              <Summary
                label="Carga total"
                value={`${data.totalKg.toLocaleString('es-MX')} kg`}
              />
            </div>
          </Card>

          {/* Árbol */}
          <div className="space-y-3">
            {data.zones.map((z) => (
              <ZoneNode key={z.zoneId} zone={z} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ZoneNode({ zone }: { zone: HierarchyZone }) {
  return (
    <details
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)]"
      open
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--vf-surface-2)]">
        <div>
          <p className="text-sm font-semibold">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              {zone.zoneCode}
            </span>{' '}
            {zone.zoneName}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {zone.frequencyGroups.length} frecuencia(s) · {zone.vehicleCount} camioneta(s) ·{' '}
            {zone.totalStops} paradas · {zone.totalKg.toLocaleString('es-MX')} kg
            {zone.totalDistanceMeters > 0 &&
              ` · ${Math.round(zone.totalDistanceMeters / 1000).toLocaleString('es-MX')} km`}
          </p>
        </div>
      </summary>
      <div className="space-y-2 border-t border-[var(--color-border)] px-4 py-3">
        {zone.frequencyGroups.map((g, idx) => (
          <FrequencyNode key={idx} group={g} />
        ))}
      </div>
    </details>
  );
}

function FrequencyNode({ group }: { group: HierarchyFrequencyGroup }) {
  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--vf-bg-elev,var(--vf-surface-1))]">
        <div>
          <p className="text-sm">
            <span className="mr-2 inline-flex items-center rounded-full bg-[var(--vf-green-700,#15803d)] px-2 py-0.5 text-[10px] font-semibold text-white">
              📅 {group.label}
            </span>
            {group.vehicles.length} camioneta(s)
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {group.totalStops} paradas · {group.totalKg.toLocaleString('es-MX')} kg
            {group.daysOfWeek.length > 0 &&
              ` · patrón histórico ${group.daysOfWeek.length}/7 d`}
          </p>
        </div>
      </summary>
      <div className="space-y-2 border-t border-[var(--color-border)] p-3">
        {group.vehicles.map((v) => (
          <VehicleNode key={v.vehicleId} vehicle={v} />
        ))}
      </div>
    </details>
  );
}

function VehicleNode({ vehicle }: { vehicle: HierarchyVehicle }) {
  const label = vehicle.alias ? `${vehicle.alias} · ${vehicle.plate}` : vehicle.plate;
  return (
    <details className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--vf-surface-1)]">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--vf-surface-2)]">
        <div>
          <p className="text-sm font-medium">🚚 {label}</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {vehicle.driverName ?? 'Sin chofer asignado'} · {vehicle.routes.length} ruta(s) ·{' '}
            {vehicle.totalStops} paradas · {vehicle.totalKg.toLocaleString('es-MX')} kg
            {vehicle.totalDistanceMeters > 0 &&
              ` · ${Math.round(vehicle.totalDistanceMeters / 1000)} km`}
          </p>
        </div>
      </summary>
      <div className="space-y-2 border-t border-[var(--color-border)] p-3">
        {vehicle.routes.map((r) => (
          <RouteNode key={r.id} route={r} />
        ))}
      </div>
    </details>
  );
}

function RouteNode({ route }: { route: HierarchyRoute }) {
  const distanceKm = route.totalDistanceMeters
    ? Math.round(route.totalDistanceMeters / 1000)
    : null;
  return (
    <details className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--vf-bg-elev,var(--vf-surface-1))]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            <Link
              href={`/routes/${route.id}`}
              className="hover:underline"
              style={{ color: 'var(--vf-text)' }}
            >
              {route.name}
            </Link>
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {route.status} · {route.completedStops}/{route.totalStops} paradas ·{' '}
            {route.totalKg.toLocaleString('es-MX')} kg
            {distanceKm !== null && ` · ${distanceKm} km`}
          </p>
        </div>
      </summary>
      <div className="border-t border-[var(--color-border)] p-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="pb-1 pr-2">#</th>
              <th className="pb-1 pr-2">Tienda</th>
              <th className="pb-1 pr-2 text-right">Kg</th>
              <th className="pb-1 pr-2">ETA</th>
              <th className="pb-1 pr-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {route.stops.map((s) => (
              <tr key={s.id} className="border-t border-[var(--color-border)]">
                <td className="py-1 pr-2 font-mono">{s.sequence}</td>
                <td className="py-1 pr-2">
                  <span className="font-mono text-[var(--color-text-muted)]">{s.storeCode}</span>{' '}
                  {s.storeName}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">
                  {Number(s.load?.[0] ?? 0) || '—'}
                </td>
                <td className="py-1 pr-2 font-mono">{formatTime(s.plannedArrivalAt)}</td>
                <td className="py-1 pr-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {s.status}
                </td>
              </tr>
            ))}
            {route.stops.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-3 text-center text-[var(--color-text-muted)]"
                >
                  Sin paradas asignadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
