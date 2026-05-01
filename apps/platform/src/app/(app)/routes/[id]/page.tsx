// Detalle de ruta: métricas + lista ordenada de paradas + acciones approve/publish/cancel.
// Sin mapa por ahora — se agrega cuando integremos Mapbox en la pantalla de aprobación visual.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardHeader, PageHeader, type BadgeTone } from '@verdfrut/ui';
import type { RouteStatus, StopStatus } from '@verdfrut/types';
import { formatDateTimeInZone, formatDuration } from '@verdfrut/utils';
import { requireRole } from '@/lib/auth';
import { getRoute } from '@/lib/queries/routes';
import { listStopsForRoute } from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { listZones } from '@/lib/queries/zones';
import { RouteActions } from './route-actions';

const STATUS_LABELS: Record<RouteStatus, string> = {
  DRAFT: 'Borrador',
  OPTIMIZED: 'Optimizada',
  APPROVED: 'Aprobada',
  PUBLISHED: 'Publicada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const STATUS_TONES: Record<RouteStatus, BadgeTone> = {
  DRAFT: 'neutral',
  OPTIMIZED: 'info',
  APPROVED: 'primary',
  PUBLISHED: 'primary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  pending: 'Pendiente',
  arrived: 'En sitio',
  completed: 'Completada',
  skipped: 'Omitida',
};

const STOP_STATUS_TONES: Record<StopStatus, BadgeTone> = {
  pending: 'neutral',
  arrived: 'warning',
  completed: 'success',
  skipped: 'danger',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const route = await getRoute(id);
  return { title: route?.name ?? 'Ruta' };
}

export default async function RouteDetailPage({ params }: PageProps) {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  const { id } = await params;

  const route = await getRoute(id);
  if (!route) notFound();

  const stops = await listStopsForRoute(id);
  const [stores, vehicles, zones] = await Promise.all([
    getStoresByIds(stops.map((s) => s.storeId)),
    getVehiclesByIds([route.vehicleId]),
    listZones(),
  ]);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const vehicle = vehicles[0];
  const zone = zones.find((z) => z.id === route.zoneId);

  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const skippedStops = stops.filter((s) => s.status === 'skipped').length;

  return (
    <>
      <PageHeader
        title={route.name}
        description={
          <span className="flex items-center gap-2">
            <Badge tone={STATUS_TONES[route.status]}>{STATUS_LABELS[route.status]}</Badge>
            <span style={{ color: 'var(--vf-text-mute)' }}>· v{route.version}</span>
            <span style={{ color: 'var(--vf-text-mute)' }}>·</span>
            <Link href="/routes" className="text-xs hover:underline" style={{ color: 'var(--vf-text-mute)' }}>
              ← Volver a rutas
            </Link>
          </span>
        }
        action={<RouteActions route={route} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* COLUMNA PRINCIPAL — paradas */}
        <Card padded={false}>
          <CardHeader
            title={`Paradas (${stops.length})`}
            description={`${completedStops} completadas · ${skippedStops} omitidas`}
            className="mb-0 px-4 pt-4"
          />
          <div className="border-t" style={{ borderColor: 'var(--vf-line)' }}>
            {stops.length === 0 ? (
              <p className="py-12 text-center text-sm" style={{ color: 'var(--vf-text-mute)' }}>
                Esta ruta no tiene paradas asignadas. Re-optimiza o agrega manualmente.
              </p>
            ) : (
              <ol className="divide-y" style={{ borderColor: 'var(--vf-line-soft)' }}>
                {stops.map((stop) => {
                  const store = storesById.get(stop.storeId);
                  return (
                    <li key={stop.id} className="flex items-start gap-3 px-4 py-3">
                      <SequenceMark sequence={stop.sequence} status={stop.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[12px]" style={{ color: 'var(--vf-text)' }}>
                            {store?.code ?? '—'}
                          </span>
                          <span className="text-sm font-medium" style={{ color: 'var(--vf-text)' }}>
                            {store?.name ?? '(tienda eliminada)'}
                          </span>
                        </div>
                        {store && (
                          <p className="text-[11.5px]" style={{ color: 'var(--vf-text-mute)' }}>
                            {store.address}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <Badge tone={STOP_STATUS_TONES[stop.status]}>{STOP_STATUS_LABELS[stop.status]}</Badge>
                        {stop.plannedArrivalAt && (
                          <p
                            className="mt-1 font-mono text-[11px] tabular-nums"
                            style={{ color: 'var(--vf-text-mute)' }}
                          >
                            ETA {formatTime(stop.plannedArrivalAt)}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>

        {/* COLUMNA LATERAL — métricas y datos */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Métricas" />
            <dl className="space-y-2.5 text-sm">
              <Metric label="Distancia total">
                {route.totalDistanceMeters
                  ? `${(route.totalDistanceMeters / 1000).toFixed(1)} km`
                  : '—'}
              </Metric>
              <Metric label="Duración estimada">
                {route.totalDurationSeconds ? formatDuration(route.totalDurationSeconds) : '—'}
              </Metric>
              <Metric label="Inicio estimado">
                {route.estimatedStartAt ? formatTime(route.estimatedStartAt) : '—'}
              </Metric>
              <Metric label="Fin estimado">
                {route.estimatedEndAt ? formatTime(route.estimatedEndAt) : '—'}
              </Metric>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Asignación" />
            <dl className="space-y-2.5 text-sm">
              <Metric label="Camión">{vehicle ? vehicle.alias ?? vehicle.plate : '—'}</Metric>
              <Metric label="Zona">{zone?.code ?? '—'}</Metric>
              <Metric label="Fecha operativa">
                <span className="font-mono">{route.date}</span>
              </Metric>
              <Metric label="Versión">v{route.version}</Metric>
            </dl>
          </Card>

          {route.publishedAt && (
            <Card>
              <CardHeader title="Auditoría" />
              <dl className="space-y-2.5 text-sm">
                {route.approvedAt && (
                  <Metric label="Aprobada">{formatDateTimeInZone(route.approvedAt, TENANT_TZ)}</Metric>
                )}
                <Metric label="Publicada">{formatDateTimeInZone(route.publishedAt, TENANT_TZ)}</Metric>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SequenceMark({ sequence, status }: { sequence: number; status: StopStatus }) {
  const bg =
    status === 'completed'
      ? 'var(--vf-ok)'
      : status === 'skipped'
        ? 'var(--vf-crit)'
        : status === 'arrived'
          ? 'var(--vf-warn)'
          : 'var(--vf-bg-sub)';
  const fg = status === 'pending' ? 'var(--vf-text-mute)' : 'white';
  const border = status === 'pending' ? 'var(--vf-line-strong)' : 'transparent';

  return (
    <div
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold tabular-nums"
      style={{ background: bg, color: fg, border: `1px solid ${border}` }}
    >
      {sequence}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs" style={{ color: 'var(--vf-text-mute)' }}>
        {label}
      </dt>
      <dd className="font-mono text-[12.5px] tabular-nums" style={{ color: 'var(--vf-text)' }}>
        {children}
      </dd>
    </div>
  );
}

// TZ del tenant — en producción multi-tenant esto vendrá del registry; por ahora env.
const TENANT_TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TENANT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
