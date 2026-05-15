'use client';

// Client component del flow de importación masiva de tiendas.
// Stream UI-1 / 2026-05-15.
//
// Layout 2 columnas:
//   - Izq: panel con upload + stats + lista de filas con status y selección.
//   - Der: mapa Mapbox con un pin por fila (color según status).
// El user puede:
//   - Click fila → highlighting del pin (zoom + popup).
//   - Para dudosas/fallidas: click "Buscar alternativa" → Places search.
//   - Checkbox por fila + zona destino + botón "Importar".

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import {
  bulkImportStores,
  parseAndGeocodeXlsx,
  searchPlaceAlternatives,
  type ImportRow,
  type ParseAndGeocodeResult,
  type PlaceAlternative,
} from './actions';

interface RowState extends ImportRow {
  /** Si el user corrigió la geocodificación con un Place alternativo. */
  override: PlaceAlternative | null;
  /** Si está seleccionada para importar. */
  selected: boolean;
}

// Determina el tier de calidad final (post-override).
function rowTier(r: RowState): 'ok' | 'doubtful' | 'failed' {
  if (r.override) return 'ok'; // user confirmó manualmente
  if (!r.geocoded) return 'failed';
  if (['rooftop', 'range_interpolated'].includes(r.geocoded.quality)) return 'ok';
  return 'doubtful';
}

// Coords actuales (override gana si existe).
function rowCoords(r: RowState): { lat: number; lng: number } | null {
  if (r.override) return { lat: r.override.lat, lng: r.override.lng };
  if (r.geocoded) return { lat: r.geocoded.lat, lng: r.geocoded.lng };
  return null;
}

function rowAddress(r: RowState): string {
  if (r.override) return r.override.formatted_address;
  if (r.geocoded) return r.geocoded.formatted_address;
  return r.rawAddress;
}

// Colores por tier (Tailwind-friendly hex para Mapbox).
const TIER_COLOR: Record<'ok' | 'doubtful' | 'failed', string> = {
  ok: '#10b981', // green-500
  doubtful: '#f59e0b', // amber-500
  failed: '#ef4444', // red-500
};

const TIER_LABEL: Record<'ok' | 'doubtful' | 'failed', { emoji: string; text: string }> = {
  ok: { emoji: '✅', text: 'OK' },
  doubtful: { emoji: '⚠️', text: 'Revisar' },
  failed: { emoji: '❌', text: 'Sin match' },
};

interface Props {
  mapboxToken: string;
}

export function ImportClient({ mapboxToken }: Props) {
  // ─── Estado top-level ───
  const [parseResult, setParseResult] = useState<ParseAndGeocodeResult | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null);
  const [parsing, startParsing] = useTransition();
  const [importing, startImporting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  // ─── Mapa ───
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());

  // Init mapa una vez.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    if (!mapboxToken) return;
    setMapboxToken(mapboxToken);
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-99.13, 19.43], // CDMX centro
      zoom: 10,
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

  // Re-render markers cuando cambia rows.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Quitar markers viejos.
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    const bounds = new mapboxgl.LngLatBounds();
    let added = 0;
    for (const r of rows) {
      const c = rowCoords(r);
      if (!c) continue;
      const tier = rowTier(r);
      const el = document.createElement('div');
      el.style.cssText = `
        width: 22px; height: 22px; border-radius: 50%;
        background: ${TIER_COLOR[tier]};
        border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        cursor: pointer;
        ${focusedRowIdx === r.rowIdx ? 'transform: scale(1.5); z-index: 10;' : ''}
      `;
      el.addEventListener('click', () => setFocusedRowIdx(r.rowIdx));
      const marker = new mapboxgl.Marker(el)
        .setLngLat([c.lng, c.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 16 }).setHTML(
            `<div style="font-size:13px"><strong>${escapeHtml(r.rawName)}</strong><br>${escapeHtml(rowAddress(r))}</div>`,
          ),
        )
        .addTo(map);
      markersRef.current.set(r.rowIdx, marker);
      bounds.extend([c.lng, c.lat]);
      added++;
    }
    if (added > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 600 });
    }
  }, [rows, focusedRowIdx]);

  // Zoom al focused.
  useEffect(() => {
    if (focusedRowIdx == null) return;
    const map = mapRef.current;
    if (!map) return;
    const r = rows.find((x) => x.rowIdx === focusedRowIdx);
    if (!r) return;
    const c = rowCoords(r);
    if (!c) return;
    map.flyTo({ center: [c.lng, c.lat], zoom: 14, duration: 700 });
    const marker = markersRef.current.get(focusedRowIdx);
    marker?.togglePopup();
  }, [focusedRowIdx, rows]);

  // ─── Handlers ───
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setError(null);
      setImportResult(null);
      startParsing(async () => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await parseAndGeocodeXlsx(formData);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setParseResult(res.data);
        setRows(
          res.data.rows.map((r) => ({
            ...r,
            override: null,
            // Default: las OK + dudosas seleccionadas, las fallidas no.
            selected: r.geocoded != null,
          })),
        );
        if (res.data.zonesAvailable.length > 0) {
          setSelectedZoneId(res.data.zonesAvailable[0]!.id);
        }
      });
    },
    [],
  );

  const handleImport = useCallback(() => {
    setError(null);
    const toImport = rows.filter((r) => r.selected && rowCoords(r));
    if (toImport.length === 0) {
      setError('Selecciona al menos una tienda con coords resueltas.');
      return;
    }
    if (!selectedZoneId) {
      setError('Selecciona una zona destino.');
      return;
    }
    startImporting(async () => {
      const payload = toImport.map((r) => {
        const c = rowCoords(r)!;
        return {
          code: r.code,
          name: r.rawName,
          address: rowAddress(r),
          lat: c.lat,
          lng: c.lng,
          zone_id: selectedZoneId,
        };
      });
      const res = await bulkImportStores(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const { created, skipped_duplicates, failed } = res.data;
      setImportResult(
        `✅ ${created} tienda(s) creada(s). ${skipped_duplicates} duplicado(s) ignoradas. ${failed.length} fallaron.`,
      );
      // Limpiar para nueva carga.
      setRows([]);
      setParseResult(null);
    });
  }, [rows, selectedZoneId]);

  // ─── Render ───
  return (
    <div className="flex h-[calc(100vh-4rem)] w-full">
      {/* Panel izquierdo */}
      <div className="w-[420px] shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-4">
        <h1 className="mb-1 text-xl font-semibold">Importar tiendas</h1>
        <p className="mb-4 text-sm text-zinc-400">
          Sube un Excel con columnas <code className="text-zinc-200">name</code> +{' '}
          <code className="text-zinc-200">address</code>. El sistema geocodifica y muestra cada
          tienda en el mapa. Valida visualmente antes de importar.
        </p>

        {/* Upload */}
        {!parseResult && (
          <label className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-900 p-8 text-center hover:border-zinc-600">
            <span className="mb-2 text-3xl">📊</span>
            <span className="text-sm text-zinc-300">
              {parsing ? 'Procesando…' : 'Click para subir XLSX'}
            </span>
            <span className="mt-1 text-xs text-zinc-500">o arrastra aquí</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={parsing}
              onChange={handleFileUpload}
            />
          </label>
        )}

        {parsing && (
          <div className="mb-4 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-300">
            ⏳ Procesando archivo y geocodificando con Google Maps…
            <div className="mt-2 text-xs text-zinc-500">Esto puede tardar 10-30 segundos.</div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            ❌ {error}
          </div>
        )}

        {importResult && (
          <div className="mb-4 rounded-lg border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">
            {importResult}
          </div>
        )}

        {/* Stats + zona destino + lista de filas */}
        {parseResult && (
          <>
            <div className="mb-4 rounded-lg bg-zinc-900 p-3 text-sm">
              <div className="font-semibold">{parseResult.stats.total} tiendas detectadas</div>
              <div className="mt-1 flex gap-3 text-xs">
                <span className="text-emerald-400">✅ {parseResult.stats.ok} OK</span>
                <span className="text-amber-400">⚠️ {parseResult.stats.doubtful} revisar</span>
                <span className="text-red-400">❌ {parseResult.stats.failed} fallaron</span>
              </div>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Zona destino *
              </label>
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              >
                <option value="">— Selecciona zona —</option>
                {parseResult.zonesAvailable.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4 space-y-2">
              {rows.map((r) => (
                <RowItem
                  key={r.rowIdx}
                  row={r}
                  isFocused={focusedRowIdx === r.rowIdx}
                  onFocus={() => setFocusedRowIdx(r.rowIdx)}
                  onToggleSelect={() =>
                    setRows((prev) =>
                      prev.map((x) =>
                        x.rowIdx === r.rowIdx ? { ...x, selected: !x.selected } : x,
                      ),
                    )
                  }
                  onApplyOverride={(alt) => {
                    setRows((prev) =>
                      prev.map((x) =>
                        x.rowIdx === r.rowIdx
                          ? { ...x, override: alt, selected: true }
                          : x,
                      ),
                    );
                    setFocusedRowIdx(r.rowIdx);
                  }}
                />
              ))}
            </div>

            <button
              onClick={handleImport}
              disabled={importing || !selectedZoneId}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-700"
            >
              {importing
                ? 'Importando…'
                : `Importar ${rows.filter((r) => r.selected && rowCoords(r)).length} tienda(s)`}
            </button>

            <button
              onClick={() => {
                setParseResult(null);
                setRows([]);
                setError(null);
                setImportResult(null);
              }}
              className="mt-2 w-full rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Cancelar / Subir otro
            </button>
          </>
        )}
      </div>

      {/* Mapa */}
      <div className="relative flex-1 bg-zinc-950">
        {!mapboxToken && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
            <div className="rounded-lg bg-zinc-900 p-6 text-center">
              <div className="text-2xl">🗺️</div>
              <div className="mt-2 text-sm">
                Falta <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> en el env.
              </div>
            </div>
          </div>
        )}
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// RowItem — una fila con su status, checkbox, y acciones contextuales.
// ─────────────────────────────────────────────────────────────────

interface RowItemProps {
  row: RowState;
  isFocused: boolean;
  onFocus: () => void;
  onToggleSelect: () => void;
  onApplyOverride: (alt: PlaceAlternative) => void;
}

function RowItem({ row, isFocused, onFocus, onToggleSelect, onApplyOverride }: RowItemProps) {
  const tier = rowTier(row);
  const label = TIER_LABEL[tier];
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [alternatives, setAlternatives] = useState<PlaceAlternative[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState(row.rawName || row.rawAddress);

  const handleSearch = useCallback(async () => {
    setSearching(true);
    try {
      const res = await searchPlaceAlternatives(searchQuery);
      if (res.ok) {
        setAlternatives(res.data);
      } else {
        setAlternatives([]);
      }
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const canSelect = rowCoords(row) != null;

  return (
    <div
      className={`rounded-lg border p-2 transition-colors ${
        isFocused
          ? 'border-emerald-700 bg-emerald-950/30'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={row.selected}
          disabled={!canSelect}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5"
        />
        <button
          onClick={onFocus}
          className="flex-1 cursor-pointer text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-100">{row.rawName || '(sin nombre)'}</span>
            <span className="text-xs text-zinc-500">{row.code}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">{rowAddress(row)}</div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={`rounded px-1.5 py-0.5 ${
                tier === 'ok'
                  ? 'bg-emerald-900/50 text-emerald-300'
                  : tier === 'doubtful'
                  ? 'bg-amber-900/50 text-amber-300'
                  : 'bg-red-900/50 text-red-300'
              }`}
            >
              {label.emoji} {label.text}
            </span>
            {row.override && <span className="text-xs text-emerald-400">corregida</span>}
            {row.geocodeError && !row.override && (
              <span className="text-xs text-red-400" title={row.geocodeError}>
                · {row.geocodeError.slice(0, 30)}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Acciones contextuales */}
      {(tier === 'doubtful' || tier === 'failed') && (
        <div className="mt-2">
          {!showAlternatives ? (
            <button
              onClick={() => {
                setShowAlternatives(true);
                if (!alternatives) handleSearch();
              }}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              🔍 Buscar alternativas en Google
            </button>
          ) : (
            <div className="mt-2 rounded border border-zinc-700 bg-zinc-950 p-2">
              <div className="mb-1 flex gap-1">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                  placeholder="Nombre, dirección, lugar…"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700 disabled:opacity-50"
                >
                  {searching ? '…' : 'Buscar'}
                </button>
              </div>
              {alternatives && alternatives.length === 0 && (
                <div className="text-xs text-zinc-500">Sin resultados.</div>
              )}
              {alternatives && alternatives.length > 0 && (
                <div className="space-y-1">
                  {alternatives.map((alt) => (
                    <button
                      key={alt.place_id}
                      onClick={() => {
                        onApplyOverride(alt);
                        setShowAlternatives(false);
                      }}
                      className="block w-full rounded border border-zinc-800 bg-zinc-900 p-1.5 text-left text-xs hover:border-emerald-700 hover:bg-emerald-950/30"
                    >
                      <div className="font-medium text-zinc-200">{alt.name}</div>
                      <div className="truncate text-zinc-500">{alt.formatted_address}</div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowAlternatives(false)}
                className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                ✕ cerrar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
