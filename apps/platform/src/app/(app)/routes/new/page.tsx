// Pantalla de creación de ruta. Filtra tiendas/camiones/choferes por zona seleccionada.
// Llama a createAndOptimizeRoute via Server Action.

import { PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { listStores } from '@/lib/queries/stores';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { getDispatch } from '@/lib/queries/dispatches';
import { NewRouteForm } from './new-route-form';

export const metadata = { title: 'Nueva ruta' };

interface Props {
  searchParams: Promise<{ dispatchId?: string }>;
}

export default async function NewRoutePage({ searchParams }: Props) {
  await requireRole('admin', 'dispatcher');
  const { dispatchId } = await searchParams;

  // Si viene de un tiro, pre-fill date/zone con los del tiro.
  const dispatch = dispatchId ? await getDispatch(dispatchId) : null;

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
        description={
          dispatch
            ? `Esta ruta se vinculará al tiro "${dispatch.name}".`
            : 'Selecciona zona, fecha, camiones, tiendas y opcionalmente chofer. El optimizador asigna y ordena las paradas.'
        }
      />
      <NewRouteForm
        zones={activeZones}
        stores={stores}
        vehicles={vehicles}
        drivers={drivers}
        dispatch={dispatch}
      />
    </>
  );
}
