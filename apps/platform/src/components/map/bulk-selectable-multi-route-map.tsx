'use client';

// Wrapper client del MultiRouteMap que habilita el modo selección bulk:
// captura las acciones del toolbar flotante (move_to_route, create_new_route,
// remove_from_dispatch) y las traduce a server actions.
//
// Phase 2 del mapa selección masiva (2026-05-15 noche / dispatches /[id]).
//
// Patrón: server component carga datos → este componente cliente provee
// onBulkAction → MultiRouteMap renderiza UI con interactividad completa.

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Select, Button } from '@tripdrive/ui';
import { MultiRouteMap, type BulkAction, type MultiRouteEntry } from './multi-route-map';
import {
  bulkMoveStopsAction,
  createRouteFromSelectionAction,
} from '@/app/(app)/dispatches/actions';

interface VehicleOption {
  id: string;
  label: string;
  zoneId: string;
}

interface DriverOption {
  id: string;
  fullName: string;
  zoneId: string;
}

interface Props {
  routes: MultiRouteEntry[];
  mapboxToken: string;
  /**
   * Scope del bulk-select. Define qué path revalidar tras un move.
   *  - `dispatch`: vista detalle del tiro (/dispatches/[id]). Cada ruta en
   *    `routes` pertenece al mismo dispatch — caso simple legacy.
   *  - `day`: vista por día (/dia/[fecha]). Las rutas pueden venir de
   *    DIFERENTES dispatches. La action computa los dispatches afectados
   *    dinámicamente y los revalida todos + /dia/[fecha].
   */
  scope:
    | { type: 'dispatch'; dispatchId: string }
    | { type: 'day'; fecha: string };
  /** ADR-123: vehículos para "Nueva ruta desde selección". Vacío → botón disabled con tooltip. */
  availableVehiclesForNewRoute: VehicleOption[];
  /** Choferes opcionales asignables al crear ruta nueva. */
  availableDriversForNewRoute: DriverOption[];
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

export function BulkSelectableMultiRouteMap({
  routes,
  mapboxToken,
  scope,
  availableVehiclesForNewRoute,
  availableDriversForNewRoute,
}: Props) {
  const router = useRouter();
  const [banner, setBanner] = useState<PostMoveBanner | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  // ADR-123: state del modal "Nueva ruta desde selección".
  // Guardamos los stopIds en momento del click para que la modal pueda llamar
  // a la action aunque el user limpie selección desde la toolbar.
  const [newRouteModal, setNewRouteModal] = useState<{
    stopIds: string[];
  } | null>(null);
  const [newRouteVehicleId, setNewRouteVehicleId] = useState('');
  const [newRouteDriverId, setNewRouteDriverId] = useState('');
  const [newRouteSubmitting, setNewRouteSubmitting] = useState(false);

  // Limpiar el label cuando el refresh del server termina + un pequeño
  // delay para que el user alcance a ver el último estado "Actualizando vista…".
  useEffect(() => {
    if (refreshing) return;
    if (!processingLabel) return;
    const t = setTimeout(() => setProcessingLabel(null), 300);
    return () => clearTimeout(t);
  }, [refreshing, processingLabel]);

  const handleBulkAction = useCallback(
    async (action: BulkAction, stopIds: string[]) => {
      setErrorMsg(null);

      if (action.type === 'move_to_route') {
        const targetRoute = routes.find((r) => r.routeId === action.targetRouteId);
        if (!targetRoute) {
          setErrorMsg('Ruta destino no encontrada.');
          return;
        }
        setProcessingLabel(
          `Moviendo ${stopIds.length} ${stopIds.length === 1 ? 'parada' : 'paradas'} a ${targetRoute.routeName}…`,
        );
        try {
          const ctx =
            scope.type === 'dispatch'
              ? { dispatchId: scope.dispatchId }
              : { fecha: scope.fecha };
          const res = await bulkMoveStopsAction(stopIds, action.targetRouteId, ctx);
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
          // Mantenemos el overlay de loading hasta que el refresh complete (la
          // primera carga después del refresh puede tardar 1-2s en hidratar).
          setProcessingLabel('Actualizando vista…');
          startTransition(() => router.refresh());
        } finally {
          // Limpiamos el label fuera del transition para que dure mientras
          // el refresh está en flight (useTransition pending = refreshing).
          // El effect de abajo se encarga de limpiar cuando termina el refresh.
        }
        return;
      }

      if (action.type === 'create_new_route') {
        // ADR-123: abrir modal para que el user elija camión + chofer opcional.
        // No tomamos decisión silenciosa de qué vehículo asignar — siempre el
        // dispatcher tiene la última palabra sobre qué camión hace qué ruta.
        if (availableVehiclesForNewRoute.length === 0) {
          setErrorMsg(
            'No hay camionetas disponibles para crear una ruta nueva en esta zona. ' +
              'Asigna vehículos en /settings/vehicles primero.',
          );
          return;
        }
        setNewRouteVehicleId('');
        setNewRouteDriverId('');
        setNewRouteModal({ stopIds: [...stopIds] });
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
    [routes, scope, router, availableVehiclesForNewRoute.length],
  );

  // ADR-123: submit del modal de nueva ruta. Llama a la action con vehicle +
  // driver + scope + stopIds y muestra el banner verde reusando el mismo
  // PostMoveBanner que para move (route destino == nueva ruta).
  const submitNewRoute = useCallback(async () => {
    if (!newRouteModal) return;
    if (!newRouteVehicleId) {
      setErrorMsg('Selecciona una camioneta para la ruta nueva.');
      return;
    }
    setNewRouteSubmitting(true);
    setProcessingLabel(
      `Creando ruta con ${newRouteModal.stopIds.length} ${newRouteModal.stopIds.length === 1 ? 'parada' : 'paradas'}…`,
    );
    try {
      const res = await createRouteFromSelectionAction(
        newRouteModal.stopIds,
        newRouteVehicleId,
        newRouteDriverId === '' ? null : newRouteDriverId,
        scope,
      );
      if (!res.ok || !res.result) {
        setErrorMsg(res.error ?? 'No se pudo crear la ruta.');
        return;
      }
      setBanner({
        moved: res.result.moved,
        failed: res.result.failed,
        targetRouteId: res.result.routeId,
        targetRouteName: res.result.routeName,
      });
      setNewRouteModal(null);
      setProcessingLabel('Actualizando vista…');
      startTransition(() => router.refresh());
    } finally {
      setNewRouteSubmitting(false);
    }
  }, [newRouteModal, newRouteVehicleId, newRouteDriverId, scope, router]);

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

      <div className="relative">
        <MultiRouteMap
          routes={routes}
          mapboxToken={mapboxToken}
          onBulkAction={handleBulkAction}
        />
        {/* Overlay full-mapa cuando hay acción en curso. Evita que el user
            crea que está frozen + bloquea interacción durante el rewrite. */}
        {processingLabel && (
          <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center rounded-[var(--radius-lg)] bg-black/40 backdrop-blur-[1px]">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-700 bg-emerald-950/95 px-5 py-3 shadow-2xl">
              <svg
                className="h-5 w-5 animate-spin text-emerald-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-sm font-medium text-emerald-100">{processingLabel}</span>
            </div>
          </div>
        )}
      </div>

      {/* ADR-123: modal "Nueva ruta desde selección" — 1 click, 2 campos.
          Resuelve la fricción previa de "+ Agregar camioneta" vacía y luego
          mover paradas. */}
      <Modal
        open={newRouteModal !== null}
        onClose={() => !newRouteSubmitting && setNewRouteModal(null)}
        title="Crear ruta nueva con las paradas seleccionadas"
        description={
          newRouteModal
            ? `Se creará una ruta nueva en estado DRAFT con las ${newRouteModal.stopIds.length} paradas seleccionadas, asignada a la camioneta que elijas. Las paradas saldrán de sus rutas actuales.`
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setNewRouteModal(null)}
              disabled={newRouteSubmitting}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitNewRoute()}
              isLoading={newRouteSubmitting}
              disabled={!newRouteVehicleId}
            >
              Crear ruta y mover paradas
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Camión
            </label>
            <Select
              value={newRouteVehicleId}
              onChange={(e) => setNewRouteVehicleId(e.target.value)}
              disabled={newRouteSubmitting}
            >
              <option value="">— Selecciona una camioneta —</option>
              {availableVehiclesForNewRoute.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Chofer (opcional)
            </label>
            <Select
              value={newRouteDriverId}
              onChange={(e) => setNewRouteDriverId(e.target.value)}
              disabled={newRouteSubmitting}
            >
              <option value="">— Sin asignar —</option>
              {availableDriversForNewRoute.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            Las paradas se agregan en el orden actual. Para optimizar la secuencia con
            tráfico real, usa el botón "Re-optimizar" desde el detalle de la ruta tras crearla.
          </p>
        </div>
      </Modal>
    </div>
  );
}
