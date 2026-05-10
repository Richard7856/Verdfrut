// Inventario — fuera del scope V1 (es un módulo aparte que tracking de productos por SKU).
// Lo dejamos visible en el sidebar pero como placeholder.

import { EmptyState, PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Inventario' };

export default async function InventoryPage() {
  await requireRole('admin', 'dispatcher');
  return (
    <>
      <PageHeader
        title="Inventario"
        description="Catálogo de productos y SKUs en tránsito."
      />
      <EmptyState
        title="Inventario — fuera de scope V1"
        description="TripDrive V1 trabaja con demanda agregada por tienda (kg/m³/cajas). El módulo de inventario por SKU se evalúa para V2 si los clientes lo requieren."
      />
    </>
  );
}
