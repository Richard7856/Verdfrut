// Bandeja de incidencias — reportes de chofer (tienda cerrada, báscula, rechazos, merma).
// Se conecta cuando el driver app de Fase 2 empiece a generar delivery_reports.

import { EmptyState, PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Incidencias' };

export default async function IncidentsPage() {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  return (
    <>
      <PageHeader
        title="Incidencias"
        description="Bandeja de problemas reportados por choferes durante la ejecución de rutas."
      />
      <EmptyState
        title="Sin incidencias"
        description="Cuando los choferes reporten tienda cerrada, báscula, rechazos o merma desde la app móvil (Fase 2), aparecerán aquí en tiempo real."
      />
    </>
  );
}
