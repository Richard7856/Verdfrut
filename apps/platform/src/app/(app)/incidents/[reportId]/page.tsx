// Detalle de un caso del comercial — panel dual: mapa en vivo + chat lado a lado.
//
// V2 (S18.2): el admin necesita ver dónde está el chofer EN VIVO mientras lee
// el reporte y responde por chat. Para zone_manager también funciona — ve el
// mismo panel dual cuando entra a su único chat activo.
//
// Layout:
// - Desktop ≥ lg: grid 2 cols [1fr 420px] — mapa izq, chat der.
// - Mobile / tablet: stack vertical, mapa arriba con altura fija, chat abajo.
//
// Reusa LiveRouteMapLoader (suscribe a gps:{routeId} + carga breadcrumbs
// históricos para trail) — único componente del platform que ya implementa
// todo lo que necesitamos para el mapa en vivo.

import { notFound } from 'next/navigation';
import { Card, Badge, PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { getIncident, listIncidentMessages } from '@/lib/queries/incidents';
import { getRoute } from '@/lib/queries/routes';
import { listStopsForRoute } from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { getDepot } from '@/lib/queries/depots';
import { getDriversByIds } from '@/lib/queries/drivers';
import { LiveRouteMapLoader } from '@/components/map/live-route-map-loader';
import type { RouteMapStop, RouteMapDepot } from '@/components/map/route-map';
import { IncidentChatClient } from './incident-chat-client';
import type { ChatStatus, IncidentDetail } from '@verdfrut/types';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ reportId: string }>;
}

const STATUS_TONE: Record<ChatStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  open: 'warning',
  driver_resolved: 'success',
  manager_resolved: 'success',
  timed_out: 'danger',
};

export default async function IncidentDetailPage({ params }: Props) {
  // admin, dispatcher Y zone_manager pueden estar aquí — todos responden en chat.
  // El zone_manager solo llega via redirect desde /incidents/active-chat o push notification.
  const profile = await requireRole('admin', 'dispatcher', 'zone_manager');
  const { reportId } = await params;

  const report = await getIncident(reportId);
  if (!report) notFound();
  const messages = await listIncidentMessages(reportId);

  // Cargar contexto de la ruta para el mapa: route + stops + depot.
  // Si la ruta ya no existe (improbable), seguimos sin mapa.
  const route = await getRoute(report.routeId);
  let mapStops: RouteMapStop[] = [];
  let mapDepot: RouteMapDepot | null = null;
  let driverName: string | undefined = undefined;

  if (route) {
    const stops = await listStopsForRoute(route.id);
    const stores = await getStoresByIds(stops.map((s) => s.storeId));
    const storesById = new Map(stores.map((s) => [s.id, s]));

    mapStops = stops
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

    // Depot del vehículo
    const [vehicle] = await getVehiclesByIds([route.vehicleId]);
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

    // Nombre del chofer para el popup del mapa
    if (route.driverId) {
      const [driver] = await getDriversByIds([route.driverId]);
      driverName = driver?.fullName;
    }
  }

  const incidents = (report.incidentDetails ?? []) as IncidentDetail[];
  const status = (report.chatStatus ?? 'open') as ChatStatus;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <>
      <PageHeader
        title={report.storeName}
        description={`${report.storeCode} · ${typeLabel(report.type)}${driverName ? ` · ${driverName}` : ''}`}
        action={<Badge tone={STATUS_TONE[status]}>{statusLabel(status)}</Badge>}
      />

      {incidents.length > 0 && (
        <Card className="mb-4 border-[var(--color-border)]">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">Incidencias declaradas</p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-text)]">
            {incidents.map((it, idx) => (
              <li key={idx}>
                • <strong>{it.quantity} {it.unit}</strong> de {it.productName}
                <span className="text-[var(--color-text-muted)]"> ({incidentTypeLabel(it.type)})</span>
                {it.notes && <span className="text-[var(--color-text-muted)]"> — {it.notes}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Layout dual: mapa + chat. Stack en mobile, grid en lg+. */}
      <div className="grid h-[calc(100dvh-14rem)] grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <div className="min-h-[400px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          {route && mapStops.length > 0 && mapboxToken ? (
            <LiveRouteMapLoader
              routeId={route.id}
              stops={mapStops}
              depot={mapDepot}
              mapboxToken={mapboxToken}
              driverName={driverName}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-[var(--vf-surface-1)] p-6 text-center text-sm text-[var(--color-text-muted)]">
              {!route
                ? 'Ruta no disponible'
                : !mapStops.length
                  ? 'Sin paradas asignadas'
                  : 'Falta NEXT_PUBLIC_MAPBOX_TOKEN'}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)]">
          <IncidentChatClient
            reportId={reportId}
            chatStatus={status}
            initialMessages={messages}
            viewerUserId={profile.id}
          />
        </div>
      </div>
    </>
  );
}

function typeLabel(t: 'entrega' | 'tienda_cerrada' | 'bascula'): string {
  return t === 'entrega' ? 'Incidencia en entrega' : t === 'tienda_cerrada' ? 'Tienda cerrada' : 'Báscula';
}

function statusLabel(s: ChatStatus): string {
  return s === 'open'
    ? 'Abierto'
    : s === 'driver_resolved'
    ? 'Resuelto por chofer'
    : s === 'manager_resolved'
    ? 'Cerrado'
    : 'Tiempo agotado';
}

function incidentTypeLabel(t: IncidentDetail['type']): string {
  return t === 'rechazo' ? 'Rechazo' : t === 'faltante' ? 'Faltante' : t === 'sobrante' ? 'Sobrante' : 'Devolución';
}
