// Recomendación de flotilla (Workbench WB-4 / ADR-116).
//
// El admin ajusta días/semana y máx paradas/día y ve: cuánta capacidad tiene
// hoy, cuánta necesita por volumen real, y cuál es la decisión por zona.
// Read-only — no escribe nada. Solo da inputs para decidir compras/contrataciones.

import { Card, EmptyState, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { recommendFleet } from '@/lib/queries/fleet-recommendations';
import type { ZoneFleetRecommendation } from '@/lib/queries/fleet-recommendations';

export const metadata = { title: 'Recomendación de flotilla' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ days?: string; stops?: string }>;
}

export default async function FleetRecommendationPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const params = await searchParams;
  const workingDaysPerWeek = clampNum(params.days, 1, 7, 5);
  const maxStopsPerDay = clampNum(params.stops, 1, 100, 14);

  const rec = await recommendFleet({ workingDaysPerWeek, maxStopsPerDay });

  return (
    <>
      <PageHeader
        title="🚚 Recomendación de flotilla"
        description="Estima cuántas camionetas necesitas mínimo para sostener tu volumen actual. Heurística basada en kg/sem y paradas/sem de los últimos 30 días de operación real. NO considera costo $, ventanas horarias estrictas ni jornada legal — es estimación de capacidad bruta."
      />

      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-4 text-sm">
          <Field
            label="Días de operación / semana"
            hint="Cuántos días a la semana ruedan tus camionetas (típico 5 o 6)."
          >
            <input
              type="number"
              name="days"
              defaultValue={workingDaysPerWeek}
              min={1}
              max={7}
              className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5"
            />
          </Field>
          <Field
            label="Paradas máx / día por camioneta"
            hint="Default 14 (mismo que usa el optimizer)."
          >
            <input
              type="number"
              name="stops"
              defaultValue={maxStopsPerDay}
              min={1}
              max={100}
              className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5"
            />
          </Field>
          <button
            type="submit"
            className="rounded-md bg-[var(--vf-green-600,#15803d)] px-4 py-1.5 text-white"
          >
            Recalcular
          </button>
        </form>
      </Card>

      {rec.zones.length === 0 ? (
        <EmptyState
          title="Sin operación real registrada"
          description="No hay tiendas activas con visitas en los últimos 30 días. Agrega tiendas o ejecuta rutas para que el análisis tenga datos."
        />
      ) : (
        <>
          {/* Tarjeta global */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Operación total
                </p>
                <p className="mt-1 text-base">
                  <strong>{rec.totals.totalStores}</strong> tienda(s) activa(s) ·{' '}
                  <strong>{rec.totals.totalKgPerWeek.toLocaleString('es-MX')} kg/sem</strong>{' '}
                  · <strong>{rec.totals.totalVisitsPerWeek}</strong> visitas/sem en{' '}
                  {rec.zones.length} zona(s).
                </p>
              </div>
              <RecommendationHeadline
                current={rec.totals.currentVehicleCount}
                needed={rec.totals.vehiclesNeeded}
                delta={rec.totals.delta}
              />
            </div>
          </Card>

          {/* Tabla por zona */}
          <Card className="mb-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Breakdown por zona — ordenado por kg/sem desc
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-3">Zona</th>
                    <th className="py-2 pr-3 text-right">Tiendas</th>
                    <th className="py-2 pr-3 text-right">kg / sem</th>
                    <th className="py-2 pr-3 text-right">Visitas / sem</th>
                    <th className="py-2 pr-3 text-right">Camionetas hoy</th>
                    <th className="py-2 pr-3 text-right">Mín necesarias</th>
                    <th className="py-2 pr-3 text-right">Δ</th>
                    <th className="py-2 pr-3 text-right">Uso</th>
                    <th className="py-2 pr-3">Restricción</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.zones.map((z) => (
                    <ZoneRow key={z.zoneId} z={z} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Cómo leer este reporte
            </p>
            <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
              <li>
                <strong>Mín necesarias</strong>: máximo entre el techo por kg y por
                paradas. Asume 1 viaje/día por camioneta.
              </li>
              <li>
                <strong>Δ &gt; 0</strong>: estás corto de capacidad — riesgo de saturar.
                Considerar contratar/rentar o redistribuir tiendas a otra zona.
              </li>
              <li>
                <strong>Δ &lt; 0</strong>: tienes holgura — puedes manejar crecimiento sin
                comprar más unidades, o consolidar.
              </li>
              <li>
                <strong>Uso ≥ 100%</strong>: la flotilla actual está al límite o
                sobrepasada. Cualquier crecimiento empuja a contratar.
              </li>
              <li>
                <strong>Restricción</strong>: si dominan los kg, la limitación es
                capacidad/peso. Si dominan las paradas, es densidad / tiempo. Pueden
                resolverse con vehículos distintos (más cap vs más rapidez).
              </li>
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function ZoneRow({ z }: { z: ZoneFleetRecommendation }) {
  const deltaColor = z.delta > 0
    ? 'var(--color-danger-fg, #dc2626)'
    : z.delta < 0
    ? 'var(--vf-green-600, #15803d)'
    : 'var(--color-text-muted)';
  const utilizationColor = z.utilizationPct > 100
    ? 'var(--color-danger-fg, #dc2626)'
    : z.utilizationPct > 85
    ? 'var(--vf-warn, #d97706)'
    : 'var(--vf-green-600, #15803d)';
  const bottleneckLabel = z.bottleneck === 'kg'
    ? 'peso (kg)'
    : z.bottleneck === 'stops'
    ? 'paradas (densidad)'
    : 'balanceada';
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="py-2 pr-3">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">{z.zoneCode}</span>{' '}
        {z.zoneName}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{z.totalStores}</td>
      <td className="py-2 pr-3 text-right tabular-nums font-mono">
        {z.totalKgPerWeek.toLocaleString('es-MX')}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{z.totalVisitsPerWeek}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {z.currentVehicleCount}{' '}
        {z.representativeCapacityKg > 0 && (
          <span className="text-[10px] text-[var(--color-text-muted)]">
            ({z.representativeCapacityKg}kg c/u)
          </span>
        )}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <strong>{z.vehiclesNeeded}</strong>
        <span
          className="ml-1 text-[10px] text-[var(--color-text-muted)]"
          title={`Por kg: ${z.vehiclesNeededByKg} · Por paradas: ${z.vehiclesNeededByStops}`}
        >
          (kg {z.vehiclesNeededByKg} / par {z.vehiclesNeededByStops})
        </span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <span style={{ color: deltaColor, fontWeight: 600 }}>
          {z.delta > 0 ? `+${z.delta}` : z.delta}
        </span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <span style={{ color: utilizationColor }}>{z.utilizationPct}%</span>
      </td>
      <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)]">{bottleneckLabel}</td>
    </tr>
  );
}

function RecommendationHeadline({
  current,
  needed,
  delta,
}: {
  current: number;
  needed: number;
  delta: number;
}) {
  let headline: string;
  let color: string;
  if (delta > 0) {
    headline = `Te faltan ${delta} camioneta(s) mínimo`;
    color = 'var(--color-danger-fg, #dc2626)';
  } else if (delta < 0) {
    headline = `Tienes holgura de ${Math.abs(delta)} camioneta(s)`;
    color = 'var(--vf-green-600, #15803d)';
  } else {
    headline = 'Capacidad justa para la operación actual';
    color = 'var(--vf-warn, #d97706)';
  }
  return (
    <div className="text-right">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
        Recomendación
      </p>
      <p className="mt-0.5 text-lg font-semibold" style={{ color }}>
        {headline}
      </p>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Hoy {current} · Mín necesario {needed}
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[10px] text-[var(--color-text-muted)]">{hint}</span>
      )}
    </div>
  );
}

function clampNum(raw: string | undefined, min: number, max: number, defaultVal: number): number {
  const n = parseInt(raw ?? '', 10);
  if (Number.isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}
