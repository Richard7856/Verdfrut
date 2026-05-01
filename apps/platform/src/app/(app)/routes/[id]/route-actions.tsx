'use client';

// Acciones contextuales según el estado de la ruta:
//   DRAFT     → Re-optimizar | Cancelar
//   OPTIMIZED → Re-optimizar | Aprobar | Cancelar
//   APPROVED  → Publicar | Cancelar (vuelve a OPTIMIZED si quieres re-optimizar)
//   PUBLISHED+ → (read-only — modificaciones requieren versión nueva)

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@verdfrut/ui';
import type { Route } from '@verdfrut/types';
import {
  approveRouteAction,
  publishRouteAction,
  cancelRouteAction,
  reoptimizeRouteAction,
} from '../actions';

export function RouteActions({ route }: { route: Route }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleApprove() {
    startTransition(async () => {
      const res = await approveRouteAction(route.id);
      if (res.ok) {
        toast.success('Ruta aprobada');
        router.refresh();
      } else {
        toast.error('Error al aprobar', res.error);
      }
    });
  }

  function handlePublish() {
    if (!confirm('¿Publicar esta ruta? El chofer asignado recibirá una notificación.')) return;
    startTransition(async () => {
      const res = await publishRouteAction(route.id);
      if (res.ok) {
        toast.success('Ruta publicada');
        router.refresh();
      } else {
        toast.error('Error al publicar', res.error);
      }
    });
  }

  function handleCancel() {
    if (!confirm('¿Cancelar esta ruta? Esta acción se puede deshacer creando una ruta nueva.')) return;
    startTransition(async () => {
      const res = await cancelRouteAction(route.id);
      if (res.ok) {
        toast.success('Ruta cancelada');
        router.refresh();
      } else {
        toast.error('Error al cancelar', res.error);
      }
    });
  }

  function handleReoptimize() {
    if (!confirm('¿Re-optimizar? Las paradas actuales se reordenarán según el optimizador.')) return;
    startTransition(async () => {
      const res = await reoptimizeRouteAction(route.id);
      if (res.ok) {
        if (res.unassignedStoreIds && res.unassignedStoreIds.length > 0) {
          toast.warning(
            'Re-optimizada con paradas sin asignar',
            `${res.unassignedStoreIds.length} tiendas no cupieron.`,
          );
        } else {
          toast.success('Ruta re-optimizada');
        }
        router.refresh();
      } else {
        toast.error('Error al re-optimizar', res.error);
      }
    });
  }

  // DRAFT — vacía o sin optimizar todavía
  if (route.status === 'DRAFT') {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleReoptimize} isLoading={pending}>
          Optimizar
        </Button>
        <Button variant="ghost" onClick={handleCancel} isLoading={pending}>
          Cancelar
        </Button>
      </div>
    );
  }

  if (route.status === 'OPTIMIZED') {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleReoptimize} isLoading={pending}>
          Re-optimizar
        </Button>
        <Button variant="primary" onClick={handleApprove} isLoading={pending}>
          Aprobar
        </Button>
        <Button variant="ghost" onClick={handleCancel} isLoading={pending}>
          Cancelar
        </Button>
      </div>
    );
  }

  if (route.status === 'APPROVED') {
    return (
      <div className="flex gap-2">
        <Button variant="primary" onClick={handlePublish} isLoading={pending}>
          Publicar a chofer
        </Button>
        <Button variant="ghost" onClick={handleCancel} isLoading={pending}>
          Cancelar
        </Button>
      </div>
    );
  }

  // PUBLISHED, IN_PROGRESS, COMPLETED, CANCELLED — sin acciones disponibles aquí.
  return null;
}
