'use client';

// Bulk "Optimizar todo el día" — loopea reoptimizeRouteAction sobre cada
// ruta DRAFT/OPTIMIZED de la fecha. NO mueve paradas entre camionetas
// (eso requiere cross-plan rebalance que es UX-Fase 3); solo reordena
// dentro de cada camioneta para que las secuencias queden óptimas.
//
// Tardará ~3s × N rutas (VROOM secuencial). Loading explícito + toast.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';
import { optimizeDayAction } from '../../dispatches/actions';

interface Props {
  fecha: string;
  /** Nombres legibles de las rutas DRAFT/OPTIMIZED del día (para mostrar
   *  en el confirm). Vacío = no hay nada que optimizar, no renderiza. */
  optimizableRoutes: Array<{ name: string; stopCount: number }>;
}

export function OptimizeDayButton({ fecha, optimizableRoutes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);

  if (optimizableRoutes.length === 0) {
    return null;
  }
  const optimizableCount = optimizableRoutes.length;

  function run() {
    if (!confirmed) {
      const routeList = optimizableRoutes
        .slice(0, 6)
        .map((r) => `  • ${r.name} (${r.stopCount} paradas)`)
        .join('\n');
      const overflow =
        optimizableRoutes.length > 6
          ? `\n  · y ${optimizableRoutes.length - 6} más…`
          : '';
      const ok = confirm(
        `Reordenar las paradas DENTRO de estas rutas:\n\n` +
          routeList +
          overflow +
          `\n\n` +
          `El algoritmo (VROOM) calcula el orden más corto para cada camioneta. ` +
          `NO mueve paradas entre camionetas (para eso usa el lasso del mapa). ` +
          `Rutas ya publicadas / en curso se ignoran.\n\n` +
          `Tarda ~3 segundos por ruta.`,
      );
      if (!ok) return;
      setConfirmed(true);
    }
    startTransition(async () => {
      const res = await optimizeDayAction(fecha);
      if (!res.ok && (res.routesOptimized ?? 0) === 0) {
        toast.error('No se pudo optimizar el día', res.error);
        setConfirmed(false);
        return;
      }
      const failed = res.routesFailed?.length ?? 0;
      if (failed > 0) {
        toast.warning(
          `${res.routesOptimized ?? 0} rutas optimizadas, ${failed} fallaron`,
          res.routesFailed?.[0]?.reason ?? '',
        );
      } else {
        toast.success(`Día re-optimizado · ${res.routesOptimized ?? 0} rutas`);
      }
      router.refresh();
      setConfirmed(false);
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={run}
      isLoading={pending}
      disabled={pending}
      title={`Reordena las paradas DENTRO de cada una de las ${optimizableCount} rutas optimizables del día. NO mueve paradas entre camionetas (usa el lasso del mapa para eso). Rutas publicadas se ignoran.`}
    >
      ⚡ Optimizar día ({optimizableCount})
    </Button>
  );
}
