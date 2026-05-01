// CRUD de camiones.

import { Badge, DataTable, EmptyState, PageHeader, type Column, type BadgeTone } from '@verdfrut/ui';
import type { Vehicle, VehicleStatus } from '@verdfrut/types';
import { requireRole } from '@/lib/auth';
import { listVehicles } from '@/lib/queries/vehicles';
import { listZones } from '@/lib/queries/zones';
import { CreateVehicleButton } from './create-vehicle-button';
import { ToggleVehicleActiveCell } from './toggle-vehicle-active-cell';

export const metadata = { title: 'Camiones' };

const STATUS_LABELS: Record<VehicleStatus, string> = {
  available: 'Disponible',
  in_route: 'En ruta',
  maintenance: 'Mantenimiento',
  inactive: 'Inactivo',
};

const STATUS_TONES: Record<VehicleStatus, BadgeTone> = {
  available: 'success',
  in_route: 'info',
  maintenance: 'warning',
  inactive: 'neutral',
};

export default async function VehiclesPage() {
  await requireRole('admin', 'dispatcher');

  const [vehicles, zones] = await Promise.all([listVehicles(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  if (zones.length === 0) {
    return (
      <>
        <PageHeader title="Camiones" description="Flota disponible." />
        <EmptyState
          title="Primero crea al menos una zona"
          description="Cada camión debe pertenecer a una zona. Ve a Configuración → Zonas."
        />
      </>
    );
  }

  const columns: Column<Vehicle>[] = [
    { key: 'plate', header: 'Placa', cell: (v) => <span className="font-mono">{v.plate}</span> },
    {
      key: 'alias',
      header: 'Alias',
      cell: (v) => v.alias ?? <span className="text-[var(--color-text-subtle)]">—</span>,
    },
    {
      key: 'zone',
      header: 'Zona',
      cell: (v) => zonesById.get(v.zoneId)?.code ?? '—',
    },
    {
      key: 'capacity',
      header: 'Capacidad',
      cell: (v) => {
        const [weight, volume, boxes] = v.capacity;
        return (
          <span className="text-xs text-[var(--color-text-muted)]">
            {weight ?? 0} kg · {volume ?? 0} m³ · {boxes ?? 0} cajas
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (v) => <Badge tone={STATUS_TONES[v.status]}>{STATUS_LABELS[v.status]}</Badge>,
    },
    {
      key: 'active',
      header: '',
      align: 'right',
      cell: (v) => <ToggleVehicleActiveCell vehicle={v} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Camiones"
        description={`${vehicles.length} camión(es) en la flota.`}
        action={<CreateVehicleButton zones={zones} />}
      />
      <DataTable
        columns={columns}
        rows={vehicles}
        rowKey={(v) => v.id}
        emptyTitle="Sin camiones registrados"
        emptyDescription="Agrega el primer camión con su capacidad por dimensión."
        emptyAction={<CreateVehicleButton zones={zones} />}
      />
    </>
  );
}
