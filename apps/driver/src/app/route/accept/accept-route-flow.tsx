'use client';

// ADR-125: flow de aceptación de orden del chofer.
// ADR-127 (fix 2026-05-17): el marker management original usaba
// `element.replaceWith(newEl)` que rompía el `transform: translate(...)`
// que Mapbox aplica para posicionar pines — los pines desaparecían del
// mapa al primer re-render. Ahora destruimos y re-creamos markers limpio
// cada vez que cambia mode o customOrder. Además agregamos el depot
// (CEDIS) como pin verde sin número.
//
// Pantalla full-screen con mapa Mapbox + barra inferior de acciones. El chofer:
//
//   1. Ve el mapa con todas las paradas marcadas con números (orden sugerido)
//      + el CEDIS de salida marcado como pin verde.
//   2. Elige UNA opción:
//      a) "Usar orden sugerido" → submit (orderedStopIds=null), va a /route.
//      b) "Definir mi orden"   → entra a modo tap. Cada vez que tappea un pin
//         se le asigna el siguiente número. Al final, "Guardar mi orden"
//         submitea con los IDs en el orden tappeado.
//
// El servidor (confirmDriverOrderAction) marca routes.driver_order_confirmed_at
// para que la próxima apertura no repita este flow.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import { Button } from '@tripdrive/ui';
import { confirmDriverOrderAction } from '../actions';

interface StopForMap {
  stopId: string;
  storeCode: string;
  storeName: string;
  lat: number;
  lng: number;
  /** Orden propuesto por el optimizer/admin al publicar. */
  suggestedSequence: number;
  /** Orden actual en BD (igual al sugerido en este punto del flow). */
  currentSequence: number;
  status: 'pending' | 'arrived' | 'completed' | 'skipped';
}

interface DepotForMap {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  routeName: string;
  stops: StopForMap[];
  depot: DepotForMap | null;
  mapboxToken: string;
}

type Mode = 'suggested' | 'custom';

export function AcceptRouteFlow({ routeName, stops, depot, mapboxToken }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const stopMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const depotMarkerRef = useRef<mapboxgl.Marker | null>(null);
  // Latched flag — true cuando 'load' del mapa terminó. Markers se montan a
  // partir de ahí y cualquier cambio de mode trigger re-mount.
  const [mapReady, setMapReady] = useState(false);

  const [mode, setMode] = useState<Mode>('suggested');
  // Stops tappeados por el chofer en modo custom — array ordenado de stopIds.
  // El índice + 1 = el número que se muestra en el pin.
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Stops pending vs no-pending. El flow solo permite re-ordenar pending —
  // las completadas/arrived/skipped mantienen su orden histórico.
  const pendingStops = stops.filter((s) => s.status === 'pending');

  // ───── Map init (una sola vez) ─────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!mapboxToken) {
      setError('Mapbox token no configurado. Avísale a tu encargado.');
      return;
    }
    setMapboxToken(mapboxToken);

    // DIAGNÓSTICO ADR-127: logs para confirmar qué coords llegan al client.
    // Si user reporta pines fuera de lugar, abrir DevTools Console y revisar.
    // Quitar estos logs cuando el bug esté confirmado resuelto.
    // eslint-disable-next-line no-console
    console.log('[accept-route] stops recibidos:', stops.map((s) => ({
      code: s.storeCode,
      lat: s.lat,
      lng: s.lng,
      latType: typeof s.lat,
      lngType: typeof s.lng,
    })));
    // eslint-disable-next-line no-console
    console.log('[accept-route] depot recibido:', depot ? {
      code: depot.code,
      lat: depot.lat,
      lng: depot.lng,
      latType: typeof depot.lat,
      lngType: typeof depot.lng,
    } : null);

    // Compute bounds incluyendo paradas + depot. Si solo hay 1 punto o están
    // todos en la misma coord, expandimos artificialmente para evitar zoom 22.
    // ADR-127: Number() defensivo aquí también — Supabase numeric llega como
    // string en algunos casos y `bounds`/`setLngLat` de mapbox-gl no proyectan
    // bien con strings (los pines salían fuera del viewport).
    const allPoints: Array<{ lat: number; lng: number }> = stops.map((s) => ({
      lat: Number(s.lat),
      lng: Number(s.lng),
    }));
    if (depot) allPoints.push({ lat: Number(depot.lat), lng: Number(depot.lng) });
    // Filtrar puntos con NaN — si algún coord viene corrupto, mejor saltarlo
    // que reventar el bbox.
    const validPoints = allPoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    if (validPoints.length === 0) {
      setError('No hay coordenadas válidas para mostrar en el mapa.');
      return;
    }
    const lats = validPoints.map((p) => p.lat);
    const lngs = validPoints.map((p) => p.lng);
    let minLng = Math.min(...lngs);
    let maxLng = Math.max(...lngs);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    // Si bbox degenerado (puntos demasiado cerca o un solo punto), expandir.
    if (maxLng - minLng < 0.005) {
      const center = (minLng + maxLng) / 2;
      minLng = center - 0.005;
      maxLng = center + 0.005;
    }
    if (maxLat - minLat < 0.005) {
      const center = (minLat + maxLat) / 2;
      minLat = center - 0.005;
      maxLat = center + 0.005;
    }
    // Guardamos el bbox para refit después de map.on('load') — el constructor
    // bounds a veces se ignora si el contenedor cambió de tamaño antes del 'load'.
    const computedBounds: [[number, number], [number, number]] = [
      [minLng, minLat],
      [maxLng, maxLat],
    ];

    // ADR-127 fix v4: NO bounds en el constructor — usar setCenter/setZoom
    // en map.on('load') para evitar conflicto con el fitBounds del init.
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      // Centro inicial = centro de los puntos (se ajusta de nuevo en load).
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      zoom: 11,
      attributionControl: false,
    });

    mapRef.current = map;
    // ADR-125 fix v4: bypass fitBounds, usar setCenter + setZoom directo.
    // fitBounds tiene comportamiento sospechoso (pines aparecían 0.37° al sur).
    // Calculamos manualmente el centro de los puntos y un zoom razonable.
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    // Zoom basado en spread: spread chico (1-5km) = zoom 13-14, mayor = zoom 12.
    const spreadKm = Math.max(
      (maxLng - minLng) * 111 * Math.cos((centerLat * Math.PI) / 180),
      (maxLat - minLat) * 111,
    );
    const targetZoom = spreadKm < 2 ? 14 : spreadKm < 5 ? 13 : spreadKm < 15 ? 12 : 11;

    // DIAGNÓSTICO ADR-127: log de lo que vamos a aplicar a Mapbox.
    // eslint-disable-next-line no-console
    console.log('[accept-route] map config:', {
      computedBounds,
      centerLng,
      centerLat,
      spreadKm,
      targetZoom,
    });

    const handleMapLoaded = () => {
      // Aplicar centro + zoom explícito en lugar de fitBounds.
      map.setCenter([centerLng, centerLat]);
      map.setZoom(targetZoom);
      // eslint-disable-next-line no-console
      console.log('[accept-route] map ready, center=', map.getCenter(), 'zoom=', map.getZoom());
      setMapReady(true);
    };
    if (map.loaded()) {
      handleMapLoaded();
    } else {
      map.on('load', handleMapLoaded);
    }

    return () => {
      // Cleanup markers explícitos antes de remover el map.
      for (const m of stopMarkersRef.current.values()) m.remove();
      stopMarkersRef.current.clear();
      if (depotMarkerRef.current) {
        depotMarkerRef.current.remove();
        depotMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // Map init solo depende del token + bounds inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───── Render markers cuando map listo + cuando cambia mode/customOrder ─────
  // Estrategia: destruir TODOS los markers y re-crear desde cero. Es O(N) por
  // re-render pero N≤30 paradas típico y los markers son ligeros. Más simple
  // y robusto que mutar elementos con replaceWith (rompía el transform).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Cleanup previos.
    for (const m of stopMarkersRef.current.values()) m.remove();
    stopMarkersRef.current.clear();

    // Depot solo se monta una vez (no depende del mode).
    // ADR-127 v4: usar mapboxgl.LngLat() explícito en vez de array — más
    // determinista (algunos paths del SDK aceptan array pero interpretan
    // [lng, lat] vs [lat, lng] inconsistentemente entre versiones).
    if (depot && !depotMarkerRef.current) {
      const depotLng = Number(depot.lng);
      const depotLat = Number(depot.lat);
      if (Number.isFinite(depotLng) && Number.isFinite(depotLat)) {
        const depotEl = createDepotMarkerElement(depot);
        depotMarkerRef.current = new mapboxgl.Marker({ element: depotEl, anchor: 'bottom' })
          .setLngLat(new mapboxgl.LngLat(depotLng, depotLat))
          .addTo(map);
        // eslint-disable-next-line no-console
        console.log('[accept-route] depot marker @', depotLng, depotLat);
      }
    }

    // Stops: crear marker fresh con el elemento del mode actual.
    for (const stop of stops) {
      const stopLng = Number(stop.lng);
      const stopLat = Number(stop.lat);
      if (!Number.isFinite(stopLng) || !Number.isFinite(stopLat)) continue;
      const el = createStopMarkerElement(stop, mode, customOrder);
      if (mode === 'custom' && stop.status === 'pending') {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => handleTapStop(stop.stopId));
      }
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(new mapboxgl.LngLat(stopLng, stopLat))
        .addTo(map);
      stopMarkersRef.current.set(stop.stopId, marker);
      // eslint-disable-next-line no-console
      console.log('[accept-route] stop marker', stop.storeCode, '@', stopLng, stopLat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, customOrder]);

  // ───── Handlers ─────

  const handleTapStop = useCallback((stopId: string) => {
    setError(null);
    setCustomOrder((prev) => {
      // Si ya está en la lista, lo quitamos (toggle off, re-numera el resto).
      if (prev.includes(stopId)) {
        return prev.filter((id) => id !== stopId);
      }
      return [...prev, stopId];
    });
  }, []);

  const handleResetOrder = useCallback(() => {
    setCustomOrder([]);
    setError(null);
  }, []);

  const handleAcceptSuggested = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const res = await confirmDriverOrderAction(null);
      if (!res.ok) {
        setError(res.error ?? 'No se pudo confirmar el orden sugerido.');
        return;
      }
      router.push('/route');
      router.refresh();
    });
  }, [router]);

  const handleSaveCustom = useCallback(() => {
    setError(null);
    if (customOrder.length !== pendingStops.length) {
      setError(
        `Te faltan ${pendingStops.length - customOrder.length} paradas por tappear.`,
      );
      return;
    }
    startTransition(async () => {
      const res = await confirmDriverOrderAction(customOrder);
      if (!res.ok) {
        setError(res.error ?? 'No se pudo guardar tu orden.');
        return;
      }
      router.push('/route');
      router.refresh();
    });
  }, [customOrder, pendingStops.length, router]);

  // ───── Render ─────

  const tappedCount = customOrder.length;
  const totalPending = pendingStops.length;
  const allTapped = tappedCount === totalPending && totalPending > 0;

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--vf-bg)] safe-top safe-bottom">
      {/* Header compacto */}
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Tu ruta de hoy
        </p>
        <h1 className="truncate text-base font-semibold text-[var(--color-text)]">
          {routeName}
        </h1>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {totalPending} {totalPending === 1 ? 'parada' : 'paradas'}
          {depot && ' · 1 CEDIS de salida'} ·{' '}
          {mode === 'suggested'
            ? 'orden sugerido por el sistema'
            : `tappeaste ${tappedCount} de ${totalPending}`}
        </p>
      </header>

      {/* DIAGNÓSTICO ADR-127: strip visible con coords reales. Quitar cuando
          el bug esté confirmado resuelto en producción. */}
      <div className="border-b border-amber-400 bg-amber-50 px-3 py-1.5 text-[10px] leading-tight text-amber-900 font-mono">
        <div>build: v4 (setCenter+LngLat explícito)</div>
        <div>
          stops: {stops.map((s) => `${s.storeCode}(${s.lat},${s.lng})`).join(' | ')}
        </div>
        {depot && (
          <div>
            depot: {depot.code}({depot.lat},{depot.lng})
          </div>
        )}
      </div>

      {/* Mapa fullscreen */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Hint del modo en la esquina superior */}
        {mode === 'custom' && (
          <div className="pointer-events-none absolute left-3 right-3 top-3 rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
            👆 Tappea las paradas en el orden que las quieres hacer. Tappea
            otra vez para quitar una.
          </div>
        )}

        {/* Mini-leyenda inferior izquierda */}
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/90 px-2.5 py-1.5 text-[10px] shadow">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: mode === 'suggested' ? '#1d4ed8' : '#16a34a' }}
            />
            <span className="text-zinc-800">
              {mode === 'suggested' ? 'Paradas (orden sugerido)' : 'Paradas tappeadas'}
            </span>
          </div>
          {depot && (
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: '#059669' }}
              />
              <span className="text-zinc-800">CEDIS de salida</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar con acciones — distinto por modo */}
      <div className="border-t border-[var(--color-border)] bg-[var(--vf-surface-1)] px-4 py-3 space-y-2">
        {error && (
          <p className="rounded-md border border-[var(--vf-crit,#dc2626)] bg-red-50 px-3 py-2 text-xs text-[var(--vf-crit,#dc2626)]">
            {error}
          </p>
        )}

        {mode === 'suggested' ? (
          <>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handleAcceptSuggested}
              isLoading={pending}
              disabled={pending}
            >
              ✓ Usar orden sugerido
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => setMode('custom')}
              disabled={pending}
            >
              Definir mi orden tappeando en el mapa
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handleSaveCustom}
              isLoading={pending}
              disabled={pending || !allTapped}
            >
              {allTapped
                ? '✓ Guardar mi orden'
                : `Tappea ${totalPending - tappedCount} más`}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="flex-1"
                onClick={handleResetOrder}
                disabled={pending || tappedCount === 0}
              >
                ↺ Reiniciar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="flex-1"
                onClick={() => {
                  setMode('suggested');
                  setCustomOrder([]);
                }}
                disabled={pending}
              >
                Volver al sugerido
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Marker DOM element factories.
//
// Pin redondo con número. Para stops: color depende del mode + estado de tap.
// Para depot: pin verde oscuro con icono 🏭, sin número.
// ─────────────────────────────────────────────────────────────────────────

function createStopMarkerElement(
  stop: StopForMap,
  mode: Mode,
  customOrder: string[],
): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: white;
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  `;
  el.title = `${stop.storeCode} · ${stop.storeName}`;

  // No-pending: gris siempre con sequence original (no se puede mover).
  if (stop.status !== 'pending') {
    el.style.background = '#94a3b8';
    el.textContent = String(stop.suggestedSequence);
    return el;
  }

  if (mode === 'suggested') {
    // Orden sugerido: azul con número del optimizer.
    el.style.background = '#1d4ed8';
    el.textContent = String(stop.suggestedSequence);
    return el;
  }

  // mode === 'custom'.
  const tapIdx = customOrder.indexOf(stop.stopId);
  if (tapIdx === -1) {
    // No tappeada todavía: contorno punteado, sin número visible.
    el.style.background = 'white';
    el.style.color = '#475569';
    el.style.border = '2px dashed #94a3b8';
    el.textContent = '?';
  } else {
    // Tappeada: verde con el orden tappeado (1-indexed).
    el.style.background = '#16a34a';
    el.textContent = String(tapIdx + 1);
    el.style.transform = 'scale(1.1)';
  }
  return el;
}

function createDepotMarkerElement(depot: DepotForMap): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    background: #059669;
    color: white;
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  `;
  el.title = `${depot.code} · ${depot.name}`;
  el.textContent = '🏭';
  return el;
}
