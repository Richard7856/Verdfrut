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
import { getDepot } from '@/lib/queries/depots';
import { listDrivers, getDriversByIds } from '@/lib/queries/drivers';
import { listUsers, getUserProfile } from '@/lib/queries/users';
import { listZones } from '@/lib/queries/zones';
import { RouteActions } from './route-actions';
import { SortableStops } from './sortable-stops';
import { DriverAssignment } from './driver-assignment';
import { RouteMapLoader } from '@/components/map/route-map-loader';
import { LiveRouteMapLoader } from '@/components/map/live-route-map-loader';
import type { RouteMapStop, RouteMapDepot } from '@/components/map/route-map';

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
  // V2: solo admin/dispatcher.
  await requireRole('admin', 'dispatcher');
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

  // Cargar depot del vehículo (puede ser FK al CEDIS o coords manuales).
  let mapDepot: RouteMapDepot | null = null;
  if (vehicle?.depotId) {
    const depot = await getDepot(vehicle.depotId);
    if (depot) mapDepot = { code: depot.code, name: depot.name, lat: depot.lat, lng: depot.lng };
  } else if (vehicle?.depotLat && vehicle?.depotLng) {
    mapDepot = {
      code: vehicle.plate,
      name: `Salida de ${vehicle.alias ?? vehicle.plate}`,
      lat: vehicle.depotLat,
      lng: vehicle.depotLng,
    };
  }

  // Build paradas para el mapa con coords de la tienda.
  const mapStops: RouteMapStop[] = stops
    .map((s) => {
      const store = storesById.get(s.storeId);
      if (!store) return null;
      return {
        storeId: s.storeId,
        storeCode: store.code,
        storeName: store.name,
        sequence: s.sequence,
        lat: store.lat,
        lng: store.lng,
        status: s.status,
      };
    })
    .filter((s): s is RouteMapStop => s !== null);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const skippedStops = stops.filter((s) => s.status === 'skipped').length;

  // Cargar info de chofer (actual + opciones) para el selector inline.
  // Drivers activos en la zona, joineados con su user_profile para mostrar nombre.
  const [zoneDrivers, zoneDriverProfiles] = await Promise.all([
    listDrivers({ zoneId: route.zoneId, activeOnly: true }),
    listUsers({ role: 'driver', zoneId: route.zoneId }),
  ]);
  const profilesByUserId = new Map(zoneDriverProfiles.map((p) => [p.id, p]));
  const availableDrivers = zoneDrivers
    .map((d) => {
      const profile = profilesByUserId.get(d.userId);
      if (!profile || !profile.isActive) return null;
      return { driver: d, profile };
    })
    .filter((x): x is { driver: typeof zoneDrivers[number]; profile: typeof zoneDriverProfiles[number] } => x !== null);

  // Resolver chofer actual de la ruta (puede ser null si no se asignó al crear).
  let currentDriver: typeof availableDrivers[number] | null = null;
  if (route.driverId) {
    const [driverRow] = await getDriversByIds([route.driverId]);
    if (driverRow) {
      const profile = await getUserProfile(driverRow.userId);
      if (profile) currentDriver = { driver: driverRow, profile };
    }
  }

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

      {/* Mapa de la ruta — se renderiza encima de paradas/métricas en mobile, columna full en desktop.
          Si la ruta está IN_PROGRESS usamos LiveRouteMap (suscribe al canal Realtime para el chofer);
          si no, mapa estático normal. */}
      {mapStops.length > 0 && (
        <div className="mb-4">
          {route.status === 'IN_PROGRESS' ? (
            <LiveRouteMapLoader
              routeId={route.id}
              stops={mapStops}
              depot={mapDepot}
              mapboxToken={mapboxToken}
              driverName={currentDriver?.profile.fullName}
            />
          ) : (
            <RouteMapLoader
              routeId={route.id}
              stops={mapStops}
              depot={mapDepot}
              mapboxToken={mapboxToken}
            />
          )}
        </div>
      )}

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
              <SortableStops
                routeId={route.id}
                reorderable={['DRAFT', 'OPTIMIZED', 'APPROVED'].includes(route.status)}
                timezone={TENANT_TZ}
                initialStops={stops.map((s) => {
                  const store = storesById.get(s.storeId);
                  return {
                    stop: s,
                    storeCode: store?.code ?? '—',
                    storeName: store?.name ?? '(tienda eliminada)',
                    storeAddress: store?.address ?? '',
                  };
                })}
              />
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
              {/* Selector inline de chofer — editable solo en pre-publicación. */}
              <DriverAssignment
                route={route}
                currentDriver={currentDriver}
                availableDrivers={availableDrivers}
              />
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
