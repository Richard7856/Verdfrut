// Mapa en vivo — supervisión de choferes en ruta. Se construye en Fase 3 (GPS Realtime).

import { EmptyState, PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Mapa en vivo' };

export default async function MapPage() {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  return (
    <>
      <PageHeader
        title="Mapa en vivo"
        description="Supervisión de choferes en ruta y rastreo GPS en tiempo real."
      />
      <EmptyState
        title="Mapa en vivo — Fase 3"
        description="Se habilita junto con GPS broadcast (Supabase Realtime) cuando los choferes empiecen a publicar posición desde la PWA."
      />
    </>
  );
}
