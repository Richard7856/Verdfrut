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
  /** Cuántas rutas en estado DRAFT/OPTIMIZED hay hoy — si 0, deshabilita. */
  optimizableCount: number;
}

export function OptimizeDayButton({ fecha, optimizableCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);

  if (optimizableCount === 0) {
    return null;
  }

  function run() {
    if (!confirmed) {
      const ok = confirm(
        `Re-optimizar ${optimizableCount} ruta(s) del día. Cada ruta reordena sus paradas con VROOM, sin mover paradas entre camionetas.\n\n` +
          `Tarda ~3s por ruta. Las rutas en curso (publicadas) NO se tocan.`,
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
      title={`Reordena paradas dentro de cada una de las ${optimizableCount} rutas (DRAFT/OPTIMIZED) del día. No mueve paradas entre camionetas.`}
    >
      ⚡ Optimizar día ({optimizableCount})
    </Button>
  );
}
