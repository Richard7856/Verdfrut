'use client';

// Mapa interactivo de todas las tiendas:
// - Marcador draggable por tienda (drag persiste lat/lng + coord_verified=true).
// - Filtros: search (code/name), zona, solo no verificadas.
// - Search Google Places overlay: typeahead → click → card "agregar tienda".
// - Click en marker → popup con datos + link a editar.

import { useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import { Button, Card, Input, Badge } from '@tripdrive/ui';
import { logger } from '@tripdrive/observability';
import {
  updateStoreLocationAction,
  createStoreFromPlaceAction,
} from './actions';

export interface StoreMarker {
  id: string;
  code: string;
  name: string;
  address: string;
  zoneId: string;
  zoneCode: string;
  lat: number;
  lng: number;
  coordVerified: boolean;
  isActive: boolean;
}

export interface ZoneOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  stores: StoreMarker[];
  zones: ZoneOption[];
  mapboxToken: string;
}

interface PlaceCandidate {
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string;
  types: string[];
  rating?: number;
}

const ZONE_COLORS: Record<string, string> = {
  CDMX: '#16a34a',
  TOL: '#2563eb',
  GDL: '#dc2626',
  MTY: '#f59e0b',
  default: '#6b7280',
};

function zoneColor(code: string): string {
  // Match por prefijo conocido o hash simple para zonas custom.
  for (const [k, v] of Object.entries(ZONE_COLORS)) {
    if (k !== 'default' && code.startsWith(k)) return v;
  }
  return ZONE_COLORS.default ?? '#6b7280';
}

export function StoresMap({ stores, zones, mapboxToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const proposalMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);

  // Google Places
  const [placesQuery, setPlacesQuery] = useState('');
  const [placesResults, setPlacesResults] = useState<PlaceCandidate[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [proposal, setProposal] = useState<PlaceCandidate | null>(null);

  // Toast simple
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Stores filtradas
  const filteredStores = useMemo(() => {
    const q = search.toLowerCase().trim();
    return stores.filter((s) => {
      if (!s.isActive) return false;
      if (zoneFilter !== 'all' && s.zoneId !== zoneFilter) return false;
      if (unverifiedOnly && s.coordVerified) return false;
      if (q && !s.code.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [stores, search, zoneFilter, unverifiedOnly]);

  // Init mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    setMapboxToken(mapboxToken);

    // BBox de todas las tiendas para centrar el mapa inicial.
    const allPoints = stores.filter((s) => s.isActive).map((s): [number, number] => [s.lng, s.lat]);
    if (allPoints.length === 0) {
      // Default México DF
      allPoints.push([-99.1332, 19.4326]);
    }
    const bounds = new mapboxgl.LngLatBounds();
    for (const p of allPoints) bounds.extend(p);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      bounds,
      fitBoundsOptions: { padding: 60, maxZoom: 12 },
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // Init solo una vez — los markers se manejan en el siguiente effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  // Sincronizar markers con filteredStores. Re-crea cuando cambia el filtro.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const desired = new Set(filteredStores.map((s) => s.id));

    // Quitar markers que ya no aplican.
    for (const [id, marker] of markersRef.current.entries()) {
      if (!desired.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Agregar / actualizar markers.
    for (const s of filteredStores) {
      let marker = markersRef.current.get(s.id);
      if (marker) {
        marker.setLngLat([s.lng, s.lat]);
        continue;
      }
      const el = document.createElement('div');
      const color = zoneColor(s.zoneCode);
      el.style.cssText =
        `width:22px;height:22px;background:${color};` +
        `border:${s.coordVerified ? '2px solid white' : '2px dashed white'};` +
        `border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4);cursor:grab;`;
      el.title = `${s.code} — arrastra para mover`;

      const popupHTML =
        `<div style="font-family:ui-sans-serif;color:#0f172a;min-width:200px">` +
        `<div style="font-weight:700;font-size:13px">${s.code}</div>` +
        `<div style="font-size:13px;margin:2px 0">${s.name}</div>` +
        `<div style="font-size:11px;color:#64748b;line-height:1.3">${s.address}</div>` +
        `<div style="margin-top:6px;display:flex;gap:6px;font-size:10px">` +
        `<span style="padding:2px 6px;background:${color};color:white;border-radius:3px">${s.zoneCode}</span>` +
        (s.coordVerified
          ? `<span style="padding:2px 6px;background:#16a34a;color:white;border-radius:3px">✓ Verificada</span>`
          : `<span style="padding:2px 6px;background:#f59e0b;color:white;border-radius:3px">Sin verificar</span>`) +
        `</div>` +
        `<a href="/settings/stores/${s.id}" style="display:inline-block;margin-top:8px;padding:5px 10px;background:#15803d;color:white;border-radius:4px;text-decoration:none;font-size:11px;font-weight:600">Editar →</a>` +
        `</div>`;

      marker = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'center' })
        .setLngLat([s.lng, s.lat])
        .setPopup(new mapboxgl.Popup({ offset: 14, maxWidth: '280px' }).setHTML(popupHTML))
        .addTo(map);

      marker.on('dragend', async () => {
        const lngLat = marker!.getLngLat();
        const lat = lngLat.lat;
        const lng = lngLat.lng;
        const res = await updateStoreLocationAction({
          storeId: s.id,
          lat,
          lng,
        });
        if (res.ok) {
          setToast({ msg: `${s.code}: ubicación actualizada y verificada.`, tone: 'ok' });
          // Re-render del marker con border sólido (verificada).
          (marker!.getElement() as HTMLDivElement).style.border = '2px solid white';
        } else {
          setToast({ msg: `${s.code}: ${res.error ?? 'no se pudo guardar'}`, tone: 'err' });
          // Revertir visualmente al lat/lng original.
          marker!.setLngLat([s.lng, s.lat]);
        }
      });

      markersRef.current.set(s.id, marker);
    }
  }, [filteredStores]);

  // Google Places search
  async function runPlacesSearch() {
    const q = placesQuery.trim();
    if (q.length < 3) return;
    setPlacesLoading(true);
    setPlacesResults([]);
    try {
      // Centro del viewport actual para localizar la búsqueda.
      const center = mapRef.current?.getCenter();
      const params = new URLSearchParams({ q });
      if (center) {
        params.set('lat', String(center.lat));
        params.set('lng', String(center.lng));
      }
      const res = await fetch(`/api/stores/places-search?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setToast({ msg: body.error ?? 'Búsqueda falló', tone: 'err' });
        return;
      }
      const data = (await res.json()) as { results: PlaceCandidate[] };
      setPlacesResults(data.results);
      if (data.results.length === 0) {
        setToast({ msg: 'Sin resultados.', tone: 'err' });
      }
    } catch (err) {
      void logger.error('[stores-map.places]', { err });
      setToast({ msg: 'Error de conexión.', tone: 'err' });
    } finally {
      setPlacesLoading(false);
    }
  }

  function showProposal(p: PlaceCandidate) {
    setProposal(p);
    const map = mapRef.current;
    if (!map) return;

    if (proposalMarkerRef.current) {
      proposalMarkerRef.current.remove();
      proposalMarkerRef.current = null;
    }

    const el = document.createElement('div');
    el.style.cssText =
      `width:28px;height:28px;background:#dc2626;border:3px solid white;` +
      `border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.5);` +
      `display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;`;
    el.textContent = '+';

    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([p.lng, p.lat])
      .addTo(map);
    proposalMarkerRef.current = marker;

    map.flyTo({ center: [p.lng, p.lat], zoom: 16 });
  }

  function dismissProposal() {
    setProposal(null);
    proposalMarkerRef.current?.remove();
    proposalMarkerRef.current = null;
  }

  // BBox change cuando cambia el filtro y hay datos.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || filteredStores.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const s of filteredStores) bounds.extend([s.lng, s.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 800 });
  }, [filteredStores.length, zoneFilter, unverifiedOnly]);

  if (!mapboxToken) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-sm text-[var(--color-text-muted)]">
        Mapa deshabilitado: configura <code className="mx-1">NEXT_PUBLIC_MAPBOX_TOKEN</code>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filtros */}
      <Card className="border-[var(--color-border)]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
          <Input
            type="search"
            placeholder="Buscar por código o nombre (ej. TOL-1422, NETO Centro)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 text-sm"
            style={{ color: 'var(--color-text)' }}
          >
            <option value="all">Todas las zonas</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} — {z.name}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={unverifiedOnly}
              onChange={(e) => setUnverifiedOnly(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            <span style={{ color: 'var(--color-text)' }}>Sin verificar</span>
          </label>
        </div>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
          {filteredStores.length} / {stores.length} tienda(s). Borde sólido =
          coords verificadas. Punteado = aún sin verificar. Arrastra el pin
          para corregir.
        </p>
      </Card>

      {/* Mapa + panel Places */}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="relative">
          <div
            ref={containerRef}
            style={{ isolation: 'isolate', transform: 'translateZ(0)' }}
            className="h-[600px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
          />
          {toast && (
            <div
              role="status"
              className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs font-medium shadow-md"
              style={{
                background:
                  toast.tone === 'ok'
                    ? 'color-mix(in oklch, var(--vf-bg-elev) 80%, var(--vf-green-500) 20%)'
                    : 'color-mix(in oklch, var(--vf-bg-elev) 80%, var(--vf-crit, #dc2626) 20%)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            >
              {toast.msg}
            </div>
          )}
        </div>

        {/* Panel Google Places */}
        <div className="flex flex-col gap-3">
          <Card className="border-[var(--color-border)]">
            <h3
              className="mb-2 text-[13px] font-semibold"
              style={{ color: 'var(--vf-text)' }}
            >
              🔍 Buscar en Google
            </h3>
            <p
              className="mb-2 text-[11px]"
              style={{ color: 'var(--vf-text-mute)' }}
            >
              Escribe nombre + zona (ej. &quot;Neta Interlomas&quot;). Se busca
              cerca del centro del mapa actual.
            </p>
            <div className="flex gap-2">
              <Input
                value={placesQuery}
                onChange={(e) => setPlacesQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runPlacesSearch();
                  }
                }}
                placeholder="Neta Interlomas"
              />
              <Button
                onClick={() => void runPlacesSearch()}
                disabled={placesLoading || placesQuery.trim().length < 3}
              >
                {placesLoading ? '…' : 'Buscar'}
              </Button>
            </div>

            {placesResults.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {placesResults.map((p) => (
                  <li key={p.place_id}>
                    <button
                      type="button"
                      onClick={() => showProposal(p)}
                      className="block w-full rounded-[var(--radius-md)] border border-[var(--color-border)] p-2 text-left transition-colors hover:bg-[var(--vf-surface-2)]"
                      style={{
                        background:
                          proposal?.place_id === p.place_id
                            ? 'color-mix(in oklch, var(--vf-bg) 80%, var(--vf-green-500) 20%)'
                            : 'transparent',
                      }}
                    >
                      <p
                        className="text-[12.5px] font-medium"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {p.name}
                      </p>
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{ color: 'var(--vf-text-mute)' }}
                      >
                        {p.formatted_address}
                      </p>
                      {p.rating && (
                        <p
                          className="mt-1 text-[10px]"
                          style={{ color: 'var(--vf-text-faint)' }}
                        >
                          ⭐ {p.rating.toFixed(1)}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {proposal && (
            <ProposalCard
              proposal={proposal}
              zones={zones}
              onDismiss={dismissProposal}
              onSuccess={(msg) => {
                setToast({ msg, tone: 'ok' });
                dismissProposal();
                // Reload de la página para que aparezca la tienda nueva.
                setTimeout(() => window.location.reload(), 500);
              }}
              onError={(msg) => setToast({ msg, tone: 'err' })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  zones,
  onDismiss,
  onSuccess,
  onError,
}: {
  proposal: PlaceCandidate;
  zones: ZoneOption[];
  onDismiss: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [code, setCode] = useState('');
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
  const [pending, setPending] = useState(false);

  async function handleCreate() {
    if (!code.trim() || !zoneId) {
      onError('Falta código o zona.');
      return;
    }
    setPending(true);
    const res = await createStoreFromPlaceAction({
      code: code.trim(),
      name: proposal.name,
      address: proposal.formatted_address,
      lat: proposal.lat,
      lng: proposal.lng,
      zoneId,
    });
    setPending(false);
    if (res.ok) {
      onSuccess(`Tienda ${code.toUpperCase()} creada.`);
    } else {
      onError(res.error ?? 'Error al crear');
    }
  }

  return (
    <Card className="border-[var(--vf-green-500)] bg-[var(--vf-surface-2)]">
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-[13px] font-semibold"
          style={{ color: 'var(--vf-text)' }}
        >
          Agregar tienda
        </h3>
        <Badge tone="success">Pin en mapa</Badge>
      </div>
      <p
        className="mt-1 text-[12px] font-medium"
        style={{ color: 'var(--color-text)' }}
      >
        {proposal.name}
      </p>
      <p
        className="mt-0.5 text-[11px]"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        {proposal.formatted_address}
      </p>
      <p className="mt-1 text-[10px] font-mono" style={{ color: 'var(--vf-text-faint)' }}>
        {proposal.lat.toFixed(5)}, {proposal.lng.toFixed(5)}
      </p>

      <div className="mt-3 space-y-2">
        <div>
          <label
            className="mb-1 block text-[11px] font-medium"
            style={{ color: 'var(--vf-text-mute)' }}
          >
            Código (ej. CDMX-9999)
          </label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CDMX-9999"
            maxLength={30}
          />
        </div>
        <div>
          <label
            className="mb-1 block text-[11px] font-medium"
            style={{ color: 'var(--vf-text-mute)' }}
          >
            Zona
          </label>
          <select
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 text-sm"
            style={{ color: 'var(--color-text)' }}
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} — {z.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={handleCreate} disabled={pending || !code.trim()}>
          {pending ? 'Creando…' : 'Crear tienda'}
        </Button>
      </div>
    </Card>
  );
}
