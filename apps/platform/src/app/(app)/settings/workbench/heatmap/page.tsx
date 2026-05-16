// Heatmap visual de operación (Workbench WB-5 / ADR-117).
//
// Toggle entre 3 lentes sobre el mismo mapa:
//   • frequency: dónde se concentran las visitas semanales.
//   • volume: dónde está el peso (kg/sem).
//   • utilization: qué zonas están saturadas o subutilizadas (color de zona).
//
// Read-only — análisis visual puro. Útil para reuniones donde el admin
// explica al comercial o al cliente la realidad de su operación.

import { Card, EmptyState, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { getHeatmapData } from '@/lib/queries/heatmap-data';
import { HeatmapClient } from './heatmap-client';

export const metadata = { title: 'Heatmap de operación' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ mode?: string }>;
}

type Mode = 'frequency' | 'volume' | 'utilization';
const VALID_MODES: Mode[] = ['frequency', 'volume', 'utilization'];

export default async function HeatmapPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const params = await searchParams;
  const modeRaw = (params.mode ?? 'volume') as Mode;
  const mode: Mode = VALID_MODES.includes(modeRaw) ? modeRaw : 'volume';

  const data = await getHeatmapData();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <>
      <PageHeader
        title="🔥 Heatmap de operación"
        description="Visualiza la realidad operativa de tus tiendas: dónde se concentra la demanda, dónde tu flotilla satura, dónde hay holgura. Datos de los últimos 30 días reales."
      />

      {data.stores.length === 0 ? (
        <EmptyState
          title="Sin operación real para visualizar"
          description="No hay tiendas activas o no se han ejecutado rutas recientes. Ejecuta operación para que el heatmap tenga datos."
        />
      ) : (
        <>
          {/* Selector de lente */}
          <Card className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              ¿Qué quieres visualizar?
            </p>
            <div className="flex flex-wrap gap-2">
              <ModeLink
                href="/settings/workbench/heatmap?mode=frequency"
                label="📅 Frecuencia"
                description="visitas/sem"
                active={mode === 'frequency'}
              />
              <ModeLink
                href="/settings/workbench/heatmap?mode=volume"
                label="📦 Volumen (kg)"
                description="carga total"
                active={mode === 'volume'}
              />
              <ModeLink
                href="/settings/workbench/heatmap?mode=utilization"
                label="🚚 Capacidad por zona"
                description="saturada / sub-utilizada"
                active={mode === 'utilization'}
              />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            {/* Mapa principal */}
            <div className="min-w-0">
              {mapboxToken ? (
                <HeatmapClient data={data} mode={mode} mapboxToken={mapboxToken} />
              ) : (
                <Card>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Mapa deshabilitado: falta <code>NEXT_PUBLIC_MAPBOX_TOKEN</code>.
                  </p>
                </Card>
              )}
            </div>

            {/* Sidebar de hotspots */}
            <Hotspots data={data} mode={mode} />
          </div>

          <Card className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Cómo leer este heatmap
            </p>
            <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
              {mode === 'frequency' && (
                <>
                  <li>• Áreas calientes = tiendas con muchas visitas/sem en los últimos 30 días.</li>
                  <li>• Áreas frías = tiendas inactivas u operación esporádica.</li>
                  <li>• Útil para detectar concentración de demanda y decidir si necesitas dispatcher dedicado.</li>
                </>
              )}
              {mode === 'volume' && (
                <>
                  <li>• Áreas calientes = tiendas que mueven más kg/sem (no solo más frecuencia).</li>
                  <li>• Una tienda con 1 v/sem × 500kg pesa igual que 5 v/sem × 100kg.</li>
                  <li>• Útil para planear flotilla por capacidad de carga (Sprinter vs Kangoo).</li>
                </>
              )}
              {mode === 'utilization' && (
                <>
                  <li>• Cada tienda se colorea según el % de uso de la flotilla de su zona.</li>
                  <li>• Verde = holgura ({'<'}85%) · Amber = al límite (85-100%) · Rojo = saturada ({'>'}100%).</li>
                  <li>• Útil para ver de un vistazo qué zonas necesitan crecer la flotilla.</li>
                </>
              )}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function ModeLink({
  href,
  label,
  description,
  active,
}: {
  href: string;
  label: string;
  description: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 text-sm transition-colors"
      style={{
        background: active
          ? 'color-mix(in oklch, var(--vf-green-500, #15803d) 18%, transparent)'
          : 'var(--vf-surface-2)',
        borderColor: active ? 'var(--vf-green-600, #15803d)' : 'var(--color-border)',
        color: active ? 'var(--vf-green-700, #15803d)' : 'var(--color-text)',
      }}
    >
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-[var(--color-text-muted)]">{description}</span>
    </a>
  );
}

function Hotspots({
  data,
  mode,
}: {
  data: Awaited<ReturnType<typeof getHeatmapData>>;
  mode: Mode;
}) {
  // Para frequency/volume listamos top tiendas; para utilization, zonas.
  if (mode === 'utilization') {
    const sortedZones = [...data.zoneStats].sort((a, b) => b.utilizationPct - a.utilizationPct);
    return (
      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Zonas por utilización
        </p>
        <ul className="space-y-2 text-sm">
          {sortedZones.length === 0 && (
            <li className="text-xs text-[var(--color-text-muted)]">
              No hay zonas con operación.
            </li>
          )}
          {sortedZones.map((z) => (
            <li key={z.zoneId} className="flex items-baseline justify-between gap-2">
              <span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">
                  {z.zoneCode}
                </span>{' '}
                {z.zoneName}
                <span className="block text-[10px] text-[var(--color-text-muted)]">
                  {z.storeCount} tiendas · {z.totalKgPerWeek.toLocaleString('es-MX')} kg/sem
                </span>
              </span>
              <span
                className="font-mono tabular-nums text-sm font-semibold"
                style={{ color: utilizationColor(z.utilizationPct) }}
              >
                {z.utilizationPct}%
              </span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  // top 10 stores by metric
  const metric: 'visitsPerWeek' | 'kgPerWeek' = mode === 'frequency' ? 'visitsPerWeek' : 'kgPerWeek';
  const top = [...data.stores].sort((a, b) => b[metric] - a[metric]).slice(0, 10);
  return (
    <Card>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Top 10 hotspots
      </p>
      <ul className="space-y-2 text-sm">
        {top.length === 0 && (
          <li className="text-xs text-[var(--color-text-muted)]">Sin datos para ranking.</li>
        )}
        {top.map((s, i) => (
          <li key={s.id} className="flex items-baseline justify-between gap-2">
            <span>
              <span className="mr-1 text-[10px] text-[var(--color-text-muted)]">
                {i + 1}.
              </span>
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {s.code}
              </span>{' '}
              {s.name}
              <span className="block text-[10px] text-[var(--color-text-muted)]">
                {s.zoneCode}
              </span>
            </span>
            <span className="font-mono tabular-nums text-xs">
              {metric === 'visitsPerWeek'
                ? `${s.visitsPerWeek} v/sem`
                : `${s.kgPerWeek.toLocaleString('es-MX')} kg/sem`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function utilizationColor(pct: number): string {
  if (pct > 100) return 'var(--color-danger-fg, #dc2626)';
  if (pct > 85) return 'var(--vf-warn, #d97706)';
  return 'var(--vf-green-600, #15803d)';
}
