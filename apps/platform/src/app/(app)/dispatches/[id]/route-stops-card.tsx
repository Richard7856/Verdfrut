'use client';

// Card por ruta dentro del detalle del tiro. Muestra:
//  - Header con nombre + status + Kangoo + chofer + métricas (km, manejo, ETAs).
//  - Lista de paradas con drag-and-drop para reordenar dentro de la ruta + dropdown
//    "Mover a → otra ruta" del mismo tiro.
// ADR-025 + ADR-035 (reorder) + ADR-043 (métricas) + ADR-045 (drag-drop).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Button, Card, Select, toast } from '@tripdrive/ui';
import { formatDuration, formatKilometers } from '@tripdrive/utils';
import type { Route, RouteStatus, Stop, Store, Vehicle } from '@tripdrive/types';
import { moveStopToAnotherRouteAction } from '../actions';
import {
  reorderStopsAction,
  assignDepotToRouteAction,
  deleteStopFromRouteAction,
  reoptimizeLiveAction,
  recalculateRouteEtasAction,
  reoptimizeRouteAction,
} from '../../routes/actions';
import { AddStopButton } from '../../routes/[id]/add-stop-button';
import { RemoveVehicleButton } from './remove-vehicle-button';
import { RoutingModeBadge } from '@/components/routing-mode-badge';

const STATUS: Record<RouteStatus, { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { text: 'Borrador', tone: 'neutral' },
  OPTIMIZED: { text: 'Optimizada', tone: 'info' },
  APPROVED: { text: 'Aprobada', tone: 'info' },
  PUBLISHED: { text: 'Publicada', tone: 'info' },
  IN_PROGRESS: { text: 'En curso', tone: 'success' },
  INTERRUPTED: { text: 'Interrumpida', tone: 'danger' },
  COMPLETED: { text: 'Completada', tone: 'success' },
  CANCELLED: { text: 'Cancelada', tone: 'danger' },
};

interface Props {
  dispatchId: string;
  route: Route;
  stops: Stop[];
  storesById: Map<string, Store>;
  vehicles: Vehicle[];
  /** Otras rutas del mismo tiro (para el dropdown "Mover a"). */
  siblings: Array<{ id: string; name: string; status: RouteStatus; vehicleId: string }>;
  /** Capacidad de cajas del vehículo (capacity[2]) — para warning visual. */
  capacityCajas: number;
  /** Timezone del tenant para formatear ETAs. */
  timezone?: string;
  /** ADR-047: depot resuelto que la ruta usa hoy (override o el del vehículo). */
  effectiveDepot?: { id: string; code: string; name: string } | null;
  /** Si el effectiveDepot viene del override (true) o del vehículo (false). */
  isDepotOverride?: boolean;
  /** Lista de depots activos para el selector inline. */
  availableDepots?: Array<{ id: string; code: string; name: string }>;
  /** Tiendas de la zona que NO están aún en esta ruta — para el botón "+ Agregar parada". */
  availableStoresToAdd?: Array<{ id: string; code: string; name: string }>;
  /** H3.5: alguna ruta del tiro tiene version > 1 (cambios manuales). Pasado al RemoveVehicleButton. */
  dispatchHasManualReorders?: boolean;
  /** ADR-121 Fase 1: feature flag `liveReOpt` del customer. Si false, escondemos
   *  el botón "🚦 Re-optimizar con tráfico actual" (post-publish). El server
   *  action también gatea (defense-in-depth). */
  canReoptLive?: boolean;
}

const EDITABLE_STATUSES = new Set<RouteStatus>(['DRAFT', 'OPTIMIZED', 'APPROVED']);
// ADR-035: post-publish también permite reorder de pending stops.
const REORDERABLE_STATUSES = new Set<RouteStatus>([
  'DRAFT',
  'OPTIMIZED',
  'APPROVED',
  'PUBLISHED',
  'IN_PROGRESS',
]);

interface StopRowData {
  stop: Stop;
  storeCode: string;
  storeName: string;
}

export function RouteStopsCard({
  dispatchId,
  route,
  stops,
  storesById,
  vehicles,
  siblings,
  capacityCajas,
  timezone = 'America/Mexico_City',
  effectiveDepot = null,
  isDepotOverride = false,
  availableDepots = [],
  availableStoresToAdd = [],
  dispatchHasManualReorders = false,
  canReoptLive = true,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [movingStopId, setMovingStopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reoptPending, setReoptPending] = useState(false);

  const status = STATUS[route.status];
  const vehicle = vehicles.find((v) => v.id === route.vehicleId);
  const editableSiblings = siblings.filter(
    (s) => s.id !== route.id && EDITABLE_STATUSES.has(s.status),
  );
  const canMove = EDITABLE_STATUSES.has(route.status) && editableSiblings.length > 0;
  const canReorder = REORDERABLE_STATUSES.has(route.status);
  const isPostPublish = route.status === 'PUBLISHED' || route.status === 'IN_PROGRESS';

  // ADR-043: total kg + completados/omitidos
  const totalKg = stops.reduce((acc, s) => acc + (Number(s.load?.[0] ?? 0) || 0), 0);
  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const skippedStops = stops.filter((s) => s.status === 'skipped').length;
  const usedCajas = stops.length;
  const overCapacity = usedCajas > capacityCajas;

  // Ordered stops + estado local para optimistic UI
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const initialItems: StopRowData[] = sorted.map((s) => ({
    stop: s,
    storeCode: storesById.get(s.storeId)?.code ?? '—',
    storeName: storesById.get(s.storeId)?.name ?? '???',
  }));

  // ADR-045: drag-and-drop con dnd-kit. Reordena con arrayMove(items, oldIdx, newIdx)
  // — al soltar la parada en la posición N, todas las que estaban entre N y la
  // antigua posición se desplazan automáticamente. Es el comportamiento que
  // pidió el cliente (vs ↑↓ uno por uno).
  const [items, setItems] = useState<StopRowData[]>(initialItems);
  const [dirty, setDirty] = useState(false);

  // Sync local state if upstream stops cambia (después de router.refresh).
  // Heurística: si los IDs cambiaron O el length, reset.
  if (
    !dirty &&
    (items.length !== initialItems.length ||
      items.some((it, i) => it.stop.id !== initialItems[i]?.stop.id))
  ) {
    setItems(initialItems);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((s) => s.stop.id === active.id);
    const newIdx = items.findIndex((s) => s.stop.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    // Post-publish: solo paradas pending son movibles. Si origen o destino no
    // son pending, abortar con toast claro.
    if (isPostPublish) {
      const dragStatus = items[oldIdx]?.stop.status;
      const targetStatus = items[newIdx]?.stop.status;
      if (dragStatus !== 'pending' || targetStatus !== 'pending') {
        toast.error(
          'Solo paradas pendientes se pueden mover',
          'Las paradas completadas/omitidas/en sitio quedan fijas en su posición original.',
        );
        return;
      }
    }

    // arrayMove: pone el item en newIdx, las demás se desplazan.
    // Ej: items [A,B,C,D,E,F,G] con G→2 = [A,B,G,C,D,E,F]
    const reordered = arrayMove(items, oldIdx, newIdx).map((it, i) => ({
      ...it,
      stop: { ...it.stop, sequence: i + 1 },
    }));
    setItems(reordered);
    setDirty(true);

    // Persistir en server. ADR-035: en post-publish solo enviamos IDs de pending.
    const idsToSend = isPostPublish
      ? reordered.filter((it) => it.stop.status === 'pending').map((it) => it.stop.id)
      : reordered.map((it) => it.stop.id);

    startTransition(async () => {
      const res = await reorderStopsAction(route.id, idsToSend);
      if (!res.ok) {
        toast.error('No se pudo reordenar', res.error ?? '');
        // Rollback al orden original.
        setItems(initialItems);
        setDirty(false);
        return;
      }
      // Server ya recalculó ETAs/km (ADR-044). Refresh para tomar valores nuevos.
      setDirty(false);
      router.refresh();
    });
  }

  function handleMove(stopId: string, targetRouteId: string) {
    setError(null);
    setMovingStopId(stopId);
    startTransition(async () => {
      const res = await moveStopToAnotherRouteAction(stopId, targetRouteId, dispatchId);
      setMovingStopId(null);
      if (!res.ok) {
        setError(res.error ?? 'Error');
        return;
      }
      router.refresh();
    });
  }

  // ADR-036: borrar parada pending desde la card del tiro. El action ya re-numera
  // sequences en server. Solo paradas pending — completed/skipped/arrived no se
  // borran (son histórico operativo del chofer).
  function handleDeleteStop(stopId: string) {
    startTransition(async () => {
      const res = await deleteStopFromRouteAction(stopId);
      if (res.ok) {
        toast.success('Parada eliminada');
        router.refresh();
      } else {
        toast.error('No se pudo eliminar', res.error);
      }
    });
  }

  // ADR-047: cambiar el CEDIS de salida directamente desde la card del tiro.
  // El select dispara una transition; al guardar el server recalcula km/ETAs
  // automáticamente y revalida el path para que esta card se refresque.
  function handleDepotChange(newDepotId: string) {
    const value = newDepotId === '' ? null : newDepotId;
    startTransition(async () => {
      const res = await assignDepotToRouteAction(route.id, value);
      if (res.ok) {
        toast.success(value ? 'CEDIS actualizado' : 'CEDIS volvió al del camión');
        router.refresh();
      } else {
        toast.error('Error al cambiar CEDIS', res.error);
      }
    });
  }

  // Stream C O1 (ADR-074): re-optimización en vivo con tráfico real.
  // Solo visible en PUBLISHED/IN_PROGRESS. Cooldown 30min en server-side.
  // Costo aproximado al dispatcher: ~$0.50 USD por re-opt — el botón está
  // gateado por confirm explícito para evitar abuso casual.
  function handleReoptimizeLive() {
    const pendingCount = stops.filter((s) => s.status === 'pending').length;
    if (pendingCount === 0) {
      toast.error('Sin paradas pendientes', 'No hay nada que re-optimizar.');
      return;
    }
    const ok = confirm(
      `Re-optimizar ${pendingCount} parada(s) pendiente(s) con tráfico actual.\n\n` +
        `• Llama Google Routes API (~$${(pendingCount * 0.05).toFixed(2)} USD aprox).\n` +
        `• El chofer recibirá push: "tu ruta se actualizó por tráfico".\n` +
        `• Cooldown: 30 min hasta poder re-optimizar de nuevo.\n\n` +
        `¿Continuar?`,
    );
    if (!ok) return;

    setReoptPending(true);
    startTransition(async () => {
      const res = await reoptimizeLiveAction(route.id);
      setReoptPending(false);
      if (res.ok) {
        const reordered = res.reorderedStops ?? 0;
        const unassigned = res.unassignedStops ?? 0;
        toast.success(
          'Re-optimización aplicada',
          unassigned > 0
            ? `${reordered} paradas reordenadas, ${unassigned} marcadas como skipped (no caben en el turno).`
            : `${reordered} paradas reordenadas con tráfico actual.`,
        );
        router.refresh();
      } else {
        toast.error('No se pudo re-optimizar', res.error);
      }
    });
  }

  // Optimización pre-publicación de UNA ruta (DRAFT/OPTIMIZED). Reordena las
  // tiendas de esta ruta sin tocar el resto del tiro. Botón hermano del
  // "Optimizar tiro completo" — distinto de reoptimizeLive que es post-publish
  // con tráfico real.
  function handleReoptimizeRoute() {
    if (
      !confirm(
        `¿Re-optimizar la ruta "${route.name}"?\n\n` +
          `Las paradas se reordenarán según VROOM. No se moverán tiendas a otras camionetas.`,
      )
    ) {
      return;
    }
    setReoptPending(true);
    startTransition(async () => {
      const res = await reoptimizeRouteAction(route.id);
      setReoptPending(false);
      if (res.ok) {
        if (res.unassignedStoreIds && res.unassignedStoreIds.length > 0) {
          toast.warning(
            'Re-optimizada con paradas sin asignar',
            `${res.unassignedStoreIds.length} no cupieron en la capacidad del camión.`,
          );
        } else {
          toast.success('Ruta re-optimizada');
        }
        router.refresh();
      } else {
        toast.error('No se pudo re-optimizar', res.error);
      }
    });
  }

  // Bug-#L4 mitigation: re-calcular ETAs sin tocar el orden. Útil cuando admin
  // reordenó post-publish y las ETAs originales quedaron obsoletas. NO llama
  // optimizer — solo haversine sobre el orden actual. Barato, instantáneo.
  function handleRecalcEtas() {
    startTransition(async () => {
      const res = await recalculateRouteEtasAction(route.id);
      if (res.ok) {
        toast.success('ETAs recalculadas', 'Sin cambiar el orden de las paradas.');
        router.refresh();
      } else {
        toast.error('No se pudo recalcular', res.error);
      }
    });
  }

  // Format helpers
  const fmtTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      : '—';

  return (
    <Card className="border-[var(--color-border)]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/routes/${route.id}`}
            className="block truncate text-sm font-semibold text-[var(--color-text)] hover:underline"
          >
            {route.name}
          </Link>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {vehicle?.alias ?? vehicle?.plate ?? '—'} ·{' '}
            <span className={overCapacity ? 'text-[var(--color-danger-fg)] font-semibold' : ''}>
              {usedCajas} paradas
            </span>
            {totalKg > 0 ? ` · ${totalKg} kg` : ''}
            {route.totalDistanceMeters ? ` · ${formatKilometers(route.totalDistanceMeters)}` : ''}
            {route.totalDurationSeconds
              ? ` · ${formatDuration(route.totalDurationSeconds)} manejo`
              : ''}
          </p>
          {route.estimatedStartAt && route.estimatedEndAt && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-subtle)]">
              Sale {fmtTime(route.estimatedStartAt)} · Regresa {fmtTime(route.estimatedEndAt)}
              {completedStops > 0 || skippedStops > 0
                ? ` · ${completedStops} ✓ ${skippedStops} omitidas`
                : ''}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <Badge tone={status.tone}>{status.text}</Badge>
            {/* UXR-2: marcar rutas publicadas/aprobadas que evitaron el optimizer
                — el dispatcher las distingue de un vistazo del lote VROOM. */}
            <RoutingModeBadge route={route} compact />
          </div>
          {/* Optimizar/re-optimizar UNA ruta — solo DRAFT/OPTIMIZED y con paradas. */}
          {(route.status === 'DRAFT' || route.status === 'OPTIMIZED') && items.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleReoptimizeRoute}
              isLoading={reoptPending}
              disabled={pending || reoptPending}
              title="Reordena las paradas de esta camioneta sin mover tiendas a otra."
            >
              {route.status === 'DRAFT' ? 'Optimizar' : 'Re-optimizar'}
            </Button>
          )}
          {/* ADR-048: quitar camioneta — solo en pre-publicación. */}
          {EDITABLE_STATUSES.has(route.status) && (
            <RemoveVehicleButton
              routeId={route.id}
              dispatchId={dispatchId}
              vehicleLabel={vehicle?.alias ?? vehicle?.plate ?? 'la ruta'}
              remainingAfter={
                siblings.filter((s) => s.id !== route.id && s.status !== 'CANCELLED').length
              }
              stopsCount={items.length}
              hasManualReorders={dispatchHasManualReorders}
            />
          )}
        </div>
      </header>

      {overCapacity && (
        <p className="mt-2 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-2 py-1 text-xs text-[var(--color-warning-fg)]">
          ⚠️ La ruta excede la capacidad del vehículo. Re-optimiza o mueve paradas.
        </p>
      )}

      {/* #85 — Banner ETAs obsoletas. Si la ruta está PUBLISHED/IN_PROGRESS y
          su version > 1, hubo al menos un reorder post-publish. Las ETAs en BD
          siguen siendo las del orden original — el chofer/admin verá horarios
          que ya no se cumplirán. ADR-035 decidió NO recalcular automáticamente
          para no romper confianza con el chofer. El banner avisa al dispatcher
          para que tome decisión (re-optimizar si todavía hay margen). */}
      {isPostPublish && route.version > 1 && (
        <div
          className="mt-2 flex items-center justify-between gap-2 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-2 py-1.5 text-xs text-[var(--color-warning-fg)]"
          role="status"
        >
          <span>
            ⚠️ Las paradas se reordenaron — las ETAs son del orden original.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRecalcEtas}
            isLoading={pending}
            disabled={pending}
            title="Re-calcula ETAs con haversine sobre el orden actual. NO re-optimiza."
          >
            Re-calcular ETAs
          </Button>
        </div>
      )}

      {/* Stream C O1 — Re-optimizar con tráfico actual. Solo en post-publish
          porque pre-publish ya usa el reoptimize regular más barato (Mapbox).
          Aquí necesitamos Google Routes con tráfico real porque hay un chofer
          que ya está en ruta. ADR-121: gateado por feature `liveReOpt`. */}
      {canReoptLive && isPostPublish && stops.some((s) => s.status === 'pending') && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5 text-xs">
          <span style={{ color: 'var(--vf-text-mute)' }}>
            ¿Atraso por tráfico o cambio?
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleReoptimizeLive}
            isLoading={reoptPending}
            disabled={pending || reoptPending}
          >
            🚦 Re-optimizar con tráfico actual
          </Button>
        </div>
      )}

      {/* ADR-047: selector inline de CEDIS de salida. Editable solo en pre-publicación.
          En post-publish queda como display read-only para que el dispatcher vea de
          dónde sale la ruta sin tener que entrar al detalle. */}
      {availableDepots.length > 0 && (
        <div className="mt-2 flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5 text-xs">
          <span className="shrink-0 text-[var(--color-text-muted)]">CEDIS salida:</span>
          {EDITABLE_STATUSES.has(route.status) ? (
            <>
              <Select
                value={isDepotOverride ? (effectiveDepot?.id ?? '') : ''}
                onChange={(e) => handleDepotChange(e.target.value)}
                disabled={pending}
                className="flex-1 text-xs"
              >
                <option value="">— Usar el del camión{effectiveDepot && !isDepotOverride ? ` (${effectiveDepot.code})` : ''} —</option>
                {availableDepots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.name}
                  </option>
                ))}
              </Select>
              {isDepotOverride && (
                <span className="shrink-0 rounded bg-[var(--color-info-bg,rgba(59,130,246,0.1))] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-info-fg,#3b82f6)]">
                  override
                </span>
              )}
            </>
          ) : (
            <span className="font-mono text-[var(--color-text)]">
              {effectiveDepot?.code ?? '—'}
              {isDepotOverride && (
                <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">· override</span>
              )}
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-[var(--color-danger-fg)]">{error}</p>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
          Sin paradas. Optimiza esta ruta o vincula una existente.
        </p>
      ) : (
        <DndContext
          id={`dnd-${route.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={canReorder ? handleDragEnd : undefined}
        >
          <SortableContext
            items={items.map((it) => it.stop.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-3 flex flex-col gap-1.5">
              {items.map((item) => {
                const isMoving = movingStopId === item.stop.id && pending;
                const isPending = item.stop.status === 'pending';
                const rowDraggable =
                  canReorder && !pending && (!isPostPublish || isPending);
                return (
                  <SortableStopRow
                    key={item.stop.id}
                    item={item}
                    draggable={rowDraggable}
                    canMoveBetweenRoutes={canMove && isPending}
                    canDelete={EDITABLE_STATUSES.has(route.status) && isPending && !pending}
                    isPostPublishDimmed={isPostPublish && !isPending}
                    isMovingBetweenRoutes={isMoving}
                    siblings={editableSiblings}
                    vehicles={vehicles}
                    fmtTime={fmtTime}
                    onMove={(targetId) => handleMove(item.stop.id, targetId)}
                    onDelete={() => handleDeleteStop(item.stop.id)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* ADR-036: agregar parada manual a la ruta. Solo en pre-publicación.
          Reusa el mismo componente que /routes/[id] para mantener un único
          flow: agrega la parada al final, marca métricas como obsoletas, y el
          dispatcher decide si re-optimizar o dejar el orden manual. */}
      {EDITABLE_STATUSES.has(route.status) && availableStoresToAdd.length > 0 && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--vf-line)' }}>
          <AddStopButton routeId={route.id} availableStores={availableStoresToAdd} />
        </div>
      )}
    </Card>
  );
}

function SortableStopRow({
  item,
  draggable,
  canMoveBetweenRoutes,
  canDelete,
  isPostPublishDimmed,
  isMovingBetweenRoutes,
  siblings,
  vehicles,
  fmtTime,
  onMove,
  onDelete,
}: {
  item: StopRowData;
  draggable: boolean;
  canMoveBetweenRoutes: boolean;
  canDelete: boolean;
  isPostPublishDimmed: boolean;
  isMovingBetweenRoutes: boolean;
  siblings: Array<{ id: string; name: string; vehicleId: string }>;
  vehicles: Vehicle[];
  fmtTime: (iso: string | null) => string;
  onMove: (targetRouteId: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.stop.id, disabled: !draggable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isPostPublishDimmed ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-2 py-1.5"
    >
      <div className="flex items-center gap-1.5">
        {draggable && (
          <span
            {...attributes}
            {...listeners}
            aria-label="Arrastra para reordenar"
            className="select-none px-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            style={{ cursor: 'grab', fontFamily: 'system-ui' }}
            title="Arrastra para reordenar"
          >
            ⋮⋮
          </span>
        )}
        <span className="text-xs font-mono text-[var(--color-text-muted)]">
          #{item.stop.sequence}
        </span>
        <span className="text-xs text-[var(--color-text)]">
          {item.storeCode} {item.storeName}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {item.stop.plannedArrivalAt && (
          <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-subtle)]">
            {fmtTime(item.stop.plannedArrivalAt)}
          </span>
        )}
        {canMoveBetweenRoutes && (
          <MoveStopMenu
            siblings={siblings}
            vehicles={vehicles}
            disabled={isMovingBetweenRoutes}
            onMove={onMove}
          />
        )}
        {canDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`¿Quitar ${item.storeCode} ${item.storeName} de esta ruta?`)) {
                onDelete();
              }
            }}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-danger-fg,#dc2626)]"
            title="Quitar parada de esta ruta"
            aria-label="Quitar parada"
          >
            <span className="text-base leading-none">×</span>
          </button>
        )}
        {item.stop.status !== 'pending' && (
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-subtle)]">
            {item.stop.status}
          </span>
        )}
      </div>
    </li>
  );
}

function MoveStopMenu({
  siblings,
  vehicles,
  disabled,
  onMove,
}: {
  siblings: Array<{ id: string; name: string; vehicleId: string }>;
  vehicles: Vehicle[];
  disabled: boolean;
  onMove: (targetRouteId: string) => void;
}) {
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onMove(v);
        e.target.value = '';
      }}
      disabled={disabled}
      // Los listeners de dnd-kit absorben pointerdown — bloqueamos para que el
      // select sí reciba clicks normales y no inicie un drag por accidente.
      onPointerDown={(e) => e.stopPropagation()}
      className="rounded border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)] disabled:opacity-50"
      aria-label="Mover parada a otra ruta"
    >
      <option value="">Mover a →</option>
      {siblings.map((s) => {
        const v = vehicles.find((veh) => veh.id === s.vehicleId);
        return (
          <option key={s.id} value={s.id}>
            {v?.alias ?? v?.plate ?? s.name}
          </option>
        );
      })}
    </select>
  );
}
