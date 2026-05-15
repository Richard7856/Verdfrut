'use client';

// Wrapper client del MultiRouteMap que habilita el modo selección bulk:
// captura las acciones del toolbar flotante (move_to_route, create_new_route,
// remove_from_dispatch) y las traduce a server actions.
//
// Phase 2 del mapa selección masiva (2026-05-15 noche / dispatches /[id]).
//
// Patrón: server component carga datos → este componente cliente provee
// onBulkAction → MultiRouteMap renderiza UI con interactividad completa.

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MultiRouteMap, type BulkAction, type MultiRouteEntry } from './multi-route-map';
import { bulkMoveStopsAction } from '@/app/(app)/dispatches/actions';

interface Props {
  routes: MultiRouteEntry[];
  mapboxToken: string;
  dispatchId: string;
}

interface PostMoveBanner {
  /** Cuántos stops se movieron exitosamente. */
  moved: number;
  /** Cuáles fallaron y por qué. */
  failed: Array<{ stopId: string; reason: string }>;
  /** Ruta destino para sugerir optimize. */
  targetRouteId: string;
  /** Label legible de la ruta destino. */
  targetRouteName: string;
}

export function BulkSelectableMultiRouteMap({ routes, mapboxToken, dispatchId }: Props) {
  const router = useRouter();
  const [banner, setBanner] = useState<PostMoveBanner | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleBulkAction = useCallback(
    async (action: BulkAction, stopIds: string[]) => {
      setErrorMsg(null);

      if (action.type === 'move_to_route') {
        const targetRoute = routes.find((r) => r.routeId === action.targetRouteId);
        if (!targetRoute) {
          setErrorMsg('Ruta destino no encontrada.');
          return;
        }
        const res = await bulkMoveStopsAction(stopIds, action.targetRouteId, dispatchId);
        if (!res.ok) {
          setErrorMsg(res.error ?? 'Error al mover paradas.');
          return;
        }
        const result = res.result;
        if (!result) return;
        setBanner({
          moved: result.moved,
          failed: result.failed,
          targetRouteId: action.targetRouteId,
          targetRouteName: targetRoute.routeName,
        });
        // Refrescar data del server para que el mapa muestre el nuevo estado.
        startTransition(() => router.refresh());
        return;
      }

      if (action.type === 'create_new_route') {
        // Phase 4 — pendiente. Por ahora mostramos error legible.
        setErrorMsg(
          'Crear nueva ruta desde selección: viene en el próximo iteración. Por ahora, mueve los stops a una ruta existente.',
        );
        return;
      }

      if (action.type === 'remove_from_dispatch') {
        // No tenemos action específica todavía. Phase 4+.
        setErrorMsg(
          'Quitar del dispatch: viene en el próximo iteración. Por ahora, usa "Quitar parada" desde el detalle de la ruta.',
        );
        return;
      }
    },
    [routes, dispatchId, router],
  );

  return (
    <div className="space-y-3">
      {/* Banner post-move con sugerencia de optimizar. */}
      {banner && (
        <div className="rounded-[var(--radius-lg)] border border-emerald-700 bg-emerald-950/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm text-emerald-100">
              <strong>✅ {banner.moved} parada{banner.moved === 1 ? '' : 's'} movida{banner.moved === 1 ? '' : 's'}</strong>{' '}
              a <strong>{banner.targetRouteName}</strong>.
              {banner.failed.length > 0 && (
                <span className="ml-2 text-amber-300">
                  ({banner.failed.length} fallaron — ver detalle abajo)
                </span>
              )}
              <div className="mt-1 text-xs text-emerald-300/80">
                Las paradas se agregaron al FINAL de la ruta destino. Su secuencia no está optimizada
                — puedes correr <strong>"Re-optimizar"</strong> desde el detalle de la ruta para que
                VROOM calcule el orden óptimo con tráfico actual.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="shrink-0 rounded p-1 text-emerald-300 hover:bg-emerald-900/50"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          {banner.failed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-amber-300">
                Ver paradas que fallaron ({banner.failed.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-200/80">
                {banner.failed.map((f) => (
                  <li key={f.stopId}>
                    <code className="text-[10px]">{f.stopId.slice(0, 8)}</code>: {f.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-2 flex gap-2">
            <a
              href={`/routes/${banner.targetRouteId}`}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Ir a la ruta para re-optimizar
            </a>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/50"
            >
              Dejar como está
            </button>
          </div>
        </div>
      )}

      {/* Banner de error general. */}
      {errorMsg && (
        <div className="flex items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="shrink-0 rounded p-1 text-red-300 hover:bg-red-900/50"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      )}

      <MultiRouteMap routes={routes} mapboxToken={mapboxToken} onBulkAction={handleBulkAction} />
    </div>
  );
}
