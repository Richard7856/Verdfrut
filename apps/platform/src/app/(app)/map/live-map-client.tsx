'use client';

// Mapa en vivo — layout 3 columnas inspirado en consolas de control:
//   1. Sidebar choferes con tabs (Todos / En ruta / Con incidencia / Completados).
//   2. Mapa central con marcadores de cada chofer.
//   3. Panel detalle del chofer seleccionado.

import { useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl } from '@verdfrut/maps';
import type { RouteStatus } from '@verdfrut/types';

export interface LiveDriver {
  routeId: string;
  routeName: string;
  routeStatus: RouteStatus;
  driverId: string | null;
  driverName: string;
  driverInitials: string;
  vehiclePlate: string;
  vehicleAlias: string | null;
  zoneId: string;
  zoneName: string;
  totalStops: number;
  completedStops: number;
  nextStop: {
    storeName: string;
    storeCode: string;
    plannedArrivalAt: string | null;
    demand: number[] | null;
  } | null;
  lastPos: { lat: number; lng: number; recordedAt: string } | null;
}

type Tab = 'all' | 'in_route' | 'incident' | 'done';

interface Props {
  drivers: LiveDriver[];
  mapboxToken: string;
  viewerName: string;
}

const STATUS_DOT: Record<RouteStatus, { color: string; tone: string }> = {
  DRAFT:       { color: '#94a3b8', tone: 'Inactivo' },
  OPTIMIZED:   { color: '#94a3b8', tone: 'Inactivo' },
  APPROVED:    { color: '#94a3b8', tone: 'Inactivo' },
  PUBLISHED:   { color: '#22c55e', tone: 'Publicada' },
  IN_PROGRESS: { color: '#22c55e', tone: 'En ruta' },
  COMPLETED:   { color: '#737373', tone: 'Completado' },
  CANCELLED:   { color: '#ef4444', tone: 'Crítico' },
};

const TAB_LABELS: Record<Tab, string> = {
  all: 'Todos',
  in_route: 'En ruta',
  incident: 'Con incidencia',
  done: 'Completados',
};

export function LiveMapClient({ drivers, mapboxToken }: Props) {
  const [tab, setTab] = useState<Tab>('all');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(
    drivers[0]?.routeId ?? null,
  );

  // Filtrado por tab.
  const filtered = useMemo(() => filterByTab(drivers, tab), [drivers, tab]);
  const selected = drivers.find((d) => d.routeId === selectedRouteId) ?? null;

  // Counts para los chips de los tabs.
  const counts = useMemo(() => ({
    all: drivers.length,
    in_route: drivers.filter((d) => d.routeStatus === 'IN_PROGRESS').length,
    incident: 0, // TODO: cablear con chat_status='open' cuando agreguemos query
    done: drivers.filter((d) => d.routeStatus === 'COMPLETED').length,
  }), [drivers]);

  return (
    <div
      data-fullbleed
      className="grid h-[calc(100dvh-var(--vf-top-h))] gap-0"
      style={{ gridTemplateColumns: '320px 1fr 360px' }}
    >
      {/* ===== SIDEBAR CHOFERES ===== */}
      <aside
        className="flex flex-col overflow-hidden border-r"
        style={{ borderColor: 'var(--vf-line)', background: 'var(--vf-bg-elev)' }}
      >
        <header className="flex flex-col gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--vf-line)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--vf-text)' }}>
              Choferes activos
            </h2>
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  background:
                    tab === t ? 'color-mix(in oklch, var(--vf-green-500) 22%, transparent)' : 'var(--vf-bg-sub)',
                  color: tab === t ? 'var(--vf-green-500)' : 'var(--vf-text-mute)',
                  border: tab === t ? '1px solid color-mix(in oklch, var(--vf-green-500) 40%, transparent)' : '1px solid transparent',
                }}
              >
                {TAB_LABELS[t]}
                <span className="ml-1.5 opacity-70">{counts[t]}</span>
              </button>
            ))}
          </div>
        </header>

        <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--vf-text-faint)' }}>
          Choferes ({filtered.length})
        </p>

        <ul className="flex-1 overflow-y-auto vf-scroll px-2 py-2">
          {filtered.length === 0 ? (
            <li className="px-2 py-6 text-center text-xs" style={{ color: 'var(--vf-text-faint)' }}>
              Sin choferes en este filtro.
            </li>
          ) : (
            filtered.map((d) => {
              const isSelected = d.routeId === selectedRouteId;
              const status = STATUS_DOT[d.routeStatus];
              const lastSeen = d.lastPos ? relativeTime(d.lastPos.recordedAt) : '—';
              return (
                <li key={d.routeId}>
                  <button
                    type="button"
                    onClick={() => setSelectedRouteId(d.routeId)}
                    className="w-full rounded-md px-2 py-2 text-left transition-colors"
                    style={{
                      background: isSelected ? 'var(--vf-bg-sub)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--vf-green-500)' : '3px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-[11px] font-semibold"
                        style={{ background: 'var(--vf-green-700)', color: 'white' }}
                      >
                        {d.driverInitials || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12.5px] font-medium" style={{ color: 'var(--vf-text)' }}>
                            {d.driverName}
                          </span>
                          <span className="text-[11px] tabular-nums" style={{ color: 'var(--vf-text-faint)' }}>
                            {d.completedStops}/{d.totalStops}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: status.color }}
                            aria-hidden
                          />
                          <span>{d.routeName}</span>
                          <span style={{ color: 'var(--vf-text-faint)' }}>·</span>
                          <span>{d.vehicleAlias ?? d.vehiclePlate}</span>
                        </div>
                        <p className="mt-0.5 text-right text-[10.5px]" style={{ color: 'var(--vf-text-faint)' }}>
                          hace {lastSeen}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {/* ===== MAPA CENTRAL ===== */}
      <section className="relative" style={{ background: 'var(--vf-bg)' }}>
        <DriversMap
          drivers={drivers}
          selectedRouteId={selectedRouteId}
          onSelect={setSelectedRouteId}
          mapboxToken={mapboxToken}
        />
      </section>

      {/* ===== PANEL DETALLE ===== */}
      <aside
        className="overflow-y-auto vf-scroll border-l"
        style={{ borderColor: 'var(--vf-line)', background: 'var(--vf-bg-elev)' }}
      >
        {selected ? (
          <DriverDetailPanel driver={selected} />
        ) : (
          <div className="p-6 text-sm" style={{ color: 'var(--vf-text-faint)' }}>
            Selecciona un chofer para ver su detalle.
          </div>
        )}
      </aside>
    </div>
  );
}

function filterByTab(drivers: LiveDriver[], tab: Tab): LiveDriver[] {
  switch (tab) {
    case 'all': return drivers;
    case 'in_route': return drivers.filter((d) => d.routeStatus === 'IN_PROGRESS');
    case 'done': return drivers.filter((d) => d.routeStatus === 'COMPLETED');
    case 'incident': return []; // pendiente de cablear
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

// ============================================================================
// Mapa con marcadores de choferes
// ============================================================================

function DriversMap({
  drivers,
  selectedRouteId,
  onSelect,
  mapboxToken,
}: {
  drivers: LiveDriver[];
  selectedRouteId: string | null;
  onSelect: (id: string) => void;
  mapboxToken: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-99.13, 19.43], // CDMX por default
      zoom: 10,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  // Sync markers cuando cambia drivers o selección.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    const bounds = new mapboxgl.LngLatBounds();
    let hasBounds = false;

    for (const d of drivers) {
      if (!d.lastPos) continue;
      seen.add(d.routeId);
      const status = STATUS_DOT[d.routeStatus];
      const isSelected = d.routeId === selectedRouteId;

      let marker = markersRef.current.get(d.routeId);
      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.style.cursor = 'pointer';
        el.style.border = 'none';
        el.style.background = 'transparent';
        el.style.padding = '0';
        marker = new mapboxgl.Marker({ element: el })
          .setLngLat([d.lastPos.lng, d.lastPos.lat])
          .addTo(map);
        el.addEventListener('click', () => onSelect(d.routeId));
        markersRef.current.set(d.routeId, marker);
      }

      // Estilo del marker (selected más grande, con borde blanco).
      const el = marker.getElement() as HTMLDivElement;
      el.innerHTML = `
        <div style="
          width: ${isSelected ? 18 : 14}px;
          height: ${isSelected ? 18 : 14}px;
          border-radius: 999px;
          background: ${status.color};
          border: 2px solid ${isSelected ? '#fff' : 'rgba(255,255,255,0.4)'};
          box-shadow: 0 0 0 ${isSelected ? 4 : 0}px rgba(34, 197, 94, 0.25), 0 1px 2px rgba(0,0,0,0.4);
          transition: all 120ms ease;
        "></div>
      `;
      marker.setLngLat([d.lastPos.lng, d.lastPos.lat]);

      bounds.extend([d.lastPos.lng, d.lastPos.lat]);
      hasBounds = true;
    }

    // Quitar markers de drivers que ya no están.
    for (const [id, marker] of markersRef.current.entries()) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Fit bounds en el primer render con datos.
    if (hasBounds && drivers.length > 0 && !map.isMoving()) {
      // Solo fit si está al center default — no queremos pelearle al user.
      const c = map.getCenter();
      if (Math.abs(c.lng + 99.13) < 0.01 && Math.abs(c.lat - 19.43) < 0.01) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 600 });
      }
    }
  }, [drivers, selectedRouteId, onSelect]);

  if (!mapboxToken) {
    return (
      <div className="grid h-full place-items-center p-8 text-sm" style={{ color: 'var(--vf-text-mute)' }}>
        Configura NEXT_PUBLIC_MAPBOX_TOKEN para activar el mapa.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}

// ============================================================================
// Panel detalle del chofer
// ============================================================================

function DriverDetailPanel({ driver }: { driver: LiveDriver }) {
  const status = STATUS_DOT[driver.routeStatus];
  const progressPct = driver.totalStops > 0
    ? Math.round((driver.completedStops / driver.totalStops) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--vf-text)' }}>
            Detalle del chofer
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full text-sm font-semibold"
            style={{ background: 'var(--vf-green-700)', color: 'white' }}
          >
            {driver.driverInitials || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold" style={{ color: 'var(--vf-text)' }}>
              {driver.driverName}
            </p>
            <p className="truncate text-[12px]" style={{ color: 'var(--vf-text-mute)' }}>
              {driver.routeName} · {driver.zoneName}
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{
              background: 'color-mix(in oklch, ' + status.color + ' 18%, transparent)',
              color: status.color,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} aria-hidden />
            {status.tone}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Camioneta" value={driver.vehicleAlias ?? driver.vehiclePlate} />
        <Stat label="Ruta" value={driver.routeName} />
        <Stat
          label="Última señal"
          value={driver.lastPos ? `hace ${relativeTime(driver.lastPos.recordedAt)}` : '—'}
        />
        <Stat
          label="Próxima ETA"
          value={
            driver.nextStop?.plannedArrivalAt
              ? new Date(driver.nextStop.plannedArrivalAt).toLocaleTimeString('es-MX', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'
          }
        />
      </div>

      <section>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span style={{ color: 'var(--vf-text-faint)' }}>Progreso de ruta</span>
          <span style={{ color: 'var(--vf-text-mute)' }}>
            {driver.completedStops}/{driver.totalStops} entregas · {progressPct}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--vf-bg-sub)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${progressPct}%`, background: 'var(--vf-green-500)' }}
          />
        </div>
      </section>

      {driver.nextStop && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--vf-text-faint)' }}>
            Próxima parada
          </h3>
          <div
            className="flex items-start gap-3 rounded-lg border p-3"
            style={{ borderColor: 'var(--vf-line)', background: 'var(--vf-bg-sub)' }}
          >
            <div
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-[11px] font-mono"
              style={{ background: 'var(--vf-bg-elev)', color: 'var(--vf-text-mute)' }}
            >
              {driver.completedStops + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium" style={{ color: 'var(--vf-text)' }}>
                <span className="mr-2 font-mono text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
                  {driver.nextStop.storeCode}
                </span>
                {driver.nextStop.storeName}
              </p>
              {driver.nextStop.demand && (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
                  {driver.nextStop.demand[0]} kg · {driver.nextStop.demand[2]} caja{driver.nextStop.demand[2] === 1 ? '' : 's'}
                </p>
              )}
              {driver.nextStop.plannedArrivalAt && (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
                  ETA{' '}
                  {new Date(driver.nextStop.plannedArrivalAt).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg border p-2.5"
      style={{ borderColor: 'var(--vf-line)', background: 'var(--vf-bg-sub)' }}
    >
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--vf-text-faint)' }}>
        {label}
      </p>
      <p className="mt-1 truncate text-[13px] font-medium" style={{ color: 'var(--vf-text)' }}>
        {value}
      </p>
    </div>
  );
}
