'use client';

// Visual Dispatch Builder — Phase 4 (2026-05-15 noche).
//
// El dispatcher arma un tiro nuevo viendo TODAS las tiendas activas de la
// zona en un mapa y asignándolas en grupos a camionetas. Reusa el patrón
// de selección bulk de las phases 1-3 pero en un contexto de "construir
// desde cero" en lugar de "editar tiro existente".

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import { Button, PageHeader } from '@tripdrive/ui';
import { createVisualDispatchAction, type RoutePlanPayload } from './actions';

// ─── Tipos compartidos con server ──────────────────────────────────

interface ZoneInfo {
  id: string;
  name: string;
  code: string;
}

export interface StoreEntry {
  id: string;
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  demand: number[] | null;
}

export interface VehicleEntry {
  id: string;
  plate: string;
  alias: string | null;
  capacity: number[];
  depotId: string | null;
  depotLat: number | null;
  depotLng: number | null;
}

export interface DriverEntry {
  id: string;
  fullName: string;
}

export interface DepotEntry {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  zone: ZoneInfo;
  /** Todas las zonas del customer — para el selector de cambio rápido. */
  availableZones: ZoneInfo[];
  stores: StoreEntry[];
  vehicles: VehicleEntry[];
  drivers: DriverEntry[];
  depots: DepotEntry[];
  defaultDate: string;
  mapboxToken: string;
  /** Cuántas tiendas activas de la zona fueron OMITIDAS por no tener coords
   *  válidas. El user las puede arreglar desde /stores/import o el editor. */
  missingCoordsCount: number;
}

// ─── State del builder ─────────────────────────────────────────────

/**
 * Una "ruta en progreso" — vive solo en memoria del cliente hasta que el
 * user da "Crear tiro". Cada una tiene asignados N stores por su ID.
 */
interface DraftRoute {
  /** Temp ID local — solo del lado cliente. No es UUID de BD. */
  tempId: string;
  vehicleId: string;
  driverId: string | null;
  /** IDs de stores asignados a esta ruta (no de stops — stores son del catálogo). */
  storeIds: Set<string>;
}

// Paleta de colores para distinguir rutas visualmente. Mismo set que MultiRouteMap.
const ROUTE_COLORS = [
  '#16a34a', '#2563eb', '#dc2626', '#f59e0b', '#7c3aed',
  '#0891b2', '#db2777', '#ca8a04', '#059669', '#9333ea',
];

const UNASSIGNED_COLOR = '#71717a'; // zinc-500 — pin gris para sin asignar.

// ─── Componente principal ──────────────────────────────────────────

export function VisualDispatchBuilder({
  zone,
  availableZones,
  stores,
  vehicles,
  drivers,
  depots,
  defaultDate,
  mapboxToken,
  missingCoordsCount,
}: Props) {
  const router = useRouter();

  // Form mínimo del dispatch.
  const [name, setName] = useState(`${zone.name} ${defaultDate}`);
  const [date, setDate] = useState(defaultDate);

  // Rutas en progreso (en memoria).
  const [routes, setRoutes] = useState<DraftRoute[]>([]);

  // Selección actual de stops (común con map interaction).
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());

  // Sidebar tab.
  const [sidebarTab, setSidebarTab] = useState<'routes' | 'unassigned'>('routes');
  const [unassignedSearch, setUnassignedSearch] = useState('');
  // Lifted: si el toolbar pide "crear nueva camioneta", abrimos el form
  // del sidebar y cambiamos a la tab de camionetas.
  const [showAddRoute, setShowAddRoute] = useState(false);

  // Modal/state de creación.
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mapa: refs.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [mapLoaded, setMapLoaded] = useState(false);

  // Lasso state (Shift+drag).
  const [lassoBox, setLassoBox] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  // ─── Derivados ────────────────────────────────────────────────────

  /** Mapa storeId → routeId (color) o null si sin asignar. */
  const routeByStoreId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of stores) m.set(s.id, null);
    for (const r of routes) {
      for (const sid of r.storeIds) m.set(sid, r.tempId);
    }
    return m;
  }, [stores, routes]);

  /** Color por tempId de ruta — estable mientras no se reorderen. */
  const colorByRouteTempId = useMemo(() => {
    const m = new Map<string, string>();
    routes.forEach((r, i) => m.set(r.tempId, ROUTE_COLORS[i % ROUTE_COLORS.length]!));
    return m;
  }, [routes]);

  /** Stores sin asignar (visibles en tab "Sin asignar"). */
  const unassignedStores = useMemo(() => {
    return stores.filter((s) => routeByStoreId.get(s.id) === null);
  }, [stores, routeByStoreId]);

  /** Stores que matchean el buscador del sidebar "Sin asignar". */
  const filteredUnassigned = useMemo(() => {
    const q = unassignedSearch.trim().toLowerCase();
    if (q.length === 0) return unassignedStores;
    return unassignedStores.filter(
      (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }, [unassignedStores, unassignedSearch]);

  // ─── Refs vivas para listeners que se registran una sola vez ─────

  const selectedRef = useRef(selectedStoreIds);
  selectedRef.current = selectedStoreIds;
  const storesRef = useRef(stores);
  storesRef.current = stores;

  const toggleSelection = useCallback((storeId: string) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  }, []);

  const toggleSelectionRef = useRef(toggleSelection);
  toggleSelectionRef.current = toggleSelection;

  // ─── Init del mapa ───────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || !mapboxToken || mapRef.current) return;
    setMapboxToken(mapboxToken);

    // Defensa: aunque el server filtra coords inválidas, validamos otra vez
    // por si llegara algo raro (caché vieja, type leak, lat/lng como string).
    // Convertimos primero a Number() para tolerar strings desde la BD.
    const validStores = stores
      .map((s) => ({
        ...s,
        lat: typeof s.lat === 'number' ? s.lat : Number(s.lat),
        lng: typeof s.lng === 'number' ? s.lng : Number(s.lng),
      }))
      .filter(
        (s) =>
          Number.isFinite(s.lat) &&
          Number.isFinite(s.lng) &&
          s.lat !== 0 &&
          s.lng !== 0 &&
          s.lat >= -90 &&
          s.lat <= 90 &&
          s.lng >= -180 &&
          s.lng <= 180,
      );

    // Init mapa SIN bounds — siempre con center+zoom default. Después del load,
    // si hay stores válidos, hacemos fitBounds via API.
    // Esto evita el bug de Mapbox v3 donde el constructor con `bounds` crashea
    // si por alguna razón internal el derived center sale NaN.
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-99.13, 19.43], // CDMX centro como fallback
      zoom: 10,
    });
    mapRef.current = map;

    map.on('load', () => {
      setMapLoaded(true);

      // Fit a las stores válidas DESPUÉS del load. try/catch defensivo en caso
      // de que algo raro pase con los bounds — si falla, el mapa ya está
      // mostrando el fallback center, no crashea.
      if (validStores.length > 0) {
        try {
          const bounds = new mapboxgl.LngLatBounds();
          for (const s of validStores) {
            bounds.extend([s.lng, s.lat]);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[visual-builder] fitBounds falló — usando fallback view:', err);
        }
      }

      // Crear marker por cada store con coords válidas.
      for (const s of validStores) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:24px;height:24px;background:#71717a;border:2px solid white;' +
          'border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);' +
          'cursor:pointer;font-size:0;' + // sin texto para reducir ruido visual
          'transition:box-shadow 100ms ease,opacity 100ms ease;';
        el.dataset.storeId = s.id;
        el.title = `${s.code} · ${s.name}`;

        // Click → toggle selección. No popup nativo para mantener UX simple.
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          toggleSelectionRef.current(s.id);
        });

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([s.lng, s.lat])
          .addTo(map);
        markersRef.current.set(s.id, marker);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      setMapLoaded(false);
    };
  }, [stores, mapboxToken]);

  // ─── Visual feedback: color por ruta + ring selección ────────────

  useEffect(() => {
    if (!mapLoaded) return;
    for (const [storeId, marker] of markersRef.current.entries()) {
      const el = marker.getElement();
      const routeTempId = routeByStoreId.get(storeId);
      const isSelected = selectedStoreIds.has(storeId);
      const color = routeTempId
        ? colorByRouteTempId.get(routeTempId) ?? UNASSIGNED_COLOR
        : UNASSIGNED_COLOR;

      el.style.background = color;
      if (isSelected) {
        el.style.boxShadow =
          '0 0 0 4px rgba(34,197,94,0.95), 0 0 0 6px rgba(255,255,255,0.6), 0 2px 6px rgba(0,0,0,0.45)';
        el.style.zIndex = '500';
        el.style.opacity = '1';
      } else {
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
        el.style.zIndex = '';
        el.style.opacity = '1';
      }
    }
  }, [routeByStoreId, selectedStoreIds, colorByRouteTempId, mapLoaded]);

  // ─── Lasso (Shift+drag) ──────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.dataset?.storeId) return;
      e.preventDefault();
      map.dragPan.disable();
      map.boxZoom.disable();
      map.scrollZoom.disable();
      const rect = container.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      dragging = true;
      setLassoBox({ x1: startX, y1: startY, x2: startX, y2: startY });
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      setLassoBox({
        x1: startX,
        y1: startY,
        x2: e.clientX - rect.left,
        y2: e.clientY - rect.top,
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging) return;
      dragging = false;
      map.dragPan.enable();
      map.boxZoom.enable();
      map.scrollZoom.enable();

      const rect = container.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;
      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);

      if (maxX - minX < 5 && maxY - minY < 5) {
        setLassoBox(null);
        return;
      }

      const newly = new Set<string>();
      for (const s of storesRef.current) {
        const px = map.project([s.lng, s.lat]);
        if (px.x >= minX && px.x <= maxX && px.y >= minY && px.y <= maxY) {
          newly.add(s.id);
        }
      }
      if (newly.size > 0) {
        setSelectedStoreIds((prev) => {
          const next = new Set(prev);
          for (const id of newly) next.add(id);
          return next;
        });
      }
      setLassoBox(null);
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (dragging) {
        map.dragPan.enable();
        map.boxZoom.enable();
        map.scrollZoom.enable();
      }
    };
  }, [mapLoaded]);

  // ─── Keyboard shortcuts ─────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        setSelectedStoreIds(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        // Cmd+A selecciona solo las sin asignar (las asignadas no se tocan).
        setSelectedStoreIds(new Set(unassignedStores.map((s) => s.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unassignedStores]);

  // ─── Acciones ────────────────────────────────────────────────────

  const addRoute = useCallback((vehicleId: string, driverId: string | null) => {
    setRoutes((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        vehicleId,
        driverId,
        storeIds: new Set(),
      },
    ]);
  }, []);

  const removeRoute = useCallback((tempId: string) => {
    setRoutes((prev) => prev.filter((r) => r.tempId !== tempId));
  }, []);

  const assignSelectedToRoute = useCallback(
    (targetTempId: string) => {
      setRoutes((prev) => {
        return prev.map((r) => {
          if (r.tempId === targetTempId) {
            // Agregar todos los seleccionados a esta ruta.
            const next = new Set(r.storeIds);
            for (const sid of selectedStoreIds) next.add(sid);
            return { ...r, storeIds: next };
          }
          // Quitar de OTRAS rutas (un store solo puede estar en una ruta).
          const next = new Set(r.storeIds);
          let changed = false;
          for (const sid of selectedStoreIds) {
            if (next.has(sid)) {
              next.delete(sid);
              changed = true;
            }
          }
          return changed ? { ...r, storeIds: next } : r;
        });
      });
      setSelectedStoreIds(new Set());
    },
    [selectedStoreIds],
  );

  const unassignSelected = useCallback(() => {
    setRoutes((prev) =>
      prev.map((r) => {
        const next = new Set(r.storeIds);
        let changed = false;
        for (const sid of selectedStoreIds) {
          if (next.has(sid)) {
            next.delete(sid);
            changed = true;
          }
        }
        return changed ? { ...r, storeIds: next } : r;
      }),
    );
    setSelectedStoreIds(new Set());
  }, [selectedStoreIds]);

  // ─── Crear tiro ──────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    setError(null);
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      setError('Dale un nombre al tiro (2+ chars).');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Fecha debe estar en formato YYYY-MM-DD.');
      return;
    }
    const routesWithStops = routes.filter((r) => r.storeIds.size > 0);
    if (routesWithStops.length === 0) {
      setError('Agrega al menos una camioneta con paradas asignadas.');
      return;
    }

    // Warning si hay stores sin asignar.
    if (unassignedStores.length > 0) {
      const ok = window.confirm(
        `Hay ${unassignedStores.length} tienda(s) sin asignar. No se incluirán en este tiro. ¿Continuar?`,
      );
      if (!ok) return;
    }

    const payload: RoutePlanPayload[] = routesWithStops.map((r) => ({
      vehicleId: r.vehicleId,
      driverId: r.driverId,
      storeIds: [...r.storeIds],
    }));

    setCreating(true);
    try {
      const res = await createVisualDispatchAction({
        name: cleanName,
        date,
        zoneId: zone.id,
        routes: payload,
      });
      if (!res.ok) {
        setError(res.error ?? 'Error al crear el tiro.');
        return;
      }
      // Redirigir al detalle del tiro recién creado.
      if (res.dispatchId) {
        router.push(`/dispatches/${res.dispatchId}`);
      } else {
        router.push('/dispatches');
      }
    } finally {
      setCreating(false);
    }
  }, [name, date, routes, unassignedStores.length, zone.id, router]);

  // ─── Render ──────────────────────────────────────────────────────

  if (!mapboxToken) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] p-8 text-center text-sm text-[var(--color-text-muted)]">
        Mapa deshabilitado: configura <code className="mx-1">NEXT_PUBLIC_MAPBOX_TOKEN</code>.
      </div>
    );
  }

  const usedVehicleIds = new Set(routes.map((r) => r.vehicleId));
  const availableVehicles = vehicles.filter((v) => !usedVehicleIds.has(v.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Armar tiro visualmente"
          description={`${stores.length} tiendas activas · ${vehicles.length} camionetas · ${drivers.length} choferes`}
        />
        {/* Selector de zona para cambiar entre CDMX/Toluca/etc sin volver al
            selector inicial. Si el user ya armó cosas, advertimos antes de
            navegar (las rutas en progreso viven solo en memoria del cliente). */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Zona operativa
          </label>
          <select
            value={zone.id}
            onChange={(e) => {
              const newZoneId = e.target.value;
              if (newZoneId === zone.id) return;
              const hasProgress = routes.length > 0;
              if (hasProgress) {
                const ok = window.confirm(
                  `Tienes ${routes.length} camioneta(s) en progreso. Si cambias de zona se pierden. ¿Continuar?`,
                );
                if (!ok) {
                  // Restaurar el select al valor anterior (forzar re-render).
                  e.target.value = zone.id;
                  return;
                }
              }
              window.location.href = `/dispatches/new/visual?zone=${newZoneId}`;
            }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--vf-bg)] px-3 py-2 text-sm font-medium"
          >
            {availableZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} ({z.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Aviso si hay tiendas activas SIN coordenadas — el mapa no las puede mostrar. */}
      {missingCoordsCount > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
          ⚠️ <strong>{missingCoordsCount}</strong> tienda{missingCoordsCount === 1 ? '' : 's'} activa{missingCoordsCount === 1 ? '' : 's'} de esta zona no tiene{missingCoordsCount === 1 ? '' : 'n'} coordenadas válidas y no aparece{missingCoordsCount === 1 ? '' : 'n'} en el mapa. Arréglalas en{' '}
          <a href="/settings/stores" className="underline hover:text-amber-100">/settings/stores</a>{' '}
          (edita cada una y agrega lat/lng) o re-impórtalas desde{' '}
          <a href="/stores/import" className="underline hover:text-amber-100">/stores/import</a>{' '}
          que geocodifica automático.
        </div>
      )}

      {/* Form básico del tiro */}
      <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Nombre del tiro
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ej. CDMX 21/05"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--vf-bg)] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Fecha operativa
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--vf-bg)] px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <a
            href="/dispatches"
            className="rounded-md border border-[var(--vf-line)] px-3 py-2 text-sm text-[var(--vf-text-mute)] hover:bg-[var(--vf-bg-sub)]"
          >
            ← Cancelar
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius-lg)] border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Layout principal: mapa + sidebar */}
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        {/* Mapa */}
        <div className="relative">
          <div
            ref={containerRef}
            style={{ isolation: 'isolate', transform: 'translateZ(0)' }}
            className="h-[600px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
          />

          {/* Hint shortcuts */}
          {selectedStoreIds.size === 0 && !lassoBox && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-[var(--vf-line)] bg-[var(--vf-bg-elev)]/90 px-3 py-2 text-xs text-[var(--vf-text-mute)] shadow-md backdrop-blur">
              💡 Click pin · <kbd className="rounded bg-[var(--vf-bg-sub)] px-1 py-0.5 font-mono text-[10px]">Shift</kbd>+drag rectángulo · <kbd className="rounded bg-[var(--vf-bg-sub)] px-1 py-0.5 font-mono text-[10px]">⌘A</kbd> todas sin asignar · <kbd className="rounded bg-[var(--vf-bg-sub)] px-1 py-0.5 font-mono text-[10px]">Esc</kbd> limpiar
            </div>
          )}

          {/* Lasso rectangle */}
          {lassoBox && (
            <div
              className="pointer-events-none absolute z-20 border-2 border-emerald-400 bg-emerald-400/10"
              style={{
                left: Math.min(lassoBox.x1, lassoBox.x2),
                top: Math.min(lassoBox.y1, lassoBox.y2),
                width: Math.abs(lassoBox.x2 - lassoBox.x1),
                height: Math.abs(lassoBox.y2 - lassoBox.y1),
              }}
            />
          )}

          {/* Toolbar flotante con selección activa */}
          {selectedStoreIds.size > 0 && (
            <AssignmentToolbar
              count={selectedStoreIds.size}
              routes={routes}
              colorByTempId={colorByRouteTempId}
              vehicles={vehicles}
              drivers={drivers}
              onAssign={assignSelectedToRoute}
              onUnassign={unassignSelected}
              onClear={() => setSelectedStoreIds(new Set())}
              onWantCreateRoute={() => {
                setSidebarTab('routes');
                setShowAddRoute(true);
              }}
              busy={false}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="flex h-[600px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)]">
          {/* Tabs */}
          <div className="flex border-b border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => setSidebarTab('routes')}
              className={`flex-1 px-3 py-2.5 text-xs font-medium ${
                sidebarTab === 'routes'
                  ? 'border-b-2 border-emerald-500 text-[var(--vf-text)]'
                  : 'text-[var(--vf-text-mute)] hover:bg-[var(--vf-bg-sub)]'
              }`}
            >
              🚚 Camionetas ({routes.length})
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('unassigned')}
              className={`flex-1 px-3 py-2.5 text-xs font-medium ${
                sidebarTab === 'unassigned'
                  ? 'border-b-2 border-emerald-500 text-[var(--vf-text)]'
                  : 'text-[var(--vf-text-mute)] hover:bg-[var(--vf-bg-sub)]'
              }`}
            >
              📍 Sin asignar ({unassignedStores.length})
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">
            {sidebarTab === 'routes' ? (
              <RoutesTab
                routes={routes}
                colorByTempId={colorByRouteTempId}
                vehicles={vehicles}
                availableVehicles={availableVehicles}
                drivers={drivers}
                showAdd={showAddRoute}
                onShowAddChange={setShowAddRoute}
                onAddRoute={addRoute}
                onRemoveRoute={removeRoute}
                onHighlightRoute={(tempId) => {
                  // Selecciona todos los stores de esta ruta para que el user
                  // pueda verlos en el mapa (auto-zoom no implementado todavía).
                  const r = routes.find((rt) => rt.tempId === tempId);
                  if (r) setSelectedStoreIds(new Set(r.storeIds));
                }}
              />
            ) : (
              <UnassignedTab
                stores={filteredUnassigned}
                total={unassignedStores.length}
                searchQuery={unassignedSearch}
                onSearchChange={setUnassignedSearch}
                selectedStoreIds={selectedStoreIds}
                onToggleSelect={toggleSelection}
              />
            )}
          </div>

          {/* Footer del sidebar — estado + crear */}
          <div className="border-t border-[var(--color-border)] p-3">
            <div className="mb-2 flex justify-between text-xs">
              <span className="text-[var(--vf-text-mute)]">Total asignadas</span>
              <span className="font-semibold text-[var(--vf-text)]">
                {stores.length - unassignedStores.length} / {stores.length}
              </span>
            </div>
            <Button
              onClick={handleCreate}
              disabled={creating}
              isLoading={creating}
              variant="primary"
              size="lg"
              className="w-full"
            >
              {creating ? 'Creando…' : 'Crear tiro'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────

interface AssignmentToolbarProps {
  count: number;
  routes: DraftRoute[];
  colorByTempId: Map<string, string>;
  vehicles: VehicleEntry[];
  drivers: DriverEntry[];
  busy: boolean;
  onAssign: (tempId: string) => void;
  onUnassign: () => void;
  onClear: () => void;
  /** Toolbar puede pedir que el sidebar abra el form de crear camioneta —
   *  útil cuando el user selecciona stops sin haber creado ruta primero. */
  onWantCreateRoute: () => void;
}

function AssignmentToolbar({
  count,
  routes,
  colorByTempId,
  vehicles,
  drivers,
  onAssign,
  onUnassign,
  onClear,
  onWantCreateRoute,
}: AssignmentToolbarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!dropdownOpen) return;
    const close = () => setDropdownOpen(false);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', close);
    };
  }, [dropdownOpen]);

  const vehicleLabel = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? (v.alias ?? v.plate) : id.slice(0, 8);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[var(--vf-line)] bg-[var(--vf-bg-elev)] px-3 py-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white">
          {count}
        </span>
        <span className="text-xs text-[var(--vf-text)]">tienda{count === 1 ? '' : 's'} seleccionada{count === 1 ? '' : 's'}</span>

        <div className="mx-1 h-6 w-px bg-[var(--vf-line)]" />

        <div className="relative">
          {routes.length === 0 ? (
            // Sin rutas creadas todavía → botón directo que abre el form
            // de crear camioneta. Más útil que un dropdown vacío.
            <button
              type="button"
              onClick={onWantCreateRoute}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              title="Primero crea una camioneta para asignar"
            >
              ➕ Crear camioneta para asignar…
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen((v) => !v);
              }}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              ➡ Asignar a camioneta…
            </button>
          )}
          {dropdownOpen && (
            <div className="absolute bottom-full left-0 mb-2 max-h-72 w-64 overflow-y-auto rounded-lg border border-[var(--vf-line)] bg-[var(--vf-bg-elev)] py-1 shadow-2xl">
              {routes.map((r) => {
                const driverName = r.driverId
                  ? drivers.find((d) => d.id === r.driverId)?.fullName ?? 'sin chofer'
                  : 'sin chofer';
                return (
                  <button
                    key={r.tempId}
                    type="button"
                    onClick={() => {
                      setDropdownOpen(false);
                      onAssign(r.tempId);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--vf-bg-sub)]"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: colorByTempId.get(r.tempId) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[var(--vf-text)]">
                        {vehicleLabel(r.vehicleId)}
                      </div>
                      <div className="truncate text-[10px] text-[var(--vf-text-mute)]">
                        {driverName} · {r.storeIds.size} paradas
                      </div>
                    </div>
                  </button>
                );
              })}
              {/* Atajo siempre disponible para crear nueva camioneta sin
                  perder la selección actual. */}
              <div className="my-1 border-t border-[var(--vf-line)]" />
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  onWantCreateRoute();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-emerald-400 hover:bg-emerald-950/30"
              >
                <span className="grid h-3 w-3 shrink-0 place-items-center rounded-full border border-emerald-500 text-[8px]">＋</span>
                <span>Crear camioneta nueva…</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onUnassign}
          className="rounded-md border border-[var(--vf-line)] bg-[var(--vf-bg)] px-3 py-1.5 text-xs font-medium text-[var(--vf-text-mute)] hover:bg-[var(--vf-bg-sub)]"
          title="Quitar de cualquier ruta y dejar sin asignar"
        >
          ✖ Desasignar
        </button>

        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-1.5 text-xs text-[var(--vf-text-mute)] hover:bg-[var(--vf-bg-sub)]"
          title="Limpiar selección (Esc)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

interface RoutesTabProps {
  routes: DraftRoute[];
  colorByTempId: Map<string, string>;
  vehicles: VehicleEntry[];
  availableVehicles: VehicleEntry[];
  drivers: DriverEntry[];
  /** showAdd controlado externamente para que el toolbar pueda abrirlo. */
  showAdd: boolean;
  onShowAddChange: (v: boolean) => void;
  onAddRoute: (vehicleId: string, driverId: string | null) => void;
  onRemoveRoute: (tempId: string) => void;
  onHighlightRoute: (tempId: string) => void;
}

function RoutesTab({
  routes,
  colorByTempId,
  vehicles,
  availableVehicles,
  drivers,
  showAdd,
  onShowAddChange,
  onAddRoute,
  onRemoveRoute,
  onHighlightRoute,
}: RoutesTabProps) {
  const [pickVehicle, setPickVehicle] = useState('');
  const [pickDriver, setPickDriver] = useState('');

  // Inicializar el vehicle pick cuando el form se abre (controlado o no).
  useEffect(() => {
    if (showAdd && !pickVehicle && availableVehicles.length > 0) {
      setPickVehicle(availableVehicles[0]!.id);
    }
  }, [showAdd, pickVehicle, availableVehicles]);

  const vehicleLabel = (v: VehicleEntry) =>
    v.alias ? `${v.alias} (${v.plate})` : v.plate;

  return (
    <div className="space-y-2">
      {routes.length === 0 && (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
          Agrega una camioneta para empezar a asignar tiendas.
        </p>
      )}

      {routes.map((r) => {
        const v = vehicles.find((x) => x.id === r.vehicleId);
        const driverName = r.driverId
          ? drivers.find((d) => d.id === r.driverId)?.fullName ?? 'sin chofer'
          : 'sin chofer';
        return (
          <div
            key={r.tempId}
            className="rounded-md border border-[var(--vf-line)] bg-[var(--vf-bg)] p-2.5"
          >
            <div className="flex items-start gap-2">
              <span
                className="mt-1 h-3 w-3 shrink-0 rounded-full"
                style={{ background: colorByTempId.get(r.tempId) }}
              />
              <button
                type="button"
                onClick={() => onHighlightRoute(r.tempId)}
                className="flex-1 cursor-pointer text-left"
                title="Click para seleccionar todas sus paradas en el mapa"
              >
                <div className="text-sm font-medium text-[var(--vf-text)]">
                  {v ? vehicleLabel(v) : '(vehículo inválido)'}
                </div>
                <div className="text-xs text-[var(--vf-text-mute)]">
                  {driverName} · {r.storeIds.size} paradas
                </div>
              </button>
              <button
                type="button"
                onClick={() => onRemoveRoute(r.tempId)}
                className="rounded p-1 text-xs text-[var(--vf-text-mute)] hover:bg-red-950/40 hover:text-red-400"
                title="Quitar camioneta (las paradas vuelven a 'sin asignar')"
              >
                🗑
              </button>
            </div>
          </div>
        );
      })}

      {!showAdd ? (
        <button
          type="button"
          onClick={() => {
            onShowAddChange(true);
            setPickVehicle(availableVehicles[0]?.id ?? '');
            setPickDriver('');
          }}
          disabled={availableVehicles.length === 0}
          className="w-full rounded-md border border-dashed border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            availableVehicles.length === 0
              ? 'No quedan camionetas disponibles'
              : undefined
          }
        >
          ＋ Agregar camioneta
        </button>
      ) : (
        <div className="rounded-md border border-emerald-700 bg-emerald-950/20 p-2.5">
          <div className="mb-2 text-xs font-semibold text-emerald-300">
            Nueva camioneta
          </div>
          <label className="mb-1 block text-[10px] font-medium text-[var(--vf-text-mute)]">
            Camioneta
          </label>
          <select
            value={pickVehicle}
            onChange={(e) => setPickVehicle(e.target.value)}
            className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--vf-bg)] px-2 py-1 text-xs"
          >
            {availableVehicles.length === 0 && (
              <option value="">— No hay camionetas disponibles —</option>
            )}
            {availableVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {vehicleLabel(v)}
              </option>
            ))}
          </select>
          <label className="mb-1 block text-[10px] font-medium text-[var(--vf-text-mute)]">
            Chofer (opcional)
          </label>
          <select
            value={pickDriver}
            onChange={(e) => setPickDriver(e.target.value)}
            className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--vf-bg)] px-2 py-1 text-xs"
          >
            <option value="">— Sin chofer asignado —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={!pickVehicle}
              onClick={() => {
                onAddRoute(pickVehicle, pickDriver || null);
                onShowAddChange(false);
              }}
              className="flex-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Agregar
            </button>
            <button
              type="button"
              onClick={() => onShowAddChange(false)}
              className="rounded border border-[var(--vf-line)] px-2 py-1 text-xs text-[var(--vf-text-mute)]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface UnassignedTabProps {
  stores: StoreEntry[];
  total: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedStoreIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

function UnassignedTab({
  stores,
  total,
  searchQuery,
  onSearchChange,
  selectedStoreIds,
  onToggleSelect,
}: UnassignedTabProps) {
  return (
    <div className="flex h-full flex-col">
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Buscar por código o nombre…"
        className="mb-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--vf-bg)] px-3 py-1.5 text-xs"
      />
      {stores.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
          {total === 0
            ? '🎉 Todas las tiendas asignadas.'
            : `Sin resultados para "${searchQuery}".`}
        </p>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {stores.map((s) => {
            const sel = selectedStoreIds.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onToggleSelect(s.id)}
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    sel
                      ? 'bg-emerald-950/40 text-emerald-200'
                      : 'hover:bg-[var(--vf-bg-sub)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={sel}
                    readOnly
                    className="mt-0.5 h-3 w-3 cursor-pointer"
                    style={{ accentColor: '#10b981' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{s.code}</span>
                    </div>
                    <div className="truncate text-[var(--vf-text-mute)]">{s.name}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
