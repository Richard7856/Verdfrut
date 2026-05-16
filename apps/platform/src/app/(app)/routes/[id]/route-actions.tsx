'use client';

// Acciones contextuales según el estado de la ruta:
//   DRAFT     → Re-optimizar | Cancelar
//   OPTIMIZED → Re-optimizar | Aprobar | Cancelar
//   APPROVED  → Publicar | Cancelar (vuelve a OPTIMIZED si quieres re-optimizar)
//   PUBLISHED+ → (read-only — modificaciones requieren versión nueva)

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';
import type { Route } from '@tripdrive/types';
import {
  approveRouteAction,
  approveAndPublishRouteAction,
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

  // ADR-108: shortcut "Publicar directo" desde DRAFT u OPTIMIZED. Salta el
  // optimize (acepta el orden actual) + aprueba + publica + notifica chofer.
  function handlePublishDirect() {
    if (!route.driverId) {
      toast.error(
        'Sin chofer asignado',
        'Asigna un chofer en el detalle del tiro antes de publicar.',
      );
      return;
    }
    if (
      !confirm(
        '¿Publicar directo al chofer?\n\n' +
          'El chofer recibirá las paradas en el ORDEN ACTUAL. No se va a re-optimizar.\n\n' +
          'Útil cuando ya armaste la ruta visualmente o moviste paradas a mano.',
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await approveAndPublishRouteAction(route.id);
      if (res.ok) {
        toast.success('Ruta publicada al chofer', 'El chofer recibió push notification.');
        router.refresh();
      } else {
        toast.error('Error al publicar', res.error);
      }
    });
  }

  // DRAFT — recién creada o con paradas armadas manualmente.
  // 2 caminos:
  //  a) Optimizar (legacy) → VROOM re-ordena → APPROVED → publicar luego
  //  b) Aprobar sin optimizar O Publicar directo → acepta el orden actual
  if (route.status === 'DRAFT') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleReoptimize} isLoading={pending}>
          Optimizar con VROOM
        </Button>
        <Button variant="primary" onClick={handlePublishDirect} isLoading={pending}>
          🚀 Publicar directo
        </Button>
        <Button variant="ghost" onClick={handleCancel} isLoading={pending}>
          Cancelar
        </Button>
      </div>
    );
  }

  if (route.status === 'OPTIMIZED') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleReoptimize} isLoading={pending}>
          Re-optimizar
        </Button>
        <Button variant="secondary" onClick={handleApprove} isLoading={pending}>
          Aprobar
        </Button>
        <Button variant="primary" onClick={handlePublishDirect} isLoading={pending}>
          🚀 Publicar directo
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
