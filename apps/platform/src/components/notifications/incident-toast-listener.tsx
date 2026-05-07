'use client';

// Componente cliente que monta el hook de notificaciones para el admin/dispatcher.
// Sin UI propia — solo dispara toasts y sonidos cuando llegan eventos de incidencia.
//
// Mount: en (app)/layout.tsx, una sola vez por sesión, después de Sidebar.
// El componente sabe el rol del viewer y se desactiva (no-op) para zone_manager
// y driver — esos roles no son destinatarios de las notificaciones de admin.

import type { UserRole } from '@verdfrut/types';
import { useIncidentNotifications } from '@/lib/use-incident-notifications';

interface Props {
  role: UserRole;
  zoneId: string | null;
}

export function IncidentToastListener({ role, zoneId }: Props) {
  // Solo admin/dispatcher reciben las notificaciones (zone_manager opera 1 chat
  // a la vez, no necesita push de "nuevos reportes" — ya está EN su chat).
  const isDestinatario = role === 'admin' || role === 'dispatcher';

  // Hook condicional via early return: si no es destinatario, no se ejecuta el hook.
  // Hooks rules: el orden de hooks importa, pero como este componente solo monta
  // o no según la prop estática `role`, podemos hacer este pattern con seguridad.
  if (!isDestinatario) return null;
  return <ListenerInner zoneId={zoneId} />;
}

function ListenerInner({ zoneId }: { zoneId: string | null }) {
  useIncidentNotifications(zoneId);
  return null;
}
