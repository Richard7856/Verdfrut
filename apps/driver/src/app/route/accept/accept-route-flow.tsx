'use client';

// ADR-125: flow de aceptación de orden del chofer.
//
// Pantalla full-screen con mapa Mapbox + barra inferior de acciones. El chofer:
//
//   1. Ve el mapa con todas las paradas marcadas con números (orden sugerido).
//   2. Elige UNA opción:
//      a) "Usar orden sugerido" → submit (orderedStopIds=null) y va a /route.
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

interface Props {
  routeName: string;
  stops: StopForMap[];
  mapboxToken: string;
}

type Mode = 'suggested' | 'custom';

export function AcceptRouteFlow({ routeName, stops, mapboxToken }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Tracking de markers por stopId para poder actualizar el HTML del pin
  // (número que muestra) sin re-renderear el mapa entero.
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [mode, setMode] = useState<Mode>('suggested');
  // Stops tappeados por el chofer en modo custom — array ordenado de stopIds.
  // El índice + 1 = el número que se muestra en el pin.
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Stops pending vs no-pending. El flow solo permite re-ordenar pending —
  // las completadas/arrived/skipped mantienen su orden histórico.
  // Para una ruta recién PUBLISHED todas son pending típicamente, pero
  // somos defensivos por si el chofer re-abre la app después de un crash.
  const pendingStops = stops.filter((s) => s.status === 'pending');

  // ───── Map init (una sola vez) ─────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!mapboxToken) {
      setError('Mapbox token no configurado. Avísale a tu encargado.');
      return;
    }
    setMapboxToken(mapboxToken);

    // Compute bounds para encuadrar todas las paradas con un poco de padding.
    const lats = stops.map((s) => s.lat);
    const lngs = stops.map((s) => s.lng);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      bounds: [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      fitBoundsOptions: { padding: 60, maxZoom: 14 },
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      // Renderear markers iniciales — números según suggested_sequence.
      for (const stop of stops) {
        const el = createMarkerElement(stop, 'suggested', null);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([stop.lng, stop.lat])
          .addTo(map);
        markersRef.current.set(stop.stopId, marker);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // Solo dependemos del array de stops; mapboxToken se setea una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───── Re-render markers cuando cambia mode o customOrder ─────
  useEffect(() => {
    if (!mapRef.current) return;
    for (const stop of stops) {
      const marker = markersRef.current.get(stop.stopId);
      if (!marker) continue;
      const newEl = createMarkerElement(stop, mode, customOrder);
      // Click handler en el elemento del pin — solo activo en modo custom.
      if (mode === 'custom' && stop.status === 'pending') {
        newEl.style.cursor = 'pointer';
        newEl.addEventListener('click', () => handleTapStop(stop.stopId));
      }
      const oldEl = marker.getElement();
      oldEl.replaceWith(newEl);
      // mapboxgl.Marker mantiene referencia al elemento — re-bindear.
      // El truco es que setDOMElement no existe oficialmente, pero el internal
      // _element sí se reemplaza. La forma "official-friendly" es destroy +
      // recreate marker, pero esto es caro. Re-asignar via el wrapper de abajo.
      (marker as unknown as { _element: HTMLElement })._element = newEl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, customOrder, stops]);

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
          {totalPending} {totalPending === 1 ? 'parada' : 'paradas'} ·{' '}
          {mode === 'suggested'
            ? 'orden sugerido por el sistema'
            : `tappeaste ${tappedCount} de ${totalPending}`}
        </p>
      </header>

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
// Marker DOM element factory.
//
// Pin redondo con número adentro. Color según mode + estado del tap:
//   - mode 'suggested' o stop ya completada/arrived/skipped: gris claro con
//     número del orden sugerido.
//   - mode 'custom' + stop pending no tappeada: contorno punteado, sin número.
//   - mode 'custom' + stop tappeada: verde con el índice + 1 del tap.
// ─────────────────────────────────────────────────────────────────────────
function createMarkerElement(
  stop: StopForMap,
  mode: Mode,
  customOrder: string[] | null,
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
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    transition: transform 0.15s;
  `;
  el.title = `${stop.storeCode} · ${stop.storeName}`;

  // No-pending: siempre gris con sequence original (no se puede mover).
  if (stop.status !== 'pending') {
    el.style.background = '#94a3b8';
    el.style.color = 'white';
    el.textContent = String(stop.suggestedSequence);
    return el;
  }

  if (mode === 'suggested' || !customOrder) {
    // Orden sugerido: azul con número del optimizer.
    el.style.background = '#1d4ed8';
    el.textContent = String(stop.suggestedSequence);
    return el;
  }

  // mode === 'custom'.
  const tapIdx = customOrder.indexOf(stop.stopId);
  if (tapIdx === -1) {
    // No tappeada todavía: contorno punteado, sin número.
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
