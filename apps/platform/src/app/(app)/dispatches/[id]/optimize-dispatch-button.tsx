'use client';

// Optimizar el TIRO completo (todas las rutas en una sola operación).
// Modal con 2 modos que tienen comportamientos muy distintos:
//
//  • "across"  → mueve tiendas entre camionetas (rebalance global). Reusa la
//                misma maquinaria que "agregar/quitar camioneta" — VROOM decide
//                el split. Borra el trabajo manual del dispatcher si hizo "Mover
//                a otra ruta" a propósito; por eso el modal lo advierte.
//
//  • "within"  → respeta a qué camioneta pertenece cada tienda y solo reordena
//                dentro. Es lo que el dispatcher quiere cuando ya curó la
//                asignación a mano y solo necesita que las paradas queden en
//                orden óptimo de visita.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';
import { optimizeDispatchAction } from '../actions';

interface Props {
  dispatchId: string;
  /** Si hay rutas en estado optimizable (DRAFT/OPTIMIZED) y al menos una con paradas. */
  canOptimize: boolean;
  /** Si alguna ruta del tiro ya está PUBLISHED+ — bloquea ambos modos. */
  hasPostPublishRoutes: boolean;
  /** Si el dispatcher movió tiendas manualmente (version > 1). Sólo afecta el warning del modo across. */
  hasManualReorders: boolean;
}

type Mode = 'across' | 'within';

export function OptimizeDispatchButton({
  dispatchId,
  canOptimize,
  hasPostPublishRoutes,
  hasManualReorders,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!canOptimize) return null;

  function handleRun(mode: Mode) {
    if (mode === 'across' && hasManualReorders) {
      const ok = confirm(
        'Hay paradas que moviste manualmente entre camionetas.\n\n' +
          'Al optimizar moviendo tiendas entre camionetas, VROOM va a recalcular ' +
          'todo desde cero y perderás esos cambios manuales.\n\n' +
          '¿Continuar de todos modos? (Si prefieres preservar tus cambios, usa ' +
          '"Solo reordenar dentro de cada camioneta").',
      );
      if (!ok) return;
    }
    setOpen(false);
    startTransition(async () => {
      const res = await optimizeDispatchAction(dispatchId, mode);
      if (!res.ok) {
        toast.error('No se pudo optimizar', res.error);
        return;
      }
      if (mode === 'across' && res.before && res.after) {
        const deltaKm = (res.before.totalDistanceMeters - res.after.totalDistanceMeters) / 1000;
        const sign = deltaKm >= 0 ? '−' : '+';
        toast.success(
          'Tiro re-balanceado',
          `${sign}${Math.abs(deltaKm).toFixed(1)} km vs antes · ${res.after.routeCount} rutas`,
        );
      } else if (mode === 'within') {
        const failed = res.routesFailed?.length ?? 0;
        if (failed > 0) {
          toast.warning(
            `${res.routesOptimized ?? 0} rutas optimizadas, ${failed} fallaron`,
            res.routesFailed?.[0]?.reason ?? '',
          );
        } else {
          toast.success(`${res.routesOptimized ?? 0} rutas re-optimizadas`);
        }
      }
      if (res.unassignedStoreIds && res.unassignedStoreIds.length > 0) {
        toast.warning(
          'Paradas sin asignar',
          `${res.unassignedStoreIds.length} no cupieron en la capacidad disponible.`,
        );
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={pending || hasPostPublishRoutes}
        title={
          hasPostPublishRoutes
            ? 'Hay rutas ya publicadas — usa "Re-optimizar con tráfico" en cada ruta individual.'
            : 'Optimiza el orden de las rutas sin mostrar alternativas. Para comparar costos, usa "Ver propuestas con costo".'
        }
        isLoading={pending}
      >
        ⚡ Optimizar tiro
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--vf-surface-1)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              ¿Cómo quieres optimizar el tiro?
            </h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Las dos opciones reordenan paradas. La diferencia es si pueden cambiarlas
              de camioneta o no. <strong>Si quieres comparar alternativas con costo
              MXN antes de aplicar, usa el botón "Ver propuestas con costo".</strong>
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleRun('across')}
                disabled={pending}
                className="flex flex-col items-start gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3 text-left transition-colors hover:border-[var(--vf-green-500)] disabled:opacity-50"
              >
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  🔀 Mover tiendas entre camionetas
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Re-balance global: VROOM decide qué tienda va a qué camión y en qué
                  orden. Mejor resultado total pero borra tus movimientos manuales.
                </span>
                {hasManualReorders && (
                  <span className="mt-1 text-[11px] font-medium text-[var(--color-warning-fg)]">
                    ⚠️ Detectamos cambios manuales — se perderán.
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleRun('within')}
                disabled={pending}
                className="flex flex-col items-start gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3 text-left transition-colors hover:border-[var(--vf-green-500)] disabled:opacity-50"
              >
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  🚚 Solo reordenar dentro de cada camioneta
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Respeta a qué camión va cada tienda; solo cambia el orden de visita.
                  Recomendado si ya curaste la asignación a mano.
                </span>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
