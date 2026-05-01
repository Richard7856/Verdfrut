// Pantalla de creación de ruta. Filtra tiendas/camiones/choferes por zona seleccionada.
// Llama a createAndOptimizeRoute via Server Action.

import { PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { listStores } from '@/lib/queries/stores';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { NewRouteForm } from './new-route-form';

export const metadata = { title: 'Nueva ruta' };

export default async function NewRoutePage() {
  await requireRole('admin', 'dispatcher');

  const [zones, stores, vehicles, drivers] = await Promise.all([
    listZones(),
    listStores({ activeOnly: true }),
    listVehicles({ activeOnly: true }),
    listDrivers({ activeOnly: true }),
  ]);

  const activeZones = zones.filter((z) => z.isActive);

  return (
    <>
      <PageHeader
        title="Nueva ruta"
        description="Selecciona zona, fecha, camiones, tiendas y opcionalmente chofer. El optimizador asigna y ordena las paradas."
      />
      <NewRouteForm
        zones={activeZones}
        stores={stores}
        vehicles={vehicles}
        drivers={drivers}
      />
    </>
  );
}
